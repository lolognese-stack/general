// Endpoints del Inbox (Pages Functions del CRM). Son módulos planos que solo
// usan env.DB y env.SETTER, así que se prueban acá con la misma D1 de test.
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as lista from '../../functions/api/setter/conversaciones.js';
import * as chat from '../../functions/api/setter/conversaciones/[id].js';
import * as enviar from '../../functions/api/setter/conversaciones/[id]/enviar.js';
import * as contactos from '../../functions/api/setter/contactos.js';
import { enviar as enviarWorker } from '../src/enviar.js';
import * as pulso from '../../functions/api/setter/pulso.js';
import * as estado from '../../functions/api/setter/estado.js';
import { prepararDb, webhookFirmado, payloadMensaje } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const pedido = (ruta, init = {}) => new Request('https://crm.test' + ruta, { ...init, headers: { 'x-crm-token': 'tok', ...(init.headers || {}) } });

// El Service Binding del panel apunta al Worker de verdad (exports.default).
const setterFetch = vi.fn((url, init) => exports.default.fetch(url, init));
const envCrm = () => ({ ...env, CRM_TOKEN: 'tok', SETTER_INTERNAL_SECRET: env.SETTER_INTERNAL_SECRET, SETTER: { fetch: setterFetch } });

async function nombres(query) {
  const r = await lista.onRequestGet({ request: pedido('/api/setter/conversaciones?' + query), env: envCrm() });
  return (await r.json()).map((c) => c.nombre);
}

beforeEach(async () => {
  await prepararDb();
  setterFetch.mockClear();
  await webhookFirmado(exports.default, payloadMensaje({ waId: '51911111111', nombre: 'Lucía', id: 'w1', texto: 'Hola, Cusco' }));
  await webhookFirmado(exports.default, payloadMensaje({ waId: '51922222222', nombre: 'Pedro', id: 'w2', texto: 'Quiero hablar con alguien', en: new Date(Date.now() - 3 * 86400000).toISOString() }));
});

describe('estado y auth', () => {
  it('sin token, 401', async () => {
    const r = await lista.onRequestGet({ request: new Request('https://crm.test/api/setter/conversaciones'), env: envCrm() });
    expect(r.status).toBe(401);
  });
  it('sin Service Binding, el setter está inactivo', async () => {
    const r = await estado.onRequestGet({ request: pedido('/api/setter/estado'), env: { ...env, CRM_TOKEN: 'tok' } });
    expect(await r.json()).toEqual({ activo: false });
  });
});

describe('filtros de la lista', () => {
  it('trae todos con el último mensaje copiado en la conversación', async () => {
    const r = await lista.onRequestGet({ request: pedido('/api/setter/conversaciones'), env: envCrm() });
    const l = await r.json();
    expect(l.map((c) => c.nombre)).toEqual(['Lucía', 'Pedro']);
    expect(l[0]).toMatchObject({ ultimo_texto: 'Hola, Cusco', ultimo_autor: 'lead', no_leidos: 1 });
  });
  it('urgentes, quién responde, búsqueda y actividad', async () => {
    await env.DB.prepare(`UPDATE wa_conversaciones SET espera_persona = 1, ia_activa = 0 WHERE wa_id = '51922222222'`).run();
    expect(await nombres('urgentes=1')).toEqual(['Pedro']);
    expect(await nombres('responde=humano')).toEqual(['Pedro']);
    expect(await nombres('responde=ia')).toEqual(['Lucía']);
    expect(await nombres('q=cusco')).toEqual(['Lucía']);
    expect(await nombres('q=2222')).toEqual(['Pedro']);
    expect(await nombres('actividad=hoy')).toEqual(['Lucía']);
  });
  it('urgentes primero en el orden', async () => {
    await env.DB.prepare(`UPDATE wa_conversaciones SET espera_persona = 1 WHERE wa_id = '51922222222'`).run();
    expect(await nombres('')).toEqual(['Pedro', 'Lucía']);
  });
});

describe('acciones', () => {
  const patch = async (id, body) => chat.onRequestPatch({ request: pedido('/x', { method: 'PATCH', body: JSON.stringify(body) }), env: envCrm(), params: { id } });

  it('tomar control y devolver a la IA', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51911111111'`);
    await env.DB.prepare('UPDATE wa_conversaciones SET espera_persona = 1 WHERE id = ?').bind(id).run();
    await patch(id, { accion: 'tomar_control' });
    expect(await uno('SELECT ia_activa, ia_pausa_motivo FROM wa_conversaciones WHERE id = ?', id)).toEqual({ ia_activa: 0, ia_pausa_motivo: 'manual' });
    await patch(id, { accion: 'devolver_ia' });
    expect(await uno('SELECT ia_activa, ia_pausa_motivo, espera_persona FROM wa_conversaciones WHERE id = ?', id)).toEqual({ ia_activa: 1, ia_pausa_motivo: null, espera_persona: 0 });
    expect(await uno(`SELECT count(*) n FROM setter_eventos WHERE conversacion_id = ? AND tipo IN ('pausa', 'reanuda')`, id)).toEqual({ n: 2 });
  });

  it('asignar y filtrar por "míos"', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    await patch(id, { accion: 'asignar', asignada_a: 'Majo' });
    expect(await nombres('asignacion=mios&yo=Majo')).toEqual(['Pedro']);
    expect(await nombres('asignacion=sin_asignar')).toEqual(['Lucía']);
  });

  it('leer pone en 0 los no leídos', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51911111111'`);
    await patch(id, { accion: 'leer' });
    expect(await uno('SELECT no_leidos FROM wa_conversaciones WHERE id = ?', id)).toEqual({ no_leidos: 0 });
  });

  it('el hilo trae mensajes, lead y análisis', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51911111111'`);
    const r = await chat.onRequestGet({ request: pedido('/x'), env: envCrm(), params: { id } });
    const d = await r.json();
    expect(d.lead).toMatchObject({ nombre: 'Lucía', fuente: 'WhatsApp' });
    expect(d.mensajes.map((m) => m.texto)).toEqual(['Hola, Cusco']);
    expect(d.analisis).toBe(null);
  });
});

describe('responder desde el CRM', () => {
  it('manda por el Worker, pausa la IA y saca el chat de urgentes', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51911111111'`);
    await env.DB.prepare('UPDATE wa_conversaciones SET espera_persona = 1 WHERE id = ?').bind(id).run();
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
      String(url).startsWith('https://graph.facebook.com/') ? Promise.resolve(Response.json({ messages: [{ id: 'wamid.WEB1' }] })) : original(url, init));
    const r = await enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ texto: 'Hola Lucía, soy Majo' }) }), env: envCrm(), params: { id } });
    expect(r.status).toBe(200);
    expect(setterFetch).toHaveBeenCalledOnce();
    expect(await uno('SELECT ia_activa, ia_pausa_motivo, espera_persona, ultimo_autor FROM wa_conversaciones WHERE id = ?', id))
      .toEqual({ ia_activa: 0, ia_pausa_motivo: 'asesora_respondio', espera_persona: 0, ultimo_autor: 'asesora_web' });
    expect(await uno(`SELECT autor, texto FROM wa_mensajes WHERE provider_id = 'wamid.WEB1'`)).toEqual({ autor: 'asesora_web', texto: 'Hola Lucía, soy Majo' });
    vi.restoreAllMocks();
  });

  it('con la ventana cerrada el equipo manda igual: el pedido sale a Meta', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    const original = globalThis.fetch;
    const meta = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
      String(url).startsWith('https://graph.facebook.com/') ? Promise.resolve(Response.json({ messages: [{ id: 'wamid.CERR1' }] })) : original(url, init));
    const r = await enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ texto: 'Hola' }) }), env: envCrm(), params: { id } });
    expect(r.status).toBe(200);
    expect(meta.mock.calls.some(([u]) => String(u).startsWith('https://graph.facebook.com/'))).toBe(true);
    expect(await uno(`SELECT autor, texto FROM wa_mensajes WHERE provider_id = 'wamid.CERR1'`)).toEqual({ autor: 'asesora_web', texto: 'Hola' });
    vi.restoreAllMocks();
  });

  it('si Meta rechaza el mensaje, vuelve su error y la IA no se pausa', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
      String(url).startsWith('https://graph.facebook.com/')
        ? Promise.resolve(Response.json({ error: { message: 'Re-engagement message', code: 131047 } }, { status: 400 }))
        : original(url, init));
    const r = await enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ texto: 'Hola' }) }), env: envCrm(), params: { id } });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain('Re-engagement');
    expect(await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', id)).toEqual({ ia_activa: 1 });
    vi.restoreAllMocks();
  });

  it('manda la plantilla de primer contacto con el nombre y pausa la IA', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    const original = globalThis.fetch;
    const meta = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
      String(url).startsWith('https://graph.facebook.com/') ? Promise.resolve(Response.json({ messages: [{ id: 'wamid.PL1' }] })) : original(url, init));
    const r = await enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ plantilla: { nombre: 'contacto_lead_viaje', idioma: 'es', params: ['Pedro'] } }) }), env: envCrm(), params: { id } });
    expect(r.status).toBe(200);
    const cuerpo = JSON.parse(meta.mock.calls.find(([u]) => String(u).startsWith('https://graph.facebook.com/'))[1].body);
    expect(cuerpo).toMatchObject({ type: 'template', template: { name: 'contacto_lead_viaje', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Pedro' }] }] } });
    expect(await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', id)).toEqual({ ia_activa: 0 });
    vi.restoreAllMocks();
  });

  it('plantilla con nombre inválido o sin dato, 400', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    const pedir = (plantilla) => enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ plantilla }) }), env: envCrm(), params: { id } });
    expect((await pedir({ nombre: 'Mal Nombre!', params: ['x'] })).status).toBe(400);
    expect((await pedir({ nombre: 'contacto_lead_viaje', params: [''] })).status).toBe(400);
  });

  it('los envíos automáticos (IA) siguen sin poder salir con la ventana cerrada', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    await expect(enviarWorker(env, {}, { conversacionId: id, texto: 'x', autor: 'ia' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('pulso', () => {
  it('da el último cambio y las urgentes', async () => {
    await env.DB.prepare(`UPDATE wa_conversaciones SET espera_persona = 1 WHERE wa_id = '51922222222'`).run();
    const r = await pulso.onRequestGet({ request: pedido('/api/setter/pulso'), env: envCrm() });
    const d = await r.json();
    expect(d.activo).toBe(true);
    expect(d.ultimo).toBeTruthy();
    expect(d.urgentes).toHaveLength(1);
  });
});

describe('agregar contacto a mano', () => {
  const alta = (body, token = 'tok') => contactos.onRequestPost({
    request: new Request('https://crm.test/api/setter/contactos', { method: 'POST', body: JSON.stringify(body), headers: { 'x-crm-token': token } }),
    env: envCrm(),
  });

  it('sin token, 401', async () => {
    expect((await alta({ whatsapp: '+51 930 299 443' }, 'malo')).status).toBe(401);
  });

  it('número inválido, 400', async () => {
    const r = await alta({ nombre: 'Ana', whatsapp: 'abc' });
    expect(r.status).toBe(400);
  });

  it('crea lead y conversación con la IA pausada', async () => {
    const r = await alta({ nombre: 'Ana Torres', whatsapp: '+51 930 299 443' });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.creado).toBe(true);
    const conv = await uno('SELECT * FROM wa_conversaciones WHERE id = ?', d.conversacion_id);
    expect(conv.wa_id).toBe('51930299443');
    expect(conv.ia_activa).toBe(0);
    expect(conv.ia_pausa_motivo).toBe('manual');
    expect(conv.abierta_por).toBe('nosotros');
    const lead = await uno('SELECT nombre, whatsapp, wa_id FROM leads WHERE id = ?', d.lead_id);
    expect(lead).toMatchObject({ nombre: 'Ana Torres', wa_id: '51930299443' });
  });

  it('repetir el número no duplica ni toca la IA de un chat existente', async () => {
    const antes = await uno('SELECT id, ia_activa FROM wa_conversaciones WHERE wa_id = ?', '51911111111');
    const r = await alta({ nombre: 'Otro nombre', whatsapp: '51911111111' });
    const d = await r.json();
    expect(d).toMatchObject({ creado: false, conversacion_id: antes.id });
    const despues = await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', antes.id);
    expect(despues.ia_activa).toBe(antes.ia_activa);
    const n = await uno('SELECT count(*) n FROM wa_conversaciones WHERE wa_id = ?', '51911111111');
    expect(n.n).toBe(1);
  });
});

describe('nota interna', () => {
  const nota = (body, secreto = env.SETTER_INTERNAL_SECRET) => exports.default.fetch('https://setter-worker/interno/nota', {
    method: 'POST', body: JSON.stringify(body), headers: { 'x-setter-secret': secreto, 'content-type': 'application/json' },
  });

  it('sin secreto, 401', async () => {
    expect((await nota({ whatsapp: '51930299443', texto: 'x' }, 'malo')).status).toBe(401);
  });

  it('crea el chat, guarda la nota, sube como urgente y no sale a WhatsApp', async () => {
    const r = await nota({ nombre: 'Ana', whatsapp: '+51 930 299 443', texto: 'Aviso de lead\nFALTA: Mail' });
    expect(r.status).toBe(200);
    const d = await r.json();
    const conv = await uno('SELECT * FROM wa_conversaciones WHERE id = ?', d.conversacion_id);
    expect(conv).toMatchObject({ wa_id: '51930299443', ia_activa: 0, espera_persona: 1, no_leidos: 1, ultimo_texto: 'Aviso de lead', ultimo_autor: 'sistema' });
    const m = await uno('SELECT autor, tipo, direccion, texto FROM wa_mensajes WHERE conversacion_id = ?', d.conversacion_id);
    expect(m).toMatchObject({ autor: 'sistema', tipo: 'nota', direccion: 'out' });
    expect(m.texto).toContain('FALTA: Mail');
  });

  it('en un chat existente no toca la IA y suma la nota', async () => {
    const antes = await uno('SELECT id, ia_activa FROM wa_conversaciones WHERE wa_id = ?', '51911111111');
    const r = await nota({ whatsapp: '51911111111', texto: 'Otra nota' });
    expect(await r.json()).toMatchObject({ creado: false, conversacion_id: antes.id });
    const despues = await uno('SELECT ia_activa, espera_persona FROM wa_conversaciones WHERE id = ?', antes.id);
    expect(despues).toMatchObject({ ia_activa: antes.ia_activa, espera_persona: 1 });
  });

  it('nota vacía o número inválido, 400', async () => {
    expect((await nota({ whatsapp: '51930299443', texto: '  ' })).status).toBe(400);
    expect((await nota({ whatsapp: 'abc', texto: 'x' })).status).toBe(400);
  });
});

describe('manychat_id en el chat', () => {
  it('el chat trae el manychat_id del lead para el botón de ManyChat', async () => {
    const c = await uno('SELECT id, lead_id FROM wa_conversaciones WHERE wa_id = ?', '51911111111');
    await env.DB.prepare('UPDATE leads SET manychat_id = ? WHERE id = ?').bind('1234567890', c.lead_id).run();
    const r = await chat.onRequestGet({ request: pedido('/api/setter/conversaciones/' + c.id), env: envCrm(), params: { id: String(c.id) } });
    expect((await r.json()).lead.manychat_id).toBe('1234567890');
  });
});

describe('asociar un chat a un lead', () => {
  const patch = (id, body) => chat.onRequestPatch({ request: pedido('/x', { method: 'PATCH', body: JSON.stringify(body) }), env: envCrm(), params: { id: String(id) } });

  it('engancha el chat al lead elegido, completa su número y borra el lead vacío que se creó solo', async () => {
    const ahora = new Date().toISOString();
    const real = (await env.DB.prepare(`INSERT INTO leads (nombre, whatsapp, etapa, creado_en, actualizado_en) VALUES ('Ulises', '+34 600 111 222', 'lead_nuevo', ?1, ?1)`).bind(ahora).run()).meta.last_row_id;
    await webhookFirmado(exports.default, payloadMensaje({ waId: '51955555555', nombre: null, id: 'wamid.ASOC1', texto: 'Hola' }));
    const conv = await uno(`SELECT id, lead_id FROM wa_conversaciones WHERE wa_id = '51955555555'`);
    expect((await uno('SELECT nombre FROM leads WHERE id = ?', conv.lead_id)).nombre).toBe('+51955555555');

    const r = await patch(conv.id, { accion: 'asociar_lead', lead_id: real });
    expect(r.status).toBe(200);
    expect((await r.json()).otro_chat).toBeNull();
    expect(await uno('SELECT lead_id FROM wa_conversaciones WHERE id = ?', conv.id)).toEqual({ lead_id: real });
    expect(await uno('SELECT wa_id, whatsapp FROM leads WHERE id = ?', real)).toEqual({ wa_id: '51955555555', whatsapp: '+34 600 111 222' });
    expect(await uno('SELECT count(*) n FROM leads WHERE id = ?', conv.lead_id)).toEqual({ n: 0 });
  });

  it('un lead que no existe, 404; y no se borra un lead con datos', async () => {
    const conv = await uno(`SELECT id, lead_id FROM wa_conversaciones WHERE wa_id = '51911111111'`);
    expect((await patch(conv.id, { accion: 'asociar_lead', lead_id: 99999 })).status).toBe(404);
    expect((await patch(conv.id, { accion: 'asociar_lead', lead_id: 'x' })).status).toBe(404);
    expect(await uno('SELECT count(*) n FROM leads WHERE id = ?', conv.lead_id)).toEqual({ n: 1 });
  });
});

describe('anclar y cotizador', () => {
  const patch = (id, body) => chat.onRequestPatch({ request: pedido('/x', { method: 'PATCH', body: JSON.stringify(body) }), env: envCrm(), params: { id: String(id) } });
  const listado = async (q = '') => (await lista.onRequestGet({ request: pedido('/api/setter/conversaciones' + q), env: envCrm() })).json();
  const convDe = (wa) => uno('SELECT id, lead_id FROM wa_conversaciones WHERE wa_id = ?', wa);

  it('un chat anclado va primero, aunque otro espere a una persona', async () => {
    const lucia = await convDe('51911111111'), pedro = await convDe('51922222222');
    await env.DB.prepare('UPDATE wa_conversaciones SET espera_persona = 1 WHERE id = ?').bind(lucia.id).run();
    await env.DB.prepare('UPDATE wa_conversaciones SET espera_persona = 0 WHERE id = ?').bind(pedro.id).run();
    expect((await listado())[0].id).toBe(lucia.id);
    expect((await patch(pedro.id, { accion: 'anclar', anclada: true })).status).toBe(200);
    const l = await listado();
    expect(l[0].id).toBe(pedro.id);
    expect(l[0].anclada).toBe(1);
    await patch(pedro.id, { accion: 'anclar', anclada: false });
    expect((await listado())[0].id).toBe(lucia.id);
  });

  it('marcar al cotizador: lo ancla, le pone nombre, pausa la IA y borra el lead que se creó solo', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ waId: '51930299443', nombre: null, id: 'wamid.COT1', texto: '.' }));
    const c = await convDe('51930299443');
    expect((await uno('SELECT nombre FROM leads WHERE id = ?', c.lead_id)).nombre).toBe('+51930299443');

    expect((await patch(c.id, { accion: 'rol', rol: 'cotizador' })).status).toBe(400);   // falta el nombre
    expect((await patch(c.id, { accion: 'rol', rol: 'jefe', alias: 'X' })).status).toBe(400);
    expect((await patch(c.id, { accion: 'rol', rol: 'cotizador', alias: ' Álvaro ' })).status).toBe(200);

    expect(await uno('SELECT rol, alias, anclada, ia_activa, lead_id FROM wa_conversaciones WHERE id = ?', c.id))
      .toEqual({ rol: 'cotizador', alias: 'Álvaro', anclada: 1, ia_activa: 0, lead_id: null });
    expect(await uno('SELECT count(*) n FROM leads WHERE id = ?', c.lead_id)).toEqual({ n: 0 });
    const cot = await listado('?rol=cotizador');
    expect(cot.map((x) => x.id)).toEqual([c.id]);
    expect(cot[0]).toMatchObject({ rol: 'cotizador', alias: 'Álvaro', anclada: 1 });
    expect((await listado('?q=lvaro')).map((x) => x.id)).toEqual([c.id]);
    expect((await listado())[0].id).toBe(c.id);
  });

  it('hay un solo cotizador, y un chat con lead de verdad no pierde su lead', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ waId: '51930299443', nombre: null, id: 'wamid.COT2', texto: '.' }));
    const a = await convDe('51930299443'), lucia = await convDe('51911111111');
    await patch(a.id, { accion: 'rol', rol: 'cotizador', alias: 'Álvaro' });
    await patch(lucia.id, { accion: 'rol', rol: 'cotizador', alias: 'Lucía' });
    expect((await listado('?rol=cotizador')).map((x) => x.id)).toEqual([lucia.id]);
    expect(await uno('SELECT lead_id FROM wa_conversaciones WHERE id = ?', lucia.id)).toEqual({ lead_id: lucia.lead_id });
    expect(await uno('SELECT rol FROM wa_conversaciones WHERE id = ?', a.id)).toEqual({ rol: null });

    await patch(lucia.id, { accion: 'rol', rol: '' });
    expect((await listado('?rol=cotizador')).length).toBe(0);
    expect(await uno('SELECT anclada FROM wa_conversaciones WHERE id = ?', lucia.id)).toEqual({ anclada: 1 });
  });
});

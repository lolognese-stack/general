// Endpoints del Inbox (Pages Functions del CRM). Son módulos planos que solo
// usan env.DB y env.SETTER, así que se prueban acá con la misma D1 de test.
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as lista from '../../functions/api/setter/conversaciones.js';
import * as chat from '../../functions/api/setter/conversaciones/[id].js';
import * as enviar from '../../functions/api/setter/conversaciones/[id]/enviar.js';
import * as contactos from '../../functions/api/setter/contactos.js';
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

  it('si el Worker rechaza (ventana cerrada), no pausa la IA', async () => {
    const { id } = await uno(`SELECT id FROM wa_conversaciones WHERE wa_id = '51922222222'`);
    const r = await enviar.onRequestPost({ request: pedido('/x', { method: 'POST', body: JSON.stringify({ texto: 'Hola' }) }), env: envCrm(), params: { id } });
    expect(r.status).toBe(409);
    expect(await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', id)).toEqual({ ia_activa: 1 });
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

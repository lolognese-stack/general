// Primera semana con el número real: de día contesta el equipo, de noche la
// IA (SETTER_SOLO_NOCHE), y cada mañana se proponen lecciones a partir de lo
// que contestó el equipo, que alguien aprueba en Setter IA › Para aprobar.

import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correrTurno } from '../src/agente/turno.js';
import { correrSeguimientos } from '../src/agente/seguimiento.js';
import { noche, fueraDeHorario } from '../src/agente/contexto.js';
import { aprenderSiToca, aprenderDelEquipo, aprenderDeChat } from '../src/agente/aprendizaje.js';
import { canalDe } from '../src/canal/adapter.js';
import * as sugerencias from '../../functions/api/setter/sugerencias.js';
import * as pulso from '../../functions/api/setter/pulso.js';
import { prepararDb, webhookFirmado, payloadMensaje, payloadEcho } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();

beforeEach(async () => {
  await prepararDb();
  await env.DB.prepare(`DELETE FROM setter_config WHERE clave LIKE 'aprendizaje_%'`).run();
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) return Response.json({ messages: [{ id: 'wamid.OUT' + Math.random() }], success: true });
    return original(url, init);
  });
});
afterEach(() => vi.restoreAllMocks());

function claudeFalso(respuestas) {
  const pedidos = [];
  const create = async (p) => { pedidos.push(structuredClone(p)); const r = respuestas.shift(); if (!r) throw new Error('sin respuestas'); return r; };
  return { pedidos, messages: { create }, beta: { messages: { create } } };
}
const texto = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });

// Tue 3/11/2026: 12:00 y 23:00 en Argentina (UTC-3).
const MEDIODIA = '2026-11-03T15:00:00.000Z';
const NOCHE = '2026-11-04T02:00:00.000Z';
const soloNoche = { ...env, SETTER_SOLO_NOCHE: '1', SETTER_FINDE_MARCA: 'Luna Llena', SETTER_FINDE_NOMBRE: 'Sofía' };

async function chat(textoLead = 'Hola') {
  await webhookFirmado(exports.default, payloadMensaje({ texto: textoLead, id: 'wamid.L' + Math.random() }));
  const conv = await uno('SELECT * FROM wa_conversaciones');
  await env.DB.prepare(`UPDATE wa_conversaciones SET ventana_hasta = '2099-01-01T00:00:00.000Z' WHERE id = ?`).bind(conv.id).run();
  return conv;
}

describe('horario nocturno', () => {
  it('la noche va de 21 a 9 y, con SETTER_SOLO_NOCHE, se suma al fin de semana', () => {
    expect(noche(new Date('2026-11-03T23:59:00Z'))).toBeNull();                          // 20:59
    expect(noche(new Date('2026-11-04T00:00:00Z'))).toBe('2026-11-04T00:00:00.000Z');     // 21:00
    expect(noche(new Date('2026-11-04T11:59:00Z'))).toBe('2026-11-04T00:00:00.000Z');     // 08:59 del día siguiente
    expect(noche(new Date('2026-11-04T12:00:00Z'))).toBeNull();                          // 09:00
    expect(fueraDeHorario({}, NOCHE)).toBeNull();
    expect(fueraDeHorario({ SETTER_SOLO_NOCHE: '1' }, NOCHE)).toEqual({ desde: '2026-11-04T00:00:00.000Z', hasta: 'mañana' });
    expect(fueraDeHorario({ SETTER_SOLO_NOCHE: '1' }, '2026-11-01T15:00:00Z').hasta).toBe('lunes');   // domingo
  });

  it('de día no contesta: el chat queda para el equipo', async () => {
    const conv = await chat();
    const claude = claudeFalso([]);
    expect(await correrTurno(soloNoche, canalDe(env), conv.id, { claude, dormir: async () => {}, ahora: () => MEDIODIA })).toBe('horario_equipo');
    expect(claude.pedidos).toHaveLength(0);
    expect(await correrSeguimientos(soloNoche, canalDe(env), { claude, ahora: new Date(MEDIODIA) })).toEqual({ horario_equipo: true });
  });

  it('de noche retoma el chat que el equipo atendió de día y se presenta hasta mañana', async () => {
    const conv = await chat('Hola, quiero ir a Cusco');
    await webhookFirmado(exports.default, payloadEcho({ texto: 'Hola! Para cuántas personas?' }));
    expect(await uno('SELECT ia_activa, ia_pausa_motivo FROM wa_conversaciones WHERE id = ?', conv.id)).toEqual({ ia_activa: 0, ia_pausa_motivo: 'asesora_respondio' });
    await webhookFirmado(exports.default, payloadMensaje({ texto: 'Somos 2', id: 'wamid.L2', en: new Date(Date.now() + 60e3).toISOString() }));

    const claude = claudeFalso([texto('Perfecto, 2 personas. ¿Para qué fecha?')]);
    expect(await correrTurno(soloNoche, canalDe(env), conv.id, { claude, dormir: async () => {}, ahora: () => NOCHE })).toMatch(/^respondio:/);
    const sys = claude.pedidos[0].system[1].text;
    expect(sys).toContain('# Fuera del horario del equipo');
    expect(sys).toContain('Hasta mañana, que una persona del equipo pueda contestarle, va a estar hablando conmigo');
    expect(sys).toContain('Sofía, la asistente virtual de Luna Llena');
    expect(await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', conv.id)).toEqual({ ia_activa: 1 });
    expect(await uno(`SELECT count(*) AS n FROM setter_eventos WHERE tipo = 'reanuda'`)).toEqual({ n: 1 });
  });

  it('de noche no retoma lo derivado', async () => {
    const conv = await chat();
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'handoff' WHERE id = ?`).bind(conv.id).run();
    expect(await correrTurno(soloNoche, canalDe(env), conv.id, { claude: claudeFalso([]), dormir: async () => {}, ahora: () => NOCHE })).toBe('pausada');
  });
});

const SUGERENCIA = {
  tipo: 'respuesta', conversacion_id: 0, pregunta: '¿Cómo se paga?', respuesta_equipo: 'Con transferencia o tarjeta, el 30 % para reservar.',
  titulo: 'Formas de pago', contenido: 'Si preguntan algo como: «¿Cómo se paga?»\nResponde: «Con transferencia o tarjeta, el 30 % para reservar.»',
};

async function chatConRespuestaDelEquipo() {
  const conv = await chat('¿Cómo se paga?');
  await webhookFirmado(exports.default, payloadEcho({ texto: 'Con transferencia o tarjeta, el 30 % para reservar.' }));
  return conv;
}

describe('sugerencias del equipo', () => {
  it('lee lo que contestó el equipo y deja sugerencias pendientes', async () => {
    const conv = await chatConRespuestaDelEquipo();
    const claude = claudeFalso([texto(JSON.stringify({ sugerencias: [{ ...SUGERENCIA, conversacion_id: conv.id }] }))]);
    const r = await aprenderDelEquipo(env, { claude, ahora: new Date(Date.now() + 60e3) });
    expect(r).toEqual({ chats: 1, sugerencias: 1 });
    const chatEnviado = claude.pedidos[0].messages[0].content;
    expect(chatEnviado).toContain('Equipo (nuevo): Con transferencia o tarjeta');
    expect(chatEnviado).toContain('Cliente: ¿Cómo se paga?');
    const s = await uno('SELECT * FROM setter_sugerencias');
    expect(s).toMatchObject({ estado: 'pendiente', titulo: 'Formas de pago', conversacion_id: conv.id, lead_id: conv.lead_id });
    // La IA no la usa todavía: no está en la base.
    expect(await uno(`SELECT count(*) AS n FROM setter_conocimiento WHERE titulo = 'Formas de pago'`)).toEqual({ n: 0 });
  });

  it('corre una vez por día, desde las 9 de Argentina', async () => {
    await chatConRespuestaDelEquipo();
    const claude = claudeFalso([texto('{"sugerencias":[]}')]);
    const dia = Date.now() + 60e3;
    const a = new Date(dia), h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hourCycle: 'h23' }).format(a));
    // Las 8:30 y las 9:30 de "mañana" en Argentina, en base a la hora de ahora.
    const manana = new Date(dia + ((24 - h + 8) % 24 || 24) * 3600e3);
    manana.setUTCMinutes(30);
    expect(await aprenderSiToca(env, { claude, ahora: manana })).toEqual({ espera: true });
    const nueve = new Date(manana.getTime() + 3600e3);
    expect(await aprenderSiToca(env, { claude, ahora: nueve })).toEqual({ chats: 1, sugerencias: 0 });
    expect(await aprenderSiToca(env, { claude, ahora: new Date(nueve.getTime() + 900e3) })).toEqual({ ya_corrio: true });
    expect(claude.pedidos).toHaveLength(1);
  });

  it('"Aprender de este chat": lee el chat entero, con lo que pidió el equipo', async () => {
    const conv = await chatConRespuestaDelEquipo();
    // conversacion_id inventado por el modelo: se usa el chat marcado.
    const claude = claudeFalso([texto(JSON.stringify({ sugerencias: [{ ...SUGERENCIA, conversacion_id: 999 }] }))]);
    const r = await aprenderDeChat(env, { conversacion_id: conv.id, nota: 'cómo explicamos los pagos' }, { claude, ahora: new Date(Date.now() + 60e3) });
    expect(r).toEqual({ chats: 1, sugerencias: 1 });
    const pedido = claude.pedidos[0].messages[0].content;
    expect(pedido).toContain('Lo que quiere que aprendas: «cómo explicamos los pagos»');
    expect(pedido).toContain('Equipo: Con transferencia o tarjeta');
    expect(await uno('SELECT conversacion_id, lead_id, estado FROM setter_sugerencias')).toEqual({ conversacion_id: conv.id, lead_id: conv.lead_id, estado: 'pendiente' });
    // No toca la marca de la revisión diaria.
    expect(await uno(`SELECT valor FROM setter_config WHERE clave = 'aprendizaje_hasta'`)).toBeNull();
    expect(await aprenderDeChat(env, { conversacion_id: 12345 }, { claude: claudeFalso([]) })).toEqual({ error: 'no existe el chat' });
  });

  it('sin respuestas nuevas del equipo no llama a Claude', async () => {
    await chat('Hola');
    const claude = claudeFalso([]);
    expect(await aprenderDelEquipo(env, { claude })).toEqual({ chats: 0, sugerencias: 0 });
  });

  const envCrm = () => ({ ...env, CRM_TOKEN: 'tok', SETTER: { fetch: () => Response.json({}) } });
  const post = (b) => sugerencias.onRequestPost({ request: new Request('https://crm.test/api/setter/sugerencias', { method: 'POST', headers: { 'x-crm-token': 'tok' }, body: JSON.stringify(b) }), env: envCrm() });
  const insertar = (tipo = 'respuesta') => env.DB.prepare(
    `INSERT INTO setter_sugerencias (tipo, titulo, contenido, pregunta, respuesta_equipo, creado_en) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(tipo, SUGERENCIA.titulo, SUGERENCIA.contenido, SUGERENCIA.pregunta, SUGERENCIA.respuesta_equipo, new Date().toISOString()).run().then((r) => r.meta.last_row_id);

  it('aprobar (editada) la pasa a la base como lección; descartar no', async () => {
    const id = await insertar(), otra = await insertar('tono');
    const lista = await (await sugerencias.onRequestGet({ request: new Request('https://crm.test/api/setter/sugerencias', { headers: { 'x-crm-token': 'tok' } }), env: envCrm() })).json();
    expect(lista.pendientes).toBe(2);
    const p = await (await pulso.onRequestGet({ request: new Request('https://crm.test/api/setter/pulso', { headers: { 'x-crm-token': 'tok' } }), env: envCrm() })).json();
    expect(p.sugerencias).toBe(2);

    const r = await post({ id, accion: 'aprobar', contenido: 'Si preguntan algo como: «¿Cómo se paga?»\nResponde: «Transferencia o tarjeta; se reserva con el 30 %.»' });
    expect(r.status).toBe(200);
    const k = await uno('SELECT * FROM setter_conocimiento WHERE id = ?', (await r.json()).conocimiento_id);
    expect(k).toMatchObject({ titulo: 'Formas de pago', tags: 'leccion', activo: 1 });
    expect(k.contenido).toContain('se reserva con el 30 %');
    expect((await post({ id, accion: 'aprobar' })).status).toBe(409);

    expect((await post({ id: otra, accion: 'descartar' })).status).toBe(200);
    expect(await uno('SELECT estado FROM setter_sugerencias WHERE id = ?', otra)).toEqual({ estado: 'descartada' });
    await env.DB.prepare(`DELETE FROM setter_conocimiento WHERE tags = 'leccion'`).run();
  });

  it('lo aprobado de tono va a su propia sección del prompt', async () => {
    const id = await insertar('tono');
    await post({ id, accion: 'aprobar', contenido: 'Cuando dicen que está caro, el equipo escribe así: «Entiendo, ¿con qué presupuesto viaja?»' });
    const conv = await chat('Hola');
    const claude = claudeFalso([texto('Hola')]);
    await correrTurno(env, canalDe(env), conv.id, { claude, dormir: async () => {} });
    const sys = claude.pedidos[0].system[0].text;
    expect(sys).toContain('# Cómo escribe el equipo');
    expect(sys).not.toContain('# Respuestas que aprobó el equipo');
    await env.DB.prepare(`DELETE FROM setter_conocimiento WHERE tags = 'leccion,tono'`).run();
  });
});

// Fase 6: pausa por echo, follow-ups del cron y aviso de derivación.
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correrSeguimientos } from '../src/agente/seguimiento.js';
import { correrTurno } from '../src/agente/turno.js';
import { canalDe } from '../src/canal/adapter.js';
import { prepararDb, webhookFirmado, payloadMensaje, payloadEcho } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const todos = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const H = 3600e3;
// 15:00 UTC = 10:00 en Lima: dentro del horario de follow-ups.
const BASE = Date.parse('2026-11-02T15:00:00Z');

let meta, resend;
beforeEach(async () => {
  await prepararDb();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM setter_uso'),
    env.DB.prepare(`UPDATE setter_agentes SET responde_siempre = 0`),
    env.DB.prepare(`UPDATE setter_seguimientos SET activo = CASE id WHEN 3 THEN 0 ELSE 1 END, plantilla = NULL`),
    env.DB.prepare(`UPDATE setter_config SET valor = '0' WHERE clave = 'kill_switch'`),
  ]);
  meta = []; resend = [];
  const original = globalThis.fetch;
  let n = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://graph.facebook.com/')) {
      const body = JSON.parse(init.body);
      if (body.status !== 'read') meta.push(body);
      return Response.json({ messages: [{ id: 'wamid.F' + ++n }] });
    }
    if (u.startsWith('https://api.resend.com/')) { resend.push(JSON.parse(init.body)); return Response.json({ id: 'r1' }); }
    return original(url, init);
  });
});
afterEach(() => vi.restoreAllMocks());

function claudeFalso(respuestas) {
  const pedidos = [];
  return { pedidos, beta: { messages: { create: async (p) => { pedidos.push(structuredClone(p)); return respuestas.shift(); } } } };
}
const texto = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });

// Chat donde el lead escribió hace `horasLead` y la IA le contestó después.
async function chatEsperando(horasLead) {
  const en = new Date(BASE - horasLead * H).toISOString();
  await webhookFirmado(exports.default, payloadMensaje({ en, texto: 'Hola, info de Cusco' }));
  const conv = await uno('SELECT * FROM wa_conversaciones');
  const out = new Date(BASE - horasLead * H + 60e3).toISOString();
  await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, provider_id, estado, creado_en) VALUES (?, 'out', 'ia', 'text', '¿Para cuándo?', 'wamid.IA0', 'read', ?)`).bind(conv.id, out).run();
  await env.DB.prepare('UPDATE wa_conversaciones SET ultimo_out_en = ?, ventana_hasta = ? WHERE id = ?').bind(out, new Date(Date.parse(en) + 24 * H).toISOString(), conv.id).run();
  return conv;
}
const correr = (claude, horasExtra = 0) => correrSeguimientos(env, canalDe(env), { claude, ahora: new Date(BASE + horasExtra * H) });

describe('pausa por echo', () => {
  it('si la asesora contesta desde el celular, la IA se pausa', async () => {
    await webhookFirmado(exports.default, payloadMensaje());
    await webhookFirmado(exports.default, payloadEcho());
    expect(await uno('SELECT ia_activa, ia_pausa_motivo FROM wa_conversaciones')).toEqual({ ia_activa: 0, ia_pausa_motivo: 'asesora_respondio' });
  });
  it('con "Responde siempre" sigue activa', async () => {
    await env.DB.prepare(`UPDATE setter_agentes SET responde_siempre = 1 WHERE rol = 'jefe'`).run();
    await webhookFirmado(exports.default, payloadMensaje());
    await webhookFirmado(exports.default, payloadEcho());
    expect(await uno('SELECT ia_activa FROM wa_conversaciones')).toEqual({ ia_activa: 1 });
  });
});

describe('follow-ups', () => {
  it('antes de las 4 h no hace nada; después, el especialista seguimiento escribe uno', async () => {
    await chatEsperando(3);
    expect((await correr(claudeFalso([]))).hechos).toEqual([]);
    const claude = claudeFalso([texto('¡Hola! ¿Pudiste pensar las fechas?')]);
    const r = await correr(claude, 1.5);
    expect(r.hechos).toEqual([{ conv: expect.any(Number), resultado: 'ia:1' }]);
    expect(claude.pedidos[0].system[0].text).toContain('retomar la conversación');
    expect(claude.pedidos[0].messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('seguimiento 1 de 2') });
    expect(meta.map((m) => m.text.body)).toEqual(['¡Hola! ¿Pudiste pensar las fechas?']);
    expect(await uno(`SELECT es_followup, intento_followup, agente_clave FROM wa_mensajes WHERE es_followup = 1`)).toEqual({ es_followup: 1, intento_followup: 1, agente_clave: 'seguimiento' });
    // El mismo cron 15 min después no repite.
    expect((await correr(claudeFalso([]), 1.75)).hechos).toEqual([]);
  });

  it('fuera de horario no escribe', async () => {
    await chatEsperando(5);
    const noche = new Date('2026-11-03T04:00:00Z');   // 23:00 en Lima
    expect(await correrSeguimientos(env, canalDe(env), { claude: claudeFalso([]), ahora: noche })).toEqual({ fuera_de_horario: true });
  });

  it('con la ventana cerrada usa la plantilla si está cargada; si no, se saltea', async () => {
    const conv = await chatEsperando(80);
    // Simula que los dos follow-ups libres ya salieron.
    for (const i of [1, 2]) {
      await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, es_followup, intento_followup, creado_en) VALUES (?, 'out', 'ia', 'text', 'x', 1, ?, ?)`)
        .bind(conv.id, i, new Date(BASE - (80 - 4 * i) * H).toISOString()).run();
    }
    expect((await correr(claudeFalso([]))).hechos).toEqual([{ conv: conv.id, resultado: 'sin_respuesta' }]);
    expect((await uno('SELECT ia_estado FROM leads')).ia_estado).toBe('sin_respuesta');

    await env.DB.prepare(`UPDATE leads SET ia_estado = 'tibio'`).run();
    await env.DB.prepare(`UPDATE setter_seguimientos SET activo = 1, plantilla = 'retomar_viaje' WHERE id = 3`).run();
    expect((await correr(claudeFalso([]))).hechos).toEqual([{ conv: conv.id, resultado: 'plantilla:3' }]);
    expect(meta.at(-1)).toMatchObject({ type: 'template', template: { name: 'retomar_viaje', language: { code: 'es' } } });
  });

  it('no molesta a quien fue derivado o espera a una persona', async () => {
    await chatEsperando(5);
    await env.DB.prepare(`UPDATE wa_conversaciones SET espera_persona = 1`).run();
    expect((await correr(claudeFalso([]))).candidatos).toBe(0);
  });
});

describe('aviso de derivación', () => {
  it('manda mail por Resend si está configurado', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ texto: 'Quiero hablar con alguien' }));
    const conv = await uno('SELECT * FROM wa_conversaciones');
    const claude = {
      beta: { messages: { create: vi.fn()
        .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 't1', name: 'derivar_a_asesora', input: { motivo: 'pide persona', resumen: 'Quiere hablar con alguien.' } }], stop_reason: 'tool_use' })
        .mockResolvedValueOnce(texto('Soy el asistente virtual con IA de Luna Llena Travel. Te escribe una asesora en breve.')) } },
    };
    await correrTurno({ ...env, RESEND_API_KEY: 're_test', AVISO_EMAIL: 'a@b.com, c@d.com' }, canalDe(env), conv.id, { claude, dormir: async () => {} });
    expect(resend).toHaveLength(1);
    expect(resend[0].to).toEqual(['a@b.com', 'c@d.com']);
    expect(resend[0].html).toContain(`#/inbox?c=${conv.id}`);
    expect(await uno(`SELECT detalle FROM setter_eventos WHERE tipo = 'aviso_derivacion'`)).toEqual({ detalle: 'mail_enviado' });
  });
});

describe('seguimientos con criterio (29/10)', () => {
  it('si el agente responde [NO_ESCRIBIR] no manda nada y no lo vuelve a intentar', async () => {
    await chatEsperando(5);
    const claude = claudeFalso([texto('[NO_ESCRIBIR]')]);
    expect((await correr(claude)).hechos).toEqual([{ conv: expect.any(Number), resultado: 'omitido' }]);
    expect(meta).toEqual([]);
    expect(await uno(`SELECT count(*) n FROM setter_eventos WHERE tipo = 'seguimiento_omitido'`)).toEqual({ n: 1 });
    // El cron de 15 min después no le vuelve a preguntar a Claude.
    expect((await correr(claude, 0.25)).candidatos).toBe(0);
    expect(claude.pedidos).toHaveLength(1);
  });

  it('retoma la cotización que mandó una persona, sin despertar a la IA', async () => {
    const conv = await chatEsperando(6);
    const enAsesora = new Date(BASE - 5 * H).toISOString();
    await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, provider_id, estado, creado_en) VALUES (?, 'out', 'asesora_app', 'text', 'Le paso la cotización', 'wamid.AS1', 'read', ?)`).bind(conv.id, enAsesora).run();
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio', ultimo_out_en = ?, ultimo_autor = 'asesora_app' WHERE id = ?`).bind(enAsesora, conv.id).run();
    const claude = claudeFalso([texto('¿Pudo ver la cotización? Cualquier duda me comenta.')]);
    expect((await correr(claude)).hechos).toEqual([{ conv: conv.id, resultado: 'ia:1' }]);
    expect(meta.map((m) => m.text?.body)).toEqual(['¿Pudo ver la cotización? Cualquier duda me comenta.']);
    expect(claude.pedidos[0].messages.at(-1).content).toContain('Lo último se lo escribió una persona del equipo');
    expect(await uno('SELECT ia_activa FROM wa_conversaciones WHERE id = ?', conv.id)).toEqual({ ia_activa: 0 });
  });

  it('no retoma un chat pausado a mano ni uno pausado sin que escribiera una persona', async () => {
    const conv = await chatEsperando(6);
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'manual' WHERE id = ?`).bind(conv.id).run();
    expect((await correr(claudeFalso([]))).candidatos).toBe(0);
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_pausa_motivo = 'handoff' WHERE id = ?`).bind(conv.id).run();
    expect((await correr(claudeFalso([]))).candidatos).toBe(0);
  });
});

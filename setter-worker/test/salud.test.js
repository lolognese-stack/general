// Monitoreo: alerta de chats sin respuesta y /api/setter/salud.
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { alertarSinRespuesta } from '../src/agente/alertas.js';
import * as salud from '../../functions/api/setter/salud.js';
import { prepararDb, webhookFirmado, payloadMensaje } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();

beforeEach(async () => {
  await prepararDb();
  await env.DB.prepare(`UPDATE setter_config SET valor = '0' WHERE clave = 'kill_switch'`).run();
});

describe('alerta de chats sin respuesta', () => {
  it('a los 10 min sin respuesta de la IA, el chat pasa a esperar a una persona (una sola vez)', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ en: new Date(Date.now() - 5 * 60e3).toISOString() }));
    expect(await alertarSinRespuesta(env)).toEqual({ alertas: 0 });
    expect(await alertarSinRespuesta(env, { ahora: new Date(Date.now() + 6 * 60e3) })).toEqual({ alertas: 1 });
    expect(await uno('SELECT espera_persona FROM wa_conversaciones')).toEqual({ espera_persona: 1 });
    expect(await alertarSinRespuesta(env, { ahora: new Date(Date.now() + 20 * 60e3) })).toEqual({ alertas: 0 });
    expect(await uno(`SELECT count(*) n FROM setter_eventos WHERE tipo = 'alerta_sin_respuesta'`)).toEqual({ n: 1 });
  });

  it('no alerta si la IA está pausada o con kill switch', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ en: new Date(Date.now() - 30 * 60e3).toISOString() }));
    await env.DB.prepare(`UPDATE setter_config SET valor = '1' WHERE clave = 'kill_switch'`).run();
    expect(await alertarSinRespuesta(env)).toEqual({ alertas: 0 });
    await env.DB.prepare(`UPDATE setter_config SET valor = '0' WHERE clave = 'kill_switch'`).run();
    await env.DB.prepare('UPDATE wa_conversaciones SET ia_activa = 0').run();
    expect(await alertarSinRespuesta(env)).toEqual({ alertas: 0 });
  });
});

describe('/api/setter/salud', () => {
  it('agrupa los problemas y lista quién espera', async () => {
    await webhookFirmado(exports.default, payloadMensaje({ en: new Date(Date.now() - 30 * 60e3).toISOString() }));
    await alertarSinRespuesta(env);
    const ahora = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO setter_eventos (tipo, detalle, creado_en) VALUES ('error_envio', 'Meta 401: viejo', ?), ('error_envio', 'Meta 401: Invalid OAuth', ?), ('turno', 'respondio:luna:1', ?)`)
      .bind(ahora, new Date(Date.now() + 1000).toISOString(), ahora).run();
    const r = await salud.onRequestGet({ request: new Request('https://crm.test/x', { headers: { 'x-crm-token': 'cli' } }), env: { ...env, CRM_TOKEN: 'cli', SETTER: {} } });
    const d = await r.json();
    expect(d.esperan).toHaveLength(1);
    const envio = d.errores.find((e) => e.tipo === 'error_envio');
    expect(envio).toMatchObject({ n: 2, detalle: 'Meta 401: Invalid OAuth' });
    expect(d.errores.map((e) => e.tipo)).not.toContain('turno');
    expect(d.ultimo_recibido).toBeTruthy();
  });
});

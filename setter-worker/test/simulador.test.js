// Simulador: chats de prueba (999…) que pasan por todo el setter sin salir a WhatsApp.

import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correrTurno } from '../src/agente/turno.js';
import { simularMensaje } from '../src/simulador.js';
import { canalDe } from '../src/canal/adapter.js';
import * as simulador from '../../functions/api/setter/simulador.js';
import { prepararDb } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const todos = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
let salidas;

beforeEach(async () => {
  await prepararDb();
  await env.DB.prepare(`DELETE FROM setter_config WHERE clave = 'sim_horario'`).run();
  salidas = [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (/graph\.facebook\.com|api\.kapso\.ai/.test(String(url))) { salidas.push(String(url)); return Response.json({ messages: [{ id: 'wamid.X' }] }); }
    return original(url, init);
  });
});
afterEach(() => vi.restoreAllMocks());

function claudeFalso(respuestas) {
  const pedidos = [];
  const create = async (p) => { pedidos.push(structuredClone(p)); const r = respuestas.shift(); if (!r) throw new Error('sin respuestas'); return r; };
  return { pedidos, beta: { messages: { create } }, messages: { create } };
}
const texto = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const WA = '99912345678';
const turno = (envT, convId, claude) => correrTurno(envT, canalDe(env), convId, { claude, dormir: async () => {} });

describe('simulador', () => {
  it('el cliente escribe, la IA contesta y nada sale a WhatsApp', async () => {
    const r = await simularMensaje(env, { wa_id: WA, texto: 'Hola, quiero ir a Machu Picchu', como: 'lead', nombre: 'Cliente de prueba' });
    expect(r.ok).toBe(true);
    const claude = claudeFalso([texto('Hola, ¿qué tal? Hermoso Machu Picchu. ¿Cuántos días tiene pensado viajar?')]);
    expect(await turno(env, r.conversacion_id, claude)).toMatch(/^respondio:/);
    expect(salidas).toEqual([]);
    const msjs = await todos('SELECT direccion, autor, texto FROM wa_mensajes WHERE conversacion_id = ? ORDER BY id', r.conversacion_id);
    expect(msjs[0].autor).toBe('lead');
    expect(msjs.slice(1).every((m) => m.autor === 'ia')).toBe(true);
    expect((await uno('SELECT nombre FROM leads WHERE wa_id = ?', WA)).nombre).toBe('Cliente de prueba');
  });

  it('el equipo "desde el celular" pausa la IA como en un chat real', async () => {
    const r = await simularMensaje(env, { wa_id: WA, texto: 'Hola', como: 'lead' });
    await simularMensaje(env, { wa_id: WA, texto: 'Hola! Te escribe el equipo', como: 'equipo' });
    expect(await uno('SELECT ia_activa, ia_pausa_motivo FROM wa_conversaciones WHERE id = ?', r.conversacion_id)).toEqual({ ia_activa: 0, ia_pausa_motivo: 'asesora_respondio' });
    expect(await uno(`SELECT autor FROM wa_mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 1`, r.conversacion_id)).toEqual({ autor: 'asesora_app' });
  });

  it('el horario elegido manda en los chats de prueba, no en los reales', async () => {
    const soloNoche = { ...env, SETTER_SOLO_NOCHE: '1', SETTER_FINDE_MARCA: 'Luna Llena', SETTER_FINDE_NOMBRE: 'Sofía' };
    const r = await simularMensaje(env, { wa_id: WA, texto: 'Hola', como: 'lead' });
    await env.DB.prepare(`INSERT INTO setter_config (clave, valor, actualizado_en) VALUES ('sim_horario', 'dia', '')`).run();
    expect(await turno(soloNoche, r.conversacion_id, claudeFalso([]))).toBe('horario_equipo');
    await env.DB.prepare(`UPDATE setter_config SET valor = 'noche' WHERE clave = 'sim_horario'`).run();
    const claude = claudeFalso([texto('Hola, soy Sofía')]);
    await turno(soloNoche, r.conversacion_id, claude);
    expect(claude.pedidos[0].system[1].text).toContain('Hasta mañana');
    // Por defecto la IA contesta siempre, sin presentación.
    await env.DB.prepare(`DELETE FROM setter_config WHERE clave = 'sim_horario'`).run();
    await simularMensaje(env, { wa_id: WA, texto: 'Somos 2', como: 'lead' });
    const otra = claudeFalso([texto('Perfecto')]);
    await turno(soloNoche, r.conversacion_id, otra);
    expect(otra.pedidos[0].system[1].text).not.toContain('# Fuera del horario del equipo');
  });

  it('solo acepta números de prueba', async () => {
    expect(await simularMensaje(env, { wa_id: '51930299443', texto: 'Hola' })).toEqual({ error: 'solo chats de prueba (999…)' });
  });

  it('/api/setter/simulador lista los chats de prueba y los borra sin tocar los reales', async () => {
    const envCrm = { ...env, CRM_TOKEN: 'tok', SETTER: { fetch: () => Response.json({}) } };
    const pedir = (metodo, ruta, b) => simulador[metodo === 'GET' ? 'onRequestGet' : 'onRequestPost']({
      request: new Request('https://crm.test/api/setter/simulador' + ruta, { method: metodo, headers: { 'x-crm-token': 'tok' }, body: b ? JSON.stringify(b) : undefined }), env: envCrm,
    }).then((x) => x.json());
    const r = await simularMensaje(env, { wa_id: WA, texto: 'Hola', como: 'lead' });
    await simularMensaje(env, { wa_id: '51930299443'.replace(/^/, ''), texto: 'x' });   // rechazado: no crea nada
    const g = await pedir('GET', '?c=' + r.conversacion_id);
    expect(g.horario).toBe('siempre');
    expect(g.chats.map((c) => c.wa_id)).toEqual([WA]);
    expect(g.mensajes.map((m) => m.texto)).toEqual(['Hola']);
    expect((await pedir('POST', '', { accion: 'nuevo' })).wa_id).toMatch(/^999\d{8}$/);
    expect(await pedir('POST', '', { accion: 'horario', valor: 'noche' })).toEqual({ ok: true });
    expect((await pedir('GET', '')).horario).toBe('noche');
    await env.DB.prepare(`INSERT INTO wa_conversaciones (wa_id, creado_en, actualizado_en) VALUES ('51900000000', '', '')`).run();
    expect(await pedir('POST', '', { accion: 'borrar' })).toEqual({ ok: true });
    expect(await todos('SELECT wa_id FROM wa_conversaciones')).toEqual([{ wa_id: '51900000000' }]);
    expect(await uno('SELECT count(*) AS n FROM leads WHERE wa_id = ?', WA)).toEqual({ n: 0 });
  });
});

// Fase 5: recursos del setter con archivos en D1 (sin R2).
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as recursos from '../../functions/api/setter/recursos.js';
import * as recurso from '../../functions/api/setter/recursos/[id].js';
import { salidaDeRecurso } from '../src/recursos.js';
import { canalDe } from '../src/canal/adapter.js';
import { prepararDb } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const envCrm = () => ({ ...env, CRM_TOKEN: 'cli', CRM_ADMIN_TOKEN: 'adm', SETTER: { fetch: () => Response.json({}) } });
const pedido = (tok, body, method = 'POST') => new Request('https://crm.test/x', { method, headers: { 'x-crm-token': tok }, body: body ? JSON.stringify(body) : undefined });
const crear = (body, tok = 'adm') => recursos.onRequestPost({ request: pedido(tok, body), env: envCrm() });
const B64 = btoa('PDF de prueba');

beforeEach(async () => {
  await prepararDb();
  await env.DB.batch([env.DB.prepare('DELETE FROM setter_archivos'), env.DB.prepare(`DELETE FROM setter_recursos WHERE etiqueta <> 'cotizador'`)]);
});
afterEach(() => vi.restoreAllMocks());

describe('alta de recursos', () => {
  it('valida etiqueta, descripción, link y formato', async () => {
    expect((await crear({ etiqueta: 'con espacio', descripcion: 'x', tipo: 'link', url: 'https://a.b' })).status).toBe(400);
    expect((await crear({ etiqueta: 'guia', descripcion: '', tipo: 'link', url: 'https://a.b' })).status).toBe(400);
    expect((await crear({ etiqueta: 'guia', descripcion: 'x', tipo: 'link', url: 'http://a.b' })).status).toBe(400);
    expect((await crear({ etiqueta: 'guia', descripcion: 'x', tipo: 'archivo', archivo: { nombre: 'a.exe', mime: 'application/x-msdownload', b64: B64 } })).status).toBe(400);
    expect((await crear({ etiqueta: 'cotizador', descripcion: 'x', tipo: 'link', url: 'https://a.b' })).status).toBe(409);
    expect((await crear({ etiqueta: 'guia', descripcion: 'x', tipo: 'link', url: 'https://a.b' }, 'cli')).status).toBe(403);
  });

  it('rechaza archivos de más de 1 MB', async () => {
    const grande = btoa('a'.repeat(1024 * 1024 + 10));
    const r = await crear({ etiqueta: 'grande', descripcion: 'x', tipo: 'archivo', archivo: { nombre: 'g.pdf', mime: 'application/pdf', b64: grande } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('1 MB');
  });

  it('guarda el archivo aparte y la lista no lo trae', async () => {
    const r = await crear({ etiqueta: '@Itinerario-Cusco', descripcion: 'PDF del itinerario de 5 días. Mandarlo si pregunta qué incluye.', tipo: 'archivo', archivo: { nombre: 'cusco.pdf', mime: 'application/pdf', b64: B64 } });
    expect(r.status).toBe(201);
    const { id, etiqueta } = await r.json();
    expect(etiqueta).toBe('itinerario-cusco');
    const lista = await (await recursos.onRequestGet({ request: pedido('cli', null, 'GET'), env: envCrm() })).json();
    const fila = lista.find((x) => x.id === id);
    expect(fila).toMatchObject({ archivo_nombre: 'cusco.pdf', archivo_mime: 'application/pdf', archivo_tamano: 13 });
    expect(fila.datos_b64).toBeUndefined();
    const arch = await recurso.onRequestGet({ request: pedido('cli', null, 'GET'), env: envCrm(), params: { id } });
    expect(await arch.text()).toBe('PDF de prueba');
  });
});

describe('envío por WhatsApp', () => {
  it('sube el archivo a Meta una sola vez y reusa el media_id', async () => {
    const { id } = await (await crear({ etiqueta: 'bienvenida', descripcion: 'Audio de bienvenida', tipo: 'audio', archivo: { nombre: 'hola.ogg', mime: 'audio/ogg', b64: B64 } })).json();
    const subidas = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      subidas.push({ url: String(url), form: init.body });
      return Response.json({ id: 'MEDIA-123' });
    });
    const rec = await uno('SELECT * FROM setter_recursos WHERE id = ?', id);
    const s1 = await salidaDeRecurso(env, canalDe(env), rec);
    const s2 = await salidaDeRecurso(env, canalDe(env), rec);
    expect(s1).toEqual({ media: { tipo: 'audio', id: 'MEDIA-123', filename: 'hola.ogg' } });
    expect(s2).toEqual(s1);
    expect(subidas).toHaveLength(1);
    expect(subidas[0].url).toBe('https://graph.facebook.com/v24.0/1111/media');
    expect(subidas[0].form.get('type')).toBe('audio/ogg');
    // Reemplazar el archivo obliga a subirlo de nuevo.
    await recurso.onRequestPatch({ request: pedido('adm', { archivo: { nombre: 'hola2.ogg', mime: 'audio/ogg', b64: B64 } }, 'PATCH'), env: envCrm(), params: { id } });
    await salidaDeRecurso(env, canalDe(env), rec);
    expect(subidas).toHaveLength(2);
  });

  it('un link sale como texto', async () => {
    const rec = await uno(`SELECT * FROM setter_recursos WHERE etiqueta = 'cotizador'`);
    expect(await salidaDeRecurso(env, canalDe(env), rec)).toEqual({ texto: 'https://lunallenatravel.vercel.app/cotizar/' });
  });
});

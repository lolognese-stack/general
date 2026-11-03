// Canal Kapso (número real en coexistencia) y modo prueba con SOLO_NUMEROS.
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { canalDe } from '../src/canal/adapter.js';
import { KapsoAdapter } from '../src/canal/kapso.js';
import { MetaCloudAdapter, firmaHmac } from '../src/canal/meta.js';
import { prepararDb, payloadMensaje, payloadEcho } from './ayuda.js';

const KAPSO = { ...env, KAPSO_API_KEY: 'kapso-key', KAPSO_WEBHOOK_SECRET: 'kapso-secreto', META_PHONE_NUMBER_ID: '1274569522413471' };
const todos = async (sql) => (await env.DB.prepare(sql).all()).results;

beforeEach(prepararDb);
afterEach(() => vi.restoreAllMocks());

function mockKapso(respuesta) {
  const original = globalThis.fetch;
  const api = vi.fn(async (url) => respuesta(String(url)));
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
    String(url).startsWith('https://api.kapso.ai/') || String(url).startsWith('https://descarga.test/') ? api(url, init) : original(url, init));
  return api;
}

async function postKapso(envUsado, body, secreto = 'kapso-secreto') {
  const raw = JSON.stringify(body);
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request('https://setter.test/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': await firmaHmac(secreto, raw) },
    body: raw,
  }), envUsado, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

describe('elección de canal', () => {
  it('usa Kapso solo si hay KAPSO_API_KEY', () => {
    expect(canalDe(env)).toBeInstanceOf(MetaCloudAdapter);
    expect(canalDe(env)).not.toBeInstanceOf(KapsoAdapter);
    expect(canalDe(KAPSO)).toBeInstanceOf(KapsoAdapter);
  });
});

describe('webhook de Kapso', () => {
  it('acepta la firma hex de Kapso y guarda el mensaje', async () => {
    const r = await postKapso(KAPSO, payloadMensaje({ texto: 'Hola desde Kapso' }));
    expect(r.status).toBe(200);
    expect(await todos('SELECT texto, autor FROM wa_mensajes')).toEqual([{ texto: 'Hola desde Kapso', autor: 'lead' }]);
  });

  it('rechaza la firma de Meta y la de otro secreto', async () => {
    expect((await postKapso(KAPSO, payloadMensaje(), 'otro')).status).toBe(401);
    const raw = JSON.stringify(payloadMensaje());
    const r = await worker.fetch(new Request('https://setter.test/webhook', {
      method: 'POST', body: raw,
      headers: { 'x-hub-signature-256': 'sha256=' + (await firmaHmac(env.META_APP_SECRET, raw)) },
    }), KAPSO, createExecutionContext());
    expect(r.status).toBe(401);
    expect(await todos('SELECT id FROM wa_mensajes')).toEqual([]);
  });

  it('no responde el handshake GET de Meta', async () => {
    const r = await worker.fetch(new Request('https://setter.test/webhook?hub.mode=subscribe&hub.verify_token=verificar-123&hub.challenge=1'), KAPSO, createExecutionContext());
    expect(r.status).toBe(403);
  });
});

describe('envío por Kapso', () => {
  it('manda a la Cloud API de Kapso con X-API-Key', async () => {
    const api = mockKapso(() => Response.json({ messages: [{ id: 'wamid.OUT1' }] }));
    const ref = await canalDe(KAPSO).sendText('5491100000000', 'Hola');
    expect(ref).toEqual({ providerId: 'wamid.OUT1' });
    const [url, init] = api.mock.calls[0];
    expect(String(url)).toBe('https://api.kapso.ai/meta/whatsapp/v24.0/1274569522413471/messages');
    expect(init.headers['x-api-key']).toBe('kapso-key');
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ messaging_product: 'whatsapp', to: '5491100000000', type: 'text' });
  });

  it('baja medios por el download_url que devuelve Kapso', async () => {
    const api = mockKapso((url) => url.startsWith('https://descarga.test/')
      ? new Response('audio', { headers: { 'content-type': 'audio/ogg' } })
      : Response.json({ download_url: 'https://descarga.test/abc' }));
    const r = await canalDe(KAPSO).downloadMedia('MEDIA1');
    expect(await r.text()).toBe('audio');
    expect(String(api.mock.calls[0][0])).toBe('https://api.kapso.ai/meta/whatsapp/v24.0/MEDIA1?phone_number_id=1274569522413471');
    expect(api.mock.calls[1][1]?.headers).toBeUndefined();
  });

  it('el error dice que vino de Kapso', async () => {
    mockKapso(() => Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }));
    await expect(canalDe(KAPSO).sendText('5491100000000', 'Hola')).rejects.toThrow('Kapso 401: Invalid API key');
  });
});

describe('modo prueba (SOLO_NUMEROS)', () => {
  const PRUEBA = { ...KAPSO, SOLO_NUMEROS: '+54 9 11 2222-3333, 51999888777' };

  it('ignora del todo a los números fuera de la lista', async () => {
    await postKapso(PRUEBA, payloadMensaje({ waId: '5491144445555', id: 'wamid.AMIGO' }));
    await postKapso(PRUEBA, payloadEcho({ waId: '5491144445555', id: 'wamid.ECO' }));
    expect(await todos('SELECT id FROM wa_mensajes')).toEqual([]);
    expect(await todos('SELECT id FROM wa_conversaciones')).toEqual([]);
    expect(await todos('SELECT id FROM leads')).toEqual([]);
  });

  it('atiende a los de la lista, con o sin el 9 de Argentina', async () => {
    await postKapso(PRUEBA, payloadMensaje({ waId: '541122223333', id: 'wamid.SIN9' }));
    await postKapso(PRUEBA, payloadMensaje({ waId: '51999888777', id: 'wamid.PERU' }));
    expect((await todos('SELECT provider_id FROM wa_mensajes ORDER BY provider_id')).map((m) => m.provider_id)).toEqual(['wamid.PERU', 'wamid.SIN9']);
  });

  it('sin lista, atiende a todos', async () => {
    await postKapso(KAPSO, payloadMensaje({ waId: '5491144445555' }));
    expect(await todos('SELECT id FROM wa_mensajes')).toHaveLength(1);
  });
});

import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizarWa, codigoWebDe } from '../src/leads.js';
import { prepararDb, webhookFirmado, payloadMensaje, payloadEstado, payloadEcho } from './ayuda.js';

const W = () => exports.default;
const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const todos = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

beforeEach(prepararDb);
afterEach(() => vi.restoreAllMocks());

// Solo intercepta la Graph API; el resto del fetch (el de vitest) sigue igual.
function mockMeta(respuesta) {
  const original = globalThis.fetch;
  const graph = vi.fn(async () => respuesta());
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
    String(url).startsWith('https://graph.facebook.com/') ? graph(url, init) : original(url, init));
  return graph;
}

describe('handshake', () => {
  it('devuelve el challenge con el verify token correcto', async () => {
    const r = await W().fetch('https://setter.test/webhook?hub.mode=subscribe&hub.verify_token=verificar-123&hub.challenge=42');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('42');
  });
  it('rechaza un verify token incorrecto', async () => {
    const r = await W().fetch('https://setter.test/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42');
    expect(r.status).toBe(403);
  });
});

describe('firma', () => {
  it('rechaza una firma hecha con otro secreto', async () => {
    const r = await webhookFirmado(W(), payloadMensaje(), 'no-es-el-secreto');
    expect(r.status).toBe(401);
    expect(await uno('SELECT count(*) n FROM wa_mensajes')).toEqual({ n: 0 });
  });
  it('rechaza un webhook sin firma', async () => {
    const r = await W().fetch('https://setter.test/webhook', { method: 'POST', body: JSON.stringify(payloadMensaje()) });
    expect(r.status).toBe(401);
  });
});

describe('mensaje entrante', () => {
  it('crea el lead, la conversación y el mensaje', async () => {
    const r = await webhookFirmado(W(), payloadMensaje({ texto: 'Hola, quiero ir a Machu Picchu' }));
    expect(r.status).toBe(200);
    const lead = await uno('SELECT * FROM leads');
    expect(lead).toMatchObject({ nombre: 'Ana', whatsapp: '+51930299443', wa_id: '51930299443', etapa: 'lead_nuevo', setter: 'IA', fuente: 'WhatsApp', ia_estado: 'frio', ia_origen: 'directo' });
    const conv = await uno('SELECT * FROM wa_conversaciones');
    expect(conv).toMatchObject({ lead_id: lead.id, wa_id: '51930299443', abierta_por: 'lead', no_leidos: 1, ia_activa: 1, visto_por_lead: 'contesto' });
    expect(conv.ventana_hasta > conv.ultimo_in_en).toBe(true);
    const msj = await uno('SELECT * FROM wa_mensajes');
    expect(msj).toMatchObject({ conversacion_id: conv.id, direccion: 'in', autor: 'lead', tipo: 'text', texto: 'Hola, quiero ir a Machu Picchu', provider_id: 'wamid.IN1' });
  });

  it('un webhook repetido no duplica nada', async () => {
    const p = payloadMensaje();
    await webhookFirmado(W(), p);
    const r = await webhookFirmado(W(), p);
    expect(r.status).toBe(200);
    expect(await uno('SELECT count(*) n FROM wa_mensajes')).toEqual({ n: 1 });
    expect(await uno('SELECT count(*) n FROM leads')).toEqual({ n: 1 });
    expect(await uno('SELECT no_leidos FROM wa_conversaciones')).toEqual({ no_leidos: 1 });
  });

  it('encuentra el lead que ya existía por su WhatsApp escrito a mano, sin pisar nada', async () => {
    await env.DB.prepare(`INSERT INTO leads (nombre, whatsapp, fuente, setter, creado_en, actualizado_en) VALUES ('Ana Pérez', '+51 930-299-443', 'Instagram', 'Majo', 'x', 'x')`).run();
    await webhookFirmado(W(), payloadMensaje({ nombre: 'Anita' }));
    const leads = await todos('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ nombre: 'Ana Pérez', whatsapp: '+51 930-299-443', fuente: 'Instagram', setter: 'Majo', wa_id: '51930299443' });
  });

  it('con "ref LL-…" encuentra el lead de la web por codigo_web', async () => {
    await env.DB.prepare(`INSERT INTO leads (nombre, codigo_web, fuente, creado_en, actualizado_en) VALUES ('Web', 'LL-123456', 'Página web', 'x', 'x')`).run();
    await webhookFirmado(W(), payloadMensaje({ texto: 'Hola! Me interesa el paquete (ref LL-123456)' }));
    const leads = await todos('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ nombre: 'Web', wa_id: '51930299443', ia_origen: 'web_ref' });
  });

  it('lead nuevo con "ref LL-…" guarda el código y el origen web_ref', async () => {
    await webhookFirmado(W(), payloadMensaje({ texto: 'info (ref ll-654321)' }));
    expect(await uno('SELECT codigo_web, ia_origen FROM leads')).toEqual({ codigo_web: 'LL-654321', ia_origen: 'web_ref' });
  });

  it('anuncio click-to-WhatsApp marca el origen anuncio', async () => {
    await webhookFirmado(W(), payloadMensaje({ extra: { referral: { source_type: 'ad', source_id: '123' } } }));
    expect(await uno('SELECT ia_origen FROM leads')).toEqual({ ia_origen: 'anuncio' });
  });

  it('una nota de voz se guarda con su media id', async () => {
    const p = payloadMensaje();
    const m = p.entry[0].changes[0].value.messages[0];
    delete m.text;
    Object.assign(m, { type: 'audio', audio: { id: 'MEDIA9', mime_type: 'audio/ogg; codecs=opus', voice: true } });
    await webhookFirmado(W(), p);
    expect(await uno('SELECT tipo, media_key, texto FROM wa_mensajes')).toEqual({ tipo: 'audio', media_key: 'meta:MEDIA9', texto: null });
  });
});

describe('estados', () => {
  async function conMensajeSaliente() {
    await webhookFirmado(W(), payloadMensaje({ en: new Date(Date.now() - 60000).toISOString() }));
    mockMeta(() => Response.json({ messages: [{ id: 'wamid.OUT1' }] }));
    const r = await W().fetch('https://setter.test/interno/enviar', {
      method: 'POST', headers: { 'x-setter-secret': 'interno-xyz' },
      body: JSON.stringify({ wa_id: '51930299443', texto: 'Hola Ana!' }),
    });
    expect(r.status).toBe(200);
  }

  it('sent → delivered → read actualiza el mensaje y el visto', async () => {
    await conMensajeSaliente();
    await webhookFirmado(W(), payloadEstado({ id: 'wamid.OUT1', estado: 'delivered' }));
    expect(await uno('SELECT visto_por_lead v FROM wa_conversaciones')).toEqual({ v: 'no_abrio' });
    await webhookFirmado(W(), payloadEstado({ id: 'wamid.OUT1', estado: 'read' }));
    const m = await uno(`SELECT estado, leido_en FROM wa_mensajes WHERE provider_id = 'wamid.OUT1'`);
    expect(m.estado).toBe('read');
    expect(m.leido_en).toBeTruthy();
    expect(await uno('SELECT visto_por_lead v FROM wa_conversaciones')).toEqual({ v: 'vio_no_contesto' });
  });

  it('un estado viejo que llega tarde no hace retroceder', async () => {
    await conMensajeSaliente();
    await webhookFirmado(W(), payloadEstado({ id: 'wamid.OUT1', estado: 'read' }));
    await webhookFirmado(W(), payloadEstado({ id: 'wamid.OUT1', estado: 'delivered' }));
    expect(await uno(`SELECT estado FROM wa_mensajes WHERE provider_id = 'wamid.OUT1'`)).toEqual({ estado: 'read' });
  });
});

describe('echo de la app WhatsApp Business', () => {
  it('se guarda como mensaje de la asesora', async () => {
    await webhookFirmado(W(), payloadMensaje());
    await webhookFirmado(W(), payloadEcho());
    await webhookFirmado(W(), payloadEcho());
    const m = await todos(`SELECT direccion, autor, texto FROM wa_mensajes WHERE autor = 'asesora_app'`);
    expect(m).toEqual([{ direccion: 'out', autor: 'asesora_app', texto: 'Te escribo yo' }]);
  });
});

describe('envío interno', () => {
  const pedir = (body, secreto = 'interno-xyz') => W().fetch('https://setter.test/interno/enviar', {
    method: 'POST', headers: { 'x-setter-secret': secreto }, body: JSON.stringify(body),
  });

  it('pide el secreto interno', async () => {
    expect((await pedir({ wa_id: '51930299443', texto: 'x' }, 'mal')).status).toBe(401);
  });

  it('manda texto por la Graph API con la ventana abierta', async () => {
    await webhookFirmado(W(), payloadMensaje());
    const f = mockMeta(() => Response.json({ messages: [{ id: 'wamid.OUT2' }] }));
    const r = await pedir({ conversacion_id: (await uno('SELECT id FROM wa_conversaciones')).id, texto: 'Hola!' });
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/1111/messages');
    expect(init.headers.authorization).toBe('Bearer token-meta');
    expect(JSON.parse(init.body)).toMatchObject({ messaging_product: 'whatsapp', to: '51930299443', type: 'text', text: { body: 'Hola!' } });
    expect(await uno(`SELECT direccion, autor, estado FROM wa_mensajes WHERE provider_id = 'wamid.OUT2'`)).toEqual({ direccion: 'out', autor: 'asesora_web', estado: 'sent' });
  });

  it('con la ventana cerrada el equipo manda texto igual (Meta decide) y también plantilla', async () => {
    const f = mockMeta(() => Response.json({ messages: [{ id: 'wamid.T1' }] }));
    const r1 = await pedir({ wa_id: '+51 930 299 443', texto: 'Hola' });
    expect(r1.status).toBe(200);
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ type: 'text', text: { body: 'Hola' } });
    const r2 = await pedir({ wa_id: '930299443', plantilla: { nombre: 'hello_world', idioma: 'en_US' } });
    expect(r2.status).toBe(200);
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
    expect(await uno('SELECT abierta_por FROM wa_conversaciones')).toEqual({ abierta_por: 'nosotros' });
    expect(await uno('SELECT count(*) n FROM leads')).toEqual({ n: 1 });
  });

  it('si Meta falla, devuelve 502 y lo deja en setter_eventos', async () => {
    await webhookFirmado(W(), payloadMensaje());
    mockMeta(() => Response.json({ error: { message: 'Recipient not in allowed list' } }, { status: 400 }));
    const r = await pedir({ wa_id: '51930299443', texto: 'Hola' });
    expect(r.status).toBe(502);
    expect(await uno(`SELECT tipo, detalle FROM setter_eventos`)).toEqual({ tipo: 'error_envio', detalle: 'Meta 400: Recipient not in allowed list' });
    expect(await uno(`SELECT count(*) n FROM wa_mensajes WHERE direccion = 'out'`)).toEqual({ n: 0 });
  });
});

describe('Durable Object Conversacion', () => {
  it('varios mensajes seguidos dejan una sola alarma (debounce) y un solo turno', async () => {
    const stub = env.CONVERSACION.get(env.CONVERSACION.idFromName('51930299443'));
    await stub.avisar(7, 60000);
    const primera = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
    await stub.avisar(7, 60000);
    await stub.avisar(7, 60000);
    const ultima = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
    expect(ultima).toBeGreaterThanOrEqual(primera);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    expect(await runInDurableObject(stub, (_, state) => state.storage.get('turnos'))).toBe(1);
    expect(await uno(`SELECT count(*) n FROM setter_eventos WHERE tipo = 'turno' AND conversacion_id = 7`)).toEqual({ n: 1 });
  });
});

describe('normalización', () => {
  it('lleva números escritos a mano a E.164 sin +', () => {
    expect(normalizarWa('+51 930 299 443')).toBe('51930299443');
    expect(normalizarWa('930299443')).toBe('51930299443');
    expect(normalizarWa('0033 6 12 34 56 78')).toBe('33612345678');
    expect(normalizarWa('123')).toBe(null);
  });
  it('saca el código de la web en mayúsculas', () => {
    expect(codigoWebDe('hola (ref ll-000123)')).toBe('LL-000123');
    expect(codigoWebDe('hola')).toBe(null);
  });
});

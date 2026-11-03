import { env } from 'cloudflare:workers';
import { firmaHmac } from '../src/canal/meta.js';

const TABLAS = ['wa_mensajes', 'wa_analisis', 'wa_conversaciones', 'setter_eventos', 'setter_sugerencias', 'leads'];

// Crea el esquema la primera vez y vacía las tablas en cada test.
export async function prepararDb() {
  const hay = await env.DB.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'wa_mensajes'`).first();
  if (!hay) await env.DB.batch(JSON.parse(env.TEST_SQL).map((s) => env.DB.prepare(s)));
  await env.DB.batch(TABLAS.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export async function webhookFirmado(exportsDefault, body, secreto = env.META_APP_SECRET) {
  const raw = JSON.stringify(body);
  return exportsDefault.fetch('https://setter.test/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await firmaHmac(secreto, raw)) },
    body: raw,
  });
}

const ts = (iso) => String(Math.floor(new Date(iso).getTime() / 1000));

// Payloads con la forma de los webhooks de la Cloud API.
export function payloadMensaje({ waId = '51930299443', nombre = 'Ana', id = 'wamid.IN1', texto = 'Hola', en = new Date().toISOString(), extra = {} } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: '1111' },
      contacts: [{ profile: { name: nombre }, wa_id: waId }],
      messages: [{ from: waId, id, timestamp: ts(en), type: 'text', text: { body: texto }, ...extra }],
    } }] }],
  };
}

export function payloadEstado({ id, estado, waId = '51930299443', en = new Date().toISOString() }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '1111' },
      statuses: [{ id, status: estado, timestamp: ts(en), recipient_id: waId }],
    } }] }],
  };
}

export function payloadEcho({ waId = '51930299443', id = 'wamid.ECHO1', texto = 'Te escribo yo', en = new Date().toISOString() } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'smb_message_echoes', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '1111' },
      message_echoes: [{ from: '15550000000', to: waId, id, timestamp: ts(en), type: 'text', text: { body: texto } }],
    } }] }],
  };
}

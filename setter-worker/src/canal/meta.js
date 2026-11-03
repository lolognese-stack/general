// Adaptador de la WhatsApp Cloud API de Meta (desarrollo con el número de
// prueba). Contrato en adapter.js.

const enc = new TextEncoder();

export function iguales(a, b) {
  // Tiempo constante, como en functions/_lib/auth.js del CRM.
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function firmaHmac(secret, raw) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isoDe = (ts) => (ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString());

// Texto y media de un mensaje de WhatsApp, sea cual sea su tipo.
function contenido(m) {
  const t = m.type;
  const media = m[t] && typeof m[t] === 'object' && m[t].id ? m[t] : null;
  let texto = null;
  if (t === 'text') texto = m.text?.body ?? null;
  else if (t === 'button') texto = m.button?.text ?? null;
  else if (t === 'interactive') texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  else if (t === 'reaction') texto = m.reaction?.emoji ?? null;
  else if (t === 'location') texto = m.location ? `${m.location.latitude},${m.location.longitude}` : null;
  else if (media) texto = media.caption ?? null;
  return { msgTipo: t, texto, mediaId: media?.id ?? null, mime: media?.mime_type ?? null };
}

export class MetaCloudAdapter {
  constructor(env) {
    this.env = env;
    this.nombre = 'Meta';
    this.raiz = `https://graph.facebook.com/${env.META_GRAPH_VERSION || 'v24.0'}`;
    this.base = `${this.raiz}/${env.META_PHONE_NUMBER_ID}`;
  }

  auth() {
    return { authorization: `Bearer ${this.env.META_ACCESS_TOKEN}` };
  }

  verifyWebhook(req) {
    const p = new URL(req.url).searchParams;
    if (p.get('hub.mode') !== 'subscribe' || !this.env.META_VERIFY_TOKEN) return null;
    if (!iguales(p.get('hub.verify_token') || '', this.env.META_VERIFY_TOKEN)) return null;
    return new Response(p.get('hub.challenge') || '', { status: 200 });
  }

  async validateSignature(req, raw) {
    const header = req.headers.get('x-hub-signature-256') || '';
    if (!this.env.META_APP_SECRET || !header.startsWith('sha256=')) return false;
    return iguales(header.slice(7), await firmaHmac(this.env.META_APP_SECRET, raw));
  }

  parseInbound(body) {
    const eventos = [];
    for (const entry of body?.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        if (change.field === 'messages') {
          const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
          for (const m of v.messages || []) {
            eventos.push({
              tipo: 'mensaje', waId: m.from, nombre: nombres[m.from] || null, providerId: m.id,
              en: isoDe(m.timestamp), referral: m.referral || null, ...contenido(m),
            });
          }
          for (const s of v.statuses || []) {
            eventos.push({
              tipo: 'estado', providerId: s.id, waId: s.recipient_id, estado: s.status,
              en: isoDe(s.timestamp), error: s.errors?.[0] ? `${s.errors[0].code} ${s.errors[0].title}` : null,
            });
          }
        } else if (change.field === 'smb_message_echoes') {
          // Coexistencia: lo que la asesora manda desde la app WhatsApp Business.
          for (const m of v.message_echoes || []) {
            eventos.push({ tipo: 'echo', waId: m.to, providerId: m.id, en: isoDe(m.timestamp), ...contenido(m) });
          }
        }
      }
    }
    return eventos;
  }

  async #post(payload) {
    const r = await fetch(`${this.base}/messages`, {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${this.nombre} ${r.status}: ${data.error?.message || 'error desconocido'}`);
    return data;
  }

  async #enviar(to, payload) {
    const data = await this.#post({ recipient_type: 'individual', to, ...payload });
    return { providerId: data.messages?.[0]?.id };
  }

  sendText(to, text) {
    return this.#enviar(to, { type: 'text', text: { body: text, preview_url: true } });
  }

  sendMedia(to, media) {
    const obj = media.id ? { id: media.id } : { link: media.link };
    if (media.caption && media.tipo !== 'audio') obj.caption = media.caption;
    if (media.filename && media.tipo === 'document') obj.filename = media.filename;
    return this.#enviar(to, { type: media.tipo, [media.tipo]: obj });
  }

  sendTemplate(to, name, lang, params = []) {
    const template = { name, language: { code: lang } };
    if (params.length) template.components = [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }];
    return this.#enviar(to, { type: 'template', template });
  }

  // Sube un archivo a WhatsApp y devuelve su media_id (dura 30 días).
  async uploadMedia(bytes, mime, nombre) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([bytes], { type: mime }), nombre || 'archivo');
    const r = await fetch(`${this.base}/media`, { method: 'POST', headers: this.auth(), body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) throw new Error(`${this.nombre} ${r.status}: ${data.error?.message || 'no se pudo subir el archivo'}`);
    return data.id;
  }

  // Los medios de WhatsApp se bajan en dos pasos: el id da una URL corta que
  // también pide el token. Devuelve la Response del archivo, para hacer stream.
  async downloadMedia(mediaId) {
    const auth = this.auth();
    const r = await fetch(`${this.raiz}/${encodeURIComponent(mediaId)}`, { headers: auth });
    const info = await r.json().catch(() => ({}));
    if (!r.ok || !info.url) throw new Error(`Meta ${r.status}: ${info.error?.message || 'media no disponible'}`);
    const archivo = await fetch(info.url, { headers: auth });
    if (!archivo.ok) throw new Error(`Meta ${archivo.status}: no se pudo bajar el archivo`);
    return archivo;
  }

  // Con escribiendo: true además muestra "escribiendo…" al lead (hasta 25 s
  // o hasta que llegue la respuesta).
  async markRead(messageId, { escribiendo = false } = {}) {
    await this.#post({ status: 'read', message_id: messageId, ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}) });
  }
}

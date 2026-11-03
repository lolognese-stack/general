// POST /api/radar/flow — manda un flow de ManyChat a un contacto (botones de
// la extensión radar-luna-llena). La API key de ManyChat la manda la extensión
// en el header x-manychat-key; si no viene, se usa el secret MANYCHAT_TOKEN.

import { rolDe, json } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const mcKey = (request.headers.get('x-manychat-key') || '').trim() || env.MANYCHAT_TOKEN;
  if (!mcKey) return json({ error: 'Falta la API key de ManyChat: cargala en el ícono de la extensión.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body invalido' }, 400); }
  const subId = Number(body.manychat_id);
  const flowNs = String(body.flow_ns || '').trim();
  if (!Number.isSafeInteger(subId) || subId <= 0) return json({ error: 'Subscriber ID inválido.' }, 400);
  if (!flowNs) return json({ error: 'Falta el flow_ns.' }, 400);

  const res = await fetch('https://api.manychat.com/fb/sending/sendFlow', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + mcKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ subscriber_id: subId, flow_ns: flowNs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    const detalle = data.details ? (typeof data.details === 'string' ? data.details : JSON.stringify(data.details)) : data.message;
    return json({ error: detalle || `ManyChat respondió ${res.status}` }, 502);
  }
  return json({ ok: true });
}

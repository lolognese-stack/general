import { checkToken, json } from '../../../_lib/auth.js';
import { setterActivo, alWorker } from '../../../_lib/setter.js';
// Nota de voz, foto o documento de un chat, bajado de WhatsApp por el Worker.
// El panel lo pide con fetch (lleva el token) y lo muestra como blob.

export async function onRequestGet({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  // Solo medios que están en algún mensaje: el endpoint no sirve para bajar cualquier id de Meta.
  const m = await env.DB.prepare('SELECT 1 FROM wa_mensajes WHERE media_key = ? LIMIT 1').bind('meta:' + params.id).first();
  if (!m) return json({ error: 'no existe ese archivo en el Inbox' }, 404);
  const r = await alWorker(env, 'interno/media/' + encodeURIComponent(params.id));
  if (!r.ok) return json({ error: (await r.json().catch(() => ({}))).error || 'no se pudo bajar' }, 502);
  return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
}

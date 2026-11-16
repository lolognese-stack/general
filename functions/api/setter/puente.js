import { checkInbox, json } from '../../_lib/auth.js';
import { estadoPuente, esElPuente } from '../../_lib/puente.js';
// GET  /api/setter/puente → estado del puente WhatsApp Web (para el Inbox).
// POST /api/setter/puente { url } → lo llama el puente al arrancar o cuando cambia su túnel
//   (x-puente-secret): guarda la dirección actual en setter_config.puente_url.

export async function onRequestGet({ request, env }) {
  if (!checkInbox(request, env)) return json({ error: 'unauthorized' }, 401);
  return json(await estadoPuente(env));
}

export async function onRequestPost({ request, env }) {
  if (!esElPuente(request, env)) return json({ error: 'unauthorized' }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const url = typeof b.url === 'string' ? b.url.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url)) return json({ error: 'url inválida' }, 400);
  await env.DB.prepare(
    `INSERT INTO setter_config (clave, valor, actualizado_en) VALUES ('puente_url', ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`
  ).bind(url, new Date().toISOString()).run();
  return json({ ok: true });
}

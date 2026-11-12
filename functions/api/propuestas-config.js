// Webhook de Discord para los avisos de propuestas, cargado desde la página Propuestas del CRM.
//   PUT    { discord_webhook }  guarda (solo admin; se valida que sea un webhook de Discord)
//   DELETE                      lo borra (solo admin)
//   POST   { prueba: true }     manda un mensaje de prueba al webhook guardado (cualquier rol)
// El valor nunca vuelve al navegador: solo si está configurado o no.
import { rolDe, esAdmin, json } from '../_lib/auth.js';
import { WEBHOOK_DISCORD, webhookDiscord, mandarDiscord } from '../_lib/propuestas.js';

export async function onRequestPut({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'solo admin' }, 403);
  let body = {};
  try { body = await request.json(); } catch {}
  const url = typeof body.discord_webhook === 'string' ? body.discord_webhook.trim() : '';
  if (!WEBHOOK_DISCORD.test(url)) return json({ error: 'No parece un webhook de Discord (https://discord.com/api/webhooks/…)' }, 400);
  await env.DB.prepare(`INSERT INTO propuestas_config (clave, valor) VALUES ('discord_webhook', ?)
    ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`).bind(url).run();
  return json({ ok: true, discord: true });
}

export async function onRequestDelete({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'solo admin' }, 403);
  await env.DB.prepare(`DELETE FROM propuestas_config WHERE clave = 'discord_webhook'`).run();
  return json({ ok: true, discord: !!(await webhookDiscord(env)) });
}

export async function onRequestPost({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const url = await webhookDiscord(env);
  if (!url) return json({ error: 'No hay webhook de Discord cargado' }, 400);
  let ok = false;
  try { ok = await mandarDiscord(url, 'Prueba: los avisos de las propuestas de Luna Llena llegan a este canal.'); } catch {}
  return ok ? json({ ok: true }) : json({ error: 'Discord no aceptó el mensaje: revisa el webhook' }, 502);
}

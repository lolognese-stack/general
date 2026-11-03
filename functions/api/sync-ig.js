import { checkToken, json } from '../_lib/auth.js';
// Botón "Traer datos de Instagram" de Performance.
//
// POST dispara el mismo sync que corre solo a las 5 AM (el Worker del
// cliente, ver ig-sync-worker/README.md): trae los posteos de Windsor, suma
// los nuevos como piezas y actualiza las métricas. Se llama desde acá y no
// directo al Worker porque el Worker tiene su propio token.
// GET devuelve la última corrida (para mostrar "Último: hoy 05:00").
//
// IG_SYNC_URL (la URL /sync del Worker) e IG_SYNC_TOKEN (su CRM_TOKEN) son
// secrets de Pages. Sin ellos el botón avisa que no hay sync configurado.

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.IG_SYNC_URL) return json({ error: 'este CRM no tiene sync de Instagram configurado' }, 501);
  let r;
  try {
    r = await fetch(env.IG_SYNC_URL, { method: 'POST', headers: { 'x-crm-token': env.IG_SYNC_TOKEN || '' } });
  } catch (e) {
    return json({ error: 'no se pudo llegar al sync: ' + e.message }, 502);
  }
  const data = await r.json().catch(() => ({ error: `el sync respondió ${r.status}` }));
  return json(data, r.ok ? 200 : 502);
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const ultima = await env.DB.prepare(
    `SELECT started_at, finished_at, status, posts_new, posts_updated, error
       FROM sync_runs WHERE status != 'running' ORDER BY started_at DESC LIMIT 1`
  ).first().catch(() => null);
  return json(ultima || null);
}

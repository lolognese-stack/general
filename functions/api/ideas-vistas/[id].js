import { checkToken, json } from '../../_lib/auth.js';
import { aCliente } from '../ideas-vistas.js';

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const sets = [], vals = [];
  if (body.nombre !== undefined) { sets.push('nombre = ?'); vals.push(String(body.nombre).trim().slice(0, 40)); }
  if (body.filtro !== undefined) { sets.push('filtro = ?'); vals.push(JSON.stringify(body.filtro || {})); }
  if (!sets.length) return json({ error: 'nada para actualizar' }, 400);
  await env.DB.prepare(`UPDATE ideas_vistas SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id).run();
  const row = await env.DB.prepare('SELECT * FROM ideas_vistas WHERE id = ?').bind(params.id).first();
  return row ? json(aCliente(row)) : json({ error: 'no existe' }, 404);
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM ideas_vistas WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

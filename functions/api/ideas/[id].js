import { checkToken, json } from '../../_lib/auth.js';
import { normalizar, aCliente } from '../ideas.js';

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const datos = normalizar(body);
  delete datos.origen;
  if (datos.codigo && body.tipo === undefined) {
    const actual = await env.DB.prepare('SELECT tipo FROM ideas WHERE id = ?').bind(params.id).first();
    if (actual && actual.tipo === 'audio') datos.codigo = null;
  }
  const cols = Object.keys(datos);
  if (!cols.length) return json({ error: 'nada para actualizar' }, 400);
  await env.DB.prepare(`UPDATE ideas SET ${cols.map((c) => `${c} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
    .bind(...cols.map((c) => datos[c]), new Date().toISOString(), params.id).run();
  const row = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(params.id).first();
  return row ? json(aCliente(row)) : json({ error: 'no existe' }, 404);
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM ideas_foto WHERE idea_id = ?').bind(params.id),
  ]);
  return json({ ok: true });
}

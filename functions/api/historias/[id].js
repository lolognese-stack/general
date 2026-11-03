import { checkToken } from '../../_lib/auth.js';
import { CAMPOS_HISTORIA } from '../historias.js';


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();

  const fields = Object.keys(body).filter((k) => CAMPOS_HISTORIA.includes(k));
  if (fields.length === 0) return json({ error: 'nada para actualizar' }, 400);

  const now = new Date().toISOString();
  const setClause = fields.map((f) => `${f} = ?`).join(', ') + ', actualizado_en = ?';
  const values = fields.map((f) => (body[f] === '' ? null : body[f]));
  values.push(now, params.id);

  await env.DB.prepare(`UPDATE historias SET ${setClause} WHERE id = ?`)
    .bind(...values)
    .run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM historias WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

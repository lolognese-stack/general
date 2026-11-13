import { checkToken, json } from '../../_lib/auth.js';
// PATCH { estado: 'pendiente'|'guardado'|'descartado', idea_id? }
// "pendiente" es el deshacer del panel.

const ESTADOS = ['pendiente', 'guardado', 'descartado'];

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { estado, idea_id = null } = await request.json();
  if (!ESTADOS.includes(estado)) return json({ error: 'estado inválido' }, 400);
  const r = await env.DB.prepare(
    `UPDATE revisar_cola SET estado = ?, idea_id = ?, actualizado_en = ? WHERE codigo = ?`
  ).bind(estado, estado === 'guardado' ? idea_id : null, new Date().toISOString(), params.codigo).run();
  return r.meta.changes ? json({ ok: true }) : json({ error: 'no existe' }, 404);
}

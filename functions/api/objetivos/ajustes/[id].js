import { esAdmin, json } from '../../../_lib/auth.js';

// DELETE: saca una corrección; la métrica vuelve al cálculo automático.
export async function onRequestDelete({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  await env.DB.prepare('DELETE FROM ajustes WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}

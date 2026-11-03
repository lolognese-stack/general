import { rolDe, json } from '../../../_lib/auth.js';
import { evento, autorDe, tokenNuevo, venceDe } from '../../../_lib/ventas.js';

// POST /api/ventas/:id/token: link de pasaportes nuevo (el viejo deja de andar).
export async function onRequestPost({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const v = await env.DB.prepare('SELECT id, fecha_inicio FROM ventas WHERE id = ?').bind(params.id).first();
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const ahora = new Date().toISOString();
  const token = tokenNuevo();
  const vence = venceDe(v.fecha_inicio, true);
  await env.DB.batch([
    env.DB.prepare('UPDATE ventas SET token_viajeros = ?, token_vence = ?, actualizado_en = ? WHERE id = ?').bind(token, vence, ahora, v.id),
    evento(env, v.id, 'viajeros', `Link de pasaportes regenerado (vence ${vence.slice(0, 10)})`, autorDe(rol), ahora),
  ]);
  return json({ token_viajeros: token, token_vence: vence });
}

import { checkToken } from '../../_lib/auth.js';
import { CAMPOS_ANGULO } from '../angulos.js';


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();

  const fields = Object.keys(body).filter((k) => CAMPOS_ANGULO.includes(k));
  if (fields.length === 0) return json({ error: 'nada para actualizar' }, 400);

  const now = new Date().toISOString();
  const setClause = fields.map((f) => `${f} = ?`).join(', ') + ', actualizado_en = ?';
  const values = fields.map((f) => {
    if (f === 'activo') return body.activo ? 1 : 0;
    return body[f] === '' ? null : body[f];
  });
  values.push(now, params.id);

  try {
    await env.DB.prepare(`UPDATE angulos SET ${setClause} WHERE id = ?`)
      .bind(...values)
      .run();
    return json({ ok: true });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return json({ error: 'ya existe un ángulo con ese nombre' }, 409);
    }
    throw e;
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  // No FK cascade: piezas.angulo_id / historias.angulo_id quedan en NULL
  // solas (son REFERENCES sin ON DELETE), así que las piezas que ya usaban
  // este ángulo no se borran, solo pierden la referencia.
  await env.DB.prepare('UPDATE piezas SET angulo_id = NULL WHERE angulo_id = ?').bind(params.id).run();
  await env.DB.prepare('UPDATE historias SET angulo_id = NULL WHERE angulo_id = ?').bind(params.id).run();
  await env.DB.prepare('DELETE FROM angulos WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

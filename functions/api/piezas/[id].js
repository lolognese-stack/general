import { checkToken } from '../../_lib/auth.js';
import { CAMPOS_PIEZA, errorEtiquetaRepetida } from '../piezas.js';
import { piezaHecha, marcarIdeasUsadas } from '../../_lib/ideas-usadas.js';


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();

  const fields = Object.keys(body).filter((k) => CAMPOS_PIEZA.includes(k));
  if (fields.length === 0) return json({ error: 'nada para actualizar' }, 400);

  const now = new Date().toISOString();
  const setClause = fields.map((f) => `${f} = ?`).join(', ') + ', actualizado_en = ?';
  const values = fields.map((f) => {
    if (f === 'portada') return body.portada ? 1 : 0;
    return body[f] === '' ? null : body[f];
  });
  values.push(now, params.id);

  // Solo al pasar a Editado o al cambiar la inspiración: guardar la ficha de nuevo
  // no vuelve a marcar una idea que se desmarcó a mano.
  const antes = fields.includes('estado') || fields.includes('inspiracion')
    ? await env.DB.prepare('SELECT estado, inspiracion FROM piezas WHERE id = ?').bind(params.id).first()
    : null;

  try {
    await env.DB.prepare(`UPDATE piezas SET ${setClause} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch (e) {
    const r = errorEtiquetaRepetida(e, body);
    if (r) return json(r, 409);
    throw e;
  }

  if (antes) {
    const estado = fields.includes('estado') ? body.estado : antes.estado;
    const inspiracion = fields.includes('inspiracion') ? body.inspiracion : antes.inspiracion;
    if (piezaHecha(estado) && (!piezaHecha(antes.estado) || (inspiracion || '') !== (antes.inspiracion || ''))) {
      await marcarIdeasUsadas(env, inspiracion);
    }
  }

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM piezas WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

import { checkToken } from '../_lib/auth.js';
// Ángulos de comunicación (la Matriz que vivía en Notion). Lista chica y
// estable — se suma alguno nuevo acá directo, sin volver a Notion.

export const CAMPOS_ANGULO = ['nombre', 'categoria', 'relevancia', 'lugar', 'formatos_sugeridos', 'activo'];


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT * FROM angulos ORDER BY categoria, nombre'
  ).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  if (!body.nombre) return json({ error: 'nombre requerido' }, 400);

  const now = new Date().toISOString();
  const datos = { ...body, activo: body.activo === undefined ? 1 : (body.activo ? 1 : 0) };

  const cols = CAMPOS_ANGULO.filter((c) => datos[c] !== undefined && datos[c] !== '');
  const sql = `INSERT INTO angulos (${cols.join(', ')}, creado_en, actualizado_en)
               VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;

  try {
    const result = await env.DB.prepare(sql)
      .bind(...cols.map((c) => datos[c]), now, now)
      .run();
    return json({ id: result.meta.last_row_id }, 201);
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return json({ error: 'ya existe un ángulo con ese nombre' }, 409);
    }
    throw e;
  }
}

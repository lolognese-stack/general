import { checkToken } from '../_lib/auth.js';
// Recursos (lead magnets) del planificador. Lista chica, cambia poco.

export const CAMPOS_RECURSO = ['nombre', 'problema', 'link', 'notas'];


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare('SELECT * FROM recursos ORDER BY nombre').all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  if (!body.nombre) return json({ error: 'nombre requerido' }, 400);

  const now = new Date().toISOString();
  const cols = CAMPOS_RECURSO.filter((c) => body[c] !== undefined && body[c] !== '');
  const sql = `INSERT INTO recursos (${cols.join(', ')}, creado_en)
               VALUES (${cols.map(() => '?').join(', ')}, ?)`;

  const result = await env.DB.prepare(sql)
    .bind(...cols.map((c) => body[c]), now)
    .run();
  return json({ id: result.meta.last_row_id }, 201);
}

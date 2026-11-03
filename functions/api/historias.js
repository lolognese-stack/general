import { checkToken } from '../_lib/auth.js';
// Secuencias de historias de IG. Una fila por secuencia (las historias de
// un día), no por historia suelta -- las métricas de ManyChat se miden por
// secuencia completa. Mismo patrón que piezas.js: token, GET con joins,
// POST con lista blanca de campos.

export const CAMPOS_HISTORIA = [
  'tema', 'fecha', 'semana', 'angulo_id', 'palabra_clave', 'link_manychat',
  'recurso_id', 'etiqueta_manychat',
  'idea', 'guion',
  'abridor_1', 'abridor_2', 'abridor_3', 'abridor_4',
  'aperturas', 'respuestas', 'calificados', 'formularios',
];


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare(
    `SELECT h.*,
            a.nombre AS angulo_nombre, a.categoria AS angulo_categoria,
            r.nombre AS recurso_nombre
       FROM historias h
       LEFT JOIN angulos a ON a.id = h.angulo_id
       LEFT JOIN recursos r ON r.id = h.recurso_id
      ORDER BY h.fecha DESC, h.id DESC`
  ).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  if (!body.tema) return json({ error: 'tema requerido' }, 400);

  const now = new Date().toISOString();
  const cols = CAMPOS_HISTORIA.filter((c) => body[c] !== undefined && body[c] !== '');
  const sql = `INSERT INTO historias (${cols.join(', ')}, creado_en, actualizado_en)
               VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;

  const result = await env.DB.prepare(sql)
    .bind(...cols.map((c) => body[c]), now, now)
    .run();

  return json({ id: result.meta.last_row_id }, 201);
}

import { checkToken } from '../_lib/auth.js';
// Serie diaria de cuenta de Instagram (alcance, views, interacciones...).
// Domino distinto de metricas.js (embudo de Tally/conversación) y de
// piezas.js (una fila por publicación) -- no mezclar.

const CAMPOS = [
  'fecha', 'reach', 'accounts_engaged', 'total_interactions', 'views',
  'likes', 'comments', 'saves', 'shares', 'new_followers',
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
    'SELECT * FROM metricas_cuenta_dia ORDER BY fecha'
  ).all();
  return json(results);
}

// Upsert por fecha -- correr el mismo import dos veces pisa el día, no lo
// duplica. Body: { dias: [{fecha, reach, ...}, ...] } o un solo día suelto.
export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const dias = Array.isArray(body.dias) ? body.dias : [body];
  if (!dias.length || !dias[0].fecha) return json({ error: 'fecha requerida' }, 400);

  const now = new Date().toISOString();
  const cols = CAMPOS.filter((c) => c !== 'fecha');
  const sql = `INSERT INTO metricas_cuenta_dia (fecha, ${cols.join(', ')}, actualizado_en)
               VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
               ON CONFLICT(fecha) DO UPDATE SET
                 ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
                 actualizado_en = excluded.actualizado_en`;

  for (const d of dias) {
    await env.DB.prepare(sql)
      .bind(d.fecha, ...cols.map((c) => (d[c] ?? null)), now)
      .run();
  }
  return json({ ok: true, n: dias.length });
}

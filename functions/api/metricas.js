import { checkToken } from '../_lib/auth.js';
// Métricas diarias del embudo de conversación.
//
// Una fila por día. La clave es la fecha: volver a cargar el mismo día pisa
// los números en vez de agregar una fila. Antes esto vivía en el
// localStorage de un solo navegador — ahora es la misma base que los leads.

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Los tres contadores son enteros >= 0. Texto, negativos y decimales se
// normalizan acá y nunca llegan a la base.
function entero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');

  const where = [];
  const binds = [];
  if (RE_FECHA.test(desde || '')) { where.push('fecha >= ?'); binds.push(desde); }
  if (RE_FECHA.test(hasta || '')) { where.push('fecha <= ?'); binds.push(hasta); }

  const sql =
    `SELECT fecha, conversaciones, formularios_enviados, formularios_completados
       FROM metricas_dia` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY fecha ASC`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body no es json' }, 400);
  }

  // Un día o una lista: el panel manda uno, una importación manda muchos.
  const filas = Array.isArray(body) ? body : [body];
  if (!filas.length) return json({ error: 'nada para guardar' }, 400);

  const now = new Date().toISOString();
  const stmts = [];

  for (const fila of filas) {
    const fecha = String(fila.fecha || '').slice(0, 10);
    if (!RE_FECHA.test(fecha)) return json({ error: `fecha invalida: ${fila.fecha}` }, 400);

    stmts.push(
      env.DB.prepare(
        `INSERT INTO metricas_dia
           (fecha, conversaciones, formularios_enviados, formularios_completados, actualizado_en)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(fecha) DO UPDATE SET
           conversaciones          = excluded.conversaciones,
           formularios_enviados    = excluded.formularios_enviados,
           formularios_completados = excluded.formularios_completados,
           actualizado_en          = excluded.actualizado_en`
      ).bind(
        fecha,
        entero(fila.conversaciones),
        entero(fila.formularios_enviados),
        entero(fila.formularios_completados),
        now
      )
    );
  }

  await env.DB.batch(stmts);
  return json({ ok: true, dias: stmts.length });
}

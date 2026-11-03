import { checkToken } from '../_lib/auth.js';
// Serie diaria de una pieza: cómo fue creciendo una publicación desde que
// empezamos a guardar fotos diarias (migración 044).
//
// Dominio distinto de metricas-cuenta.js (la cuenta entera por día) y de
// piezas.js (el último valor de cada pieza) -- no mezclar.


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const id = Number(new URL(request.url).searchParams.get('pieza_id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'pieza_id requerido' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT fecha, views, alcance, comentarios, likes, guardados, compartidos,
            seguimientos, tiempo_prom
       FROM piezas_metricas_dia
      WHERE pieza_id = ?
      ORDER BY fecha`
  ).bind(id).all();
  return json(results);
}

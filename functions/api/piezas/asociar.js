import { checkToken } from '../../_lib/auth.js';

// Asocia un posteo importado de Instagram (tema "(importado, sin clasificar)")
// a una pieza planificada, para que el posteo no quede suelto cuando el sync
// no lo pudo vincular solo (sin link cargado, o fecha/tipo que no coinciden).
//
// La pieza destino conserva todo lo que ya tiene (tema, ángulo, etiqueta,
// guion…) y recibe del posteo: el link, la fecha real, las métricas y la foto.
// La fila importada se borra: si no, el posteo quedaría contado dos veces.

const TEMA_IMPORTADO = '(importado, sin clasificar)';

const METRICAS = [
  'views', 'alcance', 'engagement', 'likes', 'comentarios',
  'guardados', 'compartidos', 'seguimientos', 'tiempo_prom',
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const importada = Number(body.importada_id);
  const destino = Number(body.destino_id);
  if (!Number.isInteger(importada) || !Number.isInteger(destino) || importada === destino) {
    return json({ error: 'importada_id y destino_id requeridos y distintos' }, 400);
  }

  const [imp, dest] = await Promise.all([
    env.DB.prepare('SELECT id, tema, video_url FROM piezas WHERE id = ?').bind(importada).first(),
    env.DB.prepare('SELECT id, tema, video_url FROM piezas WHERE id = ?').bind(destino).first(),
  ]);
  if (!imp || imp.tema !== TEMA_IMPORTADO) return json({ error: 'el posteo no está sin asociar' }, 409);
  if (!dest || dest.tema === TEMA_IMPORTADO) return json({ error: 'pieza destino inválida' }, 409);
  if (dest.video_url) return json({ error: 'la pieza destino ya tiene un link cargado' }, 409);

  const now = new Date().toISOString();
  const metricas = METRICAS.map((c) => `${c} = COALESCE((SELECT ${c} FROM piezas WHERE id = ?1), ${c})`).join(', ');

  // Un solo batch (transacción): o se pasa todo o no se toca nada.
  await env.DB.batch([
    // La foto del posteo pasa a la pieza, salvo que ya tenga una propia.
    env.DB.prepare('UPDATE OR IGNORE piezas_foto SET pieza_id = ?2 WHERE pieza_id = ?1').bind(importada, destino),
    env.DB.prepare(
      `UPDATE piezas SET
         estado = 'Subido',
         video_url = (SELECT video_url FROM piezas WHERE id = ?1),
         fecha = COALESCE((SELECT fecha FROM piezas WHERE id = ?1), fecha),
         formato = COALESCE(formato, (SELECT formato FROM piezas WHERE id = ?1)),
         hora_publicacion = COALESCE(hora_publicacion, (SELECT hora_publicacion FROM piezas WHERE id = ?1)),
         medido_en = COALESCE((SELECT medido_en FROM piezas WHERE id = ?1), medido_en),
         foto_v = COALESCE(foto_v, (SELECT foto_v FROM piezas WHERE id = ?1)),
         ${metricas},
         actualizado_en = ?3
       WHERE id = ?2`
    ).bind(importada, destino, now),
    // Historia de métricas diarias: pasa a la pieza destino.
    env.DB.prepare('UPDATE OR REPLACE piezas_metricas_dia SET pieza_id = ?2 WHERE pieza_id = ?1').bind(importada, destino),
    env.DB.prepare('UPDATE ideas SET pieza_id = ?2 WHERE pieza_id = ?1').bind(importada, destino),
    env.DB.prepare('DELETE FROM piezas WHERE id = ?1').bind(importada),
  ]);

  return json({ ok: true, id: destino });
}

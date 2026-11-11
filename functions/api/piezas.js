import { checkToken } from '../_lib/auth.js';
import { piezaHecha, marcarIdeasUsadas } from '../_lib/ideas-usadas.js';
// Piezas del planificador de contenido. Una sola fila por pieza — el
// registro planificado y el publicado-con-métricas son el mismo, solo
// cambia `estado`. A propósito distinto de separar "plan" y "publicadas":
// evita re-tipear la pieza cuando se sube.

export const CAMPOS_PIEZA = [
  'tema', 'fecha', 'semana', 'estado', 'formato', 'lugar', 'angulo_id', 'recurso_id',
  'etiqueta_manychat', 'link_manychat', 'video_url', 'hook', 'descripcion', 'cta',
  'inspiracion', 'diseno_url', 'drive_url', 'drive_miniatura_id', 'portada',
  'views', 'alcance', 'likes', 'compartidos', 'seguimientos', 'comentarios', 'guardados',
  'engagement', 'tiempo_prom', 'hora_publicacion', 'medido_en', 'notion_id',
  'duracion_seg', 'retencion_3s',
];


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);

  // leads_n/leads_si se calculan acá, no se cargan a mano: cruce por
  // etiqueta_manychat exacta. La guarda "IS NOT NULL" es obligatoria — sin
  // ella, cualquier lead con etiqueta vacía en vez de NULL contaría contra
  // todas las piezas sin etiqueta a la vez.
  const { results } = await env.DB.prepare(
    `SELECT p.*,
            a.nombre AS angulo_nombre, a.categoria AS angulo_categoria,
            r.nombre AS recurso_nombre,
            (SELECT COUNT(*) FROM leads l
              WHERE p.etiqueta_manychat IS NOT NULL
                AND l.etiqueta_manychat = p.etiqueta_manychat) AS leads_n,
            (SELECT COUNT(*) FROM leads l
              WHERE p.etiqueta_manychat IS NOT NULL
                AND l.etiqueta_manychat = p.etiqueta_manychat
                AND l.calificado = 'si') AS leads_si
       FROM piezas p
       LEFT JOIN angulos a ON a.id = p.angulo_id
       LEFT JOIN recursos r ON r.id = p.recurso_id
      ORDER BY p.fecha DESC, p.id DESC`
  ).all();

  // Ventas por pieza: lead con la etiqueta de la pieza que terminó en venta.
  // Aparte y con try: un cliente sin la tabla de ventas no puede quedarse sin
  // Planificador por un dato del embudo de Performance.
  try {
    const { results: ventas } = await env.DB.prepare(
      `SELECT l.etiqueta_manychat AS etiqueta, COUNT(*) AS n
         FROM ventas v JOIN leads l ON l.id = v.lead_id
        WHERE l.etiqueta_manychat IS NOT NULL AND l.etiqueta_manychat <> ''
          AND v.estado NOT IN ('pendiente_pago', 'cancelada')
        GROUP BY l.etiqueta_manychat`
    ).all();
    const porEtiqueta = new Map(ventas.map((v) => [v.etiqueta, v.n]));
    for (const p of results) p.ventas_n = p.etiqueta_manychat ? (porEtiqueta.get(p.etiqueta_manychat) || 0) : 0;
  } catch (e) {
    for (const p of results) p.ventas_n = 0;
  }

  return json(results);
}

// El índice único de etiqueta_manychat evita que dos piezas se lleven los mismos
// leads. Si se repite, se avisa cuál es el problema en vez de tirar un 500.
export function errorEtiquetaRepetida(e, body) {
  if (!/UNIQUE constraint failed: piezas\.etiqueta_manychat/.test(String(e && e.message))) return null;
  return { error: `Ya hay otra pieza con la etiqueta "${body.etiqueta_manychat || ''}". Cambiala para que no se repita (por ejemplo, sumale un 2).` };
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  if (!body.tema) return json({ error: 'tema requerido' }, 400);

  const now = new Date().toISOString();
  const datos = { ...body, estado: body.estado || 'IDEA', portada: body.portada ? 1 : 0 };

  const cols = CAMPOS_PIEZA.filter((c) => datos[c] !== undefined && datos[c] !== '');
  const sql = `INSERT INTO piezas (${cols.join(', ')}, creado_en, actualizado_en)
               VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;

  let result;
  try {
    result = await env.DB.prepare(sql)
      .bind(...cols.map((c) => datos[c]), now, now)
      .run();
  } catch (e) {
    const r = errorEtiquetaRepetida(e, body);
    if (r) return json(r, 409);
    throw e;
  }

  if (piezaHecha(datos.estado)) await marcarIdeasUsadas(env, datos.inspiracion);

  return json({ id: result.meta.last_row_id }, 201);
}

import { checkToken } from '../_lib/auth.js';
export const CAMPOS = [
  'nombre', 'pais', 'whatsapp', 'email', 'personas', 'destinos', 'fecha_viaje',
  'etapa', 'propuesta_url', 'precio', 'notas',
  'fecha_alta', 'pasajes', 'llegada', 'salida', 'dias', 'submission_id',
  'calificado', 'fecha_agenda', 'fecha_llamada', 'setter', 'closer',
  'fuente', 'estrategia', 'medio_agenda',
  // checklist de calificación (migración 003)
  'presupuesto_pp', 'edades_menores', 'residencia', 'categoria_hotel',
  'ocupacion', 'regimen', 'servicio', 'ocasion', 'vuelos_internos',
  // cierre y cobro (migración 003)
  'perdido_motivo', 'sena_pct', 'sena_fecha', 'saldo_vence', 'planning_fee',
  // atribución de contenido (migración 005)
  'angulo', 'etiqueta_manychat',
  // código de la visita a la web ("ref LL-######", migración 037)
  'codigo_web',
  // score de calificación, lo calcula el formulario (migración 035)
  'score', 'score_detalle',
  // Instagram y ManyChat, aparte del nombre (migraciones 032 y 042): el Sheet
  // de setting trae el usuario, no el nombre de la persona.
  'ig_username', 'manychat_id',
  // itinerario día por día en JSON (migración 048)
  'itinerario',
];

// "@Juan.Perez " -> "juan.perez". Vacío queda vacío.
export function normalizarIg(body) {
  if (typeof body.ig_username === 'string') body.ig_username = body.ig_username.trim().replace(/^@+/, '').toLowerCase();
}

// score: entero 1..10 (null o '' = sin score). Devuelve un mensaje de error
// o null si está bien. Se usa en el alta y en el PATCH.
export function errorDeScore(body) {
  if (body.score === undefined || body.score === null || body.score === '') return null;
  const n = typeof body.score === 'number' ? body.score : (typeof body.score === 'string' ? Number(body.score) : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 10) return 'score debe ser un entero de 1 a 10';
  body.score = n;
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT * FROM leads ORDER BY actualizado_en DESC'
  ).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  normalizarIg(body);
  // Alcanza con el nombre o con el usuario de Instagram.
  if (!body.nombre && !body.ig_username) return json({ error: 'nombre o usuario de Instagram requerido' }, 400);
  if (!body.nombre) body.nombre = '';
  const errScore = errorDeScore(body);
  if (errScore) return json({ error: errScore }, 400);

  const now = new Date().toISOString();
  const datos = { ...body, etapa: body.etapa || 'lead_nuevo' };

  const cols = CAMPOS.filter((c) => datos[c] !== undefined && (datos[c] !== '' || c === 'nombre'));
  const sql = `INSERT INTO leads (${cols.join(', ')}, creado_en, actualizado_en)
               VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;

  const result = await env.DB.prepare(sql)
    .bind(...cols.map((c) => datos[c]), now, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en)
     VALUES (?, NULL, ?, ?, ?)`
  )
    .bind(result.meta.last_row_id, datos.etapa, 'panel', now)
    .run();

  return json({ id: result.meta.last_row_id }, 201);
}

import { checkToken } from '../../_lib/auth.js';
import { CAMPOS, errorDeScore, normalizarIg } from '../leads.js';


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const errScore = errorDeScore(body);
  if (errScore) return json({ error: errScore }, 400);
  normalizarIg(body);

  const fields = Object.keys(body).filter((k) => CAMPOS.includes(k));
  if (fields.length === 0) return json({ error: 'nada para actualizar' }, 400);

  const now = new Date().toISOString();

  // Si cambia la etapa, dejamos rastro en `eventos` — de ahí salen los KPIs
  // (tiempo de primera respuesta, punto de fuga) sin cargar nada a mano.
  let etapaAnterior = null;
  if (fields.includes('etapa')) {
    const actual = await env.DB.prepare('SELECT etapa FROM leads WHERE id = ?')
      .bind(params.id)
      .first();
    etapaAnterior = actual ? actual.etapa : null;
  }

  const setClause = fields.map((f) => `${f} = ?`).join(', ') + ', actualizado_en = ?';
  // nombre es NOT NULL: vacío queda '' (un lead puede tener solo su usuario de Instagram).
  const values = fields.map((f) => (body[f] === '' && f !== 'nombre' ? null : body[f]));
  values.push(now, params.id);

  await env.DB.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`)
    .bind(...values)
    .run();

  if (fields.includes('etapa') && body.etapa !== etapaAnterior) {
    await env.DB.prepare(
      `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(params.id, etapaAnterior, body.etapa, body.setter || body.closer || null, now)
      .run();
  }

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  // Varias tablas referencian leads(id) sin ON DELETE CASCADE y D1 aplica las
  // claves foráneas: si queda una fila hija, el DELETE tira "FOREIGN KEY
  // constraint failed" (HTTP 500). Se borran primero los hijos, de más profundo
  // a más superficial, todo en un batch (atómico en D1). No todas las bases
  // tienen todas las tablas (depende de las migraciones corridas), así que
  // solo se tocan las que existen.
  const id = params.id;
  const hijos = [
    ['cotizacion_items', 'cotizacion_id IN (SELECT id FROM cotizaciones WHERE lead_id = ?)', 'cotizaciones'],
    ['cotizaciones', 'lead_id = ?'],
    ['wa_mensajes', 'conversacion_id IN (SELECT id FROM wa_conversaciones WHERE lead_id = ?)', 'wa_conversaciones'],
    ['wa_analisis', 'conversacion_id IN (SELECT id FROM wa_conversaciones WHERE lead_id = ?)', 'wa_conversaciones'],
    ['wa_conversaciones', 'lead_id = ?'],
    ['radar_reportes', 'lead_id = ?'],
    ['lead_resumenes', 'lead_id = ?'],
    ['eventos', 'lead_id = ?'],
  ];
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const tablas = new Set(results.map((r) => r.name));
  const stmts = hijos
    .filter(([t, , dep]) => tablas.has(t) && (!dep || tablas.has(dep)))
    .map(([t, w]) => env.DB.prepare(`DELETE FROM ${t} WHERE ${w}`).bind(id));
  stmts.push(env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

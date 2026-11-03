import { checkToken, json } from '../_lib/auth.js';
import { codigoIg } from '../_lib/ig-foto.js';
// Ideador de contenido: referencias guardadas (ver crm/migracion-028-ideas.sql).
//
// GET  lista todo, sin fotos (las sirve /api/foto-idea/:id con caché).
// POST crea. Si ya hay una idea con el mismo post de Instagram, la actualiza
//      en vez de duplicarla -- la extensión de Chrome puede guardar el mismo
//      post dos veces (una para clasificarlo, otra para corregirlo).

export const CAMPOS_IDEA = [
  'url', 'creador', 'formato', 'formato_score', 'angulo_ids', 'angulo_score',
  'texto', 'aplicacion', 'caption', 'views', 'likes', 'comentarios', 'uso', 'pieza_id', 'origen',
  'transcripcion', 'tipo', 'audio_nombre', 'audio_artista', 'audio_url',
];

// angulo_ids viaja como array y se guarda como JSON.
export function normalizar(body) {
  const datos = {};
  for (const c of CAMPOS_IDEA) {
    if (body[c] === undefined) continue;
    let v = body[c];
    if (c === 'angulo_ids') v = JSON.stringify(Array.isArray(v) ? v.map(Number).filter(Boolean) : []);
    else if (v === '') v = null;
    datos[c] = v;
  }
  // Un audio no ocupa el código del reel: el mismo reel puede estar guardado
  // como post y su audio como idea aparte.
  if (datos.url !== undefined) datos.codigo = body.tipo === 'audio' ? null : codigoIg(datos.url);
  return datos;
}

export function aCliente(row) {
  let angulo_ids = [];
  try { angulo_ids = JSON.parse(row.angulo_ids || '[]'); } catch {}
  return { ...row, angulo_ids };
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare('SELECT * FROM ideas ORDER BY creado_en DESC, id DESC').all();
  return json(results.map(aCliente));
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const datos = normalizar(body);
  if (!datos.url && !datos.texto && !datos.aplicacion && !datos.audio_nombre) return json({ error: 'falta link o texto' }, 400);
  const now = new Date().toISOString();

  // Un audio ya guardado (mismo link de audio, o mismo nombre y artista) se
  // actualiza en vez de duplicarse; un post, por su código de Instagram.
  let previa = null;
  if (datos.tipo === 'audio') {
    if (datos.audio_url) previa = await env.DB.prepare(`SELECT id, angulo_ids FROM ideas WHERE tipo = 'audio' AND audio_url = ?`).bind(datos.audio_url).first();
    if (!previa && datos.audio_nombre) previa = await env.DB.prepare(
      `SELECT id, angulo_ids FROM ideas WHERE tipo = 'audio' AND lower(audio_nombre) = lower(?) AND lower(COALESCE(audio_artista, '')) = lower(?)`
    ).bind(datos.audio_nombre, datos.audio_artista || '').first();
  } else if (datos.codigo) {
    previa = await env.DB.prepare(`SELECT id, angulo_ids FROM ideas WHERE codigo = ? AND COALESCE(tipo, 'post') != 'audio'`).bind(datos.codigo).first();
  }
  if (previa) {
    // Los ángulos se suman: volver a guardar desde la extensión (un solo
    // ángulo) no borra los que se le agregaron en el CRM.
    if (datos.angulo_ids) {
      let antes = [];
      try { antes = JSON.parse(previa.angulo_ids || '[]'); } catch {}
      datos.angulo_ids = JSON.stringify([...new Set([...antes, ...JSON.parse(datos.angulo_ids)])]);
    }
    // Lo que llega vacío no pisa lo que ya estaba.
    const cols = Object.keys(datos).filter((c) => datos[c] !== null && c !== 'origen');
    if (cols.length) {
      await env.DB.prepare(`UPDATE ideas SET ${cols.map((c) => `${c} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
        .bind(...cols.map((c) => datos[c]), now, previa.id).run();
    }
    const row = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(previa.id).first();
    return json({ ...aCliente(row), actualizada: true });
  }

  const cols = Object.keys(datos).filter((c) => datos[c] !== null);
  const creado = body.creado_en || now;
  const r = await env.DB.prepare(
    `INSERT INTO ideas (${[...cols, 'creado_en', 'actualizado_en'].join(', ')})
     VALUES (${[...cols, 1, 2].map(() => '?').join(', ')})`
  ).bind(...cols.map((c) => datos[c]), creado, now).run();
  const row = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(r.meta.last_row_id).first();
  return json(aCliente(row), 201);
}

import { checkToken, esAdmin, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../_lib/setter.js';
// Recursos del setter (no confundir con /api/recursos, los lead magnets del
// Planificador). GET lista sin los archivos. POST (admin):
//   { etiqueta, descripcion, tipo: 'link'|'archivo'|'audio', url?, archivo?: { nombre, mime, b64 } }
// Archivos y audios de hasta 1 MB van a setter_archivos (no hay R2).

export const MAX_BYTES = 1024 * 1024;
export const MIME_OK = /^(application\/pdf|image\/(jpeg|png|webp)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/mp4)/;
export const RE_ETIQUETA = /^[a-z0-9][a-z0-9_-]{1,39}$/;

// Valida { nombre, mime, b64 } y devuelve la fila para setter_archivos o un error.
export function archivoDe(a) {
  if (!a || typeof a.b64 !== 'string' || !a.b64) return { error: 'falta el archivo' };
  const mime = String(a.mime || '').toLowerCase();
  if (!MIME_OK.test(mime)) return { error: 'formato no aceptado por WhatsApp (PDF, JPG, PNG, OGG, MP3, M4A, AAC, MP4)' };
  const tamano = Math.floor(a.b64.replace(/=+$/, '').length * 3 / 4);
  if (tamano > MAX_BYTES) return { error: 'máximo 1 MB por archivo (no hay R2): comprímelo o súbelo a Drive y usa un link' };
  return { fila: { nombre: String(a.nombre || 'archivo').slice(0, 120), mime, tamano, datos_b64: a.b64 } };
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const { results } = await env.DB.prepare(
    `SELECT r.*, a.nombre AS archivo_nombre, a.mime AS archivo_mime, a.tamano AS archivo_tamano
       FROM setter_recursos r LEFT JOIN setter_archivos a ON a.recurso_id = r.id
      ORDER BY r.activo DESC, r.etiqueta`
  ).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const etiqueta = String(b.etiqueta || '').trim().replace(/^@/, '').toLowerCase();
  if (!RE_ETIQUETA.test(etiqueta)) return json({ error: 'etiqueta: minúsculas, números, - o _, sin espacios (2 a 40)' }, 400);
  const descripcion = String(b.descripcion || '').trim().slice(0, 500);
  if (!descripcion) return json({ error: 'falta la descripción: qué es y cuándo mandarlo' }, 400);
  if (!['link', 'archivo', 'audio'].includes(b.tipo)) return json({ error: 'tipo: link, archivo o audio' }, 400);
  const url = String(b.url || '').trim() || null;
  if (url && !/^https:\/\//.test(url)) return json({ error: 'el link tiene que empezar con https://' }, 400);
  if (b.tipo === 'link' && !url) return json({ error: 'falta el link' }, 400);
  let arch = null;
  if (b.tipo !== 'link' && (b.archivo || !url)) {
    const r = archivoDe(b.archivo);
    if (r.error) return json({ error: r.error }, 400);
    arch = r.fila;
  }
  if (await env.DB.prepare('SELECT 1 FROM setter_recursos WHERE etiqueta = ?').bind(etiqueta).first()) return json({ error: `ya existe @${etiqueta}` }, 409);
  const ahora = new Date().toISOString();
  const r = await env.DB.prepare(
    'INSERT INTO setter_recursos (etiqueta, descripcion, tipo, url, mime, activo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).bind(etiqueta, descripcion, b.tipo, url, arch?.mime ?? null, ahora, ahora).run();
  const id = r.meta.last_row_id;
  if (arch) {
    await env.DB.prepare('INSERT INTO setter_archivos (recurso_id, nombre, mime, tamano, datos_b64, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, arch.nombre, arch.mime, arch.tamano, arch.datos_b64, ahora).run();
  }
  return json({ id, etiqueta }, 201);
}

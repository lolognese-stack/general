import { checkToken, esAdmin, json } from '../../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../../_lib/setter.js';
import { archivoDe } from '../recursos.js';
// GET  → el archivo guardado (para escucharlo o verlo en el panel).
// PATCH (admin) { descripcion, url, activo, archivo } — un archivo nuevo
// reemplaza al anterior y obliga a subirlo de nuevo a WhatsApp.

export async function onRequestGet({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const a = await env.DB.prepare('SELECT nombre, mime, datos_b64 FROM setter_archivos WHERE recurso_id = ?').bind(params.id).first();
  if (!a) return json({ error: 'sin archivo' }, 404);
  const bin = atob(a.datos_b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': a.mime, 'content-disposition': `inline; filename="${a.nombre.replace(/"/g, '')}"` } });
}

export async function onRequestPatch({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const rec = await env.DB.prepare('SELECT * FROM setter_recursos WHERE id = ?').bind(params.id).first();
  if (!rec) return json({ error: 'no existe' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const sets = [], binds = [], ahora = new Date().toISOString();
  if (b.descripcion !== undefined) {
    const d = String(b.descripcion).trim().slice(0, 500);
    if (!d) return json({ error: 'la descripción no puede quedar vacía' }, 400);
    sets.push('descripcion = ?'); binds.push(d);
  }
  if (b.url !== undefined) {
    const u = String(b.url || '').trim() || null;
    if (u && !/^https:\/\//.test(u)) return json({ error: 'el link tiene que empezar con https://' }, 400);
    if (rec.tipo === 'link' && !u) return json({ error: 'falta el link' }, 400);
    sets.push('url = ?'); binds.push(u);
  }
  if (b.activo !== undefined) { sets.push('activo = ?'); binds.push(b.activo ? 1 : 0); }
  const stmts = [];
  if (b.archivo) {
    const r = archivoDe(b.archivo);
    if (r.error) return json({ error: r.error }, 400);
    stmts.push(env.DB.prepare(
      `INSERT INTO setter_archivos (recurso_id, nombre, mime, tamano, datos_b64, creado_en) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recurso_id) DO UPDATE SET nombre = excluded.nombre, mime = excluded.mime, tamano = excluded.tamano,
         datos_b64 = excluded.datos_b64, meta_media_id = NULL, meta_media_hasta = NULL, creado_en = excluded.creado_en`
    ).bind(rec.id, r.fila.nombre, r.fila.mime, r.fila.tamano, r.fila.datos_b64, ahora));
    sets.push('mime = ?'); binds.push(r.fila.mime);
  }
  if (!sets.length) return json({ error: 'nada para cambiar' }, 400);
  stmts.push(env.DB.prepare(`UPDATE setter_recursos SET ${sets.join(', ')}, actualizado_en = ? WHERE id = ?`).bind(...binds, ahora, rec.id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

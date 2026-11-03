import { checkToken, json } from '../../_lib/auth.js';
import { portadaIg, datosIg, aBase64 } from '../../_lib/ig-foto.js';
// Foto (y métricas) de una idea del Ideador. Mismo esquema que /api/foto-pieza.
//
// GET  sin token: la pide el <img> de la tarjeta. URL con ?v=foto_v, caché eterna.
// POST con token:
//   body { data, mime }  -> guarda esa imagen (captura subida a mano, o la que
//                           ya traía el ideador viejo).
//   body vacío           -> trae portada + likes/comentarios/caption de
//                           Instagram y actualiza la idea.

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT mime, data FROM ideas_foto WHERE idea_id = ?').bind(params.id).first();
  if (!row) return new Response('sin foto', { status: 404, headers: { 'cache-control': 'no-store' } });
  const bin = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bin, {
    headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}

export async function onRequestPost({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const idea = await env.DB.prepare('SELECT url, creador, caption FROM ideas WHERE id = ?').bind(params.id).first();
  if (!idea) return json({ error: 'no existe la idea' }, 404);

  let body = {};
  try { body = await request.json(); } catch {}

  let mime, data, origen, datos = null, audio = null;
  if (body.data) {
    mime = body.mime || 'image/jpeg';
    data = String(body.data).replace(/^data:[^,]+,/, '');
    origen = 'subida';
  } else {
    let foto;
    try { foto = await portadaIg(idea.url); }
    catch (e) { return json({ error: e.message }, 502); }
    mime = foto.mime;
    data = aBase64(foto.bytes);
    origen = idea.url;
    audio = foto.audio;
    try { datos = await datosIg(idea.url); } catch { /* la foto alcanza */ }
  }

  const v = Date.now();
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO ideas_foto (idea_id, mime, data, origen, actualizado_en) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(idea_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
         origen = excluded.origen, actualizado_en = excluded.actualizado_en`
    ).bind(params.id, mime, data, origen, now),
    env.DB.prepare('UPDATE ideas SET foto_v = ? WHERE id = ?').bind(v, params.id),
  ];
  if (audio) {
    // Qué audio usa el reel: para mostrarlo y poder guardarlo como idea aparte.
    stmts.push(env.DB.prepare(
      `UPDATE ideas SET audio_nombre = COALESCE(audio_nombre, ?), audio_artista = COALESCE(audio_artista, ?) WHERE id = ?`
    ).bind(audio.nombre, audio.artista, params.id));
  }
  if (datos) {
    stmts.push(env.DB.prepare(
      `UPDATE ideas SET views = COALESCE(?, views), likes = COALESCE(?, likes), comentarios = COALESCE(?, comentarios),
         creador = COALESCE(creador, ?), caption = COALESCE(NULLIF(caption, ''), ?), actualizado_en = ? WHERE id = ?`
    ).bind(datos.views ?? null, datos.likes, datos.comentarios, datos.creador, datos.caption || null, now, params.id));
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare('SELECT views, likes, comentarios, creador, caption, audio_nombre, audio_artista FROM ideas WHERE id = ?').bind(params.id).first();
  return json({ ok: true, foto_v: v, ...row });
}

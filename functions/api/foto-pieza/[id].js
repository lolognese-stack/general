import { checkToken, json } from '../../_lib/auth.js';
import { portadaIg, aBase64 } from '../../_lib/ig-foto.js';
// Foto de una pieza (portada del reel / primera slide del carrusel).
//
// GET  sin token: la sirve el <img> del Calendario y del drawer, que no
//      pueden mandar el header. Son portadas de posts públicos de Instagram,
//      nada privado. La URL lleva ?v=foto_v, así que se cachea para siempre:
//      D1 lee una fila la primera vez y después ni se entera.
// POST con token: la vuelve a traer de Instagram (ver _lib/ig-foto.js) y la
//      guarda.

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT mime, data FROM piezas_foto WHERE pieza_id = ?')
    .bind(params.id).first();
  if (!row) return new Response('sin foto', { status: 404, headers: { 'cache-control': 'no-store' } });
  const bin = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bin, {
    headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}

export async function onRequestPost({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const pieza = await env.DB.prepare('SELECT video_url FROM piezas WHERE id = ?').bind(params.id).first();
  if (!pieza) return json({ error: 'no existe la pieza' }, 404);

  let foto;
  try { foto = await portadaIg(pieza.video_url); }
  catch (e) { return json({ error: e.message }, 502); }

  const v = Date.now();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO piezas_foto (pieza_id, mime, data, origen, actualizado_en) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(pieza_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
         origen = excluded.origen, actualizado_en = excluded.actualizado_en`
    ).bind(params.id, foto.mime, aBase64(foto.bytes), pieza.video_url, now),
    env.DB.prepare('UPDATE piezas SET foto_v = ? WHERE id = ?').bind(v, params.id),
  ]);
  return json({ ok: true, foto_v: v });
}

import { checkToken, esAdmin, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../_lib/setter.js';
// Base de conocimiento del setter: destinos, políticas, preguntas frecuentes.
// GET lista todo (activos e inactivos). POST { titulo, contenido, tags } (admin).

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const { results } = await env.DB.prepare('SELECT * FROM setter_conocimiento ORDER BY activo DESC, titulo').all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  const titulo = String(b?.titulo || '').trim().slice(0, 120), contenido = String(b?.contenido || '').trim().slice(0, 8000);
  if (!titulo || !contenido) return json({ error: 'título y contenido requeridos' }, 400);
  const ahora = new Date().toISOString();
  const r = await env.DB.prepare('INSERT INTO setter_conocimiento (titulo, contenido, tags, activo, creado_en, actualizado_en) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(titulo, contenido, String(b.tags || '').slice(0, 200) || null, ahora, ahora).run();
  return json({ id: r.meta.last_row_id }, 201);
}

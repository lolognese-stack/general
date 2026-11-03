import { esAdmin, json } from '../../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../../_lib/setter.js';
// Editar o desactivar un ítem de la base de conocimiento (no se borra). Solo admin.

export async function onRequestPatch({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const sets = [], binds = [];
  if (b.titulo !== undefined) { const v = String(b.titulo).trim().slice(0, 120); if (!v) return json({ error: 'título vacío' }, 400); sets.push('titulo = ?'); binds.push(v); }
  if (b.contenido !== undefined) { const v = String(b.contenido).trim().slice(0, 8000); if (!v) return json({ error: 'contenido vacío' }, 400); sets.push('contenido = ?'); binds.push(v); }
  if (b.tags !== undefined) { sets.push('tags = ?'); binds.push(String(b.tags || '').slice(0, 200) || null); }
  if (b.activo !== undefined) { sets.push('activo = ?'); binds.push(b.activo ? 1 : 0); }
  if (!sets.length) return json({ error: 'nada para cambiar' }, 400);
  const r = await env.DB.prepare(`UPDATE setter_conocimiento SET ${sets.join(', ')}, actualizado_en = ? WHERE id = ?`).bind(...binds, new Date().toISOString(), params.id).run();
  if (!r.meta.changes) return json({ error: 'no existe' }, 404);
  return json({ ok: true });
}

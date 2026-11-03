import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo, editorWorker } from '../../_lib/setter.js';
// Setter IA › Para aprobar: lo que el Worker propone cada mañana a partir de
// lo que contestó el equipo (setter_sugerencias). La IA no lo usa hasta que
// alguien lo aprueba: ahí pasa a setter_conocimiento como lección.
// GET                       { pendientes, items: [...] }
// POST { id, accion: 'aprobar', titulo?, contenido? }   (editado antes de aprobar)
// POST { id, accion: 'descartar' }
// POST { accion: 'revisar' }  corre la revisión ya, sin esperar a las 9
// POST { accion: 'chat', conversacion_id, nota? }  "Aprender de este chat" del Inbox

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ pendientes: 0, items: [] });
  const { results } = await env.DB.prepare(
    `SELECT s.*, l.nombre AS lead_nombre FROM setter_sugerencias s LEFT JOIN leads l ON l.id = s.lead_id
      WHERE s.estado = 'pendiente' ORDER BY s.creado_en DESC, s.id DESC LIMIT 100`
  ).all();
  return json({ pendientes: results.length, items: results });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (b?.accion === 'revisar') return editorWorker(env, 'aprender', {});
  if (b?.accion === 'chat') return editorWorker(env, 'aprender_chat', { conversacion_id: Number(b.conversacion_id) || 0, nota: String(b.nota || '').slice(0, 500) });
  if (!['aprobar', 'descartar'].includes(b?.accion)) return json({ error: 'accion inválida' }, 400);
  const s = await env.DB.prepare(`SELECT * FROM setter_sugerencias WHERE id = ?`).bind(b.id ?? 0).first();
  if (!s) return json({ error: 'no existe la sugerencia' }, 404);
  if (s.estado !== 'pendiente') return json({ error: `ya está ${s.estado}` }, 409);
  const ahora = new Date().toISOString();

  if (b.accion === 'descartar') {
    await env.DB.prepare(`UPDATE setter_sugerencias SET estado = 'descartada', resuelto_en = ? WHERE id = ?`).bind(ahora, s.id).run();
    return json({ ok: true });
  }
  const titulo = String(b.titulo ?? s.titulo).trim().slice(0, 120), contenido = String(b.contenido ?? s.contenido).trim().slice(0, 2000);
  if (!titulo || !contenido) return json({ error: 'falta el título o el contenido' }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO setter_conocimiento (titulo, contenido, tags, activo, creado_en, actualizado_en) VALUES (?, ?, ?, 1, ?, ?)`
  ).bind(titulo, contenido, s.tipo === 'tono' ? 'leccion,tono' : 'leccion', ahora, ahora).run();
  await env.DB.prepare(`UPDATE setter_sugerencias SET estado = 'aprobada', conocimiento_id = ?, titulo = ?, contenido = ?, resuelto_en = ? WHERE id = ?`)
    .bind(r.meta.last_row_id, titulo, contenido, ahora, s.id).run();
  return json({ ok: true, conocimiento_id: r.meta.last_row_id });
}

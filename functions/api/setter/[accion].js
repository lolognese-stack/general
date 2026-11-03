import { esAdmin, json } from '../../_lib/auth.js';
import { setterActivo, editorWorker, cuerpo } from '../../_lib/setter.js';
// /api/setter/playground | puntuar | asistente: el editor de prompts llama a
// Claude a través del Worker (la API key vive solo ahí). Solo admin.
// puntuar con prompt_id guarda la nota en setter_puntuaciones.

const ACCIONES = ['playground', 'puntuar', 'asistente'];

export async function onRequestPost({ request, env, params }) {
  if (!ACCIONES.includes(params.accion)) return json({ error: 'not found' }, 404);
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  if (params.accion !== 'puntuar' || !b.prompt_id) return editorWorker(env, params.accion, b);

  const r = await editorWorker(env, 'puntuar', b);
  const d = await r.json();
  if (r.ok && d.nota) {
    await env.DB.prepare('INSERT INTO setter_puntuaciones (prompt_id, nota, faltantes_json, creado_en) VALUES (?, ?, ?, ?)')
      .bind(b.prompt_id, d.nota, JSON.stringify({ resumen: d.resumen, faltantes: d.faltantes }), new Date().toISOString()).run();
  }
  return json(d, r.status);
}

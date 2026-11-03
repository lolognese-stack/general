import { checkToken, esAdmin, json } from '../../../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../../../_lib/setter.js';
// Versiones del prompt de un agente. La publicada más nueva es la activa.
// POST { texto, publicar, nota_cambio, autor } o { desde_id } ("volver a esta":
// copia esa versión como una nueva publicada). Publicar la primera misión de
// un especialista nuevo lo activa.

export async function onRequestGet({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const { results } = await env.DB.prepare(
    `SELECT p.*, (SELECT nota FROM setter_puntuaciones s WHERE s.prompt_id = p.id ORDER BY s.id DESC LIMIT 1) AS nota
       FROM setter_prompts p WHERE agente_id = ? ORDER BY version DESC LIMIT 50`
  ).bind(params.id).all();
  return json(results);
}

export async function onRequestPost({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const a = await env.DB.prepare('SELECT * FROM setter_agentes WHERE id = ?').bind(params.id).first();
  if (!a) return json({ error: 'no existe el agente' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);

  let texto = typeof b.texto === 'string' ? b.texto.trim() : '';
  let publicar = !!b.publicar, nota = String(b.nota_cambio || '').slice(0, 200) || null;
  if (b.desde_id) {
    const o = await env.DB.prepare('SELECT * FROM setter_prompts WHERE id = ? AND agente_id = ?').bind(b.desde_id, a.id).first();
    if (!o) return json({ error: 'no existe esa versión' }, 404);
    texto = o.texto; publicar = true; nota = `Vuelta a la versión ${o.version}`;
  }
  if (!texto) return json({ error: 'el prompt está vacío' }, 400);
  if (texto.length > 30000) return json({ error: 'máximo 30.000 caracteres' }, 400);

  const ult = await env.DB.prepare('SELECT max(version) v FROM setter_prompts WHERE agente_id = ?').bind(a.id).first();
  const version = (ult?.v || 0) + 1;
  const ahora = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(a.id, version, texto, publicar ? 'publicado' : 'borrador', b.autor === 'asistente' ? 'asistente' : 'humano', nota, ahora).run();
  let activado = false;
  if (publicar && !a.activo && a.rol === 'especialista') {
    const antes = await env.DB.prepare(`SELECT count(*) n FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado'`).bind(a.id).first();
    if (antes.n === 1) {
      await env.DB.prepare('UPDATE setter_agentes SET activo = 1, actualizado_en = ? WHERE id = ?').bind(ahora, a.id).run();
      activado = true;
    }
  }
  return json({ id: r.meta.last_row_id, version, estado: publicar ? 'publicado' : 'borrador', activado }, 201);
}

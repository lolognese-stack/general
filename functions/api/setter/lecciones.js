import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo, evento } from '../../_lib/setter.js';
// Lo que el equipo le enseña al setter desde el Inbox. Queda como una entrada
// más de la base de conocimiento (tag "leccion"), visible y editable en
// Setter IA › Conocimiento, y la IA la usa desde el mensaje siguiente.
// POST { tipo: 'correccion' | 'respuesta', pregunta, respuesta, respuesta_ia?, conversacion_id? }
//   correccion  la IA contestó mal: respuesta_ia es lo que dijo
//   respuesta   una persona contestó algo que la IA no sabía

const recorte = (v, n) => String(v || '').trim().slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  const tipo = b?.tipo === 'correccion' ? 'correccion' : 'respuesta';
  const pregunta = recorte(b?.pregunta, 1000), respuesta = recorte(b?.respuesta, 2000), ia = recorte(b?.respuesta_ia, 1000);
  if (!pregunta || !respuesta) return json({ error: 'falta la pregunta o la respuesta' }, 400);

  const contenido = [`Si preguntan algo como: «${pregunta}»`, `Responde: «${respuesta}»`];
  if (tipo === 'correccion' && ia) contenido.push(`No respondas como antes: «${ia}»`);
  const titulo = `${tipo === 'correccion' ? 'Corrección' : 'Respuesta del equipo'}: ${pregunta.replace(/\s+/g, ' ').slice(0, 80)}`;
  const ahora = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO setter_conocimiento (titulo, contenido, tags, activo, creado_en, actualizado_en) VALUES (?, ?, 'leccion', 1, ?, ?)`
  ).bind(titulo.slice(0, 120), contenido.join('\n'), ahora, ahora).run();

  const conv = b?.conversacion_id ? await env.DB.prepare('SELECT id, lead_id FROM wa_conversaciones WHERE id = ?').bind(b.conversacion_id).first() : null;
  if (conv) await evento(env.DB, conv, 'leccion', titulo.slice(0, 200));
  return json({ id: r.meta.last_row_id, titulo }, 201);
}

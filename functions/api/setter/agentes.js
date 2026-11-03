import { checkToken, esAdmin, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../_lib/setter.js';
// Setter IA: agentes (jefe + especialistas), recursos para citar y ajustes.
// GET  → todo lo que necesita la sección. POST { nombre } (admin) → especialista
// nuevo, inactivo hasta que se publique su misión.

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const [agentes, recursos, config, uso] = await Promise.all([
    env.DB.prepare(
      `SELECT a.*,
              (SELECT version FROM setter_prompts p WHERE p.agente_id = a.id AND p.estado = 'publicado' ORDER BY version DESC LIMIT 1) AS version_publicada,
              (SELECT max(version) FROM setter_prompts p WHERE p.agente_id = a.id) AS version_ultima
         FROM setter_agentes a ORDER BY a.rol = 'jefe' DESC, a.id`
    ).all().then((r) => r.results),
    env.DB.prepare('SELECT id, etiqueta, descripcion, tipo, activo FROM setter_recursos ORDER BY etiqueta').all().then((r) => r.results),
    env.DB.prepare('SELECT clave, valor FROM setter_config').all().then((r) => Object.fromEntries(r.results.map((x) => [x.clave, x.valor]))),
    env.DB.prepare('SELECT respuestas_ia FROM setter_uso WHERE mes = ?').bind(new Date().toISOString().slice(0, 7)).first(),
  ]);
  return json({ agentes, recursos, config, uso_mes: uso?.respuestas_ia || 0, admin: esAdmin(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  const nombre = String(b?.nombre || '').trim().slice(0, 60);
  const base = slug(nombre);
  if (!base) return json({ error: 'nombre requerido' }, 400);
  let clave = base;
  for (let n = 2; await env.DB.prepare('SELECT 1 FROM setter_agentes WHERE clave = ?').bind(clave).first(); n++) clave = `${base}_${n}`;
  const jefe = await env.DB.prepare(`SELECT * FROM setter_agentes WHERE rol = 'jefe' ORDER BY id LIMIT 1`).first();
  const ahora = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO setter_agentes (nombre, rol, clave, padre_id, canal, activo, tono, idioma, zona_horaria, aviso_ia_marca, recurso_conversion_id, creado_en, actualizado_en)
     VALUES (?, 'especialista', ?, ?, 'whatsapp', 0, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(nombre, clave, jefe?.id ?? null, jefe?.tono ?? 'tu', jefe?.idioma ?? 'auto', jefe?.zona_horaria ?? 'America/Lima', jefe?.aviso_ia_marca ?? null, jefe?.recurso_conversion_id ?? null, ahora, ahora).run();
  return json({ id: r.meta.last_row_id, clave }, 201);
}

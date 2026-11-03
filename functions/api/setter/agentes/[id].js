import { esAdmin, json } from '../../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../../_lib/setter.js';
// Configuración de un agente (tabla 2.2 del plan). Solo admin.

const TEXTO = { nombre: 60, idioma: 10, zona_horaria: 40, aviso_ia_marca: 80, modelo: 40 };
const BOOL = ['activo', 'responde_siempre', 'responder_al_instante', 'guion_por_pasos'];

export async function onRequestPatch({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'solo el admin configura el setter' }, 403);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const a = await env.DB.prepare('SELECT * FROM setter_agentes WHERE id = ?').bind(params.id).first();
  if (!a) return json({ error: 'no existe el agente' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const sets = [], binds = [];
  for (const [k, max] of Object.entries(TEXTO)) {
    if (b[k] === undefined) continue;
    const v = String(b[k] ?? '').trim().slice(0, max);
    if (k === 'nombre' && !v) return json({ error: 'nombre requerido' }, 400);
    sets.push(`${k} = ?`); binds.push(v || null);
  }
  for (const k of BOOL) if (b[k] !== undefined) { sets.push(`${k} = ?`); binds.push(b[k] ? 1 : 0); }
  if (b.tono !== undefined) {
    if (!['tu', 'usted'].includes(b.tono)) return json({ error: 'tono: tu o usted' }, 400);
    sets.push('tono = ?'); binds.push(b.tono);
  }
  if (b.recurso_conversion_id !== undefined) { sets.push('recurso_conversion_id = ?'); binds.push(b.recurso_conversion_id ? Number(b.recurso_conversion_id) : null); }
  if (b.activo) {
    const p = await env.DB.prepare(`SELECT 1 FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado'`).bind(a.id).first();
    if (!p) return json({ error: 'publica su prompt antes de activarlo' }, 400);
  }
  if (!b.activo && b.activo !== undefined && a.rol === 'jefe') return json({ error: 'el jefe no se apaga: usa el kill switch' }, 400);
  if (!sets.length) return json({ error: 'nada para cambiar' }, 400);
  await env.DB.prepare(`UPDATE setter_agentes SET ${sets.join(', ')}, actualizado_en = ? WHERE id = ?`).bind(...binds, new Date().toISOString(), a.id).run();
  return json(await env.DB.prepare('SELECT * FROM setter_agentes WHERE id = ?').bind(a.id).first());
}

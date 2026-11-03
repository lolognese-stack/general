import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
// Lo que el panel consulta cada pocos segundos, en cualquier sección: cuándo
// cambió algo del Inbox y qué chats esperan a una persona (para el aviso
// sonoro). Lee 1 fila + las urgentes por índice: el cupo diario de lecturas
// de D1 es compartido con todo el CRM, así que la lista completa se pide
// solo cuando `ultimo` cambia.

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ activo: false });
  const ultimo = await env.DB.prepare('SELECT actualizado_en FROM wa_conversaciones ORDER BY actualizado_en DESC LIMIT 1').first();
  const { results } = await env.DB.prepare('SELECT id FROM wa_conversaciones WHERE espera_persona = 1').all();
  // Sugerencias del equipo sin revisar (Setter IA › Para aprobar), por índice.
  const sug = await env.DB.prepare(`SELECT count(*) AS n FROM setter_sugerencias WHERE estado = 'pendiente'`).first().catch(() => null);
  return json({ activo: true, ultimo: ultimo?.actualizado_en || null, urgentes: results.map((r) => r.id), sugerencias: sug?.n || 0 });
}

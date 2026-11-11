// POST /api/wa-radar/:conversacion_id/aplicar — pasa al lead lo que la persona
// cambió en WhatsApp (destinos, días, fecha, personas) según el último análisis.
// Solo toca los campos de los cambios que el análisis marcó.

import { rolDe, json } from '../../../_lib/auth.js';
import { camposParaAplicar } from '../../../_lib/wa-radar.js';

export async function onRequestPost({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const db = env.DB;
  const id = Number(params.id);
  const fila = await db.prepare('SELECT lead_id, datos_json FROM wa_reportes WHERE conversacion_id = ?').bind(id).first();
  if (!fila) return json({ error: 'Todavía no hay análisis de este chat.' }, 404);
  if (!fila.lead_id) return json({ error: 'Este chat no tiene lead: no hay nada para actualizar.' }, 400);
  let datos;
  try { datos = JSON.parse(fila.datos_json); } catch { return json({ error: 'El análisis está dañado: volvé a analizar el chat.' }, 500); }

  const campos = camposParaAplicar(datos);
  const claves = Object.keys(campos);
  if (!claves.length) return json({ error: 'No hay cambios para pasar al lead.' }, 400);

  const ahora = new Date().toISOString();
  await db.prepare(`UPDATE leads SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
    .bind(...claves.map((k) => campos[k]), ahora, fila.lead_id).run();
  await db.prepare('UPDATE wa_reportes SET aplicado_en = ? WHERE conversacion_id = ?').bind(ahora, id).run();
  return json({ ok: true, lead_id: fila.lead_id, campos });
}

// Monitoreo (plan, Fase 8): un chat con la IA prendida donde el lead escribió
// último y nadie contestó en ALERTA_MIN minutos es una falla (Claude caído,
// token de Meta vencido, prompt sin publicar…). El cron lo pasa a "espera a
// una persona" —suena en el Inbox— y deja el evento para la vista Salud.

export const ALERTA_MIN = 10;   // la demora humana máxima es ~3,6 min

export async function alertarSinRespuesta(env, { ahora = new Date() } = {}) {
  const db = env.DB, iso = ahora.toISOString();
  const cfg = await db.prepare(`SELECT valor FROM setter_config WHERE clave = 'kill_switch'`).first();
  if (cfg?.valor === '1') return { alertas: 0 };
  const limite = new Date(ahora.getTime() - ALERTA_MIN * 60e3).toISOString();
  const { results } = await db.prepare(
    `SELECT id, lead_id, ultimo_en FROM wa_conversaciones
      WHERE ia_activa = 1 AND espera_persona = 0 AND ultimo_autor = 'lead'
        AND ultimo_en <= ? AND ventana_hasta > ?
      LIMIT 50`
  ).bind(limite, iso).all();
  for (const c of results) {
    const min = Math.round((ahora.getTime() - Date.parse(c.ultimo_en)) / 60e3);
    await db.batch([
      db.prepare('UPDATE wa_conversaciones SET espera_persona = 1, actualizado_en = ? WHERE id = ?').bind(iso, c.id),
      db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
        .bind(c.id, c.lead_id, 'alerta_sin_respuesta', `el lead escribió hace ${min} min y la IA no respondió`, iso),
    ]);
  }
  return { alertas: results.length };
}

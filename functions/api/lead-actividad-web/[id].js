// Bloque "Actividad en la web" del lead: lo que esta persona hizo en la web
// de Luna Llena, unido por su código LL-###### o su contacto de ManyChat.
import { checkToken, json } from '../../_lib/auth.js';

export async function onRequestGet({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const lead = await env.DB.prepare('SELECT id, codigo_web, manychat_id FROM leads WHERE id = ?').bind(params.id).first();
  if (!lead) return json({ error: 'no existe' }, 404);
  if (!lead.codigo_web && !lead.manychat_id) return json({ sesiones: [], paquetes: [], resumen: null, sin_identidad: true });

  const donde = `(codigo = ?1 OR (?2 IS NOT NULL AND manychat_id = ?2))`;
  const { results: sesiones } = await env.DB.prepare(
    `SELECT sesion_id, codigo, primer_evento, ultimo_evento, canal, utm_content, utm_campaign, landing, dispositivo,
            pais, paginas, vistas_paquete, max_scroll, clicks_whatsapp, cotizar_abierto, leads, duracion_ms,
            visitante_id, interno
       FROM sesiones_web WHERE ${donde} ORDER BY primer_evento DESC LIMIT 50`
  ).bind(lead.codigo_web, lead.manychat_id).all();
  if (!sesiones.length) return json({ sesiones: [], paquetes: [], resumen: null });

  const ids = sesiones.map((s) => s.sesion_id);
  const { results: paquetes } = await env.DB.prepare(
    `SELECT json_extract(datos_json, '$.paquete') AS slug, max(json_extract(datos_json, '$.nombre')) AS nombre,
            max(ruta) AS ruta, count(*) AS vistas, max(creado_en) AS ultima
       FROM eventos_web WHERE sesion_id IN (${ids.map(() => '?').join(',')}) AND tipo = 'page_view'
        AND json_extract(datos_json, '$.paquete') IS NOT NULL
      GROUP BY 1 ORDER BY vistas DESC, ultima DESC LIMIT 20`
  ).bind(...ids).all();

  const sum = (k) => sesiones.reduce((a, s) => a + (s[k] || 0), 0);
  const ultima = sesiones.reduce((m, s) => (s.ultimo_evento > m ? s.ultimo_evento : m), '');
  const sync = lead.manychat_id
    ? await env.DB.prepare('SELECT estado_json, error, actualizado_en FROM manychat_web_sync WHERE manychat_id = ?').bind(lead.manychat_id).first()
    : null;
  return json({
    resumen: {
      visitas: sesiones.length,
      primera: sesiones[sesiones.length - 1].primer_evento,
      ultima,
      en_vivo: Date.now() - Date.parse(ultima) < 5 * 60000,
      navegadores: new Set(sesiones.map((s) => s.visitante_id)).size,
      tiempo_ms: sum('duracion_ms'),
      whatsapp: sum('clicks_whatsapp'),
      abrio_cotizador: sum('cotizar_abierto'),
      cotizaciones: sum('leads'),
    },
    paquetes,
    sesiones,
    manychat: sync ? { ...JSON.parse(sync.estado_json), error: sync.error, actualizado_en: sync.actualizado_en } : null,
  });
}

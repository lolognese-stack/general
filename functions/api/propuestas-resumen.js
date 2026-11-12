// Vista interna de propuestas (propuestas-4c1f6a.html): una fila por propuesta con su actividad.
// Con el token del CRM (cualquiera de los dos roles).
import { rolDe, json } from '../_lib/auth.js';
import { PROPUESTAS_URL, webhookDiscord } from '../_lib/propuestas.js';

export async function onRequestGet({ request, env }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare(`
    SELECT p.slug, p.numero, p.cliente, p.valid_until, p.registrada_en,
           max(CASE WHEN e.evento = 'apertura' THEN e.creado_en END)                     AS ultima_apertura,
           min(CASE WHEN e.evento = 'apertura' THEN e.creado_en END)                     AS primera_apertura,
           sum(e.evento = 'apertura')                                                    AS visitas,
           max(e.evento = 'seccion' AND e.detalle = 'inversion')                          AS vio_tarifa,
           max(e.evento = 'seccion' AND e.detalle = 'reserva')                            AS vio_reserva,
           max(e.evento = 'cta' AND e.detalle = 'reservar')                               AS clic_reservar,
           sum(e.evento = 'cta')                                                         AS clics_cta,
           sum(e.evento = 'pdf')                                                         AS pdf,
           sum(CASE WHEN e.evento = 'tiempo' THEN CAST(e.detalle AS INTEGER) ELSE 0 END) AS segundos,
           group_concat(DISTINCT CASE WHEN e.evento = 'apertura' THEN e.dispositivo END) AS dispositivos
      FROM propuestas p
      LEFT JOIN propuesta_eventos e ON e.slug = p.slug
     GROUP BY p.slug
     ORDER BY coalesce(ultima_apertura, p.registrada_en) DESC`).all();
  const [alertas, noLeidas, webhook] = await Promise.all([
    env.DB.prepare(`SELECT a.id, a.slug, a.tipo, a.texto, a.dispositivo, a.leida, a.creado_en
       FROM propuesta_alertas a ORDER BY a.id DESC LIMIT 60`).all(),
    env.DB.prepare('SELECT count(*) AS n FROM propuesta_alertas WHERE leida = 0').first(),
    webhookDiscord(env),
  ]);
  return json({ rol, base: PROPUESTAS_URL(env), propuestas: results, alertas: alertas.results, no_leidas: noLeidas?.n || 0, discord: !!webhook });
}

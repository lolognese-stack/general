import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
// Salud del setter: ¿está andando? Último mensaje recibido y enviado, chats
// que esperan a una persona, errores de los últimos 7 días agrupados por tipo
// (con el detalle más reciente) y los últimos 30 eventos.

const PROBLEMAS = ['error_claude', 'error_envio', 'error_recurso', 'error_seguimiento', 'error_analisis', 'error_transcripcion',
  'error_herramienta', 'error_cron', 'rechazo', 'tope_mensual', 'sin_prompt', 'sin_agente', 'sin_api_key', 'alerta_sin_respuesta'];

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const marcas = PROBLEMAS.map(() => '?').join(',');
  const [ultIn, ultOut, esperan, errores, eventos, cfg, uso] = await Promise.all([
    env.DB.prepare(`SELECT max(ultimo_in_en) en FROM wa_conversaciones`).first(),
    env.DB.prepare(`SELECT max(creado_en) en FROM wa_mensajes WHERE autor = 'ia'`).first(),
    env.DB.prepare(
      `SELECT c.id, c.wa_id, c.ultimo_texto, c.ultimo_en, c.ia_activa, c.ia_pausa_motivo, l.nombre
         FROM wa_conversaciones c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.espera_persona = 1 ORDER BY c.ultimo_en DESC LIMIT 30`
    ).all().then((r) => r.results),
    env.DB.prepare(
      `SELECT tipo, count(*) n, max(creado_en) ultimo,
              (SELECT detalle FROM setter_eventos e2 WHERE e2.tipo = e.tipo AND e2.creado_en >= ?1 ORDER BY e2.id DESC LIMIT 1) detalle
         FROM setter_eventos e WHERE creado_en >= ?1 AND tipo IN (${marcas}) GROUP BY tipo ORDER BY ultimo DESC`
    ).bind(desde, ...PROBLEMAS).all().then((r) => r.results),
    env.DB.prepare('SELECT id, conversacion_id, tipo, detalle, creado_en FROM setter_eventos ORDER BY id DESC LIMIT 30').all().then((r) => r.results),
    env.DB.prepare('SELECT clave, valor FROM setter_config').all().then((r) => Object.fromEntries(r.results.map((x) => [x.clave, x.valor]))),
    env.DB.prepare('SELECT respuestas_ia FROM setter_uso WHERE mes = ?').bind(new Date().toISOString().slice(0, 7)).first(),
  ]);
  return json({
    kill_switch: cfg.kill_switch === '1',
    modelo: cfg.modelo_respuesta || 'claude-sonnet-5-5',
    uso_mes: uso?.respuestas_ia || 0,
    tope: cfg.tope_mensual ? Number(cfg.tope_mensual) : null,
    ultimo_recibido: ultIn?.en || null,
    ultimo_respondido_ia: ultOut?.en || null,
    esperan,
    errores,
    eventos,
  });
}

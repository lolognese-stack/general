import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
// Lista del Inbox con los filtros de SetterApp (PLAN-setter-luna-llena.md, 2.5).
//
//   estado=<ia_estado>           responde=ia|humano       leidas=sin_leer|leidas
//   visto=vio_no_contesto|no_abrio                          asignacion=mios|sin_asignar (+ yo=<nombre>)
//   abierta=lead|nosotros        actividad=hoy|semana|mes|rango (+ desde, hasta YYYY-MM-DD)
//   urgentes=1                   q=<texto>                lead_id=<id>
//   rol=cotizador                los anclados van siempre primero
//
// "Hoy", "semana" y "mes" van en hora de Perú (UTC-5), como el resto del CRM.

const ESTADOS = ['frio', 'tibio', 'calificado', 'cotizador_enviado', 'derivado', 'nurture', 'sin_respuesta', 'no_calificado', 'no_es_lead'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PERU_MS = 5 * 3600 * 1000;

// Inicio (UTC ISO) de hoy / la semana (lunes) / el mes en Perú.
function inicioPeru(tipo, ahora = Date.now()) {
  const p = new Date(ahora - PERU_MS);
  let y = p.getUTCFullYear(), m = p.getUTCMonth(), d = p.getUTCDate();
  if (tipo === 'semana') d -= (p.getUTCDay() + 6) % 7;
  if (tipo === 'mes') d = 1;
  return new Date(Date.UTC(y, m, d) + PERU_MS).toISOString();
}
const finDiaPeru = (ymd) => new Date(Date.parse(ymd + 'T00:00:00Z') + PERU_MS + 86400000).toISOString();
const inicioDiaPeru = (ymd) => new Date(Date.parse(ymd + 'T00:00:00Z') + PERU_MS).toISOString();

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const p = new URL(request.url).searchParams;
  const where = [], binds = [];
  const y = (sql, ...b) => { where.push(sql); binds.push(...b); };

  if (ESTADOS.includes(p.get('estado'))) y('l.ia_estado = ?', p.get('estado'));
  if (p.get('responde') === 'ia') y('c.ia_activa = 1');
  if (p.get('responde') === 'humano') y('c.ia_activa = 0');
  if (p.get('leidas') === 'sin_leer') y('c.no_leidos > 0');
  if (p.get('leidas') === 'leidas') y('c.no_leidos = 0');
  if (['vio_no_contesto', 'no_abrio'].includes(p.get('visto'))) y('c.visto_por_lead = ?', p.get('visto'));
  if (p.get('asignacion') === 'mios' && p.get('yo')) y('c.asignada_a = ?', p.get('yo'));
  if (p.get('asignacion') === 'sin_asignar') y(`coalesce(c.asignada_a, '') = ''`);
  if (['lead', 'nosotros'].includes(p.get('abierta'))) y('c.abierta_por = ?', p.get('abierta'));
  const act = p.get('actividad');
  if (['hoy', 'semana', 'mes'].includes(act)) y('c.ultimo_en >= ?', inicioPeru(act));
  if (act === 'rango') {
    if (RE_FECHA.test(p.get('desde') || '')) y('c.ultimo_en >= ?', inicioDiaPeru(p.get('desde')));
    if (RE_FECHA.test(p.get('hasta') || '')) y('c.ultimo_en < ?', finDiaPeru(p.get('hasta')));
  }
  if (p.get('urgentes') === '1') y('c.espera_persona = 1');
  if (p.get('rol') === 'cotizador') y(`c.rol = 'cotizador'`);
  if (/^\d+$/.test(p.get('lead_id') || '')) y('c.lead_id = ?', Number(p.get('lead_id')));
  const q = (p.get('q') || '').trim().toLowerCase().slice(0, 80);
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    y(`(lower(coalesce(c.alias, l.nombre, c.nombre_perfil, '')) LIKE ? OR c.wa_id LIKE ? OR lower(coalesce(c.ultimo_texto, '')) LIKE ?)`, like, like, like);
  }

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.lead_id, c.wa_id, c.nombre_perfil, c.agente_activo, c.ia_activa, c.ia_pausa_motivo,
            c.abierta_por, c.asignada_a, c.espera_persona, c.no_leidos, c.visto_por_lead, c.ventana_hasta,
            c.ultimo_texto, c.ultimo_autor, c.ultimo_en, c.anclada, c.rol, c.alias,
            l.nombre, l.etapa, l.calificado, l.score, l.ia_estado, l.ia_origen, l.ia_calificacion
       FROM wa_conversaciones c LEFT JOIN leads l ON l.id = c.lead_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.anclada DESC, c.espera_persona DESC, c.ultimo_en DESC
      LIMIT 300`
  ).bind(...binds).all();
  return json(results);
}

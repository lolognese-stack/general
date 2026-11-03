import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo, editorWorker } from '../../_lib/setter.js';
// Setter IA › Simulador: chats de prueba (números 999…) para hablar como
// cliente y como equipo sin WhatsApp. Pasan por todo el setter de verdad; lo
// que la IA "manda" no sale a ningún lado (setter-worker/src/canal/simulado.js).
// GET ?c=<id>     { horario, chats, mensajes (del chat c) }
// POST { accion: 'nuevo' }                         { wa_id } (el chat se crea con el primer mensaje)
// POST { accion: 'mensaje', wa_id, texto, como: 'lead' | 'equipo', nombre? }
// POST { accion: 'horario', valor: 'siempre' | 'real' | 'dia' | 'noche' | 'finde' }
// POST { accion: 'borrar' }                        borra todos los chats de prueba

const HORARIOS = ['siempre', 'real', 'dia', 'noche', 'finde'];
const SIM = `wa_id LIKE '999%'`;

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const c = Number(new URL(request.url).searchParams.get('c')) || 0;
  const [horario, chats, mensajes] = await Promise.all([
    env.DB.prepare(`SELECT valor FROM setter_config WHERE clave = 'sim_horario'`).first(),
    env.DB.prepare(
      `SELECT c.id, c.wa_id, coalesce(l.nombre, c.nombre_perfil) AS nombre, c.ia_activa, c.ia_pausa_motivo, c.ultimo_en, c.ultimo_texto
         FROM wa_conversaciones c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.${SIM} ORDER BY c.actualizado_en DESC LIMIT 30`
    ).all().then((r) => r.results),
    c ? env.DB.prepare(
      `SELECT m.id, m.direccion, m.autor, m.tipo, m.texto, m.creado_en FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id
        WHERE m.conversacion_id = ? AND c.${SIM} ORDER BY m.creado_en, m.id LIMIT 300`
    ).bind(c).all().then((r) => r.results) : [],
  ]);
  return json({ horario: horario?.valor || 'siempre', chats, mensajes });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  const ahora = new Date().toISOString();
  switch (b?.accion) {
    case 'nuevo':
      return json({ wa_id: '999' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0') });
    case 'mensaje':
      return editorWorker(env, 'simular', { wa_id: b.wa_id, texto: b.texto, como: b.como, nombre: b.nombre });
    case 'horario':
      if (!HORARIOS.includes(b.valor)) return json({ error: 'horario inválido' }, 400);
      await env.DB.prepare(`INSERT INTO setter_config (clave, valor, actualizado_en) VALUES ('sim_horario', ?, ?)
        ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`).bind(b.valor, ahora).run();
      return json({ ok: true });
    case 'borrar': {
      const conv = `(SELECT id FROM wa_conversaciones WHERE ${SIM})`;
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM wa_mensajes WHERE conversacion_id IN ${conv}`),
        env.DB.prepare(`DELETE FROM setter_eventos WHERE conversacion_id IN ${conv}`),
        env.DB.prepare(`DELETE FROM wa_analisis WHERE conversacion_id IN ${conv}`),
        env.DB.prepare(`DELETE FROM setter_sugerencias WHERE estado = 'pendiente' AND conversacion_id IN ${conv}`),
        env.DB.prepare(`DELETE FROM wa_conversaciones WHERE ${SIM}`),
        env.DB.prepare(`DELETE FROM leads WHERE ${SIM}`),   // los leads 999… solo los crea el simulador
      ]);
      return json({ ok: true });
    }
    default:
      return json({ error: 'accion inválida' }, 400);
  }
}

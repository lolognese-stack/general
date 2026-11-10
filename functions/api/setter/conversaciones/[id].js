import { checkToken, json } from '../../../_lib/auth.js';
import { setterActivo, evento } from '../../../_lib/setter.js';
// Un chat del Inbox: el hilo, la ficha resumida del lead y el análisis.
// PATCH { accion }:
//   tomar_control   la IA se calla en este chat (pausa manual)
//   devolver_ia     la IA vuelve a contestar y el chat deja de esperar a una persona
//   asignar         { asignada_a } ('' = desasignar)
//   leer            pone en 0 los no leídos
//   calificacion    { ia_calificacion } etiqueta comercial puesta por una persona
//                   ('' = sin etiqueta); la IA ya no la cambia

const CAMPOS_LEAD = `id, nombre, etapa, calificado, score, setter, closer, fuente, destinos, fecha_viaje, personas,
  presupuesto_pp, residencia, edades_menores, categoria_hotel, ocasion, codigo_web, notas,
  whatsapp, email, pais, dias, pasajes, llegada, salida, itinerario, manychat_id,
  ia_estado, ia_resumen, ia_score_motivo, ia_origen, ia_primera_intencion, ia_calificacion, ia_calificacion_por`;

const ETIQUETAS = ['interesado', 'curioso', 'no_califica', 'cotizado'];
// La calificación de siempre del CRM (si/masomenos/curioso) sigue a la etiqueta.
const CALIFICADO_DE = { interesado: 'si', curioso: 'curioso' };

async function conversacion(env, id) {
  return env.DB.prepare('SELECT * FROM wa_conversaciones WHERE id = ?').bind(id).first();
}

export async function onRequestGet({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const conv = await conversacion(env, params.id);
  if (!conv) return json({ error: 'no existe la conversación' }, 404);
  const [lead, mensajes, analisis] = await Promise.all([
    conv.lead_id ? env.DB.prepare(`SELECT ${CAMPOS_LEAD} FROM leads WHERE id = ?`).bind(conv.lead_id).first() : null,
    // Los últimos 300, en orden de lectura.
    env.DB.prepare(
      `SELECT * FROM (SELECT id, direccion, autor, agente_clave, tipo, texto, media_key, transcripcion, estado, error, leido_en, es_followup, creado_en
                        FROM wa_mensajes WHERE conversacion_id = ? ORDER BY creado_en DESC, id DESC LIMIT 300)
        ORDER BY creado_en, id`
    ).bind(conv.id).all().then((r) => r.results),
    env.DB.prepare('SELECT * FROM wa_analisis WHERE conversacion_id = ?').bind(conv.id).first(),
  ]);
  return json({ conversacion: conv, lead, mensajes, analisis });
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const conv = await conversacion(env, params.id);
  if (!conv) return json({ error: 'no existe la conversación' }, 404);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const ahora = new Date().toISOString();
  const upd = (sql, ...binds) => env.DB.prepare(`UPDATE wa_conversaciones SET ${sql}, actualizado_en = ? WHERE id = ?`).bind(...binds, ahora, conv.id).run();

  if (b.accion === 'tomar_control') {
    await upd(`ia_activa = 0, ia_pausa_motivo = 'manual'`);
    await evento(env.DB, conv, 'pausa', 'tomar control desde el Inbox');
  } else if (b.accion === 'devolver_ia') {
    await upd('ia_activa = 1, ia_pausa_motivo = NULL, espera_persona = 0');
    await evento(env.DB, conv, 'reanuda', 'devuelto a la IA desde el Inbox');
  } else if (b.accion === 'asignar') {
    const quien = typeof b.asignada_a === 'string' ? b.asignada_a.trim().slice(0, 60) : '';
    await upd('asignada_a = ?', quien || null);
    await evento(env.DB, conv, 'asignacion', quien || 'sin asignar');
  } else if (b.accion === 'calificacion') {
    const v = b.ia_calificacion || null;
    if (v !== null && !ETIQUETAS.includes(v)) return json({ error: 'calificación inválida' }, 400);
    if (!conv.lead_id) return json({ error: 'el chat no tiene lead' }, 400);
    await env.DB.prepare(
      `UPDATE leads SET ia_calificacion = ?, ia_calificacion_por = ?, calificado = coalesce(?, calificado), actualizado_en = ? WHERE id = ?`
    ).bind(v, v ? 'persona' : null, CALIFICADO_DE[v] || null, ahora, conv.lead_id).run();
    await evento(env.DB, conv, 'calificacion_manual', v || 'sin etiqueta');
  } else if (b.accion === 'leer') {
    // No toca actualizado_en: leer no es un cambio que los demás tengan que recargar.
    await env.DB.prepare('UPDATE wa_conversaciones SET no_leidos = 0 WHERE id = ?').bind(conv.id).run();
  } else {
    return json({ error: 'accion desconocida' }, 400);
  }
  return json({ ok: true, conversacion: await conversacion(env, conv.id) });
}

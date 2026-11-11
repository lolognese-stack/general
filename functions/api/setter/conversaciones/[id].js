import { checkToken, json } from '../../../_lib/auth.js';
import { setterActivo, evento } from '../../../_lib/setter.js';
// Un chat del Inbox: el hilo, la ficha resumida del lead y el análisis.
// PATCH { accion }:
//   tomar_control   la IA se calla en este chat (pausa manual)
//   devolver_ia     la IA vuelve a contestar y el chat deja de esperar a una persona
//   asignar         { asignada_a } ('' = desasignar)
//   leer            pone en 0 los no leídos
//   anclar          { anclada } el chat queda arriba de la lista (o deja de estarlo)
//   rol             { rol: 'cotizador' | '', alias } marca al contacto que cotiza: no es un lead,
//                   queda anclado y sin IA. Hay uno solo: marcar a otro le saca el rol al anterior
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
  } else if (b.accion === 'anclar') {
    await upd('anclada = ?', b.anclada ? 1 : 0);
  } else if (b.accion === 'rol') {
    if (b.rol !== 'cotizador' && b.rol !== '' && b.rol !== null) return json({ error: 'rol inválido' }, 400);
    if (b.rol === 'cotizador') {
      const alias = typeof b.alias === 'string' ? b.alias.trim().slice(0, 60) : '';
      if (!alias && !conv.alias) return json({ error: 'poné el nombre de la persona' }, 400);
      await env.DB.prepare(`UPDATE wa_conversaciones SET rol = NULL WHERE rol = 'cotizador' AND id <> ?`).bind(conv.id).run();
      // Si el chat entró solo y se creó un lead con el número como nombre, ese lead sobra: no es un cliente.
      const sobra = conv.lead_id
        ? await env.DB.prepare(`SELECT id FROM leads WHERE id = ? AND nombre GLOB '+[0-9]*' AND fuente = 'WhatsApp' AND ia_resumen IS NULL`).bind(conv.lead_id).first()
        : null;
      await upd(`rol = 'cotizador', alias = coalesce(?, alias), anclada = 1, ia_activa = 0, ia_pausa_motivo = 'manual', espera_persona = 0${sobra ? ', lead_id = NULL' : ''}`, alias || null);
      if (sobra) {
        try {
          await env.DB.prepare(`DELETE FROM leads WHERE id = ? AND NOT EXISTS (SELECT 1 FROM wa_conversaciones WHERE lead_id = ?)`).bind(sobra.id, sobra.id).run();
        } catch { /* con datos colgando (radar, cotizaciones) queda: no molesta */ }
      }
    } else {
      await upd('rol = NULL');
    }
  } else if (b.accion === 'asociar_lead') {
    // Un chat que no cruzó solo con ningún lead (p. ej. le escribiste desde el celular a alguien
    // cargado con otro número): se lo asocia a mano al lead que corresponde.
    const destino = /^\d+$/.test(String(b.lead_id ?? '')) ? await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(Number(b.lead_id)).first() : null;
    if (!destino) return json({ error: 'no existe ese lead' }, 404);
    const previo = conv.lead_id;
    const otro = await env.DB.prepare('SELECT wa_id FROM wa_conversaciones WHERE lead_id = ? AND id <> ? LIMIT 1').bind(destino.id, conv.id).first();
    await upd('lead_id = ?', destino.id);
    await env.DB.prepare(`UPDATE leads SET wa_id = coalesce(wa_id, ?), whatsapp = coalesce(nullif(whatsapp, ''), ?), actualizado_en = ? WHERE id = ?`)
      .bind(conv.wa_id, '+' + conv.wa_id, ahora, destino.id).run();
    // El lead que se creó solo al llegar el chat (nombre = el número, sin nada más) sobra.
    if (previo && previo !== destino.id) {
      await env.DB.prepare(
        `DELETE FROM leads WHERE id = ? AND nombre GLOB '+[0-9]*' AND fuente = 'WhatsApp' AND ia_resumen IS NULL
           AND NOT EXISTS (SELECT 1 FROM wa_conversaciones WHERE lead_id = ?)`
      ).bind(previo, previo).run();
    }
    await evento(env.DB, conv, 'asociar_lead', `lead ${destino.id}`);
    return json({ ok: true, otro_chat: otro ? otro.wa_id : null, conversacion: await conversacion(env, conv.id) });
  } else if (b.accion === 'leer') {
    // No toca actualizado_en: leer no es un cambio que los demás tengan que recargar.
    await env.DB.prepare('UPDATE wa_conversaciones SET no_leidos = 0 WHERE id = ?').bind(conv.id).run();
  } else {
    return json({ error: 'accion desconocida' }, 400);
  }
  return json({ ok: true, conversacion: await conversacion(env, conv.id) });
}

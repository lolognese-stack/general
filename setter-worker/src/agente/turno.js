// Un turno del setter: lo corre el Durable Object cuando suena la alarma de
// una conversación (después de la demora humana y del debounce).
//
// Guardas, en orden: kill switch → IA pausada en el chat → lo último no es
// del lead (nunca escribe dos veces seguidas) → ventana de 24 h cerrada →
// tope mensual. Después: transcribe notas de voz, elige quién atiende (jefe,
// especialista activo o reserva_web si vino de la web), corre Claude con las
// herramientas, y antes de mandar vuelve a mirar que el lead no haya escrito
// algo nuevo ni que una asesora haya tomado el chat mientras tanto.

import { ejecutar } from './herramientas.js';
import { modoFinde, turnoDelEquipo } from './contexto.js';
import { correrAgentes, clienteClaude, modeloDe } from './loop.js';
import { enviar } from '../enviar.js';
import { salidaDeRecurso } from '../recursos.js';
import { canalPara, horarioDe } from '../canal/simulado.js';
import { avisarDerivacion, avisarConsulta } from '../avisos.js';
const RE_AVISO_IA = /\b(IA|AI|inteligencia artificial|artificial intelligence|intelig[eê]ncia artificial|asistente virtual|virtual assistant|assistente virtual)\b/i;

// "Hola!\n\nTe cuento…" → ['Hola!', 'Te cuento…']. Máximo 3 burbujas: lo que
// sobra va en la última.
export function partirBurbujas(texto, max = 3) {
  const partes = String(texto || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (partes.length <= max) return partes;
  return [...partes.slice(0, max - 1), partes.slice(max - 1).join('\n\n')];
}

// Tiempo de "tipeo" entre burbujas.
export const pausaEntreBurbujas = (texto) => Math.min(6000, 1200 + String(texto).length * 30);

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));

async function config(db) {
  const { results } = await db.prepare('SELECT clave, valor FROM setter_config').all();
  return Object.fromEntries(results.map((r) => [r.clave, r.valor]));
}

async function evento(db, conv, tipo, detalle, ahora) {
  await db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(conv.id, conv.lead_id, tipo, detalle ?? null, ahora).run();
}

const NOTA_ESCUCHA = `[Nota del sistema, no la ve la persona: ya derivaste este chat al equipo y le preguntaste si tenía alguna consulta sobre el servicio. Esto es lo que respondió.
- Si pregunta algo que está en la base de conocimiento o el catálogo, contéstalo en una o dos líneas. Si no está, dile que se lo confirman junto con la cotización.
- Después usa calificar: "si" si pregunta algo concreto del viaje o ya tiene una fecha concreta; "curioso" si dice que no y la fecha es vaga o lejana. Si dice que no pero tiene una fecha concreta, no califiques.
- No vuelvas a derivar. Es tu último mensaje en este chat: si solo dice que no, agradece en una línea.]`;

async function transcribirPendientes(env, canal, mensajes) {
  if (!env.AI) return;
  for (const m of mensajes) {
    if (m.direccion !== 'in' || m.tipo !== 'audio' || m.transcripcion || !m.media_key?.startsWith('meta:')) continue;
    try {
      const archivo = await canal.downloadMedia(m.media_key.slice(5));
      const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: { body: archivo.body, contentType: 'audio/ogg' },
      });
      const texto = String(r?.text || '').trim();
      if (texto) {
        await env.DB.prepare('UPDATE wa_mensajes SET transcripcion = ? WHERE id = ?').bind(texto, m.id).run();
        m.transcripcion = texto;
      }
    } catch (e) {
      await env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?)')
        .bind(m.conversacion_id, 'error_transcripcion', String(e.message || e).slice(0, 300), new Date().toISOString()).run();
    }
  }
}

async function promptPublicado(db, agenteId) {
  return db.prepare(`SELECT * FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado' ORDER BY version DESC LIMIT 1`).bind(agenteId).first();
}

function elegirAgente(agentes, conv, lead, yaHabloIa) {
  const activos = agentes.filter((a) => a.activo);
  if (conv.agente_activo) {
    const a = activos.find((x) => x.clave === conv.agente_activo);
    if (a) return a;
  }
  // Viene de un paquete de la web: ya sabe qué quiere, va directo a reserva_web.
  if (!yaHabloIa && lead.codigo_web) {
    const rw = activos.find((x) => x.clave === 'reserva_web' && x.rol === 'especialista');
    if (rw) return rw;
  }
  return activos.find((x) => x.rol === 'jefe') || null;
}

// Devuelve un string con lo que pasó (para tests y setter_eventos).
export async function correrTurno(env, canal, convId, { claude = null, dormir = dormirReal, ahora = () => new Date().toISOString() } = {}) {
  const db = env.DB;
  const t0 = ahora();
  const conv = await db.prepare('SELECT * FROM wa_conversaciones WHERE id = ?').bind(convId).first();
  if (!conv) return 'sin_conversacion';
  const cfg = await config(db);
  if (cfg.kill_switch === '1') return 'kill_switch';
  canal = canalPara(canal, conv.wa_id);
  const { envH, hora } = horarioDe(env, conv, cfg, t0);   // los chats de prueba eligen su horario
  if (turnoDelEquipo(envH, hora)) return 'horario_equipo';
  // Con SETTER_SOLO_NOCHE, de noche la IA retoma los chats que de día
  // atendió una persona desde el celular (no los derivados ni los pausados a mano).
  const retoma = !conv.ia_activa && !!envH.SETTER_SOLO_NOCHE && conv.ia_pausa_motivo === 'asesora_respondio';
  if (!conv.ia_activa && !retoma) return 'pausada';

  const mensajes = (await db.prepare(
    `SELECT * FROM (SELECT * FROM wa_mensajes WHERE conversacion_id = ? ORDER BY creado_en DESC, id DESC LIMIT 60) ORDER BY creado_en, id`
  ).bind(conv.id).all()).results;
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo || ultimo.direccion !== 'in') return 'nada_que_responder';
  if (!conv.ventana_hasta || conv.ventana_hasta <= t0) return 'ventana_cerrada';
  if (retoma) {
    await db.prepare('UPDATE wa_conversaciones SET ia_activa = 1, ia_pausa_motivo = NULL, actualizado_en = ? WHERE id = ?').bind(t0, conv.id).run();
    await evento(db, conv, 'reanuda', 'fuera del horario del equipo: la IA retoma el chat', t0);
    conv.ia_activa = 1; conv.ia_pausa_motivo = null;
  }

  const mes = t0.slice(0, 7);
  const uso = await db.prepare('SELECT respuestas_ia, tope FROM setter_uso WHERE mes = ?').bind(mes).first();
  const tope = uso?.tope ?? (cfg.tope_mensual ? Number(cfg.tope_mensual) : null);
  if (tope && (uso?.respuestas_ia || 0) >= tope) {
    await db.prepare('UPDATE wa_conversaciones SET espera_persona = 1, actualizado_en = ? WHERE id = ?').bind(t0, conv.id).run();
    await evento(db, conv, 'tope_mensual', `${uso?.respuestas_ia || 0}/${tope} respuestas en ${mes}`, t0);
    return 'tope';
  }

  if (!env.ANTHROPIC_API_KEY && !claude) {
    await evento(db, conv, 'sin_api_key', 'falta ANTHROPIC_API_KEY en el Worker', t0);
    return 'sin_api_key';
  }

  const lead = conv.lead_id ? await db.prepare('SELECT * FROM leads WHERE id = ?').bind(conv.lead_id).first() : null;
  if (!lead) return 'sin_lead';
  await transcribirPendientes(env, canal, mensajes);

  const [agentes, recursos, conocimiento] = await Promise.all([
    db.prepare('SELECT * FROM setter_agentes ORDER BY id').all().then((r) => r.results),
    db.prepare('SELECT * FROM setter_recursos WHERE activo = 1 ORDER BY etiqueta').all().then((r) => r.results),
    db.prepare('SELECT * FROM setter_conocimiento WHERE activo = 1 ORDER BY titulo').all().then((r) => r.results),
  ]);
  const yaHabloIa = mensajes.some((m) => m.autor === 'ia');
  let agente = elegirAgente(agentes, conv, lead, yaHabloIa);
  if (!agente) {
    await evento(db, conv, 'sin_agente', 'no hay agente jefe activo', t0);
    return 'sin_agente';
  }

  // "Escribiendo…" mientras piensa. Si Meta no lo acepta, sigue igual.
  if (ultimo.provider_id) canal.markRead(ultimo.provider_id, { escribiendo: true }).catch(() => {});

  // Ya derivado: la IA lee solo la respuesta a "¿tiene alguna consulta sobre
  // el servicio?", la contesta si puede, califica y se calla.
  const escucha = lead.ia_estado === 'derivado';
  const ctx = { db, conv, lead, agente, agentes, recursos, ahora: t0, salidas: [], estado: {} };
  const res = await correrAgentes({
    cliente: claude || clienteClaude(env), modelo: modeloDe(env, cfg), agente, agentes, recursos, conocimiento,
    conv, lead, mensajes, yaHabloIa, ctx, ejecutar, promptDe: (a) => promptPublicado(db, a.id),
    notaFinal: escucha ? NOTA_ESCUCHA : null, finde: modoFinde(envH, hora, mensajes),
  });
  if (res.agente && res.agente.clave !== conv.agente_activo) {
    await db.prepare('UPDATE wa_conversaciones SET agente_activo = ? WHERE id = ?').bind(res.agente.clave, conv.id).run();
  }
  // Después del turno de escucha la IA se calla, haya salido bien o no.
  const cerrarEscucha = async () => {
    if (!escucha) return;
    await db.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'handoff', actualizado_en = ? WHERE id = ? AND ia_activa = 1`).bind(ahora(), conv.id).run();
    await evento(db, conv, 'pausa', 'derivado: la IA ya leyó la respuesta a la consulta sobre el servicio', ahora());
  };
  if (res.error) {
    await cerrarEscucha();
    if (res.error !== 'sin_prompt') {
      await db.prepare('UPDATE wa_conversaciones SET espera_persona = 1, actualizado_en = ? WHERE id = ?').bind(t0, conv.id).run();
    }
    await evento(db, conv, res.error === 'rechazo' ? 'rechazo' : res.error, res.detalle, t0);
    return res.error;
  }
  agente = res.agente;
  const texto = res.texto;

  // ¿Cambió algo mientras Claude pensaba? Un mensaje nuevo del lead → el
  // turno siguiente responde todo junto. Una asesora tomó el chat → silencio.
  const nuevo = await db.prepare(`SELECT id FROM wa_mensajes WHERE conversacion_id = ? AND direccion = 'in' AND id > ? LIMIT 1`).bind(conv.id, ultimo.id).first();
  if (nuevo) {
    await evento(db, conv, 'turno_descartado', 'el lead escribió mientras se armaba la respuesta', ahora());
    return 'descartado_mensaje_nuevo';
  }
  const ahoraConv = await db.prepare('SELECT ia_activa, ia_pausa_motivo FROM wa_conversaciones WHERE id = ?').bind(conv.id).first();
  if (!ahoraConv.ia_activa && !ctx.estado.derivado && !ctx.estado.descartado) {
    await evento(db, conv, 'turno_descartado', `la IA se pausó durante el turno (${ahoraConv.ia_pausa_motivo})`, ahora());
    return 'descartado_pausa';
  }

  let burbujas = partirBurbujas(texto);
  if (agente.aviso_ia_marca && !yaHabloIa && burbujas.length && !RE_AVISO_IA.test(burbujas[0])) {
    burbujas = [`Hola, soy el asistente virtual con IA de ${agente.aviso_ia_marca}.`, ...burbujas];
  }

  let enviados = 0;
  for (let i = 0; i < burbujas.length; i++) {
    if (i > 0) await dormir(pausaEntreBurbujas(burbujas[i]));
    await enviar(env, canal, { conversacionId: conv.id, texto: burbujas[i], autor: 'ia', agenteClave: agente.clave }, ahora());
    enviados++;
  }
  for (const { recurso: rec } of ctx.salidas) {
    await dormir(1500);
    try {
      const salida = await salidaDeRecurso(env, canal, rec);
      await enviar(env, canal, { conversacionId: conv.id, autor: 'ia', agenteClave: agente.clave, recursoId: rec.id, ...salida }, ahora());
    } catch (e) {
      await evento(db, conv, 'error_recurso', `@${rec.etiqueta}: ${String(e.message || e).slice(0, 300)}`, ahora());
      continue;
    }
    enviados++;
  }

  if (ctx.estado.derivado) {
    const r = await avisarDerivacion(env, conv, lead).catch((e) => 'mail_error: ' + e.message);
    if (r !== 'sin_mail') await evento(db, conv, 'aviso_derivacion', r, ahora());
  }
  await cerrarEscucha();
  if (ctx.estado.consulta) {
    const r = await avisarConsulta(env, conv, lead, ctx.estado.consulta).catch((e) => 'mail_error: ' + e.message);
    if (r !== 'sin_mail') await evento(db, conv, 'aviso_consulta', r, ahora());
  }
  if (enviados) {
    await db.prepare(
      `INSERT INTO setter_uso (mes, respuestas_ia) VALUES (?, 1) ON CONFLICT(mes) DO UPDATE SET respuestas_ia = respuestas_ia + 1`
    ).bind(mes).run();
  }
  return enviados ? `respondio:${agente.clave}:${enviados}` : `sin_texto:${agente.clave}`;
}

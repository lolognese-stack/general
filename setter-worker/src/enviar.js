// Envío saliente: valida la ventana de 24 h, manda por el canal y guarda el
// mensaje. Lo usan el endpoint interno (panel, por Service Binding) y el
// turno de la IA (Durable Object).

import { conversacionDe, insertarMensaje, ultimoSql } from './ingesta.js';
import { normalizarWa } from './leads.js';
import { canalPara } from './canal/simulado.js';

export class ErrorEnvio extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// pedido: { conversacionId | waId, texto? | media? | plantilla?: { nombre, idioma, params }, autor, agenteClave?, recursoId? }
export async function enviar(env, canal, pedido, ahora = new Date().toISOString()) {
  const db = env.DB;
  let conv;
  if (pedido.conversacionId) {
    conv = await db.prepare('SELECT * FROM wa_conversaciones WHERE id = ?').bind(pedido.conversacionId).first();
    if (!conv) throw new ErrorEnvio('no existe la conversación', 404);
  } else {
    const waId = normalizarWa(pedido.waId);
    if (!waId) throw new ErrorEnvio('wa_id inválido');
    conv = await conversacionDe(db, { waId, nombre: null, abiertaPor: 'nosotros', codigoWeb: null, origen: null }, ahora);
  }

  canal = canalPara(canal, conv.wa_id);
  const { texto, media, plantilla } = pedido;
  if (!texto && !media && !plantilla) throw new ErrorEnvio('nada para enviar');
  // Fuera de la ventana de 24 h, WhatsApp solo acepta plantillas aprobadas. Los envíos
  // automáticos (IA, seguimientos) lo respetan; el equipo puede mandar igual con
  // `forzar` y asume lo que pase: si Meta lo rechaza, el error vuelve tal cual.
  const ventanaAbierta = conv.ventana_hasta && conv.ventana_hasta > ahora;
  if (!plantilla && !ventanaAbierta && !pedido.forzar) throw new ErrorEnvio('ventana de 24 h cerrada: solo plantillas', 409);

  let ref, tipo, cuerpo = texto ?? null, mediaKey = null;
  try {
    if (plantilla) {
      ref = await canal.sendTemplate(conv.wa_id, plantilla.nombre, plantilla.idioma || 'es', plantilla.params || []);
      tipo = 'template';
      cuerpo = `[plantilla ${plantilla.nombre}] ${(plantilla.params || []).join(' · ')}`.trim();
    } else if (media) {
      ref = await canal.sendMedia(conv.wa_id, media);
      tipo = media.tipo;
      cuerpo = media.caption ?? null;
      mediaKey = media.id ? 'meta:' + media.id : media.link;
    } else {
      ref = await canal.sendText(conv.wa_id, texto);
      tipo = 'text';
    }
  } catch (e) {
    await db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(conv.id, conv.lead_id, 'error_envio', String(e.message || e).slice(0, 500), ahora).run();
    throw new ErrorEnvio(e.message, 502);
  }

  const autor = pedido.autor || 'sistema';
  await insertarMensaje(db, {
    conversacionId: conv.id, direccion: 'out', autor, agenteClave: pedido.agenteClave,
    tipo, texto: cuerpo, mediaKey, recursoId: pedido.recursoId, providerId: ref.providerId, estado: 'sent', creadoEn: ahora,
    esFollowup: pedido.esFollowup, intentoFollowup: pedido.intentoFollowup,
  });
  const humano = autor === 'asesora_web' || autor === 'asesora_app';
  await ultimoSql(db, conv.id, { autor, texto: cuerpo, tipo, en: ahora }, ahora,
    `, ultimo_out_en = ?1, visto_por_lead = NULL${humano ? ', espera_persona = 0' : ''}`).run();
  return { conversacionId: conv.id, providerId: ref.providerId };
}

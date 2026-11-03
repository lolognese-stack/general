// Durable Object "Conversacion": uno por número de WhatsApp (idFromName(wa_id)).
//
// Cada mensaje del lead reprograma la alarma a ahora + demora: si el lead
// manda tres mensajes seguidos, la alarma suena una vez (debounce). Un DO
// procesa de a un evento por vez, así que nunca hay dos turnos en paralelo
// para el mismo chat.
//
// El turno en sí (Claude, herramientas, envío) está en agente/turno.js.

import { DurableObject } from 'cloudflare:workers';
import { canalDe } from './canal/adapter.js';
import { correrTurno } from './agente/turno.js';
import { demoraMs } from './agente/demora.js';

export class Conversacion extends DurableObject {
  // demora: ms explícitos (tests) o, si no viene, la demora humana del agente.
  async avisar(conversacionId, demora) {
    await this.ctx.storage.put('conversacionId', conversacionId);
    if (demora === undefined) demora = await this.demoraPara(conversacionId);
    await this.ctx.storage.setAlarm(Date.now() + demora);
  }

  async demoraPara(conversacionId) {
    const db = this.env.DB;
    const conv = await db.prepare('SELECT agente_activo FROM wa_conversaciones WHERE id = ?').bind(conversacionId).first();
    const ultimo = await db.prepare(`SELECT texto FROM wa_mensajes WHERE conversacion_id = ? AND direccion = 'in' ORDER BY id DESC LIMIT 1`).bind(conversacionId).first();
    const yaRespondio = await db.prepare(`SELECT 1 FROM wa_mensajes WHERE conversacion_id = ? AND autor = 'ia' LIMIT 1`).bind(conversacionId).first();
    const agente = await db.prepare(
      `SELECT responder_al_instante FROM setter_agentes WHERE activo = 1 AND (clave = ? OR rol = 'jefe') ORDER BY clave = ? DESC LIMIT 1`
    ).bind(conv?.agente_activo ?? '', conv?.agente_activo ?? '').first();
    return demoraMs({ texto: ultimo?.texto, esPrimero: !yaRespondio, alInstante: !!agente?.responder_al_instante, modo: this.env.SETTER_DEMORA });
  }

  async alarm() {
    const conversacionId = await this.ctx.storage.get('conversacionId');
    if (!conversacionId) return;
    await this.turno(conversacionId);
  }

  async turno(conversacionId) {
    const turnos = ((await this.ctx.storage.get('turnos')) || 0) + 1;
    await this.ctx.storage.put('turnos', turnos);
    let resultado;
    try {
      resultado = await correrTurno(this.env, canalDe(this.env), conversacionId);
    } catch (e) {
      resultado = 'error: ' + String(e.message || e).slice(0, 300);
    }
    await this.env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?)')
      .bind(conversacionId, 'turno', resultado, new Date().toISOString()).run();
  }
}

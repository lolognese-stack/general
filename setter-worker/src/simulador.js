// Simulador (Setter IA › Simulador): mete mensajes en un chat de prueba como
// si llegaran por WhatsApp, del cliente o del equipo desde el celular, y
// dispara el turno de la IA igual que el webhook. Ver canal/simulado.js.

import { guardarEventos } from './ingesta.js';
import { esSimulado } from './canal/simulado.js';

const DEMORA_MS = 1500;   // la IA contesta enseguida, sin la demora "humana"

// { wa_id, texto, como: 'lead' | 'equipo', nombre? }
export async function simularMensaje(env, b) {
  const waId = String(b?.wa_id || '');
  const texto = String(b?.texto || '').trim().slice(0, 4000);
  if (!esSimulado(waId)) return { error: 'solo chats de prueba (999…)' };
  if (!texto) return { error: 'falta el texto' };
  const ev = {
    tipo: b.como === 'equipo' ? 'echo' : 'mensaje', waId, nombre: b.nombre || null,
    providerId: 'sim.' + crypto.randomUUID(), en: new Date().toISOString(), msgTipo: 'text', texto,
  };
  const convs = await guardarEventos(env.DB, [ev]);
  for (const c of convs) {
    const stub = env.CONVERSACION.get(env.CONVERSACION.idFromName(c.wa_id));
    await stub.avisar(c.id, DEMORA_MS);
  }
  const conv = await env.DB.prepare('SELECT id FROM wa_conversaciones WHERE wa_id = ?').bind(waId).first();
  return { ok: true, conversacion_id: conv?.id ?? null };
}

// setter-worker: entrada HTTP y programada del setter de WhatsApp.
//
//   GET  /webhook          handshake de Meta (hub.verify_token); Kapso no lo usa
//   POST /webhook          valida firma (Meta o Kapso, ver canal/adapter.js), guarda en D1 (idempotente), avisa al DO y responde 200
//   POST /interno/enviar   envío desde el panel (Service Binding) con x-setter-secret
//   GET  /interno/media/<id>  stream de una nota de voz o foto de WhatsApp (mismo secreto)
//   POST /interno/playground | puntuar | asistente   editor de prompts (Setter IA)
//
// El trabajo pesado va en el Durable Object, no acá: Meta reintenta si el
// webhook tarda o no devuelve 200.

import { canalDe } from './canal/adapter.js';
import { guardarEventos } from './ingesta.js';
import { enviar, ErrorEnvio } from './enviar.js';
import { playground, puntuar, asistente } from './agente/playground.js';
import { correrSeguimientos } from './agente/seguimiento.js';
import { analizarPendientes } from './agente/analisis.js';
import { alertarSinRespuesta } from './agente/alertas.js';
import { aprenderSiToca, aprenderDelEquipo, aprenderDeChat } from './agente/aprendizaje.js';
import { simularMensaje } from './simulador.js';

export { Conversacion } from './conversacion.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function secretoOk(request, env) {
  const s = request.headers.get('x-setter-secret') || '';
  const esperado = env.SETTER_INTERNAL_SECRET || '';
  if (!esperado || s.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

// Modo prueba: con SOLO_NUMEROS (números separados por coma) el setter ignora
// por completo a cualquier otro número: ni lo guarda ni le contesta. Así se
// prueba en un número real sin que la IA les hable a contactos de verdad.
// En Argentina WhatsApp a veces manda el móvil sin el 9 (549… / 54…).
const numeroComparable = (n) => String(n || '').replace(/\D/g, '').replace(/^549/, '54');

export function filtrarPermitidos(env, eventos) {
  const lista = (env.SOLO_NUMEROS || '').split(',').map(numeroComparable).filter(Boolean);
  if (!lista.length) return eventos;
  return eventos.filter((ev) => lista.includes(numeroComparable(ev.waId)));
}

async function webhook(request, env, ctx) {
  const canal = canalDe(env);
  if (request.method === 'GET') return canal.verifyWebhook(request) || new Response('forbidden', { status: 403 });

  const raw = await request.text();
  if (!(await canal.validateSignature(request, raw))) return new Response('firma inválida', { status: 401 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('json inválido', { status: 400 }); }

  const conversaciones = await guardarEventos(env.DB, filtrarPermitidos(env, canal.parseInbound(body)));
  for (const c of conversaciones) {
    const stub = env.CONVERSACION.get(env.CONVERSACION.idFromName(c.wa_id));
    ctx.waitUntil(stub.avisar(c.id));
  }
  return new Response('ok');
}

async function enviarInterno(request, env) {
  if (!secretoOk(request, env)) return json({ error: 'unauthorized' }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  try {
    const r = await enviar(env, canalDe(env), {
      conversacionId: b.conversacion_id, waId: b.wa_id, texto: b.texto, media: b.media,
      plantilla: b.plantilla, autor: b.autor || 'asesora_web',
    });
    return json({ ok: true, conversacion_id: r.conversacionId, provider_id: r.providerId });
  } catch (e) {
    if (e instanceof ErrorEnvio) return json({ error: e.message }, e.status);
    throw e;
  }
}

async function mediaInterna(request, env, mediaId) {
  if (!secretoOk(request, env)) return json({ error: 'unauthorized' }, 401);
  try {
    const r = await canalDe(env).downloadMedia(mediaId);
    return new Response(r.body, {
      headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=3600' },
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

const EDITOR = { playground, puntuar, asistente, aprender: (env) => aprenderDelEquipo(env), aprender_chat: aprenderDeChat, simular: simularMensaje };

async function editor(request, env, nombre) {
  if (!secretoOk(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'falta ANTHROPIC_API_KEY en el Worker' }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  try {
    const r = await EDITOR[nombre](env, b);
    return json(r, r.error && !r.burbujas ? 400 : 200);
  } catch (e) {
    return json({ error: String(e.message || e).slice(0, 300) }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/webhook' && (request.method === 'GET' || request.method === 'POST')) return webhook(request, env, ctx);
    if (pathname === '/interno/enviar' && request.method === 'POST') return enviarInterno(request, env);
    const ed = pathname.match(/^\/interno\/(playground|puntuar|asistente|aprender|aprender_chat|simular)$/);
    if (ed && request.method === 'POST') return editor(request, env, ed[1]);
    const media = pathname.match(/^\/interno\/media\/([\w.-]+)$/);
    if (media && request.method === 'GET') return mediaInterna(request, env, media[1]);
    return new Response('not found', { status: 404 });
  },

  // Cada 15 min: follow-ups, alerta de chats sin respuesta, análisis de los
  // quietos y, una vez por día desde las 9, las sugerencias del equipo.
  async scheduled(controller, env, ctx) {
    const registrarError = (e) => env.DB.prepare('INSERT INTO setter_eventos (tipo, detalle, creado_en) VALUES (?, ?, ?)')
      .bind('error_cron', String(e.message || e).slice(0, 300), new Date().toISOString()).run();
    ctx.waitUntil(correrSeguimientos(env, canalDe(env)).catch(registrarError));
    ctx.waitUntil(alertarSinRespuesta(env).catch(registrarError));
    if (env.ANTHROPIC_API_KEY) ctx.waitUntil(analizarPendientes(env).catch(registrarError));
    if (env.ANTHROPIC_API_KEY) ctx.waitUntil(aprenderSiToca(env).catch(registrarError));
  },
};

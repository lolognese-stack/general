import { checkInbox, json } from '../../../../_lib/auth.js';
import { setterActivo, alWorker, evento } from '../../../../_lib/setter.js';
import { puenteActivo, enviarPorPuente } from '../../../../_lib/puente.js';
// Responder desde el Inbox. El envío lo hace el Worker (ventana de 24 h,
// Graph API, guardado). Escribir a mano es tomar el control: la IA se pausa
// en ese chat, para que no contesten las dos a la vez (salvo "Responde siempre").

export async function onRequestPost({ request, env, params }) {
  if (!checkInbox(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
  const pl = b.plantilla && typeof b.plantilla === 'object' ? b.plantilla : null;
  if (!texto && !pl) return json({ error: 'mensaje vacío' }, 400);
  if (texto.length > 4096) return json({ error: 'máximo 4096 caracteres' }, 400);
  // Plantilla aprobada por Meta (primer contacto, fuera de la ventana de 24 h).
  let plantilla = null;
  if (pl) {
    const nombre = typeof pl.nombre === 'string' ? pl.nombre.trim() : '';
    if (!/^[a-z0-9_]{1,512}$/.test(nombre)) return json({ error: 'nombre de plantilla inválido' }, 400);
    const params = Array.isArray(pl.params) ? pl.params.map((p) => String(p ?? '').trim().slice(0, 200)) : [];
    if (params.length > 10 || params.some((p) => !p)) return json({ error: 'falta un dato de la plantilla' }, 400);
    plantilla = { nombre, idioma: /^[a-z]{2}(_[A-Z]{2})?$/.test(pl.idioma || '') ? pl.idioma : 'es', params };
  }

  const conv = await env.DB.prepare('SELECT id, lead_id, wa_id, ia_activa, agente_activo, ventana_hasta FROM wa_conversaciones WHERE id = ?').bind(params.id).first();
  if (!conv) return json({ error: 'no existe la conversación' }, 404);

  // Pasadas las 24 h la API oficial solo deja plantillas: el texto sale por el puente WhatsApp Web
  // (como escrito a mano desde el celular). El mensaje aparece en el chat cuando llega el eco de Kapso.
  const ventana = !!(conv.ventana_hasta && conv.ventana_hasta > new Date().toISOString());
  let via = 'api', data = {};
  if (!plantilla && (!ventana || b.via === 'puente') && (await puenteActivo(env))) {
    try { data = await enviarPorPuente(env, conv.wa_id, texto); via = 'puente'; }
    catch (e) { return json({ error: 'WhatsApp Web (puente): ' + e.message }, e.status === 404 ? 404 : 502); }
    await evento(env.DB, conv, 'envio_puente', texto.slice(0, 200));
  } else {

  const r = await alWorker(env, 'interno/enviar', {
    method: 'POST',
    body: JSON.stringify(plantilla ? { conversacion_id: conv.id, plantilla, autor: 'asesora_web' } : { conversacion_id: conv.id, texto, autor: 'asesora_web' }),
  });
  data = await r.json().catch(() => ({ error: 'el Worker no respondió bien' }));
  if (!r.ok) return json({ error: data.error || 'no se pudo enviar' }, r.status);
  }

  // "Responde siempre" en el agente que atiende: escribir a mano no pausa la IA.
  const siempre = await env.DB.prepare(
    `SELECT responde_siempre FROM setter_agentes WHERE activo = 1 AND (clave = ?1 OR rol = 'jefe') ORDER BY clave = ?1 DESC LIMIT 1`
  ).bind(conv.agente_activo ?? '').first();
  if (conv.ia_activa && !siempre?.responde_siempre) {
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio' WHERE id = ?`).bind(conv.id).run();
    await evento(env.DB, conv, 'pausa', 'la asesora respondió desde el Inbox');
  }
  return json({ ok: true, via, provider_id: data.provider_id || data.id || null });
}

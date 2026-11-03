import { checkToken, json } from '../../../../_lib/auth.js';
import { setterActivo, alWorker, evento } from '../../../../_lib/setter.js';
// Responder desde el Inbox. El envío lo hace el Worker (ventana de 24 h,
// Graph API, guardado). Escribir a mano es tomar el control: la IA se pausa
// en ese chat, para que no contesten las dos a la vez (salvo "Responde siempre").

export async function onRequestPost({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
  if (!texto) return json({ error: 'mensaje vacío' }, 400);
  if (texto.length > 4096) return json({ error: 'máximo 4096 caracteres' }, 400);

  const conv = await env.DB.prepare('SELECT id, lead_id, ia_activa, agente_activo FROM wa_conversaciones WHERE id = ?').bind(params.id).first();
  if (!conv) return json({ error: 'no existe la conversación' }, 404);

  const r = await alWorker(env, 'interno/enviar', {
    method: 'POST',
    body: JSON.stringify({ conversacion_id: conv.id, texto, autor: 'asesora_web' }),
  });
  const data = await r.json().catch(() => ({ error: 'el Worker no respondió bien' }));
  if (!r.ok) return json({ error: data.error || 'no se pudo enviar' }, r.status);

  // "Responde siempre" en el agente que atiende: escribir a mano no pausa la IA.
  const siempre = await env.DB.prepare(
    `SELECT responde_siempre FROM setter_agentes WHERE activo = 1 AND (clave = ?1 OR rol = 'jefe') ORDER BY clave = ?1 DESC LIMIT 1`
  ).bind(conv.agente_activo ?? '').first();
  if (conv.ia_activa && !siempre?.responde_siempre) {
    await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio' WHERE id = ?`).bind(conv.id).run();
    await evento(env.DB, conv, 'pausa', 'la asesora respondió desde el Inbox');
  }
  return json({ ok: true, provider_id: data.provider_id });
}

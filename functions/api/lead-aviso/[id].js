import { checkToken, json } from '../../_lib/auth.js';
import { enviarAvisoLead } from '../../_lib/aviso-lead.js';

// Botón "Mandarme por mail" de la ficha del lead: manda el aviso (WhatsApp +
// datos + lo que falta) de un lead que no llenó el formulario. Ver _lib/aviso-lead.js.
export async function onRequestPost({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(params.id).first();
  if (!lead) return json({ error: 'lead no encontrado' }, 404);
  const r = await enviarAvisoLead(env, lead, { manual: true });
  if (r.ok) return json({ ok: true, faltan: r.faltan });
  return json({ error: r.error, faltan: r.faltan }, r.error === 'falta RESEND_API_KEY' ? 501 : 502);
}

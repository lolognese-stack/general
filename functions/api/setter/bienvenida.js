import { json } from '../../_lib/auth.js';
import { puenteActivo, enviarPorPuente, esElPuente, BIENVENIDA_DEFECTO } from '../../_lib/puente.js';
// POST /api/setter/bienvenida { lead_id } (x-puente-secret)
// Lo llama el formulario de viaje (luna-llena-viaje/functions/api/submit.ts) apenas entra un lead
// con WhatsApp: le escribe por el puente WhatsApp Web, como si fuera a mano. Una sola vez por lead.
// Texto: setter_config.bienvenida_texto ({nombre} = primer nombre) o el de defecto.
// Apagar: setter_config.bienvenida_activa = '0'.

export async function onRequestPost({ request, env }) {
  if (!esElPuente(request, env)) return json({ error: 'unauthorized' }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const leadId = Number(b.lead_id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: 'lead_id inválido' }, 400);
  const cfg = Object.fromEntries((await env.DB.prepare(`SELECT clave, valor FROM setter_config WHERE clave IN ('bienvenida_activa', 'bienvenida_texto')`).all()).results.map((r) => [r.clave, r.valor]));
  if (cfg.bienvenida_activa === '0') return json({ ok: false, motivo: 'apagada' });
  if (!(await puenteActivo(env))) return json({ ok: false, motivo: 'sin puente' }, 503);
  const lead = await env.DB.prepare('SELECT id, nombre, whatsapp FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return json({ error: 'no existe el lead' }, 404);
  const numero = String(lead.whatsapp || '').replace(/\D/g, '');
  if (numero.length < 8) return json({ ok: false, motivo: 'sin whatsapp' });
  const ya = await env.DB.prepare(`SELECT 1 FROM setter_eventos WHERE lead_id = ? AND tipo = 'bienvenida_puente' LIMIT 1`).bind(leadId).first().catch(() => null);
  if (ya) return json({ ok: false, motivo: 'ya enviada' });
  const nombre = String(lead.nombre || '').trim().split(/\s+/)[0] || '';
  const texto = (cfg.bienvenida_texto || BIENVENIDA_DEFECTO).replace(/\{nombre\}/g, nombre).replace(/Hola !/, 'Hola!');
  try {
    await enviarPorPuente(env, numero, texto);
  } catch (e) {
    return json({ ok: false, error: e.message }, e.status || 502);
  }
  const conv = await env.DB.prepare('SELECT id FROM wa_conversaciones WHERE wa_id = ? OR lead_id = ? LIMIT 1').bind(numero, leadId).first().catch(() => null);
  await env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(conv ? conv.id : null, leadId, 'bienvenida_puente', texto.slice(0, 200), new Date().toISOString()).run().catch(() => {});
  return json({ ok: true });
}

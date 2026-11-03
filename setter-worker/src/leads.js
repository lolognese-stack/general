// Cruce de un número de WhatsApp con los leads del CRM.
//
// Orden: leads.wa_id → leads.whatsapp normalizado → codigo_web ("ref LL-…"
// que la web suma al WhatsApp) → lead nuevo. Nunca se pisa un campo cargado:
// solo se completan los vacíos.

const RE_REF = /\bLL-\d{6}\b/i;

export const codigoWebDe = (texto) => (texto || '').match(RE_REF)?.[0].toUpperCase() ?? null;

// E.164 sin '+'. WhatsApp ya manda el wa_id así; esto es para el texto libre
// de leads.whatsapp ("+51 930 299 443", "930299443", "0051…").
export function normalizarWa(t) {
  let d = String(t || '').replace(/\D/g, '').replace(/^00/, '');
  if (/^9\d{8}$/.test(d)) d = '51' + d; // celular de Perú sin código de país
  return d.length >= 8 ? d : null;
}

export async function buscarOCrearLead(db, { waId, nombre, codigoWeb, origen }, ahora) {
  let lead = await db.prepare('SELECT id FROM leads WHERE wa_id = ? LIMIT 1').bind(waId).first();

  if (!lead) {
    // Candidatos por los últimos 8 dígitos; se confirma normalizando en JS.
    const cola = waId.slice(-8);
    const { results } = await db.prepare(
      `SELECT id, whatsapp FROM leads
        WHERE wa_id IS NULL AND whatsapp IS NOT NULL
          AND replace(replace(replace(replace(replace(whatsapp,' ',''),'-',''),'+',''),'(',''),')','') LIKE ?
        ORDER BY id DESC`
    ).bind('%' + cola).all();
    lead = results.find((r) => normalizarWa(r.whatsapp) === waId) || null;
  }

  if (!lead && codigoWeb) {
    lead = await db.prepare('SELECT id FROM leads WHERE codigo_web = ? ORDER BY id DESC LIMIT 1').bind(codigoWeb).first();
  }

  if (lead) {
    await db.prepare(
      `UPDATE leads SET wa_id = coalesce(wa_id, ?), whatsapp = coalesce(nullif(whatsapp, ''), ?),
              codigo_web = coalesce(codigo_web, ?), ia_origen = coalesce(ia_origen, ?)
        WHERE id = ?`
    ).bind(waId, '+' + waId, codigoWeb, origen, lead.id).run();
    return { leadId: lead.id, creado: false };
  }

  const r = await db.prepare(
    `INSERT INTO leads (nombre, whatsapp, wa_id, etapa, setter, fuente, codigo_web, ia_origen, ia_estado, creado_en, actualizado_en)
     VALUES (?, ?, ?, 'lead_nuevo', 'IA', 'WhatsApp', ?, ?, 'frio', ?, ?)`
  ).bind(nombre || '+' + waId, '+' + waId, waId, codigoWeb, origen, ahora, ahora).run();
  return { leadId: r.meta.last_row_id, creado: true };
}

// Aviso al equipo cuando la IA deriva un chat o consulta algo que no sabe. Por mail con Resend, solo
// si el Worker tiene RESEND_API_KEY y AVISO_EMAIL (secrets); si no, queda el
// aviso sonoro del Inbox (espera_persona = 1).

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function avisarDerivacion(env, conv, lead) {
  return avisarEquipo(env, conv, lead, { asunto: 'Lead para atender', intro: 'La IA derivó este chat de WhatsApp.' });
}

// La IA no supo responder algo y lo consulta: el chat sigue con la IA.
export function avisarConsulta(env, conv, lead, pregunta) {
  return avisarEquipo(env, conv, lead, { asunto: 'Consulta para confirmar', intro: `La IA no supo responder y le dijo al cliente que lo consulta:<br><b>${escHtml(pregunta)}</b>` });
}

async function avisarEquipo(env, conv, lead, { asunto, intro }) {
  if (!env.RESEND_API_KEY || !env.AVISO_EMAIL) return 'sin_mail';
  const link = `${env.CRM_URL || 'https://crm-plantilla.pages.dev'}/panel-4c1f6a#/inbox?c=${conv.id}`;
  const ficha = [['WhatsApp', '+' + conv.wa_id], ['Destinos', lead.destinos], ['Cuándo', lead.fecha_viaje], ['Personas', lead.personas],
    ['Presupuesto', lead.presupuesto_pp], ['Desde', lead.residencia], ['Calificación', lead.calificado], ['Código web', lead.codigo_web]]
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.AVISO_FROM || 'Setter Luna Llena <onboarding@resend.dev>',
      to: env.AVISO_EMAIL.split(',').map((x) => x.trim()).filter(Boolean),
      subject: `${asunto}: ${lead.nombre || '+' + conv.wa_id}`,
      html: `<p>${intro}</p>
        <p><b>Resumen:</b><br>${escHtml(lead.ia_resumen || '—').replace(/\n/g, '<br>')}</p>
        <table>${ficha.map(([k, v]) => `<tr><td style="color:#666;padding-right:12px">${k}</td><td>${escHtml(v)}</td></tr>`).join('')}</table>
        <p><a href="${link}">Abrir el chat en el CRM</a></p>`,
    }),
  });
  return r.ok ? 'mail_enviado' : `mail_error_${r.status}`;
}

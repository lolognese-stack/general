// Mail de aviso de un lead para contactarlo por WhatsApp (Resend).
//
// Sale solo cuando entra un formulario completo de la web (cotizar-web.js) y a
// mano desde la ficha del lead ("Mandarme por mail", /api/lead-aviso/:id), para
// los que no llenaron el formulario (llegan por Instagram o ManyChat).
// Trae un botón de WhatsApp con el mensaje armado, todos los datos del lead y
// marca en rojo lo que falta (personas, mail, presupuesto…) para preguntarlo.
//
// Necesita el secret RESEND_API_KEY. El destinatario va fijo en el código, igual
// que en luna-llena-viaje: así no se puede redirigir por accidente. Con el
// remitente de prueba de Resend (onboarding@resend.dev) solo llega a la casilla
// dueña de la cuenta, que es esta. Si se verifica un dominio, setear LEADS_FROM.

import { setterActivo, alWorker } from './setter.js';

const NOTIFICAR_A = 'lolognese@gmail.com';
const FROM = 'Luna Llena Travel <onboarding@resend.dev>';
const PANEL = 'https://crm-plantilla.pages.dev/panel-4c1f6a#/leads';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hay = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function itinerarioDe(lead) {
  try {
    const x = JSON.parse(lead.itinerario || 'null');
    return Array.isArray(x) && x.some((t) => t && Array.isArray(t.dias) && t.dias.length) ? x : null;
  } catch {
    return null;
  }
}

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${+m[3]} ${MESES[+m[2] - 1]}` : '';
}

// "Lima, Paracas y Nazca (5–8 nov)": una línea por tramo.
function lineasItinerario(it) {
  return it.map((t, i) => {
    const fechas = (t.dias || []).map((d) => d.fecha).filter(Boolean).sort();
    const rango = fechas.length ? (fechas[0] === fechas.at(-1) ? fechaCorta(fechas[0]) : `${fechaCorta(fechas[0])} – ${fechaCorta(fechas.at(-1))}`) : '';
    return `${i + 1}. ${t.titulo || ''}${rango ? ` (${rango})` : ''}`;
  });
}

function primerNombre(n) {
  return String(n || '').trim().split(/\s+/)[0] || '';
}

// Mensaje armado para abrir el chat y confirmar los datos antes de cotizar.
function mensajeWhatsapp(lead, it) {
  const partes = [];
  if (lead.dias) partes.push(`Serían ${lead.dias} días`);
  if (hay(lead.fecha_viaje)) partes.push(/^\d/.test(lead.fecha_viaje) ? `del ${lead.fecha_viaje}` : `para ${lead.fecha_viaje}`);
  if (lead.personas) partes.push(`${lead.personas} pasajero${lead.personas > 1 ? 's' : ''}`);
  const destinos = it ? lineasItinerario(it).map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)$/, '')).join(', ') : lead.destinos;
  const resumen = [partes.join(', '), hay(destinos) ? `por ${destinos}` : ''].filter(Boolean).join(', ');
  return [
    `Hola ${primerNombre(lead.nombre)}! Te escribimos de Luna Llena Travel por tu consulta sobre tu viaje a Perú.${resumen ? ' ¿Puedes confirmarnos si estos datos son correctos?' : ''}`,
    ...(resumen ? ['', `${resumen}.`] : []),
    ...(lead.personas ? [] : ['', '¿Cuántas personas viajan?']),
    '',
    'Cuando lo confirmes, empezamos a trabajar en tu propuesta.',
  ].join('\n');
}

export function armarAvisoLead(lead, { manual = false } = {}) {
  const it = itinerarioDe(lead);
  const digitos = String(lead.whatsapp || '').replace(/\D/g, '');
  const waLink = digitos ? `https://wa.me/${digitos}?text=${encodeURIComponent(mensajeWhatsapp(lead, it))}` : '';
  const nombre = hay(lead.nombre) ? lead.nombre : (lead.ig_username ? '@' + lead.ig_username : 'Sin nombre');

  const fecha = hay(lead.fecha_viaje)
    ? lead.fecha_viaje
    : (lead.llegada ? `${lead.llegada}${lead.salida ? ' al ' + lead.salida : ''}` : '');
  const origen = [lead.fuente, lead.etiqueta_manychat].filter(hay).join(' · ');
  const notas = hay(lead.notas) ? String(lead.notas).trim().slice(0, 600) + (String(lead.notas).trim().length > 600 ? '…' : '') : '';

  // Lo que hace falta para cotizar. Si no está, el mail lo marca en rojo.
  const requisitos = [
    ['Personas', hay(lead.personas)],
    ['Mail', hay(lead.email)],
    ['País', hay(lead.pais)],
    ['Fecha', hay(fecha)],
    ['Días', hay(lead.dias) || !!it],
    ['Destinos', hay(lead.destinos) || !!it],
    ['Pasajes', hay(lead.pasajes)],
    ['Presupuesto por persona', hay(lead.presupuesto_pp)],
  ];
  const faltan = requisitos.filter(([, ok]) => !ok).map(([k]) => k);

  // [etiqueta, texto plano, html]. `falta` pinta el valor en rojo.
  const FALTA = '⚠ Falta';
  const fila = (k, valor, html) => ({ k, texto: hay(valor) ? String(valor) : FALTA, html: hay(valor) ? (html ?? esc(valor)) : null });
  const filas = [
    { k: 'Nombre', texto: `${nombre}${lead.personas ? ` x ${lead.personas}` : ''}`, html: esc(`${nombre}${lead.personas ? ` x ${lead.personas}` : ''}`) },
    fila('WhatsApp', lead.whatsapp, digitos ? `<a href="https://wa.me/${digitos}" style="color:#1a56db">${esc(lead.whatsapp)}</a>` : esc(lead.whatsapp || '')),
    fila('Mail', lead.email, hay(lead.email) ? `<a href="mailto:${esc(lead.email)}" style="color:#1a56db">${esc(lead.email)}</a>` : ''),
    fila('País', lead.pais),
    ...(hay(lead.personas) ? [] : [fila('Personas', null)]),
    fila('Fecha', fecha),
    fila('Días', lead.dias),
    ...(it
      ? [{ k: 'Itinerario', texto: lineasItinerario(it).join('\n'), html: lineasItinerario(it).map(esc).join('<br>') }]
      : [fila('Destinos', lead.destinos)]),
    fila('Pasajes', lead.pasajes),
    fila('Presupuesto pp', lead.presupuesto_pp),
    ...(origen ? [{ k: 'Origen', texto: origen, html: esc(origen) }] : []),
    ...(notas ? [{ k: 'Notas', texto: notas, html: esc(notas) }] : []),
  ];

  const asunto = manual
    ? `Contactar por WhatsApp: ${nombre}${faltan.length ? ` (faltan ${faltan.length} datos)` : ''}`
    : `Nuevo lead: ${nombre}${lead.personas ? ` x ${lead.personas}` : ''}`;

  const texto = [
    ...(faltan.length ? [`FALTA: ${faltan.join(', ')}`, ''] : []),
    ...filas.map((f) => `${f.k}: ${f.texto}`),
    '',
    ...(waLink ? [`Confirmar por WhatsApp: ${waLink}`] : []),
    `Abrir en el CRM: ${PANEL}`,
  ].join('\n');

  const rojo = 'color:#c0392b;font-weight:700';
  const filasHtml = filas.map((f) =>
    `<p style="margin:0 0 6px;font:14px/1.5 sans-serif;color:#222;white-space:pre-line"><strong>${esc(f.k)}:</strong> ${f.html === null ? `<span style="${rojo}">${FALTA}</span>` : f.html}</p>`
  ).join('');

  const html = `
    <div style="max-width:480px;margin:0 auto;padding:16px">
      ${waLink ? `<a href="${waLink}" style="display:block;text-align:center;background:#25D366;color:#fff;font:bold 16px/1 sans-serif;padding:16px;border-radius:6px;text-decoration:none;margin-bottom:20px">Confirmar por WhatsApp</a>` : ''}
      ${faltan.length ? `<div style="background:#fdecea;border-left:4px solid #c0392b;padding:10px 12px;margin-bottom:16px;font:14px/1.5 sans-serif;color:#7b241c"><strong>Faltan para cotizar:</strong> ${faltan.map(esc).join(' · ')}</div>` : ''}
      ${filasHtml}
      <a href="${PANEL}" style="display:block;text-align:center;background:#161616;color:#fff;font:bold 15px/1 sans-serif;padding:14px;border-radius:6px;text-decoration:none;margin-top:20px">Abrir en el CRM</a>
    </div>`;

  return { asunto, texto, html, faltan, waLink, mensaje: mensajeWhatsapp(lead, it) };
}

// La misma información del mail, como nota interna en el chat del Inbox: el
// equipo ve qué falta y tiene el link de WhatsApp con el mensaje armado. Si el
// setter no está activo o el lead no tiene WhatsApp, no hace nada; nunca frena el mail.
export async function notaAlInbox(env, lead, aviso) {
  if (!setterActivo(env) || !String(lead.whatsapp || '').replace(/\D/g, '')) return false;
  const cuerpo = aviso.texto.split('\n').filter((l) => !l.startsWith('Abrir en el CRM') && !l.startsWith('Confirmar por WhatsApp')).join('\n').trim();
  try {
    const r = await alWorker(env, 'interno/nota', {
      method: 'POST',
      body: JSON.stringify({ whatsapp: lead.whatsapp, nombre: lead.nombre, texto: `Aviso de lead: contactar por WhatsApp\n${cuerpo}\n\nMensaje sugerido:\n${aviso.mensaje}` }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function enviarAvisoLead(env, lead, opts = {}) {
  const aviso = armarAvisoLead(lead, opts);
  const inbox = await notaAlInbox(env, lead, aviso);
  if (!env.RESEND_API_KEY) return { ok: false, error: 'falta RESEND_API_KEY', faltan: aviso.faltan, inbox };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.LEADS_FROM || FROM,
      to: NOTIFICAR_A,
      ...(hay(lead.email) ? { reply_to: lead.email } : {}),
      subject: aviso.asunto,
      text: aviso.texto,
      html: aviso.html,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.message || JSON.stringify(body)}`, faltan: aviso.faltan, inbox };
  return { ok: true, id: body.id, faltan: aviso.faltan, inbox };
}

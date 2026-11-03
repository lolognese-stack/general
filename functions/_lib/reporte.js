// Reporte semanal por mail al cliente. Arma un HTML de mail (tablas e
// inline styles: los clientes de correo no entienden grid ni variables CSS)
// con la semana que acaba de terminar, el acumulado del programa y lo que
// viene. Lo manda por Resend.
import { leerPrograma, resolverSemanas } from './programa.js';
import { calcularVivo } from './vivo.js';

const C = {
  ink: '#111111', ink2: '#3D5C70', ink3: '#556C7A', line: '#D3E1EC', ground: '#EEF4F9', surface: '#FFFFFF',
  sunk: '#E4EDF5', glacier: '#404040', glacierSoft: '#F0F0F0',
  superado: '#6741D9', superadoBg: '#EDE7FB', cumplido: '#0E7A57', cumplidoBg: '#DDF2EA',
  cerca: '#C2410C', cercaBg: '#FCE9DC', no: '#B42318', noBg: '#FBE3E0',
};
const ESTADO = {
  superado: ['Superado', C.superado, C.superadoBg], cumplido: ['Cumplido', C.cumplido, C.cumplidoBg],
  cerca: ['Cerca', C.cerca, C.cercaBg], no_cumplido: ['No cumplido', C.no, C.noBg],
  sin_datos: ['Sin datos', C.ink3, C.sunk], en_curso: ['En curso', C.glacier, C.glacierSoft],
};
const IND = [
  ['piezas', 'Piezas publicadas', (v) => num(v)],
  ['visitas_video', 'Visitas promedio por video', (v) => num(v)],
  ['conv_pub', 'Conversaciones por publicación', (v) => num(v)],
  ['conv_dia', 'Conversaciones por día', (v) => num(v)],
  ['pct_conv', 'Conversación a consulta', (v) => (v * 100).toFixed(1).replace('.', ',') + '%'],
  ['seguidores', 'Seguidores', (v) => num(v)],
];

const num = (n) => (+n || 0).toLocaleString('es-AR');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fecha = (ymd) => ymd ? new Date(ymd + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : '—';

function chip(e) {
  const [t, fg, bg] = ESTADO[e] || ESTADO.sin_datos;
  return `<span style="display:inline-block;font:800 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${fg};background:${bg};border-radius:5px;padding:5px 8px">${t}</span>`;
}
function barra(pct, marca, marcaTxt) {
  const w = Math.max(0, Math.min(100, pct));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
    <td style="background:${C.sunk};border-radius:99px;height:12px;padding:0;position:relative">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:${w}%"><tr><td style="background:${C.glacier};border-radius:99px;height:12px;font-size:0;line-height:0">&nbsp;</td></tr></table>
    </td></tr>
    ${marca != null ? `<tr><td style="font:600 11px Helvetica,Arial,sans-serif;color:${C.ink2};padding-top:5px">Deberían ir en <b>${marcaTxt}</b></td></tr>` : ''}
  </table>`;
}
function fila(label, real, obj, estado, fmt) {
  const pct = real != null && obj ? Math.round(real / obj * 100) : null;
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${C.line};font:600 13px Helvetica,Arial,sans-serif;color:${C.ink2}">${label}</td>
    <td align="right" style="padding:9px 0;border-bottom:1px solid ${C.line};font:700 14px Helvetica,Arial,sans-serif;color:${C.ink};white-space:nowrap">${real != null ? fmt(real) : '—'} <span style="font-weight:600;color:${C.ink3}">/ ${fmt(obj)}</span></td>
    <td align="right" style="padding:9px 0 9px 10px;border-bottom:1px solid ${C.line};white-space:nowrap">${pct != null ? `<span style="font:700 12px Helvetica,Arial,sans-serif;color:${C.ink3}">${pct}%</span> ` : ''}${estado ? chip(estado) : ''}</td>
  </tr>`;
}

// Semana que se reporta: la última que ya terminó (hasta < hoy). Si se pide
// una en particular, esa.
export function semanaAReportar(semanas, hoy, pedida) {
  if (pedida) return semanas.find((s) => s.numero === pedida) || null;
  const terminadas = semanas.filter((s) => s.hasta && s.hasta < hoy);
  return terminadas.length ? terminadas[terminadas.length - 1] : null;
}

export async function armarReporte(db, { semana: pedida, hoy = new Date().toISOString().slice(0, 10), panelUrl = '' } = {}) {
  const programa = await leerPrograma(db);
  if (!programa.fecha_primera_publicacion) return { error: 'el programa no tiene fecha de primera publicación' };
  const vivo = await calcularVivo(db, programa, hoy);
  const { semanas, resumen } = await resolverSemanas(db, programa, 'cliente', vivo, hoy);
  const s = semanaAReportar(semanas, hoy, pedida);
  if (!s) return { error: 'todavía no terminó ninguna semana' };
  const sig = semanas.find((x) => x.numero === s.numero + 1);
  const ant = semanas.find((x) => x.numero === s.numero - 1);
  const e = s.cerrada_en || s.fase === 'vencida' ? (s.estado_semana || 'sin_datos') : (s.fase === 'en_curso' ? 'en_curso' : 'sin_datos');
  const principal = s.principal;
  const nombrePrincipal = principal === 'consultas' ? 'consultas' : 'piezas publicadas';
  const pct = resumen.acumulado / resumen.objetivo * 100;
  const delta = resumen.acumulado - resumen.deberiamos;
  const nombre = programa.nombre_cliente ? `, ${esc(programa.nombre_cliente)}` : '';
  const varPrincipal = ant && ant.real[principal] != null && s.real[principal] != null ? s.real[principal] - ant.real[principal] : null;

  const asunto = `Semana ${s.numero} · ${s.real[principal] != null ? num(s.real[principal]) : '—'} de ${num(s.objetivo[principal])} ${nombrePrincipal} · ${ESTADO[e][0]}`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(asunto)}</title></head>
<body style="margin:0;padding:0;background:${C.ground}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.ground}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;width:100%">

  <tr><td style="padding:0 4px 14px;font:700 12px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3}">Reporte semanal · Semana ${s.numero} de ${semanas.length}</td></tr>

  <!-- Hero -->
  <tr><td style="background:${C.ink};border-radius:16px;padding:28px 28px 24px">
    <div style="font:700 12px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#CFCFCF;margin-bottom:8px">Semana ${s.numero} · ${fecha(s.desde)} al ${fecha(s.hasta)}</div>
    <div style="font:800 48px/1 Helvetica,Arial,sans-serif;letter-spacing:-.03em;color:#fff">${s.real[principal] != null ? num(s.real[principal]) : '—'}<span style="font:600 16px Helvetica,Arial,sans-serif;color:#9DB8CC;letter-spacing:0"> &nbsp;de ${num(s.objetivo[principal])} ${nombrePrincipal}</span></div>
    <div style="margin-top:14px">${chip(e)}${varPrincipal != null ? ` <span style="font:600 12px Helvetica,Arial,sans-serif;color:#9DB8CC;margin-left:8px">${varPrincipal >= 0 ? '+' : ''}${num(varPrincipal)} vs. semana anterior</span>` : ''}</div>
  </td></tr>

  <tr><td style="height:12px"></td></tr>

  <!-- Acumulado -->
  <tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:22px 24px">
    <div style="font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3};margin-bottom:6px">Programa completo</div>
    <div style="font:800 32px/1 Helvetica,Arial,sans-serif;letter-spacing:-.03em;color:${C.ink};margin-bottom:12px">${num(resumen.acumulado)}<span style="font:600 14px Helvetica,Arial,sans-serif;color:${C.ink3};letter-spacing:0"> &nbsp;de ${num(resumen.objetivo)} consultas</span></div>
    ${barra(pct, resumen.deberiamos, num(resumen.deberiamos))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px"><tr>
      <td width="33%" style="font:600 11px Helvetica,Arial,sans-serif;color:${C.ink3}">Contra el plan<br><span style="font:800 18px Helvetica,Arial,sans-serif;color:${delta >= 0 ? C.cumplido : C.cerca}">${delta >= 0 ? '+' : ''}${num(delta)}</span></td>
      <td width="33%" style="font:600 11px Helvetica,Arial,sans-serif;color:${C.ink3}">Proyección al cierre<br><span style="font:800 18px Helvetica,Arial,sans-serif;color:${C.ink}">${resumen.proyeccion != null ? num(resumen.proyeccion) : '—'}</span></td>
      <td width="33%" style="font:600 11px Helvetica,Arial,sans-serif;color:${C.ink3}">Día del programa<br><span style="font:800 18px Helvetica,Arial,sans-serif;color:${C.ink}">${resumen.dia_programa != null ? `${resumen.dia_programa} <span style="font-size:12px;color:${C.ink3}">de ${programa.duracion_dias}</span>` : '—'}</span></td>
    </tr></table>
  </td></tr>

  <tr><td style="height:12px"></td></tr>

  <!-- Indicadores -->
  <tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:22px 24px">
    <div style="font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3};margin-bottom:4px">Cómo les fue esta semana</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${IND.filter(([k]) => s.objetivo[k] != null && k !== principal).map(([k, l, f]) => fila(l, s.real[k], s.objetivo[k], s.estado[k], f)).join('')}
      ${s.real.ventas != null ? `<tr><td style="padding:9px 0;font:600 13px Helvetica,Arial,sans-serif;color:${C.ink2}">Ventas cerradas</td><td align="right" style="padding:9px 0;font:700 14px Helvetica,Arial,sans-serif;color:${C.ink}">${num(s.real.ventas)}</td><td></td></tr>` : ''}
    </table>
  </td></tr>

  ${(s.porque || s.que_hacemos) ? `<tr><td style="height:12px"></td></tr>
  <tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:22px 24px">
    ${s.porque ? `<div style="font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3};margin-bottom:4px">Por qué</div><div style="font:400 15px/1.5 Helvetica,Arial,sans-serif;color:${C.ink};margin-bottom:${s.que_hacemos ? 16 : 0}px">${esc(s.porque)}</div>` : ''}
    ${s.que_hacemos ? `<div style="font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.ink3};margin-bottom:4px">Qué hacemos</div><div style="font:400 15px/1.5 Helvetica,Arial,sans-serif;color:${C.ink}">${esc(s.que_hacemos)}</div>` : ''}
  </td></tr>` : ''}

  ${sig ? `<tr><td style="height:12px"></td></tr>
  <tr><td style="background:${C.glacierSoft};border-radius:16px;padding:18px 24px">
    <div style="font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${C.glacier};margin-bottom:4px">Lo que viene · Semana ${sig.numero}</div>
    <div style="font:600 14px/1.5 Helvetica,Arial,sans-serif;color:${C.ink}">${[
      sig.objetivo.consultas != null ? `<b>${num(sig.objetivo.consultas)} consultas</b>` : null,
      sig.objetivo.piezas != null ? `${num(sig.objetivo.piezas)} piezas` : null,
      sig.objetivo.conv_pub != null ? `${num(sig.objetivo.conv_pub)} conversaciones por publicación` : null,
      sig.objetivo.seguidores != null ? `${num(sig.objetivo.seguidores)} seguidores` : null,
    ].filter(Boolean).join(' · ')}</div>
  </td></tr>` : ''}

  <tr><td style="padding:22px 4px 0;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:${C.ink2}">
    Hola${nombre}. Este es el resumen de la semana que cerramos. Todo esto lo pueden ver actualizado cuando quieran en el panel${panelUrl ? `: <a href="${esc(panelUrl)}" style="color:${C.glacier};font-weight:700">abrir panel</a>` : ''}. Si algo no les cierra, respondan este mail y lo vemos en la próxima weekly.
  </td></tr>
  <tr><td style="padding:18px 4px 0;font:600 11px Helvetica,Arial,sans-serif;color:${C.ink3}">Organic Travelling · programa de 90 días</td></tr>

</table></td></tr></table>
</body></html>`;

  const texto = `Semana ${s.numero} (${fecha(s.desde)} al ${fecha(s.hasta)}): ${s.real[principal] ?? '—'} de ${s.objetivo[principal]} ${nombrePrincipal} · ${ESTADO[e][0]}.
Programa: ${resumen.acumulado} de ${resumen.objetivo} consultas (deberían ir en ${resumen.deberiamos}). Proyección al cierre: ${resumen.proyeccion ?? '—'}.
${s.porque ? 'Por qué: ' + s.porque + '\n' : ''}${s.que_hacemos ? 'Qué hacemos: ' + s.que_hacemos + '\n' : ''}${panelUrl ? 'Panel: ' + panelUrl : ''}`;

  return { semana: s.numero, asunto, html, texto, programa, destinatarios: (programa.email_reporte || '').split(',').map((x) => x.trim()).filter(Boolean) };
}

// Manda por Resend. Necesita RESEND_API_KEY; REPORTE_FROM opcional
// (default: el remitente de prueba de Resend, que solo llega a la cuenta dueña).
export async function enviarMail(env, { a, asunto, html, texto }) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'falta RESEND_API_KEY' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.REPORTE_FROM || 'Organic Travelling <onboarding@resend.dev>',
      to: a, subject: asunto, html, text: texto,
      ...(env.REPORTE_REPLY_TO ? { reply_to: env.REPORTE_REPLY_TO } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.message || JSON.stringify(body)}` };
  return { ok: true, id: body.id };
}

// Itinerario armado por un visitante en la web (/armar/ de lunallenatravel-web). Solo lectura, sin precios.
//
// Se ve en https://lunallenatravel.vercel.app/i/<slug>/ (la web reescribe /i/* acá). Sin login: el slug es al azar.
// El botón de WhatsApp solo aparece si el lead quedó caliente o tibio (decisión del grilling 14/11/2026).

const WEB = 'https://lunallenatravel.vercel.app';
const WA = '51982360927';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const HOTEL = { economico: 'Económico', confort: 'Confort', superior: 'Superior' };
const RITMO = { tranquilo: 'Tranquilo', equilibrado: 'Equilibrado', a_full: 'A full' };

export async function onRequestGet({ env, params }) {
  const slug = String(params.slug || '');
  if (!/^[a-z0-9]{10,30}$/.test(slug)) return noEncontrado();
  const f = await env.DB.prepare('SELECT * FROM web_itinerarios WHERE slug = ?').bind(slug).first();
  if (!f) return noEncontrado();
  let dias = [], avisos = [], v = {};
  try { dias = JSON.parse(f.dias_json || '[]'); avisos = JSON.parse(f.avisos_json || '[]'); v = JSON.parse(f.viaje_json || '{}'); } catch {}
  return new Response(pagina({ f, dias, avisos, v, slug }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'referrer-policy': 'no-referrer',
      'cache-control': 'private, max-age=60',
    },
  });
}

function fechaDe(v) {
  if (v.fecha_tipo === 'exacta' && v.fecha) { const [a, m, d] = v.fecha.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; }
  if (v.fecha_tipo === 'mes' && v.fecha) { const [a, m] = v.fecha.split('-').map(Number); return `${MESES[m - 1]} de ${a}`; }
  return null;
}

export function mensajeWhatsapp({ dias, v, slug }) {
  const ciudades = [...new Set(dias.map((x) => x.ciudad))];
  const pax = (Number(v.adultos) || 1) + (Number(v.ninos) || 0);
  const partes = [`${dias.length} días ${ciudades.join('-')}`, `${pax} ${pax === 1 ? 'persona' : 'personas'}`, fechaDe(v)].filter(Boolean);
  return `Hola, armé mi viaje: ${partes.join(', ')}. Mi itinerario: ${WEB}/i/${slug}/`;
}

function pagina({ f, dias, avisos, v, slug }) {
  const ciudades = [...new Set(dias.map((x) => x.ciudad))];
  const conWa = f.tier === 'caliente' || f.tier === 'tibio';
  const wa = `https://wa.me/${WA}?text=${encodeURIComponent(mensajeWhatsapp({ dias, v, slug }))}`;
  const pax = (Number(v.adultos) || 1) + (Number(v.ninos) || 0);
  const datos = [
    ['Duración', `${dias.length} días`],
    ['Recorrido', ciudades.join(' · ')],
    ['Viajan', `${pax} ${pax === 1 ? 'persona' : 'personas'}`],
    fechaDe(v) ? ['Fecha', fechaDe(v)] : null,
    v.ritmo ? ['Ritmo', RITMO[v.ritmo] || v.ritmo] : null,
    v.categoria_hotel ? ['Hotel', HOTEL[v.categoria_hotel] || v.categoria_hotel] : null,
  ].filter(Boolean);
  const avisoDe = (d) => avisos.filter((a) => a.dia === d.dia);
  const diasHtml = dias.map((d) => `
    <article class="it-dia it-${esc(d.tipo)}">
      ${d.foto ? `<div class="it-foto" style="background-image:url('${esc(d.foto.startsWith('http') ? d.foto : WEB + d.foto)}')"></div>` : ''}
      <div class="it-txt">
        <span class="it-n">Día ${d.dia} · ${esc(d.ciudad)}</span>
        <h3>${esc(d.titulo)}</h3>
        ${d.texto ? `<p>${esc(d.texto)}</p>` : ''}
        ${avisoDe(d).map((a) => `<p class="it-aviso">${esc(a.texto)}</p>`).join('')}
      </div>
    </article>`).join('');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>${esc(f.titulo || 'Tu itinerario')} · Luna Llena Travel</title>
<link rel="icon" href="${WEB}/assets/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--orange:#FF7A00;--orange-ink:#A34A00;--orange-soft:#F3E4D3;--bg:#F6F1EA;--paper:#FBF8F3;--ink:#1E1B18;--ink-2:#4A443E;--muted:#857B70;--line:#E2D9CE;--wa:#1FA855}
*{box-sizing:border-box;margin:0}body{font:400 16px/1.55 Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.top a{font:600 .7rem/1 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-2);text-decoration:none}
.kicker{margin-top:28px;font:500 .7rem/1.3 Manrope,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:var(--orange-ink)}
h1{margin-top:8px;font:300 clamp(1.8rem,6vw,2.6rem)/1.12 Manrope,sans-serif;letter-spacing:-.03em}
.datos{list-style:none;padding:0;margin:20px 0 0;border-top:1px solid var(--line)}
.datos li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--line);font:500 .95rem/1.4 Manrope,sans-serif}
.datos span{flex:none;width:90px;padding-top:3px;font:500 .62rem/1.3 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.dias{display:grid;gap:12px;margin-top:28px}
.it-dia{display:grid;grid-template-columns:120px 1fr;background:#fff;border:1px solid var(--line);border-radius:2px;overflow:hidden}
.it-dia:not(:has(.it-foto)){grid-template-columns:1fr}
.it-foto{background:var(--line) center/cover no-repeat;min-height:120px}
.it-txt{padding:14px 16px}
.it-n{display:block;font:500 .62rem/1.3 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--orange-ink)}
.it-txt h3{margin-top:4px;font:500 1.05rem/1.3 Manrope,sans-serif}
.it-txt p{margin-top:6px;font-size:.88rem;color:var(--ink-2)}
.it-libre,.it-llegada,.it-traslado,.it-salida{background:var(--paper)}
.it-aviso{padding:8px 10px;background:var(--orange-soft);color:var(--ink)!important}
.cierre{margin-top:30px;padding:24px 20px;background:var(--ink);color:var(--bg);text-align:center}
.cierre h2{font:300 1.4rem/1.25 Manrope,sans-serif;letter-spacing:-.02em}
.cierre p{margin-top:8px;font-size:.92rem;color:rgba(246,241,234,.78)}
.cta-wa{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:18px;padding:18px 16px;border-radius:2px;background:var(--wa);color:#fff;text-decoration:none;font:600 .78rem/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase}
.cta-wa:hover{background:#17964A}
.nota{margin-top:18px;font-size:.8rem;color:var(--muted);text-align:center}
@media (max-width:520px){.it-dia{grid-template-columns:1fr}.it-foto{min-height:150px}}
</style></head><body><main class="wrap">
<div class="top"><a href="${WEB}/">Luna Llena Travel</a><a href="${WEB}/armar/">Armar otro viaje</a></div>
<p class="kicker">Tu itinerario</p>
<h1>${esc(f.titulo || 'Tu viaje a medida')}</h1>
<ul class="datos">${datos.map(([k, x]) => `<li><span>${esc(k)}</span>${esc(x)}</li>`).join('')}</ul>
<section class="dias">${diasHtml}</section>
${conWa ? `<div class="cierre"><h2>¿Lo cotizamos?</h2><p>Un asesor revisa tu itinerario, lo ajusta contigo y te pasa el precio final.</p>
<a class="cta-wa" href="${esc(wa)}" target="_blank" rel="noopener">Enviar por WhatsApp</a></div>`
    : `<div class="cierre"><h2>Tu itinerario quedó guardado</h2><p>Guarda este enlace para volver a verlo. Cuando tengas más definida la fecha, armamos la cotización.</p></div>`}
<p class="nota">Itinerario de referencia, sin precios. Horarios, hoteles y disponibilidad se confirman con tu asesor.</p>
</main></body></html>`;
}

function noEncontrado() {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Itinerario no encontrado · Luna Llena Travel</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#1E1B18;line-height:1.5">
<h1 style="font-size:22px">No encontramos este itinerario</h1>
<p><a href="${WEB}/armar/" style="color:#A34A00;font-weight:600">Arma tu viaje de nuevo</a></p></body></html>`, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
  });
}

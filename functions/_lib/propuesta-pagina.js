// Plantilla de propuesta: UN renderizador datos_json -> HTML.
//
// Une lo que antes eran tres piezas: el render del armador (luna-llena-armador/functions/_lib/propuesta-render.js),
// su estilo y motor (ll.css / ll.js, ahora en /p-assets/) y las inyecciones de venta de luna-llena-propuestas
// (scripts/build.mjs + _venta/: vencimiento, cómo reservar, medios de pago, cancelación, FAQ, testimonios por tag,
// barra inferior). Acá salen directo, sin regex sobre un HTML ya armado.
//
// Fijo de la plantilla (CONFIG_PROPUESTA): estructura, quiénes somos, cómo reservar, medios de pago, cancelación,
// FAQ, testimonios, términos. Cambia por cliente (datos_json): portada, recorrido, días, fotos, incluye, precio,
// vencimiento, versión.
//
// REGLA: acá solo hay precios de venta. Nada de netos, márgenes, proveedores ni notas internas.

import { CONFIG_PROPUESTA } from './propuesta-config.js';
import { EQUIPO, WEB, URL_TRIPADVISOR } from './propuesta-confianza.js';

export const ASSETS_VENTA = 'https://luna-llena-propuestas.vercel.app';
export const CRM_PUBLICO = 'https://crm-plantilla.pages.dev';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escBr = (s) => esc(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
const SEPARADORES = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const jsonEnScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(SEPARADORES, (c) => '\\u' + c.charCodeAt(0).toString(16));
const pad2 = (n) => String(n).padStart(2, '0');
const txt = (v, max = 700) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v, max = 8, len = 80) => (Array.isArray(v) ? v.map((x) => txt(x, len)).filter(Boolean).slice(0, max) : []);
const usdR = (n) => `USD ${new Intl.NumberFormat('en-US').format(Math.round(n))}`;
const usdD = (n) => 'USD ' + new Intl.NumberFormat('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const ddmmaaaa = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const hoyLima = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
export const SLUG_OK = /^[a-z0-9][a-z0-9-]{2,60}$/;

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l4.2 4L19 6.8"/></svg>';
const AVION = '<svg viewBox="0 0 24 24"><path d="M3 13l18-5-7 7-5 1-2 4-2-1 1-4-3-2Z"/></svg>';
const ICONOS = {
  persona: '<svg viewBox="0 0 16 20" width="13" height="16" fill="currentColor"><circle cx="8" cy="5" r="4"/><path d="M0 20c0-5 3.6-8.5 8-8.5s8 3.5 8 8.5z"/></svg>',
  compartir: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  escudo: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  tarjeta: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 10h18M7 15h4"/></svg>',
  banco: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
  efectivo: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="1"/><circle cx="12" cy="12" r="2.5"/></svg>',
  billetera: '<svg viewBox="0 0 24 24"><path d="M4 7h14a2 2 0 012 2v8a2 2 0 01-2 2H4z"/><path d="M4 7l11-3v3M16 13h2"/></svg>',
};

// Bandera (emoji) del país de origen; si no está en la lista, no se pone nada.
const ISO = { mexico: 'MX', argentina: 'AR', chile: 'CL', colombia: 'CO', peru: 'PE', uruguay: 'UY', paraguay: 'PY', bolivia: 'BO', ecuador: 'EC', venezuela: 'VE', brasil: 'BR', espana: 'ES', 'estados unidos': 'US', canada: 'CA', 'costa rica': 'CR', panama: 'PA', guatemala: 'GT', 'republica dominicana': 'DO', 'puerto rico': 'PR', francia: 'FR', alemania: 'DE', italia: 'IT', 'reino unido': 'GB', portugal: 'PT' };
export function bandera(pais) {
  const iso = ISO[String(pais || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()];
  return iso ? String.fromCodePoint(...[...iso].map((l) => 0x1F1E6 + l.charCodeAt(0) - 65)) : '';
}

// Config efectivo: el de la plantilla + lo que el CRM pise (propuestas_config › 'plantilla', JSON parcial).
export function configEfectivo(pisado) {
  const base = JSON.parse(JSON.stringify(CONFIG_PROPUESTA));
  if (!pisado || typeof pisado !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (pisado[k] === undefined) continue;
    base[k] = Array.isArray(base[k]) || typeof base[k] !== 'object' || base[k] === null ? pisado[k] : { ...base[k], ...pisado[k] };
  }
  return base;
}

// Quiénes somos (autoridad): pared de fotos de viajeros de la web.
export function bandaAutoridad() {
  const figs = [];
  for (let k = 0; k < 32; k++) {
    const idx = (k * 29) % 64;
    const fila = (idx >> 3) + 1, pos = idx & 7;
    const r = ((((k * 37) % 19) - 9) / 2).toFixed(1);
    figs.push(`<figure style="--r:${r}deg"><span style="background-image:url(${WEB}/assets/viajeros/fila-${fila}.webp);background-position:${(pos * 100 / 7).toFixed(2)}% 0"></span></figure>`);
  }
  return `<section class="vjb" id="autoridad"><div class="shell">
      <div class="vjb__head"><p class="eyebrow rv">Quiénes somos</p><h2 class="h2 rv"><b>+1000</b> viajeros ya recorrieron Perú con nosotros</h2>
        <p class="vjb__lead rv">Somos una agencia de Cusco, operamos nuestros propios tours y te acompañamos desde el primer mensaje hasta el último día del viaje.</p></div>
      <div class="vjb__cifras rv"><div><b>+8</b><span>años armando viajes por Perú</span></div><div>${ICONOS.escudo}<span>Agencia registrada en Perú</span></div><a href="${esc(URL_TRIPADVISOR)}" target="_blank" rel="noopener"><b>4,9<small>★</small></b><span>en TripAdvisor</span></a></div>
      <div class="vjb__wall rv" role="img" aria-label="Fotos de grupos que viajaron con Luna Llena">${figs.join('')}</div>
      <p class="vjb__pie rv">Fotos reales de quienes viajaron con nosotros.</p>
      <div class="vjb__sellos rv" aria-label="Reconocimientos"><img src="${WEB}/assets/logos/mincetur.webp" alt="MINCETUR" loading="lazy"><img src="${WEB}/assets/logos/travelers-choice.webp" alt="Tripadvisor Travelers’ Choice" loading="lazy"><img src="${WEB}/assets/logos/safe-travels.webp" alt="Safe Travels, WTTC" loading="lazy"><img src="${WEB}/assets/logos/promperu.webp" alt="PromPerú" loading="lazy"></div>
    </div></section>`;
}

// "Puedes cancelar hasta el DD/MM/AAAA": los términos admiten cancelar hasta 20 días antes del viaje (30 con trekking).
export function fechaCancelacion(d) {
  if (d.cancelacionHasta) return d.cancelacionHasta;
  if (!d.viaje || !d.viaje.inicio) return null;
  const dias = (d.tags || []).includes('trekking') ? 30 : 20;
  const f = new Date(d.viaje.inicio + 'T12:00:00Z');
  f.setUTCDate(f.getUTCDate() - dias);
  return { fecha: f.toISOString().slice(0, 10), dias };
}

function rellenar(texto, pago) {
  const v = { seña: pago['señaPorcentaje'], saldoCuando: pago.saldoCuando, recargoTarjeta: pago.recargoTarjeta, igvFactura: pago.igvFactura };
  return texto.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
}

// opciones: { slug, cfg, hoy, vista: bool (vista previa interna), banda: texto de la banda roja, assets }
//   vista previa = sin el script de seguimiento, con los placeholders visibles y sin canonical público.
export function renderPagina(d, opciones = {}) {
  const cfg = opciones.cfg || configEfectivo();
  const slug = opciones.slug || d.slug || '';
  const hoy = opciones.hoy || hoyLima();
  const vista = Boolean(opciones.vista);
  const crm = opciones.crm || CRM_PUBLICO;
  const assets = opciones.assets || ASSETS_VENTA;
  const sitio = (cfg.sitio || ASSETS_VENTA).replace(/\/$/, '');
  const pago = { ...cfg.pago, ...(d.pago || {}) };
  const viaje = d.viaje || {};
  const personas = Number(viaje.pasajeros) || 2;
  const total = Number(d.precio && d.precio.totalPP) || 0;
  const vencida = Boolean(d.validUntil && hoy > d.validUntil) && !vista;
  const tags = new Set(d.tags || []);
  const terminos = cfg.terminos.url;
  const ph = (t) => `<span class="venta-ph">Falta: ${esc(t)}</span>`;

  const wa = (t) => `https://wa.me/${cfg.agencia.whatsapp}?text=${encodeURIComponent(t)}`;
  const ref = `la propuesta N° ${d.numero} (${d.cliente})`;
  const waDuda = wa(`Hola Luna Llena Travel, tengo una duda sobre ${ref}.`);
  const waReservar = wa(`Hola Luna Llena Travel, quiero reservar ${ref}.`);
  const waVencida = wa(`Hola Luna Llena Travel, ${ref} venció y quiero actualizarla.`);
  const online = pago.reservaOnline === true;   // apagada por defecto: "Quiero reservar" abre WhatsApp
  const hrefReservar = vencida ? waVencida : online ? `/${slug}/reservar/` : waReservar;
  const destinoReservar = online && !vencida ? '' : ' target="_blank" rel="noreferrer"';

  const vence = (clase) => d.validUntil
    ? `<p class="${clase}"><span class="venta-vigente">Propuesta válida hasta el <b>${ddmm(d.validUntil)}</b></span><span class="venta-vencio">Esta propuesta venció el <b>${ddmm(d.validUntil)}</b></span></p>`
    : `<p class="${clase} venta-solo-preview">${ph('fecha de vencimiento (validUntil)')}</p>`;

  const logosPago = (medios) => (medios.length
    ? `<ul class="venta-logos">${medios.map((m) => `<li>${m.logo ? `<img src="${esc(m.logo.startsWith('/') ? assets + m.logo : m.logo)}" alt="${esc(m.nombre)}" loading="lazy">` : `<span>${esc(m.nombre)}</span>`}</li>`).join('')}</ul>`
    : ph('medios de pago (config › pago.mediosDePago)'));

  const canc = fechaCancelacion(d);
  const cancelaBreve = !canc
    ? 'Puedes cancelar hasta 20 días antes del viaje (30 días en programas de trekking).'
    : `Puedes cancelar hasta el <b class="venta-riesgo__fecha">${ddmmaaaa(typeof canc === 'string' ? canc : canc.fecha)}</b>${typeof canc === 'string' ? '' : `, ${canc.dias} días antes del viaje`}.`;
  const cancelaHtml = !canc ? '' : `<p class="venta-cancela rv"><b>Puedes cancelar cuando quieras hasta el ${ddmmaaaa(typeof canc === 'string' ? canc : canc.fecha)}</b>${typeof canc === 'string' ? '' : ` (${canc.dias} días antes del viaje)`}, según nuestros <a href="${esc(terminos)}">términos y condiciones</a>.</p>`;

  // ----- portada -----
  const paisOrigen = esc(viaje.paisOrigen || '');
  const flag = bandera(viaje.paisOrigen);
  const titulo = viaje.pais ? `${esc(d.cliente)}, ${esc(viaje.pais)} te está esperando.` : `${esc(d.cliente)}, ${escBr(txt(d.portada && d.portada.lugar, 80))} te está esperando.`;
  const portada = `<header class="cover" id="inicio" style="--cover-image:url('${esc(d.portada && d.portada.foto)}')">
    <div class="cover__top"><div class="shell"><div class="cover__logo"><img src="${WEB}/assets/logo.svg" alt=""><span>Luna Llena Travel</span></div></div></div>
    <div class="shell cover__body">
      <h1>${titulo}</h1>
      <div class="cover__meta">${paisOrigen ? `<div><b>Desde</b>${flag ? `<span class="venta-bandera" aria-hidden="true">${flag}</span>` : ''}${paisOrigen}</div>` : ''}<div><b>Fechas</b><span class="venta-fechas" aria-hidden="true"><i></i><i></i><i></i></span>${esc(viaje.fechas || 'Fechas a confirmar')}</div><div><b>Viajeros</b><span class="venta-viajeros" aria-hidden="true">${ICONOS.persona.repeat(Math.min(personas, 6))}</span>${personas} ${personas === 1 ? 'viajero' : 'viajeros'}</div></div>
      ${vence('venta-vence venta-vence--hero')}
      <a class="btn" href="#recorrido">Ver el recorrido ↓</a>
    </div>
  </header>`;

  // ----- video de bienvenida (opcional) -----
  let video = '';
  if (d.videoUrl) {
    const yt = d.videoUrl.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/);
    const vm = d.videoUrl.match(/vimeo\.com\/(\d+)/);
    const embed = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0` : vm ? `https://player.vimeo.com/video/${vm[1]}?autoplay=1` : '';
    const player = embed
      ? `<button type="button" class="venta-video__play" data-embed="${esc(embed)}"${yt ? ` style="--poster:url('https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg')"` : ''} aria-label="Reproducir video de bienvenida"><span></span></button>`
      : `<video src="${esc(d.videoUrl)}" controls preload="metadata" playsinline></video>`;
    video = `
  <section class="venta-video" id="bienvenida"><div class="narrow"><span class="eyebrow">Un saludo antes de empezar</span><div class="venta-video__marco">${player}</div></div></section>`;
  }

  // ----- recorrido: ciudades -----
  const ciudades = Array.isArray(d.ciudades) ? d.ciudades : [];
  const ciudadesHtml = ciudades.map((c, i) => {
    const t = lista(c.tags, 4);
    return `<article class="city rv" style="--photo:url('${esc(c.foto)}')"><span class="city__n">${pad2(i + 1)}</span><div class="city__in"><p class="city__date">${esc([c.rango, c.nombre].filter(Boolean).join(' · '))}</p><h3>${escBr(txt(c.titulo, 80) || c.nombre)}</h3><p class="city__hotel">${c.noches} ${c.noches === 1 ? 'noche' : 'noches'} en <b>${esc(c.hotel)}</b></p>${txt(c.linea, 200) ? `<p class="city__line">${esc(txt(c.linea, 200))}</p>` : ''}${t.length ? `<div class="tags">${t.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div></article>`;
  }).join('\n');

  // ----- día por día -----
  const flujo = (Array.isArray(d.flujo) ? d.flujo : []).map((it) => {
    if (it.t === 'cap') {
      const pills = [`${it.noches} ${it.noches === 1 ? 'noche' : 'noches'}`, ...lista(it.pills, 3).filter((x) => !/^\d+ noches?$/.test(x))].slice(0, 4);
      return `<section class="chapter" data-city-start="${esc(it.ciudad)}" style="--chapter-image:url('${esc(it.foto)}')"><div class="chapter__in rv"><span class="chapter__step">${esc(`Capítulo ${pad2(it.n)}${it.fecha ? ' · ' + it.fecha : ''}`)}</span><h3>${escBr(txt(it.titulo, 80) || it.ciudad)}</h3>${txt(it.copy, 300) ? `<p>${esc(txt(it.copy, 300))}</p>` : ''}<div class="pills">${pills.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div></section>`;
    }
    if (it.t === 'dia') {
      const momentos = Array.isArray(it.momentos) ? it.momentos : [];
      const crono = momentos.length ? `<div class="tl"><p class="tl__t">Cronograma del día</p><ol>${momentos.map((m) => `<li class="tl__i"><time>${esc(m.time)}</time><div class="tl__c">${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.title)}" loading="lazy">` : ''}<h5>${esc(m.title)}</h5><p>${esc(m.text)}</p></div></li>`).join('')}</ol></div>` : '';
      const chips = lista(it.chips, 5);
      const relato = it.sinRelato ? '' : txt(it.relato, 700);
      return `<article class="day day--${esc(it.kind)} rv" data-day="${pad2(it.dia)}" data-place="${esc(it.lugar || it.ciudad)}"><div class="day__photo"><img src="${esc(it.foto)}" alt="${esc(it.titulo)}" loading="lazy"><span class="day__no">${esc(it.label)}</span></div><div class="day__body"><p class="day__kicker">${esc(it.kicker || it.ciudad)}</p><h4>${esc(it.titulo)}</h4>${relato ? `<p>${esc(relato)}</p>` : ''}${chips.length ? `<div class="chips">${chips.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}${crono}</div></article>`;
    }
    if (it.t === 'hotel') {
      const filas = (it.filas || []).filter((f) => f && f[1]);
      return `<article class="hotel rv"><div class="hotel__img" style="--photo:url('${esc(it.foto)}')"><span class="hotel__nights">${it.noches} ${it.noches === 1 ? 'noche' : 'noches'}</span></div><div class="hotel__body"><p class="hotel__city">Check-in · día ${pad2(it.dia)} · ${esc(it.ciudad)}</p><h3>${esc(it.nombre)}</h3><dl>${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div></article>`;
    }
    if (it.t === 'vuelo') {
      return `<div class="flight rv">${AVION}<p>${esc(it.texto)}${it.detalle ? `<small>${esc(it.detalle)}</small>` : ''}</p>${it.precio ? `<div class="px">${esc(it.precio)}<small>Tarifa referencial</small></div>` : ''}</div>`;
    }
    return '';
  }).filter(Boolean);
  const fin = d.final || {};
  const nDias = Number(viaje.dias) || 0, nDest = Number(viaje.destinos) || ciudades.length;

  // ----- incluye -----
  const inc = d.incluye || {};
  const items = (Array.isArray(inc.items) ? inc.items : []).map((it) => ({ title: txt(it && it.title, 90), detail: txt(it && it.detail, 160) })).filter((it) => it.title).slice(0, 8);
  const noIncluye = txt(inc.no_incluye, 300) || 'Vuelos internacionales, propinas y gastos personales.';

  // ----- inversión -----
  const filasPrecio = (Array.isArray(d.precio && d.precio.filas) ? d.precio.filas : []).map((f) => `<div class="row rv"><div><h4>${esc(f.titulo)}</h4><small>${esc(f.detalle || '')}</small></div><div class="amt">${esc(usdR(f.montoPP))} <small>p/p</small></div>${(f.items || []).length ? `<ul>${f.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`).join('\n');
  const notaExtra = txt(d.precio && d.precio.nota, 400);
  const notaInv = `Valor referencial por persona. No incluye vuelo internacional. Sujeto a disponibilidad al momento de reservar.${notaExtra ? ' ' + esc(notaExtra) : ''}`;
  const conf = cfg.agencia.confianza || [];
  const confianzaInv = conf.length
    ? `\n      <ul class="venta-confianza rv">${conf.map((c) => `<li>${c.icono && ICONOS[c.icono] ? ICONOS[c.icono] : `<b>${esc(c.cifra)}</b>`}<span>${esc(c.texto.replace(/\{(\w+)\}/g, (m, k) => cfg.agencia[k] ?? m))}</span></li>`).join('')}</ul>`
    : '';
  const riesgo = `<div class="venta-riesgo rv">
        <div class="venta-riesgo__item">${ICONOS.escudo}<div><b>Cancelación</b><p>${cancelaBreve}</p><a href="${esc(terminos)}">Ver términos y condiciones</a></div></div>
        <div class="venta-riesgo__item venta-riesgo__item--medios"><div><b>Medios de pago</b>${logosPago(pago.mediosDePago || [])}${pago.recargoTarjeta ? `<p class="venta-nota">Con tarjeta se suma un ${pago.recargoTarjeta}%.</p>` : ''}</div></div>
      </div>`;

  // ----- cómo reservar -----
  const seña = Math.round(total * personas * pago['señaPorcentaje']) / 100;
  const tieneMP = tags.has('machu-picchu');
  const cal = cfg.calcomUrl
    ? `<a class="btn btn--lg venta-btn--linea" href="${esc(cfg.calcomUrl)}" target="_blank" rel="noopener" data-cta="llamada">Agendar llamada de 10 min</a>`
    : `<span class="venta-ph venta-ph--btn">Falta: link de Cal.com (config › calcomUrl)</span>`;
  const reserva = `
    <section class="sec" id="reserva"><div class="shell venta-reserva">
      <div class="head"><span class="eyebrow rv">Cómo reservar</span><h2 class="h2 rv">Así reservas<br>tu viaje.</h2></div>
      <ol class="venta-pasos rv">
        <li><span class="venta-pasos__n">01</span><div><h3>Validamos el itinerario y la disponibilidad</h3><p>Revisamos contigo fechas, servicios y horarios, y ajustamos lo que haga falta antes de reservar.</p></div></li>
        <li><span class="venta-pasos__n">02</span><div><h3>Coordinamos el medio de pago</h3><p>Elegimos juntos la forma más cómoda de pagar desde tu país. Aceptamos:</p>${logosPago(pago.mediosDePago || [])}</div></li>
        <li><span class="venta-pasos__n">03</span><div><h3>Aceptas los términos y condiciones</h3><p>Están completos en <a href="${esc(terminos)}">nuestros términos</a>.</p></div></li>
        <li><span class="venta-pasos__n">04</span><div><h3>Abonas la seña del ${pago['señaPorcentaje']}%</h3><p>${esc(usdD(seña))} en total para ${personas} ${personas === 1 ? 'viajero' : 'viajeros'}. El saldo se paga ${esc(pago.saldoCuando)}.</p></div></li>
        <li><span class="venta-pasos__n">05</span><div><h3>Nos envías los datos de cada pasajero</h3><p>Nombre completo como figura en el pasaporte, número de pasaporte, nacionalidad y fecha de nacimiento. ${tieneMP ? 'Con esos datos emitimos las entradas a Machu Picchu y los boletos de tren.' : 'Con esos datos emitimos las entradas y reservamos los servicios.'}</p></div></li>
        <li><span class="venta-pasos__n">06</span><div><h3>Confirmamos tu reserva en menos de 24 h</h3><p>${tieneMP ? 'Emitimos las entradas y el tren, y te enviamos la confirmación del viaje.' : 'Reservamos todos los servicios y te enviamos la confirmación del viaje.'}</p></div></li>
      </ol>
      ${cancelaHtml}
      ${vence('venta-vence venta-vence--reserva rv')}
      <div class="venta-botones rv">
        <a class="btn btn--wa btn--lg" href="${esc(waDuda)}" target="_blank" rel="noreferrer" data-cta="duda">Tengo una duda</a>
        ${cal}
        <a class="btn btn--lg venta-btn--linea" href="${esc(hrefReservar)}"${destinoReservar} data-vencida-href="${esc(waVencida)}" data-cta="reservar">Quiero reservar</a>
      </div>
    </div></section>`;

  // ----- testimonios por tag + equipo -----
  const tests = cfg.testimonios.filter((t) => t.tags.some((x) => tags.has(x)));
  const resenaHtml = (r) => `<blockquote class="venta-resena"><div class="resena__s" aria-label="5 de 5 estrellas">★★★★★</div><h4>${esc(r.t)}</h4><p>“${esc(r.p)}”</p><small>${esc(r.n)} · ${esc(r.f)} · ${esc(r.src)}</small></blockquote>`;
  const resenas = tests.length
    ? `<div class="venta-resenas rv" data-venta-carrusel><div class="venta-resenas__pista">${tests.map(resenaHtml).join('')}</div>${tests.length > 1 ? `<div class="venta-dots">${tests.map((r, i) => `<button type="button" aria-label="Reseña ${i + 1}"${i === 0 ? ' class="on"' : ''}></button>`).join('')}</div>` : ''}</div>\n      `
    : '';
  const guias = EQUIPO.map((g) => `<li><img src="${WEB}/cotizar/equipo/${g.foto}.webp" alt="${esc(g.nombre)}" loading="lazy"><b>${esc(g.nombre)}</b><span>Guía oficial</span></li>`).join('');
  const confianza = `<section class="sec" id="confianza"><div class="shell aut">
      <p class="eyebrow rv">Lo que dicen</p>
      ${resenas}<div class="equipo rv"><h3>Quiénes te van a atender</h3><p class="equipo__sub">Nuestros guías oficiales de turismo también responden tu WhatsApp: sabes con quién hablas desde el primer mensaje.</p>
        <div class="lider"><img src="${WEB}/cotizar/equipo/1.webp" alt="Álvaro Oblitas Mora" loading="lazy"><div><b>Álvaro Oblitas Mora</b><span>Dueño y guía principal</span></div></div>
        <ul class="guias">${guias}</ul></div>
    </div></section>`;

  // ----- preguntas frecuentes -----
  const faq = cfg.faq.map((f) => {
    const r = f.respuesta ? `<p>${esc(rellenar(f.respuesta, pago))}</p>` : '';
    const todo = f.todo ? `<p>${ph(f.todo)}</p>` : '';
    return `<details class="${f.respuesta ? '' : 'venta-solo-preview'}"><summary>${esc(f.pregunta)}</summary><div>${r}${todo}</div></details>`;
  }).join('');
  const faqHtml = `
    <section class="sec sec--paper" id="preguntas"><div class="shell venta-faq">
      <div class="head"><span class="eyebrow rv">Preguntas frecuentes</span><h2 class="h2 rv">Lo que suelen<br>preguntarnos.</h2></div>
      <div class="venta-faq__lista rv">${faq}</div>
    </div></section>`;

  // ----- compartir -----
  const textoCompartir = `Mira nuestro viaje${viaje.pais ? ` a ${viaje.pais}` : ''} con ${cfg.agencia.nombre}: ${sitio}/${slug}/`;

  // ----- datos que la página declara (el CRM los lee para validar la reserva) -----
  const datosVenta = {
    slug, numero: d.numero, cliente: d.cliente, validUntil: d.validUntil, version: d.version, status: d.status || 'enviada',
    viaje: { nombre: viaje.nombre, inicio: viaje.inicio, fin: viaje.fin },
    pasajeros: personas,
    precio: { totalPP: total },
    pago: { 'señaPorcentaje': pago['señaPorcentaje'], recargoTarjeta: pago.recargoTarjeta, saldoCuando: pago.saldoCuando },
    terminosVersion: cfg.terminos.version,
  };
  const clases = [vencida && 'venta-vencida', vista && 'venta-preview'].filter(Boolean).join(' ');
  const lugares = [...new Set(ciudades.map((c) => c.nombre))];
  const tituloPagina = `Propuesta para ${d.cliente} — ${lugares.join(', ')} · Luna Llena Travel`;
  const banda = opciones.banda
    ? `<div role="status" style="position:sticky;top:0;z-index:9999;background:#B3261E;color:#fff;font:700 14px/1.3 system-ui,sans-serif;text-align:center;padding:10px 14px;letter-spacing:.02em">${esc(opciones.banda)}</div>`
    : '';
  const banderaUsada = flag ? `\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&text=${encodeURIComponent(flag)}&display=swap">` : '';

  return `<!DOCTYPE html>
<html lang="es"${clases ? ` class="${clases}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#1E1B18">
  <title>${esc(tituloPagina)}</title>
  <link rel="icon" href="${WEB}/assets/logo.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${crm}/p-assets/ll.css">
<style>
@media print{ .pbar,.bottom,.btn--pdf,.btn--wa{display:none!important} .rv{opacity:1!important;transform:none!important} }
</style>
  <link rel="stylesheet" href="${assets}/_venta/venta.css">${banderaUsada}
</head>
<body>
  ${banda}
  <script id="venta-datos" type="application/json">${JSON.stringify(datosVenta).replace(/</g, '\\u003c')}</script>
  <div class="venta-aviso-vencida" role="status">Esta propuesta venció. <a href="${esc(waVencida)}" target="_blank" rel="noreferrer" data-cta="vencida">Escríbenos para actualizarla</a></div>
  <script>const quote = ${jsonEnScript({ traveler: d.cliente, total, personas })};</script>

  <div class="pbar" id="pbar" aria-label="Progreso del viaje">
    <div class="pbar__row"><a class="pbar__logo" href="#inicio"><img src="${WEB}/assets/logo.svg" alt=""><span>Luna Llena Travel</span></a><div class="pbar__where" id="pbar-where">Tu viaje</div><a class="pbar__cta" href="#inversion">Ver tarifa</a></div>
    <div class="pbar__track" id="pbar-track"><div class="pbar__fill" id="pbar-fill"></div></div>
  </div>

  ${portada}${video}

  <main>
    <section class="sec" id="recorrido"><div class="shell">
      <div class="head"><span class="eyebrow rv">El recorrido</span><h2 class="h2 rv">${nDest} ${nDest === 1 ? 'destino' : 'destinos'}.<br>Una sola historia.</h2>${txt(d.recorrido && d.recorrido.copy, 300) ? `<p class="lead rv">${esc(txt(d.recorrido.copy, 300))}</p>` : ''}</div>
      <div class="stats rv"><div><b>${nDias}</b><span>días</span></div><div><b>${Math.max(0, nDias - 1)}</b><span>noches</span></div><div><b>${nDest}</b><span>${nDest === 1 ? 'destino' : 'destinos'}</span></div><div><b>${personas}</b><span>${personas === 1 ? 'viajero' : 'viajeros'}</span></div></div>
      <div class="cities">${ciudadesHtml}</div>
    </div></section>

    <section class="sec sec--paper" id="itinerario"><div class="shell">
      <div class="head"><span class="eyebrow rv">Día por día</span><h2 class="h2 rv">Un viaje que se<br>va revelando.</h2><p class="lead rv">Cada día, uno debajo del otro, tal como lo vas a vivir. A medida que avanzas, la barra de arriba marca en qué parte del viaje estás.</p></div>
    </div>
    <div class="narrow flow">
      ${flujo.join('\n      ')}
      <div class="finish rv"><p>${esc(fin.stats || '')}</p><h3>${esc(txt(fin.titulo, 90) || 'Una historia completa, sin correrla.')}</h3><span>${esc(txt(fin.nota, 240) || 'Vuelos internacionales no incluidos. La propuesta se adapta al horario de llegada y salida del pasajero.')}</span></div>
    </div></section>

    <section class="sec sec--paper" id="incluye"><div class="shell inc">
      <div><span class="eyebrow rv">Lo importante ya está resuelto</span><h2 class="h2 rv">Viajar sin<br>hacer planillas.</h2>${txt(inc.copy, 300) ? `<p class="lead rv">${esc(txt(inc.copy, 300))}</p>` : ''}</div>
      <div class="rv"><ul class="checks">${items.map((it) => `<li>${CHECK}<span>${esc(it.title)}${it.detail ? `<small>${esc(it.detail)}</small>` : ''}</span></li>`).join('')}</ul><div class="no"><b>No incluye</b>${esc(noIncluye)}</div></div>
    </div></section>

    ${bandaAutoridad()}

    <section class="sec sec--paper" id="inversion"><div class="shell invest">
      <div class="head"><span class="eyebrow rv">La inversión del viaje</span><h2 class="h2 rv">Lo que incluye<br>cada parte.</h2><p class="lead rv">${esc(txt(d.precio && d.precio.copy, 240) || 'El detalle de cada parte del viaje, y abajo el total por persona.')}</p></div>
      <div class="rows">${filasPrecio}
</div>
      <div class="total rv"><div><span>Inversión total por pasajero</span><small>En habitación doble · ${personas} ${personas === 1 ? 'pasajero' : 'pasajeros'}: ${esc(usdR(total * personas))}</small></div><b>${esc(usdD(total))}</b></div>${confianzaInv}
      ${vence('venta-vence venta-vence--precio rv')}
      ${riesgo}
      <p class="invest__note">${notaInv}</p>
      <div class="cta rv"><p>¿${personas === 1 ? 'Te imaginas' : 'Se imaginan'} en este viaje? Podemos ajustar ritmo, tours y categoría de hotel hasta que sea exactamente el viaje que buscas.</p><a class="btn btn--lg" href="#reserva" data-cta="ver-reserva">Ver cómo reservar ↓</a></div>
    </div></section>
    ${reserva}

    ${confianza}
    ${faqHtml}
  </main>

  <footer class="foot"><div class="shell">Luna Llena Travel · Agencia de viajes en Perú · Respondemos en horario de Perú · Propuesta N° ${esc(d.numero)} · <a href="${esc(terminos)}">Términos y condiciones</a></div></footer>

  <aside class="bottom" id="bottom" aria-label="Resumen de la propuesta"><div class="shell"><div><b>${esc(usdD(total))} p/p</b></div><a class="btn venta-compartir" href="https://wa.me/?text=${esc(encodeURIComponent(textoCompartir))}" target="_blank" rel="noreferrer" data-cta="compartir" data-compartir="${esc(textoCompartir)}" aria-label="Compartir">${ICONOS.compartir}</a> <a class="btn" href="#reserva" data-cta="barra-reserva">Reservar</a></div></aside>
  <script src="${crm}/p-assets/ll.js"></script>
${vista ? '' : `  <script src="${assets}/_venta/venta.js" defer></script>\n`}</body>
</html>
`;
}

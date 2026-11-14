// Cotización -> datos_json de la propuesta (lo que dibuja propuesta-pagina.js). Funciones puras, salvo escribirTextos (IA).
//
// REGLA: solo precios de venta. Nada de netos, márgenes, proveedores ni notas internas: lo que se arma acá es lo que ve el
// cliente. Los textos los redacta la IA UNA vez a partir de la ficha publicada en la web (no inventa servicios, horarios ni
// precios; el código descarta lo que se pase) y quedan guardados y editables en la vista previa.

import { normalizar } from './tarifario.js';
import { sumarDias } from './cotizar.js';
import { claudeJson } from './claude.js';

export const DIAS_VALIDEZ = 15;
export const FOTO_RESPALDO = 'https://lunallenatravel.vercel.app/assets/wp/2023/11/puno1-1024x445.jpg';
const MODELO_TEXTOS = 'claude-sonnet-5-5';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const HAB = { SGL: 'simple', DBL: 'doble', TPL: 'triple' };
const pad2 = (n) => String(n).padStart(2, '0');
const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const fecha = (iso) => new Date(iso + 'T12:00:00Z');
const corta = (iso) => `${fecha(iso).getUTCDate()} ${MESES[fecha(iso).getUTCMonth()]}`;
const rango = (a, b) => (a === b ? corta(a) : `${corta(a)} — ${corta(b)}`);
const labelDia = (n, iso) => `DÍA ${pad2(n)}` + (iso ? ` · ${DIAS[fecha(iso).getUTCDay()].toUpperCase()} ${fecha(iso).getUTCDate()} ${MESES[fecha(iso).getUTCMonth()].toUpperCase()}` : '');
const recorta = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const listaY = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const aAzar = () => [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const slugDe = (nombre, azar = aAzar()) => `${normalizar(String(nombre || 'cliente').split(/\s+/)[0]).slice(0, 30).replace(/\s+/g, '') || 'cliente'}-${azar}`;

// Tags que usa la plantilla: testimonios por tag y cancelación de 30 días con "trekking".
const PALABRAS = [
  [/machu\s*picchu/i, 'machu-picchu'], [/valle\s*sagrado/i, 'valle-sagrado'], [/humantay/i, 'humantay'],
  [/monta[ñn]a.*colores|7\s*colores|vinicunca/i, 'montaña-colores'], [/cuatrimoto/i, 'cuatrimotos'],
  [/nazca/i, 'nazca'], [/huacachina|paracas|\bica\b/i, 'ica'], [/titicaca|uros|amantan[ií]|taquile/i, 'puno'],
  [/trek|camino inca|salkantay|huayhuash|choquequirao/i, 'trekking'],
];

// Por qué esta cotización NO se puede publicar (la vista previa interna sí se ve, con banda roja).
export function bloqueosDe(vista, { vigente = true } = {}) {
  const c = vista.cotizacion, p = vista.pendientes || {}, out = [];
  if (!vigente) out.push('Hay una versión más nueva de la cotización');
  if (c.estado !== 'aprobada') out.push('La cotización no está aprobada');
  if (c.usa_prueba) out.push('Usa PRECIOS DE PRUEBA');
  if (vista.totales.problemas) out.push('Hay líneas sin precio');
  if (p.ilustrativas) out.push(`Hay ${p.ilustrativas} línea(s) ilustrativa(s) sin precio real`);
  if (p.sin_confirmar) out.push(`Hay ${p.sin_confirmar} precio(s) de la web sin confirmar`);
  if (p.paquete_web) out.push('El precio del paquete no está confirmado');
  return out;
}

// Texto de la banda roja de la vista previa (null = no hace falta: se puede publicar).
export function bandaDe(bloqueos) {
  if (!bloqueos.length) return null;
  const prueba = bloqueos.some((b) => /PRUEBA/.test(b));
  return `${prueba ? 'PRECIOS DE PRUEBA' : 'BORRADOR'} · solo vista interna, no se puede enviar al cliente (${bloqueos.join('; ')})`;
}

// Días del viaje con la ciudad donde se duerme, el tipo de día y lo que se hace.
function diasDe(p, lineas) {
  const dest = p.destinos && p.destinos.length ? p.destinos : [{ ciudad: 'Perú', noches: Math.max(0, (p.dias || 1) - 1) }];
  const noches = dest.reduce((s, d) => s + d.noches, 0);
  const n = Math.max(1, noches + 1, Number(p.dias) || 0, ...lineas.map((l) => l.dia || 1));
  const acum = []; let t = 0;
  for (const d of dest) { t += d.noches; acum.push(t); }
  const ciudadIdx = (dia) => { const i = acum.findIndex((a) => a > dia - 1); return i < 0 ? dest.length - 1 : i; };
  return { dest, n, ciudadIdx };
}

// ficha = { id, nombre, fotos[], incluye[], dias_detalle[] } de la web, o null
const fichaDe = (web, id) => (id ? web.find((w) => w.id === id) || null : null);

export function armarDatos({ vista, catalogo = { hoteles: [], servicios: [] }, web = [], textos = {}, hoy, numero, previo = null }) {
  const { cotizacion: c, pedido: p, lineas, totales: t } = vista;
  const pax = Math.max(1, Number(p.pasajeros) || 1);
  const tentativa = Boolean(p.fecha_tentativa);   // fecha elegida al crear el pedido, sin pasajes todavía
  const inicio = p.fecha_inicio || null;
  const { dest, n: nDias, ciudadIdx } = diasDe(p, lineas);
  const fin = p.fecha_fin || (inicio ? sumarDias(inicio, nDias - 1) : null);
  const fechaDia = (d) => (inicio ? sumarDias(inicio, d - 1) : null);
  const servicioDe = (l) => catalogo.servicios.find((s) => s.id === l.servicio_id) || null;
  const hotelDe = (l) => catalogo.hoteles.find((h) => h.id === l.hotel_id) || null;

  // fotos: de la ficha del tour, si no de cualquier tour de esa ciudad, si no la de respaldo
  const fichaLinea = (l) => fichaDe(web, l.web_producto_id) || fichaDe(web, (servicioDe(l) || {}).web_id);
  const fotosFicha = (f) => (f ? parse(f.fotos, Array.isArray(f.fotos) ? f.fotos : []) : []).filter((u) => /^https:\/\//.test(u));
  const fotoCiudad = (ciudad, k = 0) => {
    const fs = web.filter((w) => w.tipo === 'tour' && normalizar(w.ciudad_base || '') === normalizar(ciudad)).flatMap(fotosFicha);
    if (fs.length) return fs[k % fs.length];
    const cualquiera = web.flatMap(fotosFicha);
    return cualquiera.length ? cualquiera[k % cualquiera.length] : FOTO_RESPALDO;
  };

  const hoteles = lineas.filter((l) => l.tipo === 'hotel');
  const resto = lineas.filter((l) => l.tipo !== 'hotel');
  const porDia = new Map();
  for (const l of resto) (porDia.get(l.dia || 1) || porDia.set(l.dia || 1, []).get(l.dia || 1)).push(l);

  // ----- ciudades (estadías) -----
  let desde = 1;
  const estadias = dest.map((d, i) => {
    const e = { i, ciudad: d.ciudad, noches: d.noches, primerDia: desde, ultimoDia: desde + d.noches };
    desde += d.noches;
    return e;
  });
  const hotelDeEstadia = (e) => hoteles.find((h) => h.dia === e.primerDia && normalizar(h.descripcion).includes(normalizar(e.ciudad)))
    || hoteles.find((h) => h.dia >= e.primerDia && h.dia <= e.ultimoDia) || null;
  const nombreHotel = (l) => (l ? String(l.descripcion).split(' · ')[0] : 'Hotel a confirmar');
  const ciudadesTxt = new Map((textos.ciudades || []).map((x) => [normalizar(x.nombre), x]));

  const ciudades = estadias.map((e) => {
    const h = hotelDeEstadia(e);
    const tx = ciudadesTxt.get(normalizar(e.ciudad)) || {};
    return {
      nombre: e.ciudad, rango: inicio ? rango(fechaDia(e.primerDia), fechaDia(Math.min(nDias, e.ultimoDia + 1))) : '',
      titulo: tx.titulo || e.ciudad, noches: e.noches, hotel: nombreHotel(h), linea: tx.linea || '', tags: lista4(tx.tags),
      foto: fotoCiudad(e.ciudad, 1),
    };
  });

  // ----- día por día -----
  const diasTx = new Map((textos.dias || []).map((x) => [Number(x.dia), x]));
  const flujo = [];
  let estadiaPrev = -1;
  for (let d = 1; d <= nDias; d++) {
    const e = estadias[ciudadIdx(d)];
    const items = porDia.get(d) || [];
    const kind = d === 1 ? 'llegada' : items.length ? 'principal' : d === nDias ? 'regreso' : 'libre';
    if (e.i !== estadiaPrev && kind !== 'regreso') {
      const tx = ciudadesTxt.get(normalizar(e.ciudad)) || {};
      flujo.push({ t: 'cap', n: e.i + 1, fecha: inicio ? rango(fechaDia(e.primerDia), fechaDia(Math.min(nDias, e.ultimoDia + 1))) : '', ciudad: e.ciudad,
        foto: fotoCiudad(e.ciudad, 2), titulo: tx.titulo || e.ciudad, copy: tx.copy || '', noches: e.noches, pills: [] });
      estadiaPrev = e.i;
    }
    const fichas = items.map((l) => ({ l, f: fichaLinea(l) }));
    const nombres = [...new Set(items.map((l) => String(l.descripcion).split(' · ')[0]))];
    // De un paquete publicado, el título del día es el de su ficha ("Cusco – Puno: Ruta del Sol" repetido no dice nada)
    const titulosFicha = fichas.map(({ l, f }) => {
      if (!f || f.tipo !== 'paquete') return '';
      const dd = (f.dias_detalle || []).find((x) => x.dia === (l.web_dia || 1));
      return dd && dd.titulo ? dd.titulo : '';
    }).filter(Boolean);
    const base = textosBase(kind, e.ciudad, titulosFicha.length ? titulosFicha : nombres, fichas, d);
    const tx = diasTx.get(d) || {};
    const fotoDia = fichas.flatMap(({ l, f }) => {
      const dd = f && (f.dias_detalle || []).find((x) => x.dia === (l.web_dia || 1));
      return [dd && dd.foto, ...fotosFicha(f)];
    }).find((u) => u && /^https:\/\//.test(u)) || fotoCiudad(e.ciudad, d);
    const chips = [...new Set(fichas.flatMap(({ f }) => parse(f && f.incluye, Array.isArray(f && f.incluye) ? f.incluye : [])).map((x) => recorta(typeof x === 'string' ? x : '', 60)).filter(Boolean))].slice(0, 4);
    flujo.push({
      t: 'dia', dia: d, kind, lugar: kind === 'llegada' ? `${e.ciudad} · llegada` : kind === 'regreso' ? 'regreso' : nombres[0] || e.ciudad,
      label: labelDia(d, fechaDia(d)), foto: fotoDia,
      kicker: tx.kicker || base.kicker, titulo: tx.titulo || base.titulo, relato: tx.relato || base.relato,
      chips, momentos: [],
    });
    // el hotel aparece el día que llegas a cada ciudad
    for (const h of hoteles.filter((x) => (x.dia || 1) === d)) {
      const ha = hotelDe(h);
      const unit = h.cantidad * (h.unidades || 1) ? Math.round(h.venta_cent / (h.cantidad * (h.unidades || 1))) / 100 : 0;
      const salida = inicio ? corta(fechaDia(d + h.cantidad)) : '';
      flujo.push({
        t: 'hotel', dia: d, ciudad: e.ciudad, nombre: nombreHotel(h), noches: h.cantidad, foto: fotoCiudad(e.ciudad, 3),
        filas: [
          ['Estadía', `${h.cantidad} ${h.cantidad === 1 ? 'noche' : 'noches'}`],
          inicio ? ['Entrada · salida', `${corta(fechaDia(d))} → ${salida}`] : null,
          ['Habitación', `${h.unidades || 1} ${(h.unidades || 1) === 1 ? 'habitación' : 'habitaciones'} ${HAB[h.habitacion] || ''}`.trim()],
          ha && ha.categoria ? ['Categoría', ha.categoria.charAt(0).toUpperCase() + ha.categoria.slice(1)] : null,
          unit > 0 ? ['Tarifa referencial', `USD ${new Intl.NumberFormat('en-US').format(Math.round(unit))} por habitación / noche`] : null,
        ].filter(Boolean),
      });
    }
  }

  // ----- precio (solo de venta) -----
  const totalPP = Math.round(t.venta_cent / pax) / 100;
  const porPaquete = t.modo === 'paquete_web';
  const ventaHotel = hoteles.reduce((s, l) => s + l.venta_cent, 0);
  const alojPP = porPaquete ? 0 : Math.round(ventaHotel / pax) / 100;
  const nochesAloj = hoteles.reduce((s, l) => s + l.cantidad, 0);
  const tours = [...new Set(resto.map((l) => String(l.descripcion).split(' · ')[0]))];
  const filas = porPaquete
    ? [{ titulo: 'Paquete completo', detalle: 'Alojamiento, tours, entradas y traslados incluidos', montoPP: totalPP, items: tours }]
    : [
      hoteles.length ? { titulo: `Alojamiento · ${nochesAloj} ${nochesAloj === 1 ? 'noche' : 'noches'}`, detalle: 'Habitación doble, por persona', montoPP: alojPP, items: hoteles.map((h) => `${nombreHotel(h)} · ${h.cantidad} ${h.cantidad === 1 ? 'noche' : 'noches'}`) } : null,
      { titulo: 'Tours, entradas y traslados', detalle: 'Recorrido terrestre con asistencia del equipo', montoPP: Math.round((totalPP - alojPP) * 100) / 100, items: tours },
    ].filter(Boolean);

  const tags = new Set(dest.map((d) => normalizar(d.ciudad)).filter(Boolean).map((x) => x.replace(/\s+/g, '-')));
  for (const l of lineas) for (const [re, tag] of PALABRAS) if (re.test(l.descripcion)) tags.add(tag);

  const ciudadesNombre = dest.map((d) => d.ciudad);
  const datos = {
    v: 1,
    numero: numero || `CT-${p.id}-v${c.version}`,
    cliente: String(p.nombre).trim().split(/\s+/)[0],
    validUntil: previo ? previo.validUntil : sumarDias(hoy, DIAS_VALIDEZ),
    status: 'enviada',
    version: previo ? previo.version : 1,
    updatedAt: previo ? previo.updatedAt : hoy,
    changelog: previo ? previo.changelog : [{ version: 1, fecha: hoy, texto: 'Propuesta enviada.' }],
    videoUrl: previo ? previo.videoUrl : null,
    tags: [...tags],
    viaje: {
      nombre: `Perú: ${listaY(ciudadesNombre)}`, pais: 'Perú', paisOrigen: p.pais || '', inicio, fin, pasajeros: pax,
      fechas: inicio ? `${rango(inicio, fin || inicio)}${tentativa ? ' (tentativas)' : ''}` : 'Fechas a confirmar',
      dias: nDias, destinos: dest.length, tentativa,
    },
    portada: { foto: (ciudades[0] && ciudades[0].foto) || FOTO_RESPALDO, lugar: ciudadesNombre[0] || 'Perú' },
    recorrido: { copy: textos.recorrido || '' },
    ciudades,
    flujo,
    final: { stats: `${nDias} días · ${dest.length} ${dest.length === 1 ? 'destino' : 'destinos'} · ${Math.max(0, nDias - 1)} noches`, titulo: (textos.final && textos.final.titulo) || '', nota: (textos.final && textos.final.nota) || '' },
    incluye: { copy: '', items: incluyeDe(resto, servicioDe, hoteles.length), no_incluye: noIncluyeDe(resto, servicioDe) },
    precio: { totalPP, copy: '', filas, nota: '' },
  };
  return datos;
}

const lista4 = (v) => (Array.isArray(v) ? v.map((x) => recorta(x, 40)).filter(Boolean).slice(0, 4) : []);

// "Qué incluye" desde el catálogo: lo que el cliente compra, sin netos ni notas internas.
function incluyeDe(resto, servicioDe, hayHoteles) {
  const items = [];
  if (hayHoteles) items.push({ title: 'Alojamiento con desayuno', detail: 'En habitación doble, según el detalle de cada ciudad.' });
  const vistos = new Set();
  for (const l of resto) {
    const s = servicioDe(l);
    const clave = s ? s.id : l.descripcion;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    items.push({ title: recorta(String(l.descripcion).split(' · ')[0], 90), detail: recorta(s && s.incluye, 160) });
  }
  return items.slice(0, 8);
}
function noIncluyeDe(resto, servicioDe) {
  const xs = [...new Set(resto.map((l) => (servicioDe(l) || {}).no_incluye).filter(Boolean))];
  return xs.length ? recorta(xs.join(' · '), 300) : '';
}

// Texto base de un día (lo que queda si la IA no lo redactó): sale de la ficha de la web o es genérico.
function textosBase(kind, ciudad, nombres, fichas, d) {
  const relatoFicha = fichas.map(({ l, f }) => {
    const dd = f && (f.dias_detalle || []).find((x) => x.dia === (l.web_dia || 1));
    return dd && dd.relato ? dd.relato : f && f.resumen ? f.resumen : '';
  }).filter(Boolean).join(' ');
  if (kind === 'llegada') {
    return { kicker: `Llegada a ${ciudad}`, titulo: nombres.length ? `Llegada y ${nombres.join(' + ')}`.slice(0, 120) : `Llegada a ${ciudad}`,
      relato: recorta(`Los recibimos en ${ciudad} y los llevamos al hotel. ${relatoFicha}`, 700) };
  }
  if (kind === 'regreso') return { kicker: ciudad, titulo: 'Regreso', relato: `Traslado al aeropuerto con tiempo para tu vuelo de regreso.` };
  if (kind === 'libre') return { kicker: ciudad, titulo: 'Día libre', relato: `Un día para descansar o recorrer ${ciudad} a tu ritmo. Si quieres, te recomendamos qué hacer.` };
  return { kicker: ciudad, titulo: nombres.join(' + ').slice(0, 120) || `Día ${d}`, relato: recorta(relatoFicha, 700) };
}

// ---------- textos con IA ----------
const ESQUEMA = {
  type: 'object', additionalProperties: false, required: ['recorrido', 'ciudades', 'dias', 'final'],
  properties: {
    recorrido: { type: 'string' },
    ciudades: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['nombre', 'titulo', 'linea', 'copy'], properties: {
      nombre: { type: 'string' }, titulo: { type: 'string' }, linea: { type: 'string' }, copy: { type: 'string' } } } },
    dias: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dia', 'kicker', 'titulo', 'relato'], properties: {
      dia: { type: 'integer' }, kicker: { type: 'string' }, titulo: { type: 'string' }, relato: { type: 'string' } } } },
    final: { type: 'object', additionalProperties: false, required: ['titulo', 'nota'], properties: { titulo: { type: 'string' }, nota: { type: 'string' } } },
  },
};
const SISTEMA = `Redactas los textos de una propuesta de viaje de Luna Llena Travel (agencia de Cusco, Perú). Tono cálido y concreto, en español neutro, tuteando ("tú"/"ustedes"). Frases cortas, sin exagerar ni usar signos de admiración.
REGLAS: usa SOLO los servicios, lugares y datos que te paso. No inventes horarios, hoteles, comidas ni experiencias que no estén en los datos. No menciones precios, dinero, descuentos ni proveedores. Cada relato de día: 2 a 4 oraciones, máximo 600 caracteres. "titulo" de día: máximo 70 caracteres. "kicker": máximo 40 caracteres. "linea" de ciudad: una frase de máximo 140 caracteres. "copy" de ciudad: máximo 220. "recorrido": máximo 250 caracteres, resume el viaje de principio a fin. final.titulo máximo 70; final.nota déjala vacía.
Devuelve un texto para CADA día y CADA ciudad que te paso.`;

export function datosParaIA(datos) {
  return {
    cliente: datos.cliente, viajeros: datos.viaje.pasajeros,
    ciudades: datos.ciudades.map((c) => ({ nombre: c.nombre, noches: c.noches, hotel: c.hotel })),
    dias: datos.flujo.filter((x) => x.t === 'dia').map((x) => ({ dia: x.dia, tipo: x.kind, ciudad: x.lugar, que_se_hace: x.titulo, ficha_web: x.relato })),
  };
}

// Valida lo que devolvió la IA: lo que no sirve se descarta y queda el texto base. Nunca precios.
export function validarTextos(crudo, datos) {
  const out = { recorrido: '', ciudades: [], dias: [], final: {} };
  const limpio = (s, max) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return !t || /USD|US\$|\$\s?\d|soles|\bPEN\b/i.test(t) ? '' : t.slice(0, max); };
  if (!crudo || typeof crudo !== 'object') return out;
  out.recorrido = limpio(crudo.recorrido, 300);
  const nombres = new Set(datos.ciudades.map((c) => normalizar(c.nombre)));
  for (const c of Array.isArray(crudo.ciudades) ? crudo.ciudades : []) {
    if (!nombres.has(normalizar(c && c.nombre))) continue;
    out.ciudades.push({ nombre: c.nombre, titulo: limpio(c.titulo, 80), linea: limpio(c.linea, 200), copy: limpio(c.copy, 300) });
  }
  const diasOk = new Set(datos.flujo.filter((x) => x.t === 'dia').map((x) => x.dia));
  const vistos = new Set();
  for (const d of Array.isArray(crudo.dias) ? crudo.dias : []) {
    const n = Number(d && d.dia);
    if (!diasOk.has(n) || vistos.has(n)) continue;
    vistos.add(n);
    out.dias.push({ dia: n, kicker: limpio(d.kicker, 100), titulo: limpio(d.titulo, 120), relato: limpio(d.relato, 700) });
  }
  out.final = { titulo: limpio(crudo.final && crudo.final.titulo, 90), nota: '' };
  return out;
}

// Pide los textos a Claude. Si falla (sin key, sin red, respuesta rota) devuelve null y la propuesta sale con los textos base.
export async function escribirTextos(env, datos) {
  try {
    const { datos: crudo, modelo } = await claudeJson(env, {
      system: SISTEMA, user: JSON.stringify(datosParaIA(datos)), schema: ESQUEMA, maxTokens: 6000, modelo: MODELO_TEXTOS,
    });
    return { textos: validarTextos(crudo, datos), modelo };
  } catch (e) {
    return { textos: null, error: String(e.message || e).slice(0, 160) };
  }
}

// ---------- edición desde la vista previa ----------
// Solo se pueden tocar textos, fotos y vencimiento: la ruta tiene que estar en esta lista.
const URL_HTTPS = /^https:\/\/[^\s"'<>]{4,500}$/;
const REGLAS = [
  [/^validUntil$/, (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)],
  [/^videoUrl$/, (v) => (v === '' ? null : URL_HTTPS.test(v) ? v : undefined)],
  [/^cliente$/, (v) => (v.trim() ? v.trim().slice(0, 60) : undefined)],
  [/^portada\.foto$/, (v) => (URL_HTTPS.test(v) ? v : undefined)],
  [/^(recorrido|incluye)\.copy$/, (v) => v.trim().slice(0, 300)],
  [/^incluye\.no_incluye$/, (v) => v.trim().slice(0, 300)],
  [/^precio\.(copy|nota)$/, (v) => v.trim().slice(0, 400)],
  [/^final\.(titulo|nota)$/, (v) => v.trim().slice(0, 240)],
  [/^ciudades\.\d+\.(linea|titulo)$/, (v) => v.trim().slice(0, 200)],
  [/^ciudades\.\d+\.foto$/, (v) => (URL_HTTPS.test(v) ? v : undefined)],
  [/^flujo\.\d+\.(titulo|kicker)$/, (v) => (v.trim() ? v.trim().slice(0, 120) : undefined)],
  [/^flujo\.\d+\.(relato|copy)$/, (v) => v.trim().slice(0, 700)],
  [/^flujo\.\d+\.foto$/, (v) => (URL_HTTPS.test(v) ? v : undefined)],
];

// cambios = [{ ruta: 'flujo.3.relato', valor: '...' }]. Devuelve { datos, errores }; no toca el original.
export function aplicarCambios(datos, cambios) {
  const nuevo = JSON.parse(JSON.stringify(datos));
  const errores = [];
  for (const c of Array.isArray(cambios) ? cambios : []) {
    const ruta = String(c && c.ruta || '');
    const regla = REGLAS.find(([re]) => re.test(ruta));
    if (!regla || typeof c.valor !== 'string') { errores.push(`No se puede editar "${ruta}"`); continue; }
    const v = regla[1](c.valor);
    if (v === undefined) { errores.push(`Valor no válido en "${ruta}"`); continue; }
    const partes = ruta.split('.');
    let o = nuevo;
    for (const k of partes.slice(0, -1)) o = o == null ? undefined : o[k];
    const ultimo = partes[partes.length - 1];
    if (!o || typeof o !== 'object') { errores.push(`No existe "${ruta}"`); continue; }
    o[ultimo] = v;
  }
  return { datos: nuevo, errores };
}

// Armado automático del itinerario (Fase 3). Funciones puras: no tocan la base ni la red, así se prueban solas.
//
// Reparto de trabajo (decisión 10 del plan): quien PROPONE puede ser la IA, que elige tours del catálogo por clave y
// nunca ve un precio; el CÓDIGO valida lo que propuso (que exista, que quepa, que no se repita), pone los precios y
// avisa lo que huele mal. Sin IA (o si falla) propone el armado base de acá.
//
// Qué sale:
//   - paquete publicado tal cual (misma ciudad y mismos días): precio por componentes Y precio web, Álvaro marca cuál vale;
//   - a medida: hoteles del tarifario + tours del tarifario o de la web en los días libres;
//   - días que no alcanzan: dos borradores (A respeta los días y recorta, B arma lo que se pidió y explica por qué no entra);
//   - destino que la web no tiene: línea ILUSTRATIVA, sin precio, marcada.
// Todo precio que no viene del tarifario sale "sin confirmar" y bloquea la aprobación hasta que Álvaro lo confirme.
import { armarBorrador, sumarDias, diasDe, descontarNochesIncluidas } from './cotizar.js';

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normCiudad = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mismaCiudad = (a, b) => normCiudad(a) === normCiudad(b);
const usd = (c) => `US$ ${(c / 100).toFixed(2)}`;
// Cosas que no se arman solas: solo si el cliente las pide por nombre.
const SOLO_SI_LO_PIDEN = /ayahuasca|kambo|pachamama|espiritual|mistic|florecimiento|retiro|vivencial|free-|salsa|cooking/i;

// ---------- reglas ----------
// filas de ct_reglas -> { alturas: Map ciudad -> m, conexiones: Map "A>B" -> {horas, dia_completo}, aclimatacion, hayPrueba }
export function indexarReglas(filas = []) {
  const alturas = new Map(), conexiones = new Map();
  let aclimatacion = { altura_aviso_m: 3000, salto_aviso_m: 2000, dia_completo_primer_dia: false }, hayPrueba = false;
  for (const f of filas) {
    let d = {}; try { d = typeof f.datos === 'string' ? JSON.parse(f.datos) : (f.datos || {}); } catch { /* regla dañada: se ignora */ }
    if (f.es_prueba) hayPrueba = true;
    if (f.tipo === 'ciudad') alturas.set(normCiudad(f.clave), Number(d.altura_m));
    else if (f.tipo === 'conexion') { const [a, b] = String(f.clave).split('>'); conexiones.set(`${normCiudad(a)}>${normCiudad(b)}`, d); }
    else if (f.tipo === 'aclimatacion') aclimatacion = { ...aclimatacion, ...d };
  }
  return { alturas, conexiones, aclimatacion, hayPrueba };
}

// ---------- tramos ----------
export function tramosDe(destinos) {
  let dia = 1;
  const tramos = destinos.map((d) => { const t = { ciudad: d.ciudad, noches: d.noches, desde: dia, hasta: dia + d.noches }; dia += d.noches; return t; });
  return { tramos, totalDias: Math.max(1, dia) };
}

// Si los días que pidió el cliente no alcanzan para las noches pedidas.
// A: recorta noches desde el último destino (mínimo 1 noche por destino) y si no alcanza saca destinos del final.
export function recortar(destinos, dias) {
  const out = destinos.map((d) => ({ ...d })), avisos = [];
  const noches = () => out.reduce((n, d) => n + d.noches, 0);
  let pasos = 0;
  while (noches() > dias - 1 && pasos++ < 500) {
    const i = [...out.keys()].reverse().find((k) => out[k].noches > 1);
    if (i !== undefined) { out[i].noches -= 1; continue; }
    if (out.length > 1) { const sacado = out.pop(); avisos.push(`Se sacó ${sacado.ciudad} (${sacado.noches} noche${sacado.noches === 1 ? '' : 's'}): no entra en ${dias} días`); continue; }
    out[0].noches = Math.max(0, dias - 1); break;
  }
  destinos.forEach((d) => { const n = out.find((x) => mismaCiudad(x.ciudad, d.ciudad)); if (n && n.noches < d.noches) avisos.push(`${d.ciudad}: ${d.noches} → ${n.noches} noche${n.noches === 1 ? '' : 's'}`); });
  return { destinos: out, avisos };
}

// ---------- catálogo de candidatos ----------
// Cada candidato es un servicio del tarifario (precio real) o un tour de la web sin tarifa (precio publicado, sin confirmar).
// incluirSinTarifa: servicios cargados pero sin precio todavía; solo para lo que el cliente pidió por nombre (la línea sale marcada sin tarifa).
export function candidatosDe({ catalogo, web, incluirSinTarifa = false }) {
  const out = [];
  const usados = new Set();
  for (const s of (catalogo.servicios || []).filter((x) => x.activo && (incluirSinTarifa || (x.tarifas || []).length))) {
    if (!['tour', 'paquete', 'entrada'].includes(s.tipo)) continue;
    const w = s.web_id ? web.find((p) => p.id === s.web_id) : null;
    if (w) usados.add(w.id);
    out.push({ clave: `s${s.id}`, origen: 'tarifario', servicio: s, producto: w || null, ciudad: s.ciudad, dias: diasDe(s.duracion), nombre: s.nombre, duracion: s.duracion || '' });
  }
  for (const p of web.filter((x) => x.tipo === 'tour' && !usados.has(x.id))) {
    out.push({ clave: `w:${p.id}`, origen: 'web', servicio: null, producto: p, ciudad: p.ciudad_base, dias: Math.max(1, p.dias), nombre: p.nombre, duracion: `${p.dias} día${p.dias > 1 ? 's' : ''}` });
  }
  return out;
}

// Un tour que la web publica "a consultar" no tiene ni precio sugerido: va al final.
const sinPrecio = (c) => (c.origen === 'web' && c.producto.precio_web_cent == null ? 1 : 0);

// Lo que se hace por defecto sin IA: primero lo que tiene tarifa real, después el orden de la web. Sin lo "solo si lo piden".
export function ordenBase(cands) {
  return cands.filter((c) => !SOLO_SI_LO_PIDEN.test(c.producto?.id || c.nombre))
    .sort((a, b) => (a.origen === b.origen ? 0 : a.origen === 'tarifario' ? -1 : 1) || (sinPrecio(a) - sinPrecio(b)) || (a.dias - b.dias) || a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- armado de una variante ----------
function lineaDeCandidato(c, { dia, fecha, pax, orden }) {
  const base = { dia, orden, fecha, pasajeros: pax, cantidad: 1, web_producto_id: c.producto?.id || null };
  if (c.origen === 'tarifario') return { ...base, tipo: c.servicio.tipo, servicio_id: c.servicio.id, descripcion: c.servicio.nombre, origen_precio: 'tarifario' };
  const p = c.producto, conPrecio = p.precio_web_cent != null;
  const total = conPrecio ? p.precio_web_cent * pax : 0;
  return {
    ...base, tipo: 'manual', descripcion: p.nombre, origen_precio: 'web', sin_confirmar: 1, precio_es_venta: 1, neto_cent: total, venta_cent: total,
    nota: conPrecio ? `Precio publicado en la web: ${usd(p.precio_web_cent)} por persona. Sin tarifa propia: confirmar.` : 'La web lo publica "a consultar": falta el precio.',
  };
}

// Días libres de cada tramo donde cabe una actividad.
function huecos(tramo, esUltimo, ocupados) {
  const dias = [];
  for (let d = tramo.desde + 1; d <= tramo.hasta - 1; d++) dias.push(d);
  if (!dias.length && tramo.noches === 1) dias.push(tramo.hasta);   // 1 noche: el único día es el de salida (media jornada)
  return dias.filter((d) => !ocupados.has(d));
}

// Excursiones que pidió el cliente por nombre ("Cañón del Colca"): cada una se busca entre los candidatos (nombre y resumen).
// Devuelve { forzadas: [candidato], avisos }. Palabras sueltas como "lago" o "del" no cuentan: todas las demás tienen que aparecer.
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'y', 'en', 'a', 'al', 'lago', 'valle', 'tour', 'excursion', 'visita']);
export function resolverExcursiones(excursiones, candidatos) {
  const forzadas = [], avisos = [];
  for (const nombre of excursiones || []) {
    const palabras = normCiudad(nombre).split(' ').filter((w) => w && !PALABRAS_VACIAS.has(w));
    if (!palabras.length) continue;
    const hay = (c) => { const t = ` ${normCiudad(`${c.nombre} ${c.producto?.resumen || ''}`)} `; return palabras.every((w) => t.includes(` ${w}`)); };
    const hits = candidatos.filter((c) => hay(c) && !forzadas.includes(c));
    // Una excursión pedida es un tour o paquete: las entradas (tickets) solo si no hay otra cosa.
    const esEntrada = (x) => (x.servicio?.tipo === 'entrada' ? 1 : 0);
    const c = ordenBase(hits).sort((a, b) => esEntrada(a) - esEntrada(b))[0];
    if (c) forzadas.push(c); else avisos.push(`No encontré "${nombre}" en el tarifario ni en la web: armalo a mano.`);
  }
  return { forzadas, avisos };
}

// Elige qué va en cada hueco. `elegir` (opcional, puede ser async) = la IA: recibe los huecos y los candidatos por ciudad
// y devuelve { "<ciudad>|<dia>": clave }. Lo que devuelva se valida acá: clave inexistente, repetida o que no entra se descarta.
export async function llenarHuecos({ tramos, candidatos, ocupados, pedido, elegir = null, forzadas = [] }) {
  const slots = [];
  tramos.forEach((t, i) => { for (const d of huecos(t, i === tramos.length - 1, ocupados)) slots.push({ id: `${t.ciudad}|${d}`, ciudad: t.ciudad, dia: d, hasta: t.hasta }); });
  const porCiudad = (ciudad) => candidatos.filter((c) => mismaCiudad(c.ciudad, ciudad));
  let propuesta = {}, avisoIA = null;
  const avisosForzadas = [];
  const usadas = new Set(), elegidas = [];
  const ocup = new Set(ocupados);
  const cabe = (c, slot) => { for (let k = 0; k < c.dias; k++) if (slot.dia + k > slot.hasta || (k > 0 && ocup.has(slot.dia + k))) return false; return !ocup.has(slot.dia); };
  const poner = (c, slot) => { for (let k = 0; k < c.dias; k++) ocup.add(slot.dia + k); usadas.add(c.clave); elegidas.push({ c, slot }); };
  // 0) lo que el cliente pidió por nombre va primero, en un día libre de su ciudad
  for (const c of forzadas) {
    const slot = slots.find((s) => mismaCiudad(s.ciudad, c.ciudad) && cabe(c, s));
    if (slot) poner(c, slot); else avisosForzadas.push(`${c.nombre} (lo pidió el cliente) no entra: ${c.ciudad} no tiene ${c.dias} día${c.dias > 1 ? 's' : ''} libre${c.dias > 1 ? 's' : ''} seguido${c.dias > 1 ? 's' : ''}. Sumá noches ahí o sacá otra actividad.`);
  }
  if (elegir && slots.some((s) => !ocup.has(s.dia))) {
    try { propuesta = (await elegir({ slots: slots.filter((s) => !ocup.has(s.dia)), candidatos: candidatos.filter((c) => !usadas.has(c.clave)).map((c) => ({ clave: c.clave, ciudad: c.ciudad, nombre: c.nombre, dias: c.dias, duracion: c.duracion, resumen: c.producto?.resumen || '' })), pedido })) || {}; }
    catch (e) { avisoIA = `La IA no pudo elegir (${String(e.message || e).slice(0, 80)}): se usó el armado automático.`; }
  }
  // 1) lo que propuso la IA, validado
  for (const slot of slots) {
    const c = porCiudad(slot.ciudad).find((x) => x.clave === propuesta[slot.id]);
    if (c && !usadas.has(c.clave) && cabe(c, slot)) poner(c, slot);
  }
  // 2) lo que falte, con el orden base
  for (const slot of slots) {
    if (ocup.has(slot.dia)) continue;
    const c = ordenBase(porCiudad(slot.ciudad)).find((x) => !usadas.has(x.clave) && cabe(x, slot));
    if (c) poner(c, slot);
  }
  return { elegidas, ocupados: ocup, avisoIA, avisosForzadas };
}

// Avisos de viaje (no bloquean). `lineas` ya tienen dia y descripcion; `tramos` son los de la variante.
export function validarItinerario({ tramos, lineas, reglas, diasPedidos = null, esPaquete = false }) {
  const avisos = [];
  const enDia = (d) => lineas.filter((l) => l.dia === d && l.tipo !== 'hotel');
  const alt = (c) => reglas.alturas.get(normCiudad(c));
  const { altura_aviso_m: tope, salto_aviso_m: salto, dia_completo_primer_dia: soloLiviano } = reglas.aclimatacion;
  tramos.forEach((t, i) => {
    const h = alt(t.ciudad), previa = i ? alt(tramos[i - 1].ciudad) : null;
    if (h == null) { avisos.push(`No hay altura cargada para ${t.ciudad}: no se pudo revisar la aclimatación.`); return; }
    const sube = previa != null ? h - previa : null;
    if (h >= tope && (previa == null || sube >= salto) && !soloLiviano) {
      const act = enDia(t.desde).filter((l) => l.origen_precio !== 'ilustrativa');
      if (act.length) avisos.push(`Día ${t.desde}: llega a ${t.ciudad} (${h.toLocaleString('es-PE')} m${sube ? `, sube ${sube.toLocaleString('es-PE')} m` : ''}) y tiene ${act.map((l) => l.descripcion).join(', ')}. Mejor un primer día liviano.`);
    }
    // Machu Picchu antes de aclimatar: un día en altura sin pasar antes por una ciudad baja y sin día de adaptación.
    if (i < tramos.length - 1) {
      const sig = tramos[i + 1], conex = reglas.conexiones.get(`${normCiudad(t.ciudad)}>${normCiudad(sig.ciudad)}`);
      if (!conex) avisos.push(`No hay regla de traslado ${t.ciudad} → ${sig.ciudad}: revisá cómo y cuánto se tarda.`);
      else if (conex.dia_completo && !esPaquete && enDia(t.hasta).length) avisos.push(`Día ${t.hasta}: el traslado ${t.ciudad} → ${sig.ciudad} lleva el día (${conex.horas} h) y hay ${enDia(t.hasta).map((l) => l.descripcion).join(', ')}.`);
    }
  });
  const vistos = new Map();
  for (const l of lineas) if (l.web_producto_id && !l.web_dia) vistos.set(l.web_producto_id, (vistos.get(l.web_producto_id) || 0) + 1);
  for (const [id, n] of vistos) if (n > 1) avisos.push(`${id} está ${n} veces en el itinerario.`);
  if (diasPedidos && tramos.length) { const tot = tramos[tramos.length - 1].hasta; if (tot !== diasPedidos) avisos.push(`El itinerario dura ${tot} días y el cliente pidió ${diasPedidos}.`); }
  if (avisos.length && reglas.hayPrueba) avisos.push('Estas reglas de viaje las propuso el sistema y Álvaro todavía no las validó: se avisa, no se bloquea.');
  return avisos;
}

// ¿Hay un paquete publicado que sea justo lo pedido? Mismas ciudades (como conjunto) y mismos días.
export function paqueteExacto({ destinos, dias, web }) {
  const pedidas = new Set(destinos.map((d) => normCiudad(d.ciudad)));
  return web.filter((p) => p.tipo === 'paquete' && p.dias === dias && p.ciudades.length === pedidas.size && p.ciudades.every((c) => pedidas.has(normCiudad(c))))
    .sort((a, b) => (a.precio_web_cent ?? 1e12) - (b.precio_web_cent ?? 1e12))[0] || null;
}

// Noches por ciudad de un paquete según sus días (el último día es de salida).
export function destinosDePaquete(p) {
  const out = [];
  (p.dias_detalle || []).forEach((d, i, todos) => {
    const noche = i < todos.length - 1 ? 1 : 0;
    const ult = out[out.length - 1];
    if (ult && mismaCiudad(ult.ciudad, d.ciudad)) ult.noches += noche; else out.push({ ciudad: d.ciudad, noches: noche });
  });
  return out.length ? out : [{ ciudad: p.ciudad_base, noches: Math.max(0, p.noches) }];
}

function armarPaquete({ pedido, p, catalogo, reglas }) {
  const pax = Math.max(1, Number(pedido.pasajeros) || 1);
  const destinos = destinosDePaquete(p);
  const { lineas: hoteles, avisos } = armarBorrador({ ...pedido, destinos, servicios: [] }, catalogo);
  const fechaDia = (d) => (pedido.fecha_inicio ? sumarDias(pedido.fecha_inicio, d - 1) : null);
  let orden = 0;
  const dias = (p.dias_detalle || []).map((d) => ({
    dia: d.dia, orden: orden++, fecha: fechaDia(d.dia), tipo: 'manual', descripcion: `${p.nombre} · día ${d.dia}: ${d.titulo}`.slice(0, 200), pasajeros: pax, cantidad: 1,
    origen_precio: 'web', web_producto_id: p.id, web_dia: d.dia, precio_es_venta: 1, neto_cent: 0, venta_cent: 0, nota: d.relato || null,
  }));
  const tras = lineasTraslados({ pedido: { ...pedido, destinos }, catalogo, orden: orden + hoteles.length });
  const lineas = [...dias, ...hoteles.map((l) => ({ ...l, orden: orden++, origen_precio: 'tarifario' })), ...tras.lineas];
  const { tramos } = tramosDe(destinos);
  const av = [
    `Paquete publicado en la web: ${p.nombre} (${p.dias} días). Los días vienen de la ficha; el precio por componentes solo suma los hoteles con tarifa cargada.`,
    ...avisos.filter((a) => !/fechas dan/.test(a)),
    ...tras.avisos,
    ...validarItinerario({ tramos, lineas: dias.map((l) => ({ ...l, origen_precio: 'paquete' })), reglas, diasPedidos: pedido.dias || null, esPaquete: true }),
  ];
  return { variante: null, titulo: p.nombre, lineas, avisos: av, precio_modo: 'paquete_web', paquete_web_id: p.id, paquete_web_cent: p.precio_web_cent == null ? null : p.precio_web_cent * pax, tramos };
}

async function armarMedida({ pedido, destinos, catalogo, web, reglas, elegir, titulo, variante, avisosExtra = [] }) {
  const pax = Math.max(1, Number(pedido.pasajeros) || 1);
  const { tramos } = tramosDe(destinos);
  const candidatos = candidatosDe({ catalogo, web });
  const conOferta = (ciudad) => candidatos.some((c) => mismaCiudad(c.ciudad, ciudad)) || (catalogo.hoteles || []).some((h) => h.activo && mismaCiudad(h.ciudad, ciudad)) || reglas.alturas.has(normCiudad(ciudad));
  const ilustrativas = tramos.filter((t) => !conOferta(t.ciudad));
  const reales = tramos.filter((t) => !ilustrativas.includes(t));
  // Hoteles del tarifario por tramo (la numeración de días sale de todos los destinos); los destinos ilustrativos no llevan hotel.
  const { lineas: hoteles, avisos } = armarBorrador({ ...pedido, destinos, servicios: [] }, catalogo);
  const fechaDia = (d) => (pedido.fecha_inicio ? sumarDias(pedido.fecha_inicio, d - 1) : null);
  const desdeIlustrativo = new Set(ilustrativas.map((t) => t.desde));
  const lineas = [];
  let orden = 0;
  for (const l of hoteles) if (!desdeIlustrativo.has(l.dia)) lineas.push({ ...l, orden: orden++, origen_precio: 'tarifario' });
  for (const t of ilustrativas) {
    lineas.push({
      dia: t.desde, orden: orden++, fecha: fechaDia(t.desde), tipo: 'manual', descripcion: `${t.ciudad}: ${t.noches} noche${t.noches === 1 ? '' : 's'} (destino sin ficha en la web)`.slice(0, 200), pasajeros: pax, cantidad: 1,
      origen_precio: 'ilustrativa', es_ilustrativa: 1, precio_es_venta: 1, neto_cent: 0, venta_cent: 0,
      nota: 'Ilustración: la web no publica este destino. Álvaro tiene que armarlo y ponerle precio.',
    });
  }
  const ocupados = new Set();
  const exc = resolverExcursiones(pedido.excursiones, candidatosDe({ catalogo, web, incluirSinTarifa: true }));
  const { elegidas, avisoIA, avisosForzadas } = await llenarHuecos({ tramos: reales, candidatos, ocupados, pedido, elegir, forzadas: exc.forzadas });
  for (const { c, slot } of elegidas) lineas.push({ ...lineaDeCandidato(c, { dia: slot.dia, fecha: fechaDia(slot.dia), pax, orden: orden++ }) });
  const tras = lineasTraslados({ pedido: { ...pedido, destinos }, catalogo, orden });
  orden += tras.lineas.length;
  lineas.push(...tras.lineas);
  const avNoches = descontarNochesIncluidas(lineas, catalogo, reales);
  lineas.sort((a, b) => (a.dia - b.dia) || (a.orden - b.orden));
  const av = [
    ...avisosExtra,
    ...avNoches,
    ...(avisoIA ? [avisoIA] : []),
    ...exc.avisos, ...avisosForzadas, ...tras.avisos,
    ...ilustrativas.map((t) => `${t.ciudad} no está en la web ni en el tarifario: quedó como ilustración, sin precio.`),
    ...avisos.filter((a) => !/fechas dan/.test(a)),
    ...validarItinerario({ tramos, lineas, reglas, diasPedidos: pedido.dias || null }),
  ];
  const sinHueco = reales.filter((t) => t.noches > 1 && !elegidas.some((e) => mismaCiudad(e.slot.ciudad, t.ciudad)));
  for (const t of sinHueco) av.push(`${t.ciudad}: no hay tours cargados para llenar sus días libres.`);
  return { variante, titulo, lineas, avisos: av, precio_modo: 'componentes', paquete_web_id: null, paquete_web_cent: null, tramos };
}


// ---------- traslados y trenes que pidió el cliente ----------
// pedido.traslados = [{ que, dia|null, modalidad PRI|GRU }]. Sin día, se deduce del texto:
//   "→ estación de tren", "tren", "Machu Picchu" → el día que viaja a Aguas Calientes / Machu Picchu;
//   una ciudad del recorrido → el día que llega ahí (o el que se va, si es "hotel → aeropuerto");
//   "aeropuerto → hotel" sin ciudad → día 1; "hotel → aeropuerto" → último día.
const TREN_MP = /\b(tren|estacion|machu picchu|aguas calientes|ollantaytambo|poroy)\b/;
const destinoMP = (c) => /aguas calientes|machu picchu/.test(normCiudad(c));
export function diaTraslado(t, tramos, totalDias) {
  if (t.dia) return { dia: Math.min(Math.max(1, t.dia), totalDias), seguro: true };
  const q = ` ${normCiudad(t.que)} `;
  const nombra = (c) => q.includes(` ${normCiudad(c)} `);
  const iAero = q.indexOf(' aeropuerto '), iHotel = q.indexOf(' hotel ');
  const aSalida = iAero >= 0 && ((iHotel >= 0 && iHotel < iAero) || /\b(salida|regreso|vuelo de vuelta)\b/.test(q));
  let tr = null;
  if (TREN_MP.test(q)) tr = tramos.find((x) => destinoMP(x.ciudad)) || null;
  if (!tr) tr = tramos.find((x, i) => i > 0 && nombra(x.ciudad)) || tramos.find((x) => nombra(x.ciudad)) || null;
  if (tr) return { dia: Math.min(aSalida ? tr.hasta : tr.desde, totalDias), seguro: true };
  if (iAero >= 0) return { dia: aSalida ? totalDias : 1, seguro: true };
  return { dia: 1, seguro: false };
}

// Líneas de los traslados pedidos. Con el nombre exacto de un servicio del tarifario (traslado o tren) sale con su tarifa;
// si no, una línea manual sin precio (origen "pedido") que bloquea la aprobación hasta que alguien le ponga precio.
export function lineasTraslados({ pedido, catalogo, orden = 0 }) {
  const lista = (pedido.traslados || []).filter((t) => t && t.que);
  if (!lista.length) return { lineas: [], avisos: [] };
  const destinos = (pedido.destinos || []).filter((d) => d && d.ciudad).map((d) => ({ ciudad: d.ciudad, noches: Math.max(0, Number(d.noches) || 0) }));
  const { tramos, totalDias } = tramosDe(destinos);
  const pax = Math.max(1, Number(pedido.pasajeros) || 1);
  const fechaDia = (d) => (pedido.fecha_inicio ? sumarDias(pedido.fecha_inicio, d - 1) : null);
  const servs = (catalogo.servicios || []).filter((s) => s.activo && ['traslado', 'tren'].includes(s.tipo));
  const lineas = [], avisos = [];
  for (const t of lista) {
    const { dia, seguro } = diaTraslado(t, tramos, Math.max(1, Number(pedido.dias) || totalDias));
    const mod = t.modalidad === 'GRU' ? 'GRU' : 'PRI';
    const s = servs.find((x) => normCiudad(x.nombre) === normCiudad(t.que));
    const base = { dia, orden: orden++, fecha: fechaDia(dia), pasajeros: pax, cantidad: 1, modalidad: mod };
    if (s) lineas.push({ ...base, tipo: s.tipo, servicio_id: s.id, descripcion: s.nombre, origen_precio: 'tarifario' });
    else {
      lineas.push({
        ...base, tipo: 'manual', descripcion: `${t.que} (${mod === 'PRI' ? 'privado' : 'compartido'})`.slice(0, 200),
        origen_precio: 'pedido', sin_confirmar: 1, precio_es_venta: 0, neto_cent: 0, venta_cent: 0,
        nota: 'Lo pidió el cliente y no está en el tarifario: poné el precio (Editar) para que se pueda aprobar.',
      });
    }
    if (!seguro) avisos.push(`"${t.que}" quedó en el día ${dia}: no se pudo saber qué día va. Revisalo.`);
  }
  return { lineas, avisos };
}

// ---------- entrada ----------
// pedido: { pasajeros, dias, fecha_inicio, fecha_fin, destinos:[{ciudad,noches}], categoria_hotel, servicios:[] }
// -> { variantes: [ { variante, titulo, lineas, avisos, precio_modo, paquete_web_id, paquete_web_cent } ] }
export async function armarItinerario({ pedido, catalogo, web, reglas, elegir = null }) {
  const destinos = (pedido.destinos || []).filter((d) => d && d.ciudad).map((d) => ({ ciudad: d.ciudad, noches: Math.max(0, Number(d.noches) || 0) }));
  const noches = destinos.reduce((n, d) => n + d.noches, 0);
  const dias = Number(pedido.dias) || noches + 1;
  const R = reglas.alturas ? reglas : indexarReglas(reglas);
  if (!destinos.length) return { variantes: [] };

  const pq = paqueteExacto({ destinos, dias, web });
  if (pq && !(pedido.servicios || []).length) return { variantes: [armarPaquete({ pedido: { ...pedido, dias }, p: pq, catalogo, reglas: R })] };

  if (noches + 1 > dias) {
    const rec = recortar(destinos, dias);
    const a = await armarMedida({ pedido: { ...pedido, dias }, destinos: rec.destinos, catalogo, web, reglas: R, elegir, titulo: `Entra en ${dias} días (recortado)`, variante: 'A', avisosExtra: [`Respeta los ${dias} días que pidió el cliente y recorta el recorrido.`, ...rec.avisos] });
    const b = await armarMedida({ pedido: { ...pedido, dias: noches + 1 }, destinos, catalogo, web, reglas: R, elegir, titulo: `Lo que pidió (${noches + 1} días)`, variante: 'B',
      avisosExtra: [`Arma todo lo que pidió el cliente, pero no entra en ${dias} días: ${destinos.map((d) => `${d.ciudad} ${d.noches} n`).join(', ')} son ${noches + 1} días (${noches + 1 - dias} más). Hay que ofrecerle más días o sacar algo.`] });
    return { variantes: [a, b] };
  }
  let extra = [];
  let dest = destinos;
  if (noches + 1 < dias) {
    dest = destinos.map((d, i) => (i === destinos.length - 1 ? { ...d, noches: d.noches + (dias - noches - 1) } : d));
    extra = [`El cliente pidió ${dias} días y los destinos suman ${noches + 1}: se sumaron ${dias - noches - 1} noche${dias - noches - 1 === 1 ? '' : 's'} en ${destinos[destinos.length - 1].ciudad}.`];
  }
  return { variantes: [await armarMedida({ pedido: { ...pedido, dias }, destinos: dest, catalogo, web, reglas: R, elegir, titulo: 'A medida', variante: null, avisosExtra: extra })] };
}

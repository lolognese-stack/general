// Motor de precios del cotizador interno. Funciones puras (sin base): las usa /api/ct y las prueba crm/probar-cotizar.mjs.
// Todo en centavos enteros. Moneda de la cotización: USD. Las tarifas en PEN se pasan a USD con el tipo de cambio.
//
// catalogo = { servicios: [{id, nombre, ciudad, tipo, duracion, pax_min, precio_es_venta, activo, tarifas: [...]}],
//              hoteles:   [{id, nombre, ciudad, categoria, precio_es_venta, es_ilustrativo, activo, tarifas: [...]}] }
// config   = { margen_pct, tc_pen_por_usd, recargo_tarjeta_pct, igv_pct, temporadas: [{temporada, desde_md, hasta_md}] }

import { normalizar } from './tarifario.js';

export const sumarDias = (iso, n) => {
  const d = new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3);
  return d.toISOString().slice(0, 10);
};
export const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3);

// Temporada de un día: 'alta' si cae en algún rango alta (los rangos pueden cruzar el año), si no 'baja'.
export function temporadaDe(fecha, temporadas = []) {
  if (!fecha) return 'baja';
  const md = fecha.slice(5, 10);
  const dentro = (t) => t.desde_md <= t.hasta_md ? md >= t.desde_md && md <= t.hasta_md : md >= t.desde_md || md <= t.hasta_md;
  return temporadas.some((t) => t.temporada === 'alta' && dentro(t)) ? 'alta' : 'baja';
}

// La tarifa que vale para esa fecha, temporada y cantidad de pasajeros.
// Preferencia: real antes que de prueba, temporada específica antes que 'todas', tramo más angosto, la más nueva.
export function elegirTarifa(tarifas, { pax = null, fecha, temporada, habitacion = null }) {
  const ok = (tarifas || []).filter((t) =>
    t.vigente_desde <= fecha && fecha <= t.vigente_hasta &&
    (t.temporada === 'todas' || t.temporada === temporada) &&
    (habitacion ? t.habitacion === habitacion : true) &&
    (pax === null || (t.pax_desde <= pax && (t.pax_hasta === null || t.pax_hasta === undefined || pax <= t.pax_hasta))));
  const ancho = (t) => (t.pax_hasta ?? 999) - (t.pax_desde ?? 1);
  ok.sort((a, b) => (a.es_ilustrativa - b.es_ilustrativa) || ((a.temporada === 'todas') - (b.temporada === 'todas'))
    || (ancho(a) - ancho(b)) || (b.vigente_desde < a.vigente_desde ? -1 : b.vigente_desde > a.vigente_desde ? 1 : 0));
  return ok[0] || null;
}

// Centavos en la moneda de la tarifa -> centavos de USD.
export function aUsd(cent, moneda, tc) {
  if (moneda === 'USD') return cent;
  if (moneda === 'PEN') {
    if (!(tc > 0)) throw new Error('Falta el tipo de cambio');
    return Math.round(cent / tc);
  }
  throw new Error(`Moneda desconocida: ${moneda}`);
}

export const conMargen = (netoCent, margenPct) => Math.round(netoCent * (1 + (Number(margenPct) || 0) / 100));

// Habitaciones para N pasajeros: parejas en DBL; si quedan 3, una TPL; si queda 1, una SGL.
export function habitaciones(pax) {
  pax = Math.max(1, Number(pax) || 1);
  if (pax === 1) return { SGL: 1 };
  const r = {};
  let resto = pax;
  if (resto % 2 === 1) { r.TPL = 1; resto -= 3; }
  if (resto > 0) r.DBL = resto / 2;
  return r;
}

const diasDe = (duracion) => { const m = String(duracion || '').match(/(\d+)\s*D/i); return m ? Math.max(1, +m[1]) : 1; };
const etiquetaHab = { SGL: 'simple', DBL: 'doble', TPL: 'triple' };

// Precio de una línea. Devuelve una copia con neto_cent, venta_cent, margen_pct, problema, etc. actualizados.
// Lo que se pisó a mano (pisado_neto / pisado_venta) no se toca.
export function precioLinea(l, { catalogo, config, pax }) {
  const x = { ...l, problema: null, temporada_usada: null };
  const margenDefecto = Number(config.margen_pct);
  const tc = Number(config.tc_pen_por_usd);
  const temps = config.temporadas || [];
  let netoCalc = null, esVenta = 0, ilus = 0;

  if (x.tipo === 'manual') {
    esVenta = x.precio_es_venta ? 1 : 0;
    netoCalc = x.neto_cent ?? 0;
  } else if (x.tipo === 'hotel') {
    const h = (catalogo.hoteles || []).find((y) => y.id === x.hotel_id);
    if (!h) x.problema = 'Falta elegir el hotel';
    else if (!x.fecha) x.problema = 'Falta la fecha de llegada';
    else {
      esVenta = h.precio_es_venta ? 1 : 0;
      let total = 0, primera = null, faltan = 0;
      for (let i = 0; i < (x.cantidad || 1); i++) {
        const f = sumarDias(x.fecha, i);
        const t = elegirTarifa(h.tarifas, { fecha: f, temporada: temporadaDe(f, temps), habitacion: x.habitacion });
        if (!t) { faltan++; continue; }
        if (!primera) primera = t;
        if (t.temporada !== 'todas') x.temporada_usada = t.temporada;
        if (t.es_ilustrativa || h.es_ilustrativo) ilus = 1;
        total += aUsd(t.neto_cent, t.moneda, tc) * (x.unidades || 1);
      }
      if (faltan) x.problema = `Sin tarifa ${x.habitacion} para ${faltan} de ${x.cantidad} noches`;
      if (primera) { x.tarifa_id = primera.id; x.neto_unit_cent = primera.neto_cent; x.moneda = primera.moneda; }
      netoCalc = faltan ? null : total;
    }
  } else {
    const s = (catalogo.servicios || []).find((y) => y.id === x.servicio_id);
    if (!s) x.problema = 'El servicio ya no está en el catálogo';
    else if (!x.fecha) x.problema = 'Falta la fecha';
    else {
      esVenta = s.precio_es_venta ? 1 : 0;
      // El tramo se elige por el tamaño del grupo (todos hacen el tour juntos), no por los pasajeros de la línea.
      const grupo = pax || x.pasajeros;
      const t = elegirTarifa(s.tarifas, { pax: grupo, fecha: x.fecha, temporada: temporadaDe(x.fecha, temps) });
      if (!t) x.problema = `Sin tarifa para ${grupo} pasajeros el ${x.fecha}`;
      else {
        if (t.es_ilustrativa) ilus = 1;
        x.temporada_usada = t.temporada;
        x.tarifa_id = t.id; x.neto_unit_cent = t.neto_cent; x.moneda = t.moneda;
        netoCalc = aUsd(t.neto_cent, t.moneda, tc) * (x.pasajeros || 1);
      }
      if (s.pax_min && grupo < s.pax_min) x.problema = `Sale desde ${s.pax_min} pasajeros`;
    }
  }

  x.precio_es_venta = esVenta;
  x.es_ilustrativa = ilus;
  if (!x.pisado_neto) x.neto_cent = netoCalc ?? 0;
  if (x.pisado_neto && x.problema && x.tipo !== 'manual') x.problema = null;   // precio puesto a mano: ya no falta tarifa
  x.margen_pct = esVenta ? 0 : (x.margen_fijo ?? margenDefecto);
  if (!x.pisado_venta) x.venta_cent = esVenta ? x.neto_cent : conMargen(x.neto_cent, x.margen_pct);
  return x;
}

export function totales(lineas, { pax, config }) {
  const neto = lineas.reduce((s, l) => s + (l.neto_cent || 0), 0);
  const venta = lineas.reduce((s, l) => s + (l.venta_cent || 0), 0);
  const n = Math.max(1, Number(pax) || 1);
  return {
    neto_cent: neto,
    venta_cent: venta,
    ganancia_cent: venta - neto,
    margen_efectivo_pct: neto ? Math.round(((venta - neto) / neto) * 1000) / 10 : null,
    venta_por_persona_cent: Math.round(venta / n),
    con_factura_cent: Math.round(venta * (1 + (Number(config.igv_pct) || 0) / 100)),
    con_tarjeta_cent: Math.round(venta * (1 + (Number(config.recargo_tarjeta_pct) || 0) / 100)),
    problemas: lineas.filter((l) => l.problema).length,
    usa_ilustrativas: lineas.some((l) => l.es_ilustrativa) ? 1 : 0,
  };
}

// ¿La cotización tiene que salir con el cartel PRECIOS DE PRUEBA?
export function usaPrueba(lineas, config) {
  if (lineas.some((l) => l.es_ilustrativa)) return true;
  const prueba = config.es_prueba || {};
  if (prueba.margen_pct && lineas.some((l) => !l.precio_es_venta && !l.pisado_venta && l.margen_fijo == null)) return true;
  if (prueba.tc_pen_por_usd && lineas.some((l) => l.moneda === 'PEN' && !l.pisado_neto)) return true;
  if (prueba.temporadas && lineas.some((l) => l.temporada_usada && l.temporada_usada !== 'todas')) return true;
  return false;
}

// Borrador automático a partir del pedido.
// pedido = { fecha_inicio, fecha_fin, pasajeros, destinos: [{ciudad, noches}], categoria_hotel, servicios: [id] }
// Devuelve { lineas, avisos }: líneas sin precio (pasan después por precioLinea).
export function armarBorrador(pedido, catalogo) {
  const avisos = [];
  const pax = Math.max(1, Number(pedido.pasajeros) || 1);
  const destinos = (pedido.destinos || []).filter((d) => d && d.ciudad).map((d) => ({ ciudad: d.ciudad, noches: Math.max(0, Number(d.noches) || 0) }));
  const inicio = pedido.fecha_inicio || null;
  const lineas = [];
  let orden = 0;
  const fechaDia = (dia) => inicio ? sumarDias(inicio, dia - 1) : null;
  if (!inicio) avisos.push('El pedido no tiene fecha de inicio: no se puede elegir tarifa');

  // Tramos de días por destino: llega el día "desde" y se va el día "desde + noches".
  let dia = 1;
  const tramos = destinos.map((d) => { const t = { ...d, desde: dia, hasta: dia + d.noches }; dia += d.noches; return t; });
  const totalDias = Math.max(1, dia);
  if (inicio && pedido.fecha_fin) {
    const segunFechas = diasEntre(inicio, pedido.fecha_fin) + 1;
    if (segunFechas !== totalDias) avisos.push(`Las fechas dan ${segunFechas} días y las noches por destino dan ${totalDias}: revisá las noches`);
  }

  // Alojamiento.
  const cat = pedido.categoria_hotel;
  if (cat && cat !== 'sin_hotel') {
    for (const t of tramos) {
      if (!t.noches) continue;
      const enCiudad = (catalogo.hoteles || []).filter((h) => h.activo && normalizar(h.ciudad) === normalizar(t.ciudad) && h.categoria === cat);
      const llegada = fechaDia(t.desde);
      const rooms = habitaciones(pax);
      // Primero un hotel real con tarifa para todas las habitaciones; si no, uno de prueba.
      const cubre = (h) => !!llegada && Object.keys(rooms).every((hab) => (h.tarifas || []).some((x) => x.habitacion === hab && x.vigente_desde <= llegada && llegada <= x.vigente_hasta));
      const hotel = [...enCiudad].sort((a, b) => (a.es_ilustrativo - b.es_ilustrativo) || (cubre(b) - cubre(a)) || a.nombre.localeCompare(b.nombre))[0];
      for (const [hab, n] of Object.entries(rooms)) {
        lineas.push({
          dia: t.desde, orden: orden++, tipo: 'hotel', hotel_id: hotel ? hotel.id : null, habitacion: hab, unidades: n, cantidad: t.noches,
          pasajeros: hab === 'SGL' ? n : hab === 'DBL' ? n * 2 : n * 3, fecha: llegada,
          descripcion: hotel ? `${hotel.nombre} · ${n} hab. ${etiquetaHab[hab]} × ${t.noches} noche${t.noches > 1 ? 's' : ''}` : `Hotel ${cat} en ${t.ciudad} (sin hotel cargado)`,
        });
      }
    }
  }

  // Servicios pedidos: en su ciudad, en días libres. Primero los de varios días, después los de día completo y al final
  // los de medio día (que, si no hay lugar, pueden ir la tarde del día de llegada).
  const ocupado = new Map();     // día -> ocupado por un servicio
  const largoDe = (s) => diasDe(s.duracion);
  const medioDia = (s) => /medio|half|\bhoras?\b|minutos/i.test(s.duracion || '');
  const pedidos = (pedido.servicios || []).map((id) => (catalogo.servicios || []).find((s) => s.id === Number(id))).filter(Boolean)
    .map((s, i) => ({ s, i })).sort((a, b) => (largoDe(b.s) - largoDe(a.s)) || (medioDia(a.s) - medioDia(b.s)) || (a.i - b.i)).map((x) => x.s);
  const libre = (d, largo) => [...Array(largo).keys()].every((i) => !ocupado.get(d + i));
  for (const s of pedidos) {
    const t = tramos.find((x) => normalizar(x.ciudad) === normalizar(s.ciudad));
    const largo = largoDe(s);
    let d = null;
    if (!t) { d = totalDias; avisos.push(`${s.nombre} es de ${s.ciudad}, que no está en los destinos: quedó en el último día`); }
    else {
      // Días libres: del siguiente a la llegada al anterior a la salida (el de salida es de viaje).
      // Un paquete de varios días puede terminar el día de salida. Con 1 noche, el único día es el de salida; con 0, el de llegada.
      const primero = t.noches ? t.desde + 1 : t.desde;
      const ultimo = largo > 1 ? Math.max(primero, t.hasta) : (t.noches >= 2 ? t.hasta - 1 : primero);
      for (let x = primero; x + largo - 1 <= ultimo; x++) if (libre(x, largo)) { d = x; break; }
      if (d === null && medioDia(s) && t.noches && libre(t.desde, 1)) d = t.desde;
      if (d === null) {
        d = Math.max(primero, ultimo - largo + 1);
        avisos.push(`${s.nombre} no entra en los días libres de ${t.ciudad} (${t.noches} noche${t.noches === 1 ? '' : 's'}): quedó el día ${d} junto con otro servicio, revisalo`);
      }
    }
    for (let i = 0; i < largo; i++) ocupado.set(d + i, true);
    const noches = (String(s.duracion || '').match(/(\d+)\s*N/i) || [])[1];
    if (noches && cat && cat !== 'sin_hotel') avisos.push(`${s.nombre} incluye ${noches} noche${noches === '1' ? '' : 's'} de alojamiento: revisá que no se cobre doble hotel`);
    lineas.push({ dia: d, orden: orden++, tipo: s.tipo, servicio_id: s.id, pasajeros: pax, cantidad: 1, unidades: 1, fecha: fechaDia(d), descripcion: s.nombre });
  }
  lineas.sort((a, b) => (a.dia - b.dia) || ((a.tipo === 'hotel') - (b.tipo === 'hotel')) || (a.orden - b.orden));
  lineas.forEach((l, i) => { l.orden = i; });
  return { lineas, avisos, dias: totalDias };
}

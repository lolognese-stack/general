// Tests del cálculo de precios del cotizador interno. Correr: node crm/probar-cotizar.mjs
import assert from 'node:assert/strict';
import { temporadaDe, elegirTarifa, aUsd, conMargen, habitaciones, precioLinea, totales, usaPrueba, armarBorrador, sumarDias } from '../functions/_lib/cotizar.js';

let ok = 0;
const t = (nombre, fn) => { try { fn(); ok++; } catch (e) { console.error('FALLA:', nombre, '\n ', e.message); process.exitCode = 1; } };

const VIG = { vigente_desde: '2026-01-01', vigente_hasta: '2027-12-31' };
const tar = (id, cent, desde, hasta, extra = {}) => ({ id, neto_cent: cent, moneda: 'USD', pax_desde: desde, pax_hasta: hasta, temporada: 'todas', es_ilustrativa: 0, ...VIG, ...extra });
const TEMPS = [{ temporada: 'alta', desde_md: '06-01', hasta_md: '08-31' }, { temporada: 'alta', desde_md: '12-20', hasta_md: '01-05' }];
const CONFIG = { margen_pct: 25, tc_pen_por_usd: 3.75, recargo_tarjeta_pct: 5, igv_pct: 18, temporadas: TEMPS };

const cityTour = { id: 1, nombre: 'City Tour Cusco', ciudad: 'Cusco', tipo: 'tour', duracion: 'Medio día', pax_min: 1, precio_es_venta: 0, activo: 1,
  tarifas: [tar(11, 4000, 1, 1), tar(12, 2800, 2, 3), tar(13, 2200, 4, 6), tar(14, 1800, 7, null)] };
const valle = { id: 2, nombre: 'Valle VIP + MP 2D/1N', ciudad: 'Cusco', tipo: 'paquete', duracion: '2D/1N', pax_min: 1, precio_es_venta: 0, activo: 1,
  tarifas: [tar(21, 43000, 2, 3, { temporada: 'baja' }), tar(22, 47300, 2, 3, { temporada: 'alta' })] };
const circuito = { id: 3, nombre: 'Circuito Mágico del Agua', ciudad: 'Lima', tipo: 'entrada', duracion: '2 horas', pax_min: 1, precio_es_venta: 0, activo: 1,
  tarifas: [{ ...tar(31, 1500, 1, null), moneda: 'PEN' }] };
const propio = { id: 4, nombre: 'Humantay (propio)', ciudad: 'Cusco', tipo: 'tour', duracion: 'Día completo', pax_min: 2, precio_es_venta: 1, activo: 1, tarifas: [tar(41, 2700, 2, null)] };
const hotelCusco = { id: 50, nombre: 'Hotel Wayra', ciudad: 'Cusco', categoria: 'confort', precio_es_venta: 0, es_ilustrativo: 0, activo: 1, tarifas: [
  { id: 51, habitacion: 'DBL', neto_cent: 10000, moneda: 'USD', temporada: 'baja', es_ilustrativa: 0, ...VIG },
  { id: 52, habitacion: 'DBL', neto_cent: 13000, moneda: 'USD', temporada: 'alta', es_ilustrativa: 0, ...VIG },
  { id: 53, habitacion: 'SGL', neto_cent: 8500, moneda: 'USD', temporada: 'todas', es_ilustrativa: 0, ...VIG },
  { id: 54, habitacion: 'TPL', neto_cent: 13000, moneda: 'USD', temporada: 'todas', es_ilustrativa: 0, ...VIG }] };
const hotelPrueba = { id: 60, nombre: 'Hotel Ejemplo (prueba)', ciudad: 'Cusco', categoria: 'confort', precio_es_venta: 0, es_ilustrativo: 1, activo: 1, tarifas: [
  { id: 61, habitacion: 'DBL', neto_cent: 9000, moneda: 'USD', temporada: 'todas', es_ilustrativa: 1, ...VIG }] };
const CAT = { servicios: [cityTour, valle, circuito, propio], hoteles: [hotelPrueba, hotelCusco] };

t('temporadas, también cruzando el año', () => {
  assert.equal(temporadaDe('2027-07-15', TEMPS), 'alta');
  assert.equal(temporadaDe('2027-05-31', TEMPS), 'baja');
  assert.equal(temporadaDe('2027-12-31', TEMPS), 'alta');
  assert.equal(temporadaDe('2027-01-03', TEMPS), 'alta');
  assert.equal(temporadaDe('2027-01-06', TEMPS), 'baja');
  assert.equal(temporadaDe('2027-07-15', []), 'baja');
});

t('tramos de pasajeros: 1, 2-3, 4-6, 7+', () => {
  const f = { fecha: '2027-03-10', temporada: 'baja' };
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 1 }).id, 11);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 2 }).id, 12);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 3 }).id, 12);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 4 }).id, 13);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 6 }).id, 13);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 7 }).id, 14);
  assert.equal(elegirTarifa(cityTour.tarifas, { ...f, pax: 25 }).id, 14);
  assert.equal(elegirTarifa(valle.tarifas, { ...f, pax: 1 }), null);          // sin tramo para 1
});

t('temporada alta y baja', () => {
  assert.equal(elegirTarifa(valle.tarifas, { pax: 2, fecha: '2027-07-10', temporada: 'alta' }).id, 22);
  assert.equal(elegirTarifa(valle.tarifas, { pax: 2, fecha: '2027-03-10', temporada: 'baja' }).id, 21);
  // Una específica gana sobre 'todas'.
  const ts = [tar(1, 100, 1, null), tar(2, 200, 1, null, { temporada: 'alta' })];
  assert.equal(elegirTarifa(ts, { pax: 2, fecha: '2027-07-10', temporada: 'alta' }).id, 2);
  assert.equal(elegirTarifa(ts, { pax: 2, fecha: '2027-03-10', temporada: 'baja' }).id, 1);
});

t('vigencia, real antes que de prueba, tramo más angosto', () => {
  const ts = [tar(1, 100, 1, null, { es_ilustrativa: 1 }), tar(2, 200, 1, null), tar(3, 300, 2, 3), tar(4, 400, 1, null, { vigente_desde: '2028-01-01', vigente_hasta: '2028-12-31' })];
  assert.equal(elegirTarifa(ts, { pax: 2, fecha: '2027-03-10', temporada: 'baja' }).id, 3);
  assert.equal(elegirTarifa(ts, { pax: 5, fecha: '2027-03-10', temporada: 'baja' }).id, 2);
  assert.equal(elegirTarifa(ts, { pax: 5, fecha: '2028-03-10', temporada: 'baja' }).id, 4);
  assert.equal(elegirTarifa(ts, { pax: 5, fecha: '2025-03-10', temporada: 'baja' }), null);
});

t('cambio de moneda PEN a USD', () => {
  assert.equal(aUsd(1500, 'PEN', 3.75), 400);          // S/ 15 = US$ 4,00
  assert.equal(aUsd(1000, 'PEN', 3.72), 269);          // S/ 10 / 3,72 = 2,688 -> 2,69
  assert.equal(aUsd(1000, 'USD', 3.72), 1000);
  assert.throws(() => aUsd(1000, 'PEN', 0), /tipo de cambio/);
  assert.throws(() => aUsd(1000, 'EUR', 3.7), /Moneda/);
});

t('margen', () => {
  assert.equal(conMargen(10000, 25), 12500);
  assert.equal(conMargen(2800, 20), 3360);
  assert.equal(conMargen(333, 10), 366);                // 366,3 -> 366
  assert.equal(conMargen(1000, 0), 1000);
});

t('habitaciones por cantidad de pasajeros', () => {
  assert.deepEqual(habitaciones(1), { SGL: 1 });
  assert.deepEqual(habitaciones(2), { DBL: 1 });
  assert.deepEqual(habitaciones(3), { TPL: 1 });
  assert.deepEqual(habitaciones(4), { DBL: 2 });
  assert.deepEqual(habitaciones(5), { TPL: 1, DBL: 1 });
});

const ctx = (pax) => ({ catalogo: CAT, config: CONFIG, pax });

t('línea de servicio: tramo por grupo, margen y moneda', () => {
  const l = precioLinea({ tipo: 'tour', servicio_id: 1, pasajeros: 2, fecha: '2027-03-10' }, ctx(2));
  assert.equal(l.neto_cent, 5600); assert.equal(l.venta_cent, 7000); assert.equal(l.margen_pct, 25); assert.equal(l.problema, null);
  const p = precioLinea({ tipo: 'entrada', servicio_id: 3, pasajeros: 4, fecha: '2027-03-10' }, ctx(4));
  assert.equal(p.neto_cent, 1600); assert.equal(p.venta_cent, 2000); assert.equal(p.moneda, 'PEN');
  const alta = precioLinea({ tipo: 'paquete', servicio_id: 2, pasajeros: 2, fecha: '2027-07-10' }, ctx(2));
  assert.equal(alta.neto_cent, 94600); assert.equal(alta.tarifa_id, 22);
});

t('precio propio (ya es de venta): sin margen', () => {
  const l = precioLinea({ tipo: 'tour', servicio_id: 4, pasajeros: 2, fecha: '2027-03-10' }, ctx(2));
  assert.equal(l.neto_cent, 5400); assert.equal(l.venta_cent, 5400); assert.equal(l.margen_pct, 0);
});

t('sin tarifa y mínimo de pasajeros: problema, no inventa precio', () => {
  const l = precioLinea({ tipo: 'paquete', servicio_id: 2, pasajeros: 1, fecha: '2027-03-10' }, ctx(1));
  assert.match(l.problema, /Sin tarifa para 1/); assert.equal(l.neto_cent, 0);
  const m = precioLinea({ tipo: 'tour', servicio_id: 4, pasajeros: 1, fecha: '2027-03-10' }, ctx(1));
  assert.match(m.problema, /desde 2/);
});

t('hotel: noche por noche, cruzando temporada', () => {
  // 30/05 baja, 31/05 baja, 01/06 alta: 100 + 100 + 130 = 330 por habitación, 2 habitaciones
  const l = precioLinea({ tipo: 'hotel', hotel_id: 50, habitacion: 'DBL', unidades: 2, cantidad: 3, fecha: '2027-05-30' }, ctx(4));
  assert.equal(l.neto_cent, 66000); assert.equal(l.venta_cent, 82500);
  const sinTpl = precioLinea({ tipo: 'hotel', hotel_id: 60, habitacion: 'TPL', unidades: 1, cantidad: 2, fecha: '2027-05-30' }, ctx(3));
  assert.match(sinTpl.problema, /Sin tarifa TPL/);
  assert.equal(precioLinea({ tipo: 'hotel', hotel_id: 60, habitacion: 'DBL', unidades: 1, cantidad: 1, fecha: '2027-05-30' }, ctx(2)).es_ilustrativa, 1);
});

t('precios pisados a mano se respetan', () => {
  const n = precioLinea({ tipo: 'tour', servicio_id: 1, pasajeros: 2, fecha: '2027-03-10', pisado_neto: 1, neto_cent: 5000 }, ctx(2));
  assert.equal(n.neto_cent, 5000); assert.equal(n.venta_cent, 6250);
  const v = precioLinea({ tipo: 'tour', servicio_id: 1, pasajeros: 2, fecha: '2027-03-10', pisado_venta: 1, venta_cent: 9999 }, ctx(2));
  assert.equal(v.neto_cent, 5600); assert.equal(v.venta_cent, 9999);
  const sinTarifa = precioLinea({ tipo: 'paquete', servicio_id: 2, pasajeros: 1, fecha: '2027-03-10', pisado_neto: 1, neto_cent: 50000 }, ctx(1));
  assert.equal(sinTarifa.problema, null); assert.equal(sinTarifa.venta_cent, 62500);
  const margen = precioLinea({ tipo: 'tour', servicio_id: 1, pasajeros: 2, fecha: '2027-03-10', margen_fijo: 10 }, ctx(2));
  assert.equal(margen.venta_cent, 6160);
  const manual = precioLinea({ tipo: 'manual', neto_cent: 2000, descripcion: 'Cena show' }, ctx(2));
  assert.equal(manual.venta_cent, 2500);
});

t('totales, por persona, IGV y tarjeta', () => {
  const ls = [{ neto_cent: 10000, venta_cent: 12500 }, { neto_cent: 5400, venta_cent: 5400, problema: 'x' }];
  const r = totales(ls, { pax: 2, config: CONFIG });
  assert.equal(r.venta_cent, 17900); assert.equal(r.neto_cent, 15400); assert.equal(r.ganancia_cent, 2500);
  assert.equal(r.venta_por_persona_cent, 8950); assert.equal(r.con_factura_cent, 21122); assert.equal(r.con_tarjeta_cent, 18795);
  assert.equal(r.problemas, 1); assert.equal(r.margen_efectivo_pct, 16.2);
});

t('precios de prueba: tarifa de prueba o configuración sin confirmar', () => {
  assert.equal(usaPrueba([{ es_ilustrativa: 1 }], {}), true);
  assert.equal(usaPrueba([{ es_ilustrativa: 0, precio_es_venta: 0 }], { es_prueba: { margen_pct: 1 } }), true);
  assert.equal(usaPrueba([{ es_ilustrativa: 0, precio_es_venta: 1 }], { es_prueba: { margen_pct: 1 } }), false);
  assert.equal(usaPrueba([{ es_ilustrativa: 0, moneda: 'PEN', precio_es_venta: 1 }], { es_prueba: { tc_pen_por_usd: 1 } }), true);
  assert.equal(usaPrueba([{ es_ilustrativa: 0, precio_es_venta: 0 }], { es_prueba: {} }), false);
});

t('borrador automático: hoteles por destino, servicios por día', () => {
  const pedido = { fecha_inicio: '2027-03-01', fecha_fin: '2027-03-05', pasajeros: 2, categoria_hotel: 'confort',
    destinos: [{ ciudad: 'Lima', noches: 1 }, { ciudad: 'Cusco', noches: 3 }], servicios: [3, 1, 2] };
  const { lineas, avisos, dias } = armarBorrador(pedido, CAT);
  assert.equal(dias, 5);
  assert.deepEqual(avisos.filter((a) => /Lima/.test(a) && /hotel/i.test(a)), []);
  const hotel = lineas.filter((l) => l.tipo === 'hotel');
  assert.equal(hotel.length, 2);                                   // Lima (sin hotel cargado) + Cusco
  const cusco = hotel.find((l) => l.hotel_id === 50);              // el real antes que el de prueba
  assert.equal(cusco.dia, 2); assert.equal(cusco.cantidad, 3); assert.equal(cusco.habitacion, 'DBL'); assert.equal(cusco.fecha, '2027-03-02');
  assert.equal(hotel.find((l) => l.hotel_id === null).dia, 1);
  const dia = (id) => lineas.find((l) => l.servicio_id === id).dia;
  assert.equal(dia(3), 2);                                         // Lima: 1 noche, va el día siguiente (el de salida)
  assert.equal(dia(2), 3);                                         // Cusco (llega el 2, se va el 5): el paquete primero, 3 y 4
  assert.equal(lineas.find((l) => l.servicio_id === 2).fecha, sumarDias('2027-03-01', 2));
  assert.equal(dia(1), 4);                                         // no queda día libre: aviso
  assert.ok(avisos.some((x) => /City Tour Cusco no entra/.test(x)));
  assert.ok(avisos.some((x) => /Valle VIP.*1 noche de alojamiento/.test(x)));
  // Solo Cusco, 3 noches (días 1 a 4): paquete 2-3, Humantay no entra (aviso), el city tour de medio día va la tarde de llegada.
  const c = armarBorrador({ ...pedido, destinos: [{ ciudad: 'Cusco', noches: 3 }], servicios: [1, 2, 4] }, CAT);
  const dc = (id) => c.lineas.find((l) => l.servicio_id === id).dia;
  assert.equal(dc(2), 2); assert.equal(dc(4), 3); assert.equal(dc(1), 1);
  assert.ok(c.avisos.some((x) => /Humantay/.test(x) && /no entra/.test(x)));
  assert.ok(!c.lineas.some((l) => l.tipo !== 'hotel' && l.dia === 4));     // el día 4 es de salida
  // Un paquete de 2 días puede terminar el día de salida (Puno 2 noches: días 1 a 3, paquete 2-3).
  const pu = armarBorrador({ ...pedido, destinos: [{ ciudad: 'Cusco', noches: 2 }], servicios: [2] }, CAT);
  assert.equal(pu.lineas.find((l) => l.servicio_id === 2).dia, 2);
  assert.ok(!pu.avisos.some((x) => /no entra/.test(x)));
  const precio = lineas.map((l) => precioLinea(l, ctx(2)));
  assert.match(precio.find((l) => l.tipo === 'hotel' && !l.hotel_id).problema, /Falta elegir el hotel/);
});

t('borrador: avisos de fechas, servicio fuera de destino y sin fecha', () => {
  const a = armarBorrador({ fecha_inicio: '2027-03-01', fecha_fin: '2027-03-10', pasajeros: 2, categoria_hotel: 'sin_hotel', destinos: [{ ciudad: 'Cusco', noches: 2 }], servicios: [3] }, CAT);
  assert.ok(a.avisos.some((x) => /10 días/.test(x)));
  assert.ok(a.avisos.some((x) => /Lima, que no está/.test(x)));
  assert.equal(a.lineas.filter((l) => l.tipo === 'hotel').length, 0);
  const b = armarBorrador({ pasajeros: 2, destinos: [{ ciudad: 'Cusco', noches: 1 }], servicios: [1] }, CAT);
  assert.ok(b.avisos.some((x) => /fecha de inicio/.test(x)));
  assert.match(precioLinea(b.lineas[0], ctx(2)).problema, /Falta la fecha/);
});

console.log(`${ok} tests ok`);

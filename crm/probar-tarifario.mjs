// Tests del tarifario (lectura de filas, importes, fechas, solapamientos). Correr: node crm/probar-tarifario.mjs
import assert from 'node:assert/strict';
import { aCentavos, aFecha, leerFila, revisarArchivo, solapan, claveServicio, normalizar } from '../functions/_lib/tarifario.js';

let ok = 0;
const t = (nombre, fn) => { try { fn(); ok++; } catch (e) { console.error('FALLA:', nombre, '\n ', e.message); process.exitCode = 1; } };

t('importes en distintos formatos', () => {
  assert.equal(aCentavos('45'), 4500);
  assert.equal(aCentavos('45,5'), 4550);
  assert.equal(aCentavos('45.50'), 4550);
  assert.equal(aCentavos('1.234,50'), 123450);
  assert.equal(aCentavos('1,234.50'), 123450);
  assert.equal(aCentavos('1,234'), 123400);
  assert.equal(aCentavos('1.234'), 123400);
  assert.equal(aCentavos('US$ 70'), 7000);
  assert.equal(aCentavos('S/ 15'), 1500);
  assert.equal(aCentavos(12.345), 1235);
  assert.equal(aCentavos('abc'), null);
  assert.equal(aCentavos('-5'), null);
  assert.equal(aCentavos(''), null);
});

t('fechas', () => {
  assert.equal(aFecha('2026-11-01'), '2026-11-01');
  assert.equal(aFecha('01/11/2026'), '2026-11-01');
  assert.equal(aFecha('1/11/26'), '2026-11-01');
  assert.equal(aFecha('31/02/2026'), null);
  assert.equal(aFecha(46327), '2026-11-01');          // serie de Excel
  assert.equal(aFecha('mañana'), null);
});

t('normalizar y claves', () => {
  assert.equal(normalizar('Montaña de 7 Colores'), 'montana-de-7-colores');
  assert.equal(claveServicio('tour', 'Cusco ', 'City  Tour Cusco'), 'tour|cusco|city-tour-cusco');
});

const base = { tipo: 'tour', nombre: 'City Tour Cusco', ciudad: 'Cusco', precio_neto: '28', moneda: 'usd', pax_desde: 2, pax_hasta: 3, vigente_desde: '2026-11-01', vigente_hasta: '31/03/2027' };

t('fila de servicio válida', () => {
  const { errores, d } = leerFila(base);
  assert.deepEqual(errores, []);
  assert.equal(d.clase, 'servicio');
  assert.equal(d.neto_cent, 2800);
  assert.equal(d.moneda, 'USD');
  assert.equal(d.temporada, 'todas');
  assert.equal(d.vigente_hasta, '2027-03-31');
  assert.equal(d.pax_desde, 2); assert.equal(d.pax_hasta, 3);
});

t('encabezados con mayúsculas, tildes y alias', () => {
  const { errores, d } = leerFila({ 'Tipo': 'Tour', 'Servicio': 'City Tour Cusco', 'Ciudad': 'Cusco', 'Precio': '28', 'Moneda': 'USD', 'Tramo': '7+', 'Desde': '2026-11-01', 'Hasta': '2027-03-31', 'Temporada': 'Alta' });
  assert.deepEqual(errores, []);
  assert.equal(d.pax_desde, 7); assert.equal(d.pax_hasta, null); assert.equal(d.temporada, 'alta');
});

t('tramos de pasajeros', () => {
  const p = (tramo) => leerFila({ ...base, pax_desde: undefined, pax_hasta: undefined, tramo_pax: tramo }).d;
  assert.deepEqual([p('1').pax_desde, p('1').pax_hasta], [1, 1]);
  assert.deepEqual([p('2-3').pax_desde, p('2-3').pax_hasta], [2, 3]);
  assert.deepEqual([p('4 a 6').pax_desde, p('4 a 6').pax_hasta], [4, 6]);
  assert.deepEqual([p('7 o más').pax_desde, p('7 o más').pax_hasta], [7, null]);
  assert.ok(leerFila({ ...base, pax_desde: undefined, pax_hasta: undefined, tramo_pax: 'varios' }).errores.length);
  const q = leerFila({ ...base, pax_desde: '7+', pax_hasta: '' });                  // tramo escrito en pax_desde
  assert.deepEqual([q.errores, q.d.pax_desde, q.d.pax_hasta], [[], 7, null]);
});

t('errores por fila', () => {
  const e = (cambio) => leerFila({ ...base, ...cambio }).errores.join(' | ');
  assert.match(e({ tipo: 'crucero' }), /tipo "crucero" no existe/);
  assert.match(e({ precio_neto: 'consultar' }), /no es un número/);
  assert.match(e({ precio_neto: '' }), /falta el precio/);
  assert.match(e({ moneda: 'EUR' }), /moneda "EUR"/);
  assert.match(e({ vigente_hasta: '2026-10-01' }), /anterior/);
  assert.match(e({ pax_desde: 4, pax_hasta: 2 }), /menor que pax_desde/);
  assert.match(e({ temporada: 'media' }), /temporada "media"/);
  assert.match(e({ ciudad: '' }), /falta la ciudad/);
});

t('fila de hotel', () => {
  const { errores, d } = leerFila({ tipo: 'Hotel', nombre: 'Hotel X', ciudad: 'Cusco', categoria_hotel: 'Confort', habitacion: 'doble', precio_neto: '95', moneda: 'USD', vigente_desde: '2026-11-01', vigente_hasta: '2027-03-31' });
  assert.deepEqual(errores, []);
  assert.equal(d.clase, 'hotel'); assert.equal(d.categoria, 'confort'); assert.equal(d.habitacion, 'DBL');
  assert.match(leerFila({ tipo: 'hotel', nombre: 'H', ciudad: 'Cusco', categoria_hotel: 'boutique', habitacion: 'suite', precio_neto: 1, moneda: 'USD', vigente_desde: '2026-01-01', vigente_hasta: '2026-12-31' }).errores.join(), /categoria_hotel.*habitacion/);
});

t('solapamientos', () => {
  const a = leerFila(base).d;
  assert.ok(solapan(a, leerFila({ ...base, pax_desde: 3, pax_hasta: 5 }).d));               // tramo 3 en común
  assert.ok(!solapan(a, leerFila({ ...base, pax_desde: 4, pax_hasta: 6 }).d));
  assert.ok(!solapan(a, leerFila({ ...base, vigente_desde: '2027-04-01', vigente_hasta: '2027-12-31' }).d));
  assert.ok(solapan(a, leerFila({ ...base, temporada: 'alta' }).d));                         // 'todas' cubre alta
  const alta = leerFila({ ...base, temporada: 'alta' }).d, baja = leerFila({ ...base, temporada: 'baja' }).d;
  assert.ok(!solapan(alta, baja));
  assert.ok(!solapan(a, leerFila({ ...base, nombre: 'Otro tour' }).d));
});

t('revisar archivo: duplicados, existentes, de prueba y filas vacías', () => {
  const existente = { ...leerFila({ ...base, pax_desde: 4, pax_hasta: 6 }).d, id: 9, es_ilustrativa: 0 };
  const prueba = { ...leerFila(base).d, id: 10, es_ilustrativa: 1 };
  const r = revisarArchivo([
    base,                                                       // fila 2: ok (convive con la de prueba)
    { ...base, pax_desde: 3, pax_hasta: 3 },                    // fila 3: se pisa con la 2
    {},                                                         // fila 4: vacía, se saltea
    { ...base, pax_desde: 5, pax_hasta: 8 },                    // fila 5: choca con la existente real
    { ...base, moneda: '' },                                    // fila 6: falta moneda
  ], [existente, prueba]);
  assert.equal(r.resumen.total, 4);
  assert.equal(r.resumen.ok, 1);
  const n = (k) => r.filas.find((f) => f.n === k);
  assert.match(n(2).avisos.join(), /tarifa de prueba/);
  assert.match(n(3).errores.join(), /fila 2/);
  assert.match(n(5).errores.join(), /cerrá su vigencia/);
  assert.match(n(6).errores.join(), /moneda/);
  // Reemplazando las de prueba, el aviso desaparece.
  const r2 = revisarArchivo([base], [prueba], { reemplazarIlustrativas: true });
  assert.deepEqual(r2.filas[0].avisos, []);
  assert.match(revisarArchivo(new Array(2001).fill(base)).error, /máximo/);
});

console.log(`${ok} tests ok`);

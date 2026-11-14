// Pruebas del armado automático (ct-armado.js). Uso: node crm/probar-armado.mjs
import assert from 'node:assert/strict';
import { armarBorrador, descontarNochesIncluidas } from '../functions/_lib/cotizar.js';
import { armarItinerario, indexarReglas, recortar, paqueteExacto, validarItinerario, tramosDe, candidatosDe, resolverExcursiones, destinosDePaquete } from '../functions/_lib/ct-armado.js';

let n = 0;
const test = async (nombre, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };

const reglas = indexarReglas([
  ...[['Lima', 155], ['Cusco', 3400], ['Puno', 3830], ['Arequipa', 2335]].map(([clave, h]) => ({ tipo: 'ciudad', clave, datos: JSON.stringify({ altura_m: h }), es_prueba: 1 })),
  { tipo: 'conexion', clave: 'Cusco>Puno', datos: '{"horas":8,"dia_completo":true}', es_prueba: 1 },
  { tipo: 'conexion', clave: 'Lima>Cusco', datos: '{"horas":1.5,"dia_completo":false}', es_prueba: 1 },
  { tipo: 'aclimatacion', clave: 'general', datos: '{"altura_aviso_m":3000,"salto_aviso_m":2000,"dia_completo_primer_dia":false}', es_prueba: 1 },
]);
const tarifa = (extra = {}) => ({ id: 1, pax_desde: 1, pax_hasta: null, temporada: 'todas', neto_cent: 3000, moneda: 'USD', vigente_desde: '2027-01-01', vigente_hasta: '2027-12-31', es_ilustrativa: 0, ...extra });
const hotel = (id, ciudad) => ({ id, nombre: `Hotel ${ciudad}`, ciudad, categoria: 'confort', activo: 1, precio_es_venta: 1, es_ilustrativo: 0, tarifas: ['SGL', 'DBL', 'TPL'].map((h, i) => tarifa({ id: id * 10 + i, habitacion: h })) });
const servicio = (id, nombre, ciudad, extra = {}) => ({ id, nombre, ciudad, tipo: 'tour', duracion: 'Medio día', pax_min: 1, activo: 1, precio_es_venta: 0, web_id: null, tarifas: [tarifa({ id: 100 + id })], ...extra });
const tour = (id, nombre, base, extra = {}) => ({ id, tipo: 'tour', nombre, zona: base, ciudades: [base], ciudad_base: base, dias: 1, noches: 0, precio_web_cent: 4000, resumen: '', dias_detalle: [], ...extra });
const paquete = (id, nombre, ciudades, dias, precio) => ({ id, tipo: 'paquete', nombre, zona: ciudades.join(' y '), ciudades, ciudad_base: ciudades[0], dias, noches: dias - 1, precio_web_cent: precio,
  dias_detalle: Array.from({ length: dias }, (_, i) => ({ dia: i + 1, ciudad: ciudades[Math.min(ciudades.length - 1, Math.floor(i / Math.ceil(dias / ciudades.length)))], titulo: `Día ${i + 1}`, relato: 'x', foto: '' })) });

const catalogo = {
  hoteles: [hotel(1, 'Cusco'), hotel(2, 'Lima'), hotel(3, 'Puno')],
  servicios: [servicio(1, 'City Tour Cusco', 'Cusco', { web_id: 'city-tour' }), servicio(2, 'Circuito Mágico del Agua', 'Lima', { tipo: 'entrada' })],
};
const web = [
  tour('city-tour', 'City Tour', 'Cusco'), tour('laguna-humantay', 'Laguna Humantay', 'Cusco', { precio_web_cent: 7500 }),
  tour('montana-de-colores', 'Montaña de Colores', 'Cusco', { precio_web_cent: 6800 }), tour('maras', 'Maras y Moray', 'Cusco', { precio_web_cent: 5500 }),
  tour('retiro-de-ayahuasca', 'Retiro de Ayahuasca', 'Cusco', { precio_web_cent: 30000 }),
  tour('mapi-2d-1n', 'Machu Picchu 2D/1N', 'Cusco', { dias: 2, noches: 1, precio_web_cent: 33000 }),
  paquete('6d5n-ruta-del-sol', 'Cusco y Puno: Ruta del Sol', ['Cusco', 'Puno'], 6, 50500),
];
const pedido = (extra = {}) => ({ pasajeros: 2, fecha_inicio: '2027-02-10', categoria_hotel: 'confort', servicios: [], destinos: [{ ciudad: 'Cusco', noches: 4 }], ...extra });
const armar = (p, elegir = null) => armarItinerario({ pedido: p, catalogo, web, reglas, elegir });
const nochesHotel = (v) => v.lineas.filter((l) => l.tipo === 'hotel' && l.habitacion === 'DBL').reduce((s, l) => s + l.cantidad, 0);

await test('paquete tal cual: mismas ciudades y días -> una variante, precio web x pasajeros y días de la ficha', async () => {
  const r = await armar(pedido({ dias: 6, destinos: [{ ciudad: 'Cusco', noches: 3 }, { ciudad: 'Puno', noches: 2 }] }));
  assert.equal(r.variantes.length, 1);
  const v = r.variantes[0];
  assert.equal(v.variante, null); assert.equal(v.precio_modo, 'paquete_web'); assert.equal(v.paquete_web_id, '6d5n-ruta-del-sol');
  assert.equal(v.paquete_web_cent, 50500 * 2);
  assert.equal(v.lineas.filter((l) => l.web_dia).length, 6);
  assert.ok(v.lineas.some((l) => l.tipo === 'hotel'));
  assert.ok(!v.avisos.some((a) => /veces en el itinerario|lleva el día/.test(a)), v.avisos.join('|'));
});
await test('paquete: no se usa si el cliente pidió servicios sueltos o los días no coinciden', async () => {
  assert.equal(paqueteExacto({ destinos: [{ ciudad: 'cusco' }, { ciudad: 'PUNO' }], dias: 6, web }).id, '6d5n-ruta-del-sol');
  assert.equal(paqueteExacto({ destinos: [{ ciudad: 'Cusco' }, { ciudad: 'Puno' }], dias: 7, web }), null);
  const r = await armar(pedido({ dias: 6, servicios: [1], destinos: [{ ciudad: 'Cusco', noches: 3 }, { ciudad: 'Puno', noches: 2 }] }));
  assert.equal(r.variantes[0].precio_modo, 'componentes');
});
await test('a medida que encaja: hoteles + tours en días libres; tarifario primero, web sin confirmar', async () => {
  const r = await armar(pedido({ dias: 5 }));
  assert.equal(r.variantes.length, 1);
  const v = r.variantes[0];
  assert.equal(v.variante, null); assert.equal(v.precio_modo, 'componentes');
  const tours = v.lineas.filter((l) => l.tipo !== 'hotel');
  assert.deepEqual(tours.map((l) => l.dia), [2, 3, 4]);             // días 2, 3 y 4 de 5
  assert.equal(tours[0].servicio_id, 1);                           // el City Tour tiene tarifa propia: va primero
  assert.ok(tours.slice(1).every((l) => l.origen_precio === 'web' && l.sin_confirmar === 1 && l.precio_es_venta === 1));
  assert.equal(tours[1].venta_cent, tours[1].neto_cent);
  assert.ok(!tours.some((l) => /ayahuasca/i.test(l.descripcion)), 'lo espiritual no se arma solo');
  assert.ok(tours.every((l) => !l.es_ilustrativa));
  assert.equal(v.lineas.find((l) => l.tipo === 'hotel').dia, 1);
});
await test('el primer día en altura no lleva tours y el aviso de aclimatación salta si se fuerza uno', async () => {
  const v = (await armar(pedido({ dias: 5 }))).variantes[0];
  assert.ok(!v.lineas.some((l) => l.dia === 1 && l.tipo !== 'hotel'));
  const { tramos } = tramosDe([{ ciudad: 'Lima', noches: 2 }, { ciudad: 'Cusco', noches: 3 }]);
  const av = validarItinerario({ tramos, reglas, lineas: [{ dia: 3, descripcion: 'Laguna Humantay', tipo: 'manual', origen_precio: 'web' }] });
  assert.ok(av.some((a) => /Día 3: llega a Cusco/.test(a)), av.join('|'));
  assert.ok(av.some((a) => /Álvaro todavía no las validó/.test(a)));
});
await test('traslado de día completo: avisa si hay un tour ese día, no bloquea', async () => {
  const { tramos } = tramosDe([{ ciudad: 'Cusco', noches: 3 }, { ciudad: 'Puno', noches: 2 }]);
  const av = validarItinerario({ tramos, reglas, lineas: [{ dia: 4, descripcion: 'Maras', tipo: 'manual', origen_precio: 'web' }] });
  assert.ok(av.some((a) => /traslado Cusco → Puno lleva el día/.test(a)), av.join('|'));
  assert.ok(validarItinerario({ tramos: tramosDe([{ ciudad: 'Cusco', noches: 2 }, { ciudad: 'Arequipa', noches: 1 }]).tramos, reglas, lineas: [] }).some((a) => /No hay regla de traslado Cusco → Arequipa/.test(a)));
});
await test('días que no alcanzan: A recorta, B arma lo pedido y explica', async () => {
  const r = await armar(pedido({ dias: 5, destinos: [{ ciudad: 'Cusco', noches: 4 }, { ciudad: 'Puno', noches: 3 }] }));
  assert.equal(r.variantes.length, 2);
  const [a, b] = r.variantes;
  assert.equal(a.variante, 'A'); assert.equal(b.variante, 'B');
  assert.equal(nochesHotel(a), 4);                                  // 5 días = 4 noches
  assert.equal(nochesHotel(b), 7);                                  // lo que pidió
  assert.ok(a.avisos.some((x) => /Respeta los 5 días/.test(x)));
  assert.ok(b.avisos.some((x) => /no entra en 5 días/.test(x)));
});
await test('recortar: mínimo 1 noche por destino y saca destinos del final si hace falta', () => {
  const r = recortar([{ ciudad: 'Lima', noches: 2 }, { ciudad: 'Cusco', noches: 4 }, { ciudad: 'Puno', noches: 3 }], 5);
  assert.equal(r.destinos.reduce((s, d) => s + d.noches, 0), 4);
  assert.ok(r.avisos.length);
  const justo = recortar([{ ciudad: 'Lima', noches: 1 }, { ciudad: 'Cusco', noches: 1 }, { ciudad: 'Puno', noches: 1 }], 2);
  assert.equal(justo.destinos.length, 1); assert.ok(justo.avisos.some((a) => /Se sacó Puno/.test(a)));
});
await test('días de más: se suman al último destino y se avisa', async () => {
  const v = (await armar(pedido({ dias: 7 }))).variantes[0];
  assert.equal(nochesHotel(v), 6);
  assert.ok(v.avisos.some((a) => /se sumaron 2 noches en Cusco/.test(a)));
});
await test('destino que la web no tiene: ilustración sin precio, marcada, sin hotel', async () => {
  const r = await armar(pedido({ dias: 6, destinos: [{ ciudad: 'Cusco', noches: 3 }, { ciudad: 'Chiclayo', noches: 2 }] }));
  const v = r.variantes[0];
  const ilus = v.lineas.filter((l) => l.es_ilustrativa);
  assert.equal(ilus.length, 1);
  assert.equal(ilus[0].origen_precio, 'ilustrativa'); assert.equal(ilus[0].venta_cent, 0); assert.equal(ilus[0].dia, 4);
  assert.ok(!v.lineas.some((l) => l.tipo === 'hotel' && l.dia === 4));
  assert.ok(v.lineas.some((l) => l.tipo === 'hotel' && l.dia === 1), 'Cusco sí lleva hotel');
  assert.ok(v.avisos.some((a) => /Chiclayo no está en la web ni en el tarifario/.test(a)));
});
await test('un tour "a consultar" no se arma antes que uno con precio', async () => {
  const sinPrecio = [tour('a-consultar', 'Aaa a consultar', 'Cusco', { precio_web_cent: null }), tour('con-precio', 'Zzz con precio', 'Cusco', { precio_web_cent: 5000 })];
  const r = await armarItinerario({ pedido: pedido({ dias: 8, destinos: [{ ciudad: 'Cusco', noches: 7 }] }), catalogo: { ...catalogo, servicios: [] }, web: sinPrecio, reglas });
  const tours = r.variantes[0].lineas.filter((l) => l.tipo !== 'hotel');
  assert.equal(tours[0].descripcion, 'Zzz con precio');
});
await test('IA: lo que propone se valida (clave inexistente, repetida o que no entra se descarta) y se completa con el armado base', async () => {
  const elegir = async ({ slots }) => ({ [slots[0].id]: 'w:laguna-humantay', [slots[1].id]: 'w:laguna-humantay', [slots[2].id]: 'w:no-existe' });
  const v = (await armar(pedido({ dias: 5 }), elegir)).variantes[0];
  const tours = v.lineas.filter((l) => l.tipo !== 'hotel');
  assert.equal(tours[0].descripcion, 'Laguna Humantay');
  assert.equal(tours.filter((l) => l.descripcion === 'Laguna Humantay').length, 1);
  assert.equal(tours.length, 3);
});
await test('IA caída: se arma igual y queda el aviso', async () => {
  const v = (await armar(pedido({ dias: 5 }), async () => { throw new Error('sin cupo'); })).variantes[0];
  assert.equal(v.lineas.filter((l) => l.tipo !== 'hotel').length, 3);
  assert.ok(v.avisos.some((a) => /La IA no pudo elegir/.test(a)));
});
await test('IA: nunca recibe precios', async () => {
  let visto = '';
  await armar(pedido({ dias: 5 }), async (x) => { visto = JSON.stringify(x); return {}; });
  assert.ok(visto.length > 50);
  assert.ok(!/precio|neto|venta|cent|usd/i.test(visto), visto.slice(0, 300));
});
await test('candidatosDe: multi-día, el servicio unido a la web trae su ficha y el tour con tarifa no se repite', () => {
  const c = candidatosDe({ catalogo, web });
  assert.equal(c.find((x) => x.clave === 'w:mapi-2d-1n').dias, 2);
  assert.ok(c.find((x) => x.clave === 's1').producto);
  assert.ok(!c.some((x) => x.clave === 'w:city-tour'));
});
await test('destinosDePaquete: noches por ciudad según los días de la ficha', () => {
  const d = destinosDePaquete(web.find((p) => p.id === '6d5n-ruta-del-sol'));
  assert.equal(d.reduce((s, x) => s + x.noches, 0), 5);
});
await test('noches_incluidas: Colca 2D/1N descuenta 1 noche del hotel de Arequipa; el full day no descuenta', () => {
  const cat = { hoteles: [hotel(9, 'Arequipa')], servicios: [servicio(20, 'Cañón del Colca 2D/1N', 'Arequipa', { duracion: '2D/1N', noches_incluidas: 1 }), servicio(21, 'Colca full day', 'Arequipa', { duracion: '1D' })] };
  const ped = { pasajeros: 2, fecha_inicio: '2027-02-10', categoria_hotel: 'confort', destinos: [{ ciudad: 'Arequipa', noches: 3 }] };
  const noches = (r) => r.lineas.filter((l) => l.tipo === 'hotel' && l.habitacion === 'DBL').reduce((s, l) => s + l.cantidad, 0);
  const sin = armarBorrador({ ...ped, servicios: [21] }, cat);
  assert.equal(noches(sin), 3);
  const con = armarBorrador({ ...ped, servicios: [20] }, cat);
  assert.equal(noches(con), 2);
  assert.ok(con.lineas.filter((l) => l.tipo === 'hotel').every((l) => /× 2 noches/.test(l.descripcion)), JSON.stringify(con.lineas.map((l) => l.descripcion)));
  assert.ok(con.avisos.some((a) => /se descontó del hotel de Arequipa/.test(a)), con.avisos.join('|'));
  assert.ok(!con.avisos.some((a) => /revisá que no se cobre doble/.test(a)));
});
await test('noches_incluidas: no baja de 0 y quita las líneas de hotel vacías', () => {
  const cat = { servicios: [servicio(20, 'Colca', 'Arequipa', { noches_incluidas: 3 })] };
  const lineas = [{ tipo: 'hotel', dia: 1, cantidad: 1, descripcion: 'H · 1 hab. × 1 noche' }, { tipo: 'tour', dia: 2, servicio_id: 20 }];
  descontarNochesIncluidas(lineas, cat, [{ ciudad: 'Arequipa', noches: 1, desde: 1, hasta: 2 }]);
  assert.equal(lineas.filter((l) => l.tipo === 'hotel').length, 0);
});
await test('excursiones: Colca va en un día libre de Arequipa aunque no sea destino con noches; la que no existe avisa', async () => {
  const cat = { hoteles: [hotel(9, 'Arequipa'), hotel(1, 'Cusco')], servicios: [] };
  const w = [tour('canon-del-colca', 'Cañón del Colca', 'Arequipa', { dias: 2, noches: 1 }), tour('city-arequipa', 'City Tour Arequipa', 'Arequipa'), tour('x', 'Otro', 'Cusco')];
  const ped = { pasajeros: 2, dias: 5, fecha_inicio: '2027-02-10', categoria_hotel: 'confort', servicios: [], destinos: [{ ciudad: 'Cusco', noches: 1 }, { ciudad: 'Arequipa', noches: 3 }], excursiones: ['Cañón del Colca', 'Cueva de Cristal'] };
  const r = await armarItinerario({ pedido: ped, catalogo: cat, web: w, reglas, elegir: async () => ({}) });
  const v = r.variantes[0];
  const colca = v.lineas.find((l) => /Colca/.test(l.descripcion));
  assert.ok(colca, JSON.stringify(v.lineas.map((l) => l.descripcion)));
  assert.ok(v.avisos.some((a) => /Cueva de Cristal/.test(a)), v.avisos.join('|'));
  const c = await armarItinerario({ pedido: { ...ped, excursiones: [] }, catalogo: cat, web: w, reglas, elegir: async () => ({}) });
  assert.ok(!c.variantes[0].avisos.some((a) => /Cueva/.test(a)));
});
await test('resolverExcursiones: "Lago Titicaca" encuentra el tour por el resumen y no confunde ciudades', () => {
  const cands = candidatosDe({ catalogo: { hoteles: [], servicios: [] }, web: [tour('puno-2d', 'Puno 2D/1N', 'Puno', { dias: 2, noches: 1, resumen: 'Uros y Taquile en el Lago Titicaca' }), tour('city', 'City Tour Cusco', 'Cusco')] });
  const r = resolverExcursiones(['Lago Titicaca', 'Machu Picchu'], cands);
  assert.equal(r.forzadas.length, 1); assert.equal(r.forzadas[0].nombre, 'Puno 2D/1N');
  assert.equal(r.avisos.length, 1);
});
await test('excursiones: un servicio cargado sin tarifa se ubica igual (la línea queda sin precio) pero no entra solo', async () => {
  const cat = { hoteles: [hotel(9, 'Arequipa')], servicios: [servicio(30, 'Cañón del Colca (full day)', 'Arequipa', { duracion: '1D', tarifas: [] })] };
  const ped = { pasajeros: 2, dias: 4, fecha_inicio: '2027-02-10', categoria_hotel: 'confort', servicios: [], destinos: [{ ciudad: 'Arequipa', noches: 3 }] };
  const con = await armarItinerario({ pedido: { ...ped, excursiones: ['Cañón del Colca'] }, catalogo: cat, web: [tour('x', 'Otro', 'Arequipa')], reglas, elegir: async () => ({}) });
  assert.ok(con.variantes[0].lineas.some((l) => l.servicio_id === 30), JSON.stringify(con.variantes[0].lineas.map((l) => l.descripcion)));
  const sin = await armarItinerario({ pedido: ped, catalogo: cat, web: [tour('x', 'Otro', 'Arequipa')], reglas, elegir: async () => ({}) });
  assert.ok(!sin.variantes[0].lineas.some((l) => l.servicio_id === 30));
});
console.log(`${n} tests ok`);

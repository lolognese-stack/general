// Pruebas del armado de la propuesta desde la cotización (ct-propuesta-datos.js). Uso: node crm/probar-propuesta-datos.mjs
import assert from 'node:assert/strict';
import { armarDatos, bloqueosDe, bandaDe, validarTextos, aplicarCambios, slugDe, datosParaIA, FOTO_RESPALDO } from '../functions/_lib/ct-propuesta-datos.js';
import { renderPagina } from '../functions/_lib/propuesta-pagina.js';

let n = 0;
const test = async (nombre, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };
const clonar = (o) => JSON.parse(JSON.stringify(o));

const linea = (x) => ({ tipo: 'tour', cantidad: 1, unidades: 1, neto_cent: 1234, venta_cent: 5000, nota: 'NOTA INTERNA: margen 40% con el proveedor X', ...x });
const vistaBase = () => ({
  cotizacion: { id: 11, version: 2, estado: 'aprobada', usa_prueba: 0, aprobada_por: 'Álvaro', aprobada_en: '2026-11-13' },
  pedido: { id: 7, nombre: 'Ana Pérez', pais: 'Argentina', pasajeros: 2, fecha_inicio: '2027-03-10', fecha_fin: '2027-03-15', fecha_tentativa: 0, dias: 6, lead_id: 5, conversacion_id: 9,
    destinos: [{ ciudad: 'Cusco', noches: 3 }, { ciudad: 'Puno', noches: 2 }] },
  lineas: [
    linea({ tipo: 'hotel', dia: 1, descripcion: 'Hotel Plaza Cusco · doble', hotel_id: 1, cantidad: 3, habitacion: 'DBL', venta_cent: 30000 }),
    linea({ tipo: 'tour', dia: 2, descripcion: 'City Tour Cusco', servicio_id: 1, venta_cent: 6000 }),
    linea({ tipo: 'tour', dia: 3, descripcion: 'Machu Picchu 2D/1N', web_producto_id: 'machu', web_dia: 1, venta_cent: 25000, origen_precio: 'web' }),
    linea({ tipo: 'hotel', dia: 4, descripcion: 'Hotel Lago Puno · doble', hotel_id: 2, cantidad: 2, habitacion: 'DBL', venta_cent: 16000 }),
    linea({ tipo: 'tour', dia: 5, descripcion: 'Uros y Taquile', servicio_id: 2, venta_cent: 7000 }),
  ],
  totales: { modo: 'componentes', venta_cent: 84000, problemas: 0 },
  pendientes: { ilustrativas: 0, sin_confirmar: 0, paquete_web: 0, total: 0 },
});
const catalogo = { hoteles: [{ id: 1, nombre: 'Hotel Plaza Cusco', categoria: 'confort' }, { id: 2, nombre: 'Hotel Lago Puno', categoria: 'confort' }],
  servicios: [{ id: 1, nombre: 'City Tour Cusco', incluye: 'Guía y transporte', no_incluye: 'Propinas' }, { id: 2, nombre: 'Uros y Taquile', incluye: 'Lancha', no_incluye: '', web_id: 'uros' }] };
const web = [
  { id: 'machu', tipo: 'tour', ciudad_base: 'Cusco', fotos: JSON.stringify(['https://x.test/machu1.jpg']), incluye: JSON.stringify(['Entrada a Machu Picchu', 'Tren']), resumen: '', dias_detalle: [{ dia: 1, relato: 'Subes a la ciudadela con tu guía.', foto: 'https://x.test/machu-dia.jpg' }] },
  { id: 'uros', tipo: 'tour', ciudad_base: 'Puno', fotos: JSON.stringify(['https://x.test/uros.jpg']), incluye: '[]', resumen: 'Navegas hasta las islas flotantes.', dias_detalle: [] },
];
const armar = (v = vistaBase(), extra = {}) => armarDatos({ vista: v, catalogo, web, hoy: '2026-11-13', ...extra });

await test('arma días, capítulos, hoteles y ciudades desde la cotización', () => {
  const d = armar();
  assert.equal(d.viaje.dias, 6);
  assert.equal(d.flujo.filter((x) => x.t === 'dia').length, 6);
  assert.equal(d.flujo.filter((x) => x.t === 'cap').length, 2);
  assert.equal(d.flujo.filter((x) => x.t === 'hotel').length, 2);
  assert.deepEqual(d.ciudades.map((c) => [c.nombre, c.noches, c.hotel]), [['Cusco', 3, 'Hotel Plaza Cusco'], ['Puno', 2, 'Hotel Lago Puno']]);
  const dias = d.flujo.filter((x) => x.t === 'dia');
  assert.deepEqual(dias.map((x) => x.kind), ['llegada', 'principal', 'principal', 'libre', 'principal', 'regreso']);
  assert.equal(dias[0].label, 'DÍA 01 · MIÉ 10 MAR');
  assert.equal(d.viaje.fechas, '10 mar — 15 mar');
});

await test('el precio sale de venta, por persona, y suma alojamiento + tours', () => {
  const d = armar();
  assert.equal(d.precio.totalPP, 420);
  assert.equal(d.precio.filas.length, 2);
  assert.equal(d.precio.filas[0].montoPP, 230);
  assert.equal(d.precio.filas[1].montoPP, 190);
  assert.equal(d.precio.filas[0].montoPP + d.precio.filas[1].montoPP, d.precio.totalPP);
});

await test('con precio de paquete: una sola fila y el total del paquete', () => {
  const v = vistaBase(); v.totales = { modo: 'paquete_web', venta_cent: 100000, problemas: 0 };
  const d = armar(v);
  assert.equal(d.precio.totalPP, 500);
  assert.equal(d.precio.filas.length, 1);
  assert.equal(d.precio.filas[0].montoPP, 500);
});

await test('fecha tentativa: queda marcada en las fechas de la propuesta', () => {
  const v = vistaBase(); v.pedido.fecha_tentativa = 1;
  assert.ok(armar(v).viaje.fechas.includes('tentativas'));
  assert.ok(armar(v).viaje.tentativa);
});

await test('fotos: de la ficha del tour; si no hay, las de la ciudad; nunca vacías', () => {
  const d = armar();
  const dias = d.flujo.filter((x) => x.t === 'dia');
  assert.equal(dias[2].foto, 'https://x.test/machu-dia.jpg');
  assert.equal(dias[4].foto, 'https://x.test/uros.jpg');
  for (const x of d.flujo) if (x.foto !== undefined) assert.ok(/^https:\/\//.test(x.foto), x.foto);
  const sinWeb = armarDatos({ vista: vistaBase(), catalogo, web: [], hoy: '2026-11-13' });
  assert.ok(sinWeb.flujo.filter((x) => x.foto !== undefined).every((x) => x.foto === FOTO_RESPALDO));
});

await test('el texto base del día sale de la ficha de la web', () => {
  const d = armar();
  const dias = d.flujo.filter((x) => x.t === 'dia');
  assert.ok(dias[2].relato.includes('Subes a la ciudadela'));
  assert.ok(dias[4].relato.includes('islas flotantes'));
  assert.equal(dias[3].titulo, 'Día libre');
  assert.equal(dias[5].titulo, 'Regreso');
});

await test('lo interno no llega a datos_json ni a la página: netos, notas, márgenes', () => {
  const d = armar();
  const todo = JSON.stringify(d) + renderPagina(d, { slug: 'ana-abc123', hoy: '2026-11-13' });
  assert.ok(!/NOTA INTERNA|proveedor X|1234|12\.34|neto_cent|margen_fijo/i.test(todo.replace(/<script id="venta-datos"[\s\S]*?<\/script>/, '')));
});

await test('la página armada con datos reales se dibuja completa', () => {
  const h = renderPagina(armar(), { slug: 'ana-abc123', hoy: '2026-11-13' });
  for (const id of ['recorrido', 'itinerario', 'incluye', 'autoridad', 'inversion', 'reserva', 'confianza', 'preguntas']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('Ana, Perú te está esperando.'));
  assert.ok(h.includes('Hotel Plaza Cusco'));
  assert.equal((h.match(/class="day day--/g) || []).length, 6);
});

await test('bloqueos: sin aprobar, de prueba, precios web sin confirmar, ilustraciones, paquete, versión vieja', () => {
  assert.deepEqual(bloqueosDe(vistaBase()), []);
  const v = vistaBase();
  v.cotizacion.estado = 'borrador'; v.cotizacion.usa_prueba = 1; v.totales.problemas = 1;
  v.pendientes = { ilustrativas: 1, sin_confirmar: 2, paquete_web: 1, total: 4 };
  const b = bloqueosDe(v, { vigente: false });
  assert.equal(b.length, 7);
  assert.ok(/PRECIOS DE PRUEBA/.test(bandaDe(b)));
  assert.equal(bandaDe([]), null);
  assert.ok(/^BORRADOR/.test(bandaDe(['La cotización no está aprobada'])));
});

await test('validarTextos: descarta precios, días que no existen y ciudades ajenas', () => {
  const d = armar();
  const t = validarTextos({
    recorrido: 'Un viaje por Cusco y Puno.',
    ciudades: [{ nombre: 'Cusco', titulo: 'Cusco imperial', linea: 'Cuesta USD 400', copy: 'ok' }, { nombre: 'Lima', titulo: 'x', linea: 'x', copy: 'x' }],
    dias: [{ dia: 2, kicker: 'Cusco', titulo: 'Entre piedras', relato: 'Recorren la ciudad.' }, { dia: 2, kicker: 'x', titulo: 'duplicado', relato: 'x' }, { dia: 99, kicker: 'x', titulo: 'x', relato: 'x' }, { dia: 3, kicker: 'k', titulo: 't', relato: 'Paga 50 soles' }],
    final: { titulo: 'Hasta pronto', nota: 'ignorada' },
  }, d);
  assert.equal(t.ciudades.length, 1);
  assert.equal(t.ciudades[0].linea, '');
  assert.deepEqual(t.dias.map((x) => x.dia), [2, 3]);
  assert.equal(t.dias[1].relato, '');
  assert.equal(t.final.nota, '');
  assert.deepEqual(validarTextos(null, d).dias, []);
});

await test('los textos de la IA reemplazan a los base solo donde llegaron', () => {
  const d0 = armar();
  const textos = validarTextos({ recorrido: 'Viaje redondo.', ciudades: [{ nombre: 'Cusco', titulo: 'Cusco imperial', linea: 'La capital inca.', copy: '' }],
    dias: [{ dia: 2, kicker: 'Cusco', titulo: 'Entre piedras', relato: 'Recorren la ciudad con guía.' }], final: { titulo: 'Hasta pronto', nota: '' } }, d0);
  const d = armar(vistaBase(), { textos });
  const dias = d.flujo.filter((x) => x.t === 'dia');
  assert.equal(dias[1].titulo, 'Entre piedras');
  assert.ok(dias[2].relato.includes('Subes a la ciudadela'));   // sin texto de IA: queda el de la ficha
  assert.equal(d.recorrido.copy, 'Viaje redondo.');
  assert.equal(d.ciudades[0].linea, 'La capital inca.');
  assert.equal(d.final.titulo, 'Hasta pronto');
});

await test('lo que se le manda a la IA no tiene precios', () => {
  const s = JSON.stringify(datosParaIA(armar()));
  assert.ok(!/USD|precio|venta|cent/i.test(s));
});

await test('aplicarCambios: solo textos, fotos y vencimiento; rechaza lo demás', () => {
  const d = armar();
  const { datos, errores } = aplicarCambios(d, [
    { ruta: 'flujo.1.relato', valor: 'Nuevo relato' }, { ruta: 'validUntil', valor: '2026-12-31' }, { ruta: 'portada.foto', valor: 'https://x.test/p.jpg' }, { ruta: 'ciudades.0.linea', valor: 'Línea nueva' },
  ]);
  assert.deepEqual(errores, []);
  assert.equal(datos.flujo[1].relato, 'Nuevo relato');
  assert.equal(datos.validUntil, '2026-12-31');
  assert.equal(d.validUntil, '2026-11-28', 'no toca el original');
  for (const mala of [{ ruta: 'precio.totalPP', valor: '1' }, { ruta: 'precio.filas.0.montoPP', valor: '1' }, { ruta: 'portada.foto', valor: 'javascript:alert(1)' }, { ruta: 'validUntil', valor: 'mañana' }, { ruta: 'flujo.99.relato', valor: 'x' }, { ruta: 'status', valor: 'confirmada' }, { ruta: 'tags', valor: 'x' }]) {
    assert.ok(aplicarCambios(d, [mala]).errores.length, mala.ruta);
  }
});

await test('slug: <nombre sin acentos>-<6 al azar>', () => {
  assert.match(slugDe('Ana Pérez'), /^ana-[0-9a-f]{6}$/);
  assert.match(slugDe('Álvaro'), /^alvaro-[0-9a-f]{6}$/);
  assert.match(slugDe(''), /^cliente-[0-9a-f]{6}$/);
  assert.notEqual(slugDe('Ana'), slugDe('Ana'));
});

console.log(`${n} tests ok`);

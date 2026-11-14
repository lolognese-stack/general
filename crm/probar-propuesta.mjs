// Tests del paso cotización aprobada -> propuesta web. Correr: node crm/probar-propuesta.mjs
import assert from 'node:assert/strict';
import { paraPropuesta, slugSugerido } from '../functions/_lib/ct-propuesta.js';

let ok = 0;
const t = (nombre, fn) => { try { fn(); ok++; } catch (e) { console.error('FALLA:', nombre, '\n ', e.message); process.exitCode = 1; } };

const linea = (x) => ({ neto_cent: 0, venta_cent: 0, margen_pct: 25, nota: null, problema: null, ...x });
const vista = (cambios = {}) => ({
  cotizacion: { id: 7, version: 2, estado: 'aprobada', usa_prueba: 0, aprobada_por: 'Álvaro', aprobada_en: '2026-11-14 12:00:00', notas_alvaro: 'NOTA INTERNA secreta', ...cambios.cotizacion },
  pedido: { id: 3, nombre: 'Marta Gómez', pais: 'Argentina', pasajeros: 2, fecha_inicio: '2027-03-01', fecha_fin: '2027-03-05', pedidos_especiales: 'Aniversario',
    destinos: [{ ciudad: 'Lima', noches: 1 }, { ciudad: 'Cusco', noches: 3 }], ...cambios.pedido },
  lineas: cambios.lineas || [
    linea({ dia: 1, tipo: 'hotel', descripcion: 'Hotel Lima Centro · 1 hab. doble × 1 noche', cantidad: 1, unidades: 1, habitacion: 'DBL', neto_cent: 7000, venta_cent: 8750 }),
    linea({ dia: 2, tipo: 'tour', servicio_id: 1, descripcion: 'City Tour Lima', neto_cent: 6400, venta_cent: 8000, nota: 'pagar en efectivo al guía (interno)' }),
    linea({ dia: 2, tipo: 'hotel', descripcion: 'Hotel Cusco Plaza · 1 hab. doble × 3 noches', cantidad: 3, unidades: 1, habitacion: 'DBL', neto_cent: 30000, venta_cent: 37500 }),
    linea({ dia: 3, tipo: 'paquete', servicio_id: 2, descripcion: 'Valle Sagrado VIP + Machu Picchu 2D/1N', neto_cent: 86000, venta_cent: 107500 }),
  ],
  totales: { venta_cent: 161750, neto_cent: 129400, problemas: 0, ...cambios.totales },
});
const SERV = [{ id: 1, nombre: 'City Tour Lima', incluye: 'Guía y transporte', no_incluye: 'Entradas a museos' }, { id: 2, nombre: 'Valle Sagrado VIP + Machu Picchu 2D/1N', incluye: 'Tren y entrada', no_incluye: null }];

t('solo aprobadas, sin precios de prueba, sin líneas sin precio y con fechas', () => {
  assert.match(paraPropuesta(vista({ cotizacion: { estado: 'en_revision' } }), { hoy: '2026-11-14' }).errores.join(), /no está aprobada/);
  assert.match(paraPropuesta(vista({ cotizacion: { usa_prueba: 1 } }), { hoy: '2026-11-14' }).errores.join(), /PRUEBA/);
  assert.match(paraPropuesta(vista({ totales: { problemas: 1 } }), { hoy: '2026-11-14' }).errores.join(), /sin precio/);
  assert.match(paraPropuesta(vista({ pedido: { fecha_inicio: null } }), { hoy: '2026-11-14' }).errores.join(), /fechas/);
});

t('propuesta.json con el formato de luna-llena-propuestas', () => {
  const r = paraPropuesta(vista(), { servicios: SERV, hoy: '2026-11-14', azar: 'a1b2c3' });
  const p = r.propuesta_json;
  assert.equal(r.slug, 'marta-a1b2c3');
  assert.equal(p.numero, 'CT-3-v2');
  assert.equal(p.cliente, 'Marta');
  assert.equal(p.validUntil, '2026-11-29');
  assert.equal(p.status, 'enviada');
  assert.deepEqual(p.viaje, { nombre: 'Perú: Lima y Cusco', pais: 'Perú', inicio: '2027-03-01', fin: '2027-03-05', pasajeros: 2 });
  assert.equal(p.precio.totalPP, 808.75);                                   // 1617.50 / 2
  assert.equal(p.precio.desglosePP.alojamiento, 231.25);                    // (87.50 + 375) / 2
  assert.equal(Math.round((p.precio.desglosePP.alojamiento + p.precio.desglosePP.tours) * 100), 80875);
  for (const tag of ['lima', 'cusco', 'machu-picchu', 'valle-sagrado']) assert.ok(p.tags.includes(tag), tag);
  for (const k of ['numero', 'cliente', 'validUntil', 'viaje', 'precio', 'changelog']) assert.ok(p[k] !== undefined, k);
});

t('nada interno sale: ni netos, ni márgenes, ni notas', () => {
  const r = paraPropuesta(vista(), { servicios: SERV, hoy: '2026-11-14' });
  const todo = JSON.stringify(r);
  assert.ok(!/neto|margen/i.test(todo), 'aparece neto o margen');
  assert.ok(!todo.includes('1294'), 'aparece el neto total');
  assert.ok(!todo.includes('NOTA INTERNA') && !todo.includes('efectivo al guía'), 'aparece una nota interna');
  assert.ok(!/\b25%/.test(todo));
});

t('texto para el armador: días, hoteles, precio, incluye', () => {
  const { texto_armador: x } = paraPropuesta(vista(), { servicios: SERV, hoy: '2026-11-14' });
  assert.match(x, /Pasajero: Marta Gómez · 2 personas · Argentina/);
  assert.match(x, /Fecha de llegada \(día 1\): 2027-03-01/);
  assert.match(x, /Día 1 \(lun 01\/03\): libre/);
  assert.match(x, /Día 2 \(mar 02\/03\): City Tour Lima/);
  assert.match(x, /Día 3 .*Valle Sagrado/);
  assert.match(x, /Día 5 \(vie 05\/03\): libre/);
  assert.match(x, /Hotel Cusco Plaza, 3 noches, 1 habitación doble/);
  assert.match(x, /Precio total por persona: USD 808\.75 \(total del grupo USD 1,617\.50\)/);
  assert.match(x, /Incluye:\n- City Tour Lima: Guía y transporte/);
  assert.match(x, /No incluye:\n- City Tour Lima: Entradas a museos/);
  assert.match(x, /Pedidos del cliente: Aniversario/);
});

t('slug', () => {
  assert.equal(slugSugerido('Ñandú Pérez', 'ffffff'), 'nandu-ffffff');
  assert.equal(slugSugerido('', '123456'), 'cliente-123456');
});

console.log(`${ok} tests ok`);

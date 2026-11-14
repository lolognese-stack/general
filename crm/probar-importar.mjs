// Pruebas de la lectura de chat / Excel (ct-importar.js, solo la parte de código: la IA no se llama). Uso: node crm/probar-importar.mjs
import assert from 'node:assert/strict';
import { normalizarLectura } from '../functions/_lib/ct-importar.js';

let n = 0;
const test = (nombre, fn) => { try { fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };
const crudo = (extra = {}) => ({
  pedido: { nombre: 'Ulises', pais: 'México', pasajeros: 2, fecha_inicio: '2027-11-05', fecha_fin: '2027-11-20', dias: 16, destinos: [{ ciudad: 'Lima', noches: 2 }, { ciudad: 'Cusco', noches: 9 }], categoria_hotel: 'confort', pedidos_especiales: '', ...extra },
  lineas: [
    { dia: 1, descripcion: 'Circuito Mágico del Agua', precio_usd: 25, unidad: 'persona' },
    { dia: 3, descripcion: 'Sobrevuelo de Nazca', precio_usd: 300, unidad: 'grupo' },
    { dia: 4, descripcion: 'Sin precio', precio_usd: -5, unidad: 'grupo' },
    { dia: 0, descripcion: '', precio_usd: 10, unidad: 'grupo' },
  ],
});

test('excel: precio por persona se multiplica por los pasajeros; el del grupo queda igual', () => {
  const r = normalizarLectura(crudo(), 'excel');
  assert.deepEqual(r.lineas.map((l) => l.total_grupo_cent), [5000, 30000]);
  assert.equal(r.faltan.length, 0);
});
test('excel: descarta líneas sin descripción o con precio negativo', () => {
  assert.equal(normalizarLectura(crudo(), 'excel').lineas.length, 2);
});
test('chat: no trae líneas aunque la IA las mande', () => {
  assert.equal(normalizarLectura(crudo(), 'chat').lineas.length, 0);
});
test('marca lo que falta para crear el pedido', () => {
  const r = normalizarLectura({ pedido: { nombre: '', pais: '', pasajeros: 0, fecha_inicio: '', fecha_fin: '', dias: 0, destinos: [], categoria_hotel: '', pedidos_especiales: '' }, lineas: [] }, 'excel');
  assert.deepEqual(r.faltan, ['el nombre del cliente', 'la cantidad de pasajeros', 'los destinos', 'los días del viaje', 'la fecha (o una fecha tentativa)', 'líneas con precio en dólares']);
});
test('fechas inválidas o al revés se descartan; pasajeros fuera de rango también', () => {
  const r = normalizarLectura(crudo({ fecha_inicio: '5/11/2027', fecha_fin: '2027-11-20', pasajeros: 99 }), 'chat');
  assert.equal(r.pedido.fecha_inicio, '');
  assert.equal(r.pedido.pasajeros, null);
  assert.equal(normalizarLectura(crudo({ fecha_fin: '2027-10-01' }), 'chat').pedido.fecha_fin, '');
});
test('con noches en los destinos no pide los días; sin respuesta de la IA no revienta', () => {
  assert.ok(!normalizarLectura(crudo({ dias: 0 }), 'chat').faltan.includes('los días del viaje'));
  assert.ok(normalizarLectura(null, 'chat').faltan.length > 0);
});
test('texto largo o con HTML queda como texto plano y recortado', () => {
  const r = normalizarLectura(crudo({ nombre: 'A'.repeat(500), pedidos_especiales: 'x'.repeat(5000) }), 'chat');
  assert.equal(r.pedido.nombre.length, 120);
  assert.equal(r.pedido.pedidos_especiales.length, 2000);
});
console.log(`${n} tests ok`);

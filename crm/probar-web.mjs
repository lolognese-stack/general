// Prueba del lector de la web (ct-web.js) con fichas reales guardadas en crm/fixtures/. Uso: node crm/probar-web.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseFicha, aProducto, diferencias, leerTanda, ciudadDe, ciudadBase, TANDA } from '../functions/_lib/ct-web.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (f) => readFileSync(join(AQUI, 'fixtures', f), 'utf8');
let n = 0;
const test = async (nombre, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };

const ficha = parseFicha(leer('web-paquete-ruta-del-sol.html'));
const catPaq = { id: '6d5n-ruta-del-sol', tipo: 'paquete', nombre: 'Cusco · Puno: Ruta del Sol', zona: 'Cusco y Puno', duracion: { dias: 6, noches: 5 }, tarifas: [{ usd: 505 }], consultar: false, url: '/paquetes/6d5n-ruta-del-sol/' };
const catTour = { id: 'city-tour', tipo: 'tour', nombre: 'City Tour', zona: 'Cusco', duracion: { dias: 1, noches: 0 }, tarifas: [{ usd: 30 }], consultar: false, url: '/tours/city-tour/' };

await test('lee una ficha de paquete: 6 días con pasos', () => {
  assert.ok(ficha.titulo);
  assert.equal(ficha.dias.length, 6);
  assert.ok(ficha.dias.every((d) => d.pasos.length > 0));
});
await test('paquete: ciudades en orden, Cusco y Puno, y precio publicado en centavos', () => {
  const p = aProducto(catPaq, ficha);
  assert.equal(p.tipo, 'paquete');
  assert.equal(p.dias, 6);
  assert.equal(p.precio_web_cent, 50500);
  assert.deepEqual(p.ciudades.slice(0, 1), ['Cusco']);
  assert.ok(p.ciudades.includes('Puno'), p.ciudades.join());
  assert.equal(p.dias_detalle.length, 6);
  assert.ok(p.hash);
});
await test('tour: ciudad base y un solo día', () => {
  const p = aProducto(catTour, parseFicha(leer('web-tour-city-tour.html')));
  assert.equal(p.tipo, 'tour'); assert.equal(p.ciudad_base, 'Cusco'); assert.equal(p.dias, 1); assert.equal(p.dias_detalle.length, 0);
});
await test('zonas que se hacen desde Cusco', () => {
  assert.equal(ciudadBase('Machu Picchu'), 'Cusco'); assert.equal(ciudadBase('Valle Sagrado'), 'Cusco'); assert.equal(ciudadBase('Huaraz'), 'Huaraz');
});
await test('"consultar" no inventa precio', () => {
  assert.equal(aProducto({ ...catTour, consultar: true }, parseFicha(leer('web-tour-city-tour.html'))).precio_web_cent, null);
});
await test('la duración del nombre corrige una ficha que dice 1 día', () => {
  const p = aProducto({ ...catTour, nombre: 'Cachiccata – Intipunku 3D/2N', duracion: { dias: 1, noches: 0 } }, parseFicha(leer('web-tour-city-tour.html')));
  assert.equal(p.dias, 3); assert.equal(p.noches, 2);
});
await test('ciudadDe', () => { assert.equal(ciudadDe('Traslado a Puno', 'Cusco'), 'Puno'); assert.equal(ciudadDe('Día libre', 'Lima'), 'Lima'); });
await test('diferencias: alta, cambio, baja y sin cambio', () => {
  const a = aProducto(catTour, parseFicha(leer('web-tour-city-tour.html')));
  const b = aProducto(catPaq, ficha);
  const guardados = [{ id: a.id, nombre: a.nombre, hash: a.hash, activo: 1 }, { id: 'viejo', nombre: 'Viejo', hash: 'x', activo: 1 }];
  const d = diferencias(guardados, [a, b]);
  assert.deepEqual(d.altas.map((x) => x.id), [b.id]);
  assert.equal(d.sin_cambio, 1);
  assert.deepEqual(d.bajas.map((x) => x.id), ['viejo']);
  const cambiado = { ...a, hash: 'otro' };
  assert.deepEqual(diferencias(guardados, [cambiado], { completo: false }).cambios.map((x) => x.id), [a.id]);
});
await test('leerTanda: respeta la tanda y sigue donde quedó', async () => {
  const cat = { productos: Array.from({ length: 65 }, (_, i) => ({ ...catTour, id: `t${String(i).padStart(3, '0')}`, url: `/tours/t${i}/` })) };
  let pedidos = 0;
  const falso = async (u) => {
    pedidos++;
    if (u.endsWith('catalogo.json')) return { ok: true, json: async () => cat };
    if (u.endsWith('/tours/t3/')) return { ok: false, status: 404 };
    return { ok: true, text: async () => leer('web-tour-city-tour.html') };
  };
  const r1 = await leerTanda({}, { desde: 0 }, falso);
  assert.equal(r1.productos.length, TANDA - 1); assert.equal(r1.errores.length, 1); assert.equal(r1.errores[0].id, 't003'); assert.equal(r1.siguiente, TANDA);
  assert.ok(pedidos <= 50, 'más de 50 lecturas en un pedido: ' + pedidos);
  const r3 = await leerTanda({}, { desde: 60 }, falso);
  assert.equal(r3.siguiente, null); assert.equal(r3.productos.length, 5); assert.equal(r3.ids.length, 65);
});
console.log(`${n} tests ok`);

// Pruebas de la plantilla de propuesta (propuesta-pagina.js). Uso: node crm/probar-propuesta-pagina.mjs
// La referencia es la propuesta de Ulises ya publicada: datos y esqueleto sacados con crm/fixtures/extraer-ulises.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPagina, configEfectivo, fechaCancelacion, bandera } from '../functions/_lib/propuesta-pagina.js';
import { esqueleto } from './fixtures/esqueleto.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const leer = (f) => JSON.parse(fs.readFileSync(path.join(aqui, 'fixtures', f), 'utf8'));
const ulises = leer('ulises-datos.json');
const esqPublicada = leer('ulises-esqueleto.json');

let n = 0;
const test = async (nombre, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };
const clonar = (o) => JSON.parse(JSON.stringify(o));
const pagina = (d = ulises, o = {}) => renderPagina(d, { slug: 'ulises-b69ed5', hoy: '2026-11-13', ...o });

await test('con los datos de Ulises da el mismo esqueleto que la página publicada', () => {
  const nuevo = esqueleto(pagina());
  let i = 0;
  while (i < nuevo.length && i < esqPublicada.length && nuevo[i] === esqPublicada[i]) i++;
  assert.equal(nuevo.length, esqPublicada.length, `largo ${nuevo.length} vs ${esqPublicada.length}; primera diferencia en ${i}: nuevo=${nuevo.slice(i - 2, i + 3)} publicada=${esqPublicada.slice(i - 2, i + 3)}`);
  assert.deepEqual(nuevo, esqPublicada);
});

await test('las secciones están en el orden de la propuesta de Ulises', () => {
  const ids = [...pagina().matchAll(/<section[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['recorrido', 'itinerario', 'incluye', 'autoridad', 'inversion', 'reserva', 'confianza', 'preguntas']);
});

await test('el texto de los días, el precio y la portada de Ulises se mantienen', () => {
  const h = pagina();
  assert.ok(h.includes('<h1>Ulises, Perú te está esperando.</h1>'));
  assert.ok(h.includes('<b>USD 1,728.50</b>'));
  assert.ok(h.includes('USD 1,728.50 p/p'));
  assert.ok(h.includes('Del aeropuerto al Circuito del Agua'));
  assert.ok(h.includes('<span class="venta-bandera" aria-hidden="true">🇲🇽</span>México'));
  assert.equal((h.match(/class="day day--/g) || []).length, 16);
  assert.equal((h.match(/class="hotel rv"/g) || []).length, 8);
  assert.ok(h.includes('Puedes cancelar hasta el <b class="venta-riesgo__fecha">16/10/2027</b>, 20 días antes del viaje.'));
});

await test('vigente: la página no marca vencida; vencida: sí, y "Quiero reservar" va a WhatsApp', () => {
  assert.ok(!/<html lang="es" class="[^"]*venta-vencida/.test(pagina()));
  const v = pagina(ulises, { hoy: '2026-12-01' });
  assert.ok(/<html lang="es" class="venta-vencida"/.test(v));
  assert.ok(v.includes('data-cta="reservar"'));
});

await test('seña, saldo y términos salen del config de la plantilla', () => {
  const h = pagina();
  assert.ok(h.includes('Abonas la seña del 50%'));
  assert.ok(h.includes('USD 1,728.50 en total para 2 viajeros'), 'seña = 50% de 3.457');
  assert.ok(h.includes('El saldo se paga al llegar a Cusco.'));
  assert.ok(h.includes('href="/terminos/"'));
});

await test('testimonios: solo los que comparten tag con el viaje', () => {
  const h = pagina();
  assert.ok(h.includes('Una experiencia que rompe esquemas'));        // tag cusco
  assert.ok(!h.includes('Caminata y aventura para llegar a Choquequirao'));   // trekking: Ulises no lo tiene
  const d = clonar(ulises); d.tags = ['trekking'];
  assert.ok(pagina(d).includes('Caminata y aventura para llegar a Choquequirao'));
});

await test('cancelación: 20 días antes, 30 con trekking, o fija a mano', () => {
  assert.deepEqual(fechaCancelacion({ viaje: { inicio: '2027-11-05' }, tags: [] }), { fecha: '2027-10-16', dias: 20 });
  assert.deepEqual(fechaCancelacion({ viaje: { inicio: '2027-11-05' }, tags: ['trekking'] }), { fecha: '2027-10-06', dias: 30 });
  assert.equal(fechaCancelacion({ viaje: { inicio: '2027-11-05' }, cancelacionHasta: '2027-10-01' }), '2027-10-01');
});

await test('vista previa: sin script de seguimiento, con la banda roja y sin vencida', () => {
  const h = pagina(ulises, { vista: true, banda: 'PRECIOS DE PRUEBA · solo vista interna', hoy: '2030-01-01' });
  assert.ok(!h.includes('/_venta/venta.js'));
  assert.ok(h.includes('PRECIOS DE PRUEBA · solo vista interna'));
  assert.ok(h.includes('class="venta-preview"'));
  assert.ok(!h.includes('venta-vencida'));
  assert.ok(pagina().includes('/_venta/venta.js'));
});

await test('la página declara sus datos para validar la reserva (script#venta-datos)', () => {
  const m = pagina().match(/<script id="venta-datos" type="application\/json">([\s\S]*?)<\/script>/);
  const dv = JSON.parse(m[1]);
  assert.equal(dv.slug, 'ulises-b69ed5');
  assert.equal(dv.precio.totalPP, 1728.5);
  assert.equal(dv.pasajeros, 2);
  assert.equal(dv.validUntil, '2026-11-27');
});

await test('escapa lo que viene del cliente o de la IA', () => {
  const d = clonar(ulises);
  d.cliente = 'Ana <script>alert(1)</script>';
  d.flujo.find((x) => x.t === 'dia').relato = '"><img src=x onerror=alert(1)>';
  const h = pagina(d);
  assert.ok(!h.includes('<script>alert(1)'));
  assert.ok(!h.includes('<img src=x'));
});

await test('no sale nada interno: ni netos, ni márgenes, ni ilustraciones', () => {
  const h = pagina();
  assert.ok(!/bneto|margen|ilustrativ|PRECIOS? DE PRUEBA/i.test(h.replace(/<script id="venta-datos"[\s\S]*?<\/script>/, '')));
});

await test('configEfectivo: se pisa parte del config sin perder el resto', () => {
  const c = configEfectivo({ pago: { saldoCuando: 'una semana antes' }, calcomUrl: 'https://cal.com/x' });
  assert.equal(c.pago.saldoCuando, 'una semana antes');
  assert.equal(c.pago['señaPorcentaje'], 50);
  assert.equal(c.calcomUrl, 'https://cal.com/x');
  assert.ok(pagina(ulises, { cfg: c }).includes('Agendar llamada de 10 min'));
});

await test('bandera del país de origen', () => {
  assert.equal(bandera('México'), '🇲🇽');
  assert.equal(bandera('Atlantis'), '');
});

console.log(`${n} tests ok`);

// Prueba de la lógica de seguimientos: node crm/probar-seguimientos.mjs
import assert from 'node:assert/strict';
import { secuencia, proximoToque, textoDe, retomarDesde, caliente, hoyLima, sumarDias } from '../functions/_lib/seguimientos.js';

const sec = secuencia(null);
const seg = { estado: 'activa', dia0: '2026-11-01' };
let n = 0; const ok = (m) => { n++; console.log('ok', m); };

// Antes del día 2 no hay nada vencido.
let p = proximoToque(seg, [], sec, '2026-11-02');
assert.equal(p.toque.dia, 2); assert.equal(p.vencido, false); ok('día 1: el día 2 todavía no vence');
p = proximoToque(seg, [], sec, '2026-11-03');
assert.equal(p.toque.dia, 2); assert.equal(p.vencido, true); assert.equal(p.atraso, 0); ok('día 2 vence en fecha');
// Atrasado: el día 2 sigue siendo el que toca, con 4 días de atraso (no aparece el del día 5).
p = proximoToque(seg, [], sec, '2026-11-07');
assert.equal(p.toque.dia, 2); assert.equal(p.atraso, 4); ok('atrasado: se muestra el más viejo, uno solo');
// Hecho tarde (día 6): el del día 5 vence 3 días después de ese, no el mismo día.
p = proximoToque(seg, [{ dia: 2, fecha: '2026-11-07' }], sec, '2026-11-07');
assert.equal(p.toque.dia, 5); assert.equal(p.vence, '2026-11-10'); assert.equal(p.vencido, false); ok('hecho tarde: el siguiente respeta la distancia');
// En fecha: el del día 5 vence el día 5.
p = proximoToque(seg, [{ dia: 2, fecha: '2026-11-03' }], sec, '2026-11-06');
assert.equal(p.toque.dia, 5); assert.equal(p.vence, '2026-11-06'); assert.equal(p.vencido, true); ok('en fecha: día 5 vence el día 5');
// Salteado cuenta como hecho.
p = proximoToque(seg, [{ dia: 2, fecha: '2026-11-03' }, { dia: 5, fecha: '2026-11-06' }], sec, '2026-11-09');
assert.equal(p.toque.dia, 8); assert.equal(p.toque.tipo, 'grabar'); ok('día 8 es para grabar');
// Pausada o respondió: nada.
assert.equal(proximoToque({ ...seg, estado: 'respondio' }, [], sec, '2026-11-10'), null); ok('respondió: sin toques');
// Todos hechos: nada.
assert.equal(proximoToque(seg, sec.map((t) => ({ dia: t.dia, fecha: sumarDias('2026-11-01', t.dia) })), sec, '2027-03-01'), null); ok('secuencia terminada');
// Retomar el día 40: arranca en el de 60 y vence hoy.
assert.equal(retomarDesde('2026-11-01', '2026-12-11'), 60); ok('retomar a los 40 días: desde el de 60');
assert.equal(retomarDesde('2026-11-01', '2027-06-01'), 90); ok('retomar pasado el día 90: desde el de 90');
p = proximoToque({ ...seg, retomado_desde: 60, retomado_en: '2026-12-11' }, [{ dia: 2, fecha: '2026-11-03' }], sec, '2026-12-11');
assert.equal(p.toque.dia, 60); assert.equal(p.vencido, true); ok('retomado: el de 60 vence el día que se retoma');
// Textos.
const d2 = sec.find((t) => t.dia === 2), d12 = sec.find((t) => t.dia === 12);
assert.match(textoDe(d2, { nombre: 'Ulises Pérez' }), /^¡Hola, Ulises! ¿Qué les pareció/); ok('nombre: solo el primero');
assert.match(textoDe(d2, { nombre: 'Ulises', abrio: false }), /¿Pudieron abrir la propuesta\?/); ok('día 2 sin abrir');
assert.match(textoDe(d12, { nombre: 'Ana' }), /Un dato importante: las entradas/); ok('día 12 sin revisar: B');
assert.match(textoDe(d12, { nombre: 'Ana', revisoDisponibilidad: true }), /se están empezando a llenar/); ok('día 12 revisado: A');
assert.match(textoDe(d2, { nombre: '' }), /^¡Hola! ¿Qué les pareció/); ok('sin nombre');
// Caliente.
const ahora = new Date('2026-11-10T15:00:00Z');
assert.equal(caliente([{ evento: 'cta', detalle: 'reservar', creado_en: '2026-11-10 10:00:00' }], ahora), true); ok('caliente: tocó reservar');
assert.equal(caliente([{ evento: 'cta', detalle: 'reservar', creado_en: '2026-11-07 10:00:00' }], ahora), false); ok('frío: fue hace más de 48 h');
assert.equal(caliente([{ evento: 'apertura', creado_en: '2026-11-10 09:00:00' }, { evento: 'apertura', creado_en: '2026-11-09 20:00:00' }], ahora), true); ok('caliente: 2 aperturas');
assert.equal(caliente([{ evento: 'tiempo', detalle: '200', creado_en: '2026-11-10 09:00:00' }], ahora), true); ok('caliente: más de 3 minutos');
// Secuencia guardada inválida: se usa la base.
assert.equal(secuencia('{"no":"array"}').length, sec.length); ok('config inválida: base');
assert.equal(secuencia(JSON.stringify([{ dia: 3, clave: 'x', tipo: 'texto', texto: 'hola' }]))[0].dia, 3); ok('config válida: la usa');
// Hora de Lima (UTC-5): las 02:00 UTC del 13 todavía son el 12 en Lima.
assert.equal(hoyLima(new Date('2026-11-13T02:00:00Z')), '2026-11-12'); ok('hoy en Lima');
console.log(`\n${n} pruebas ok`);

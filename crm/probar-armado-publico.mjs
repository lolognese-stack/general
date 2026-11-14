// Pruebas del armador PÚBLICO de la web (armado-publico.js + score-armador.js). Uso: node crm/probar-armado-publico.mjs
import assert from 'node:assert/strict';
import { armarBase, componer, candidatosPublicos, indiceCandidatos, leerDestinos, leerSeq, hidratarPaquetes, itinerarioLead, excursionesDe, paquetesPublicos, destinosDisponibles } from '../functions/_lib/armado-publico.js';
import { indexarReglas } from '../functions/_lib/ct-armado.js';
import { scoreArmador, pideExtra } from '../functions/_lib/score-armador.js';

let n = 0;
const test = (nombre, fn) => { try { fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); } };

const reglas = indexarReglas([
  ...[['Lima', 155], ['Cusco', 3400], ['Puno', 3830], ['Arequipa', 2335]].map(([clave, h]) => ({ tipo: 'ciudad', clave, datos: JSON.stringify({ altura_m: h }), es_prueba: 1 })),
  { tipo: 'conexion', clave: 'Cusco>Puno', datos: '{"horas":8,"dia_completo":true}', es_prueba: 1 },
  { tipo: 'conexion', clave: 'Lima>Cusco', datos: '{"horas":1.5,"dia_completo":false}', es_prueba: 1 },
  { tipo: 'aclimatacion', clave: 'general', datos: '{"altura_aviso_m":3000,"salto_aviso_m":2000,"dia_completo_primer_dia":false}', es_prueba: 1 },
]);
const tour = (id, nombre, base, extra = {}) => ({ id, tipo: 'tour', nombre, ciudad_base: base, ciudades: [base], dias: 1, noches: 0, precio_web_cent: 4000, resumen: `Resumen ${nombre}`, fotos: '["/f.jpg"]', url: `/tours/${id}/`, dias_detalle: [], ...extra });
const dia = (d, ciudad, titulo) => ({ dia: d, ciudad, titulo, relato: `Relato ${titulo}`, foto: '/d.jpg' });
const web = [
  tour('city-tour', 'City Tour Cusco', 'Cusco'), tour('valle-sagrado-vip-maras-moray', 'Valle Sagrado VIP', 'Cusco'),
  tour('mapi-full-day-tren-turistico', 'Machu Picchu Full Day', 'Cusco', { precio_web_cent: 33000 }),
  tour('montana-de-colores', 'Montaña de Colores', 'Cusco'), tour('retiro-de-ayahuasca', 'Retiro de Ayahuasca', 'Cusco'),
  tour('mapi-2d-1n', 'Machu Picchu 2D/1N', 'Cusco', { dias: 2, noches: 1, dias_detalle: [dia(1, 'Cusco', 'Valle y Aguas Calientes'), dia(2, 'Cusco', 'Machu Picchu al amanecer')] }),
  { id: 'peru-10', tipo: 'paquete', nombre: 'Perú 10', ciudad_base: 'Lima', ciudades: ['Lima', 'Arequipa', 'Cusco', 'Puno'], dias: 8, noches: 7, precio_web_cent: 99900, url: '/paquetes/peru-10/',
    dias_detalle: [dia(1, 'Lima', 'Llegada + City tour Lima colonial'), dia(2, 'Lima', 'Ruta culinaria en Lima'), dia(3, 'Arequipa', 'Cañón del Colca (día 1)'), dia(4, 'Arequipa', 'Cañón del Colca (día 2)'),
      dia(5, 'Cusco', 'City tour'), dia(6, 'Puno', 'Ruta del Sol a Puno (día 1)'), dia(7, 'Puno', 'Ruta del Sol: Uros, Taquile y Sillustani'), dia(8, 'Puno', 'Salida')] },
];
const pc = candidatosPublicos(web);
const idx = indiceCandidatos(pc);
const sinPrecio = (obj) => { const s = JSON.stringify(obj); assert.ok(!/cent|precio|usd|neto|venta|margen/i.test(s), `hay un campo de precio: ${s.match(/.{0,40}(cent|precio|usd|neto|venta|margen).{0,40}/i)?.[0]}`); };

test('candidatos: tours de Cusco y días de paquete para ciudades sin tours; sin "solo si lo piden" ni traslados', () => {
  const cusco = pc.get('cusco').map((c) => c.clave);
  assert.equal(cusco[0], 't:city-tour');
  assert.ok(!cusco.includes('t:retiro-de-ayahuasca'));
  assert.deepEqual(pc.get('lima').map((c) => c.nombre), ['City tour Lima colonial', 'Ruta culinaria en Lima']);
  const colca = pc.get('arequipa')[0];
  assert.equal(colca.nombre, 'Cañón del Colca'); assert.equal(colca.dias, 2);
  assert.deepEqual(pc.get('puno').map((c) => c.nombre), ['Uros, Taquile y Sillustani']);
  assert.ok(!pc.has('cusco') || !pc.get('cusco').some((c) => c.clave.startsWith('d:')), 'Cusco tiene tours: no usa días de paquete');
});

test('nada de lo que sale tiene precio', () => {
  sinPrecio([...pc.values()]);
  sinPrecio(armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 2 }, { id: 'cusco', noches: 4 }]), web, reglas }));
  sinPrecio(armarBase({ destinos: [], desde: 'peru-10', web, reglas }));
  sinPrecio(paquetesPublicos(web)); sinPrecio(destinosDisponibles(pc));
});

test('equilibrado: llegada libre, Cusco nunca con actividad el día que llega, Machu Picchu no el primer día disponible', () => {
  const r = armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 2 }, { id: 'cusco', noches: 4 }]), web, reglas });
  assert.equal(r.dias.length, 7);
  assert.deepEqual(r.dias.map((d) => d.tipo), ['llegada', 'actividad', 'traslado', 'actividad', 'actividad', 'actividad', 'salida']);
  assert.ok(!/machu/i.test(r.dias[3].titulo), 'Machu Picchu no va el día 4 (primer día en Cusco después de llegar)');
  assert.equal(r.avisos.length, 0);
});

test('tranquilo deja un día libre de cada tres; a full llena el día de llegada a una ciudad baja', () => {
  const des = leerDestinos([{ id: 'cusco', noches: 5 }]);
  const t = armarBase({ destinos: des, ritmo: 'tranquilo', web, reglas });
  assert.equal(t.dias.filter((d) => d.tipo === 'libre').length, 1);
  const f = armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 2 }]), ritmo: 'a_full', web, reglas });
  assert.equal(f.dias[0].tipo, 'actividad');
  const fc = armarBase({ destinos: des, ritmo: 'a_full', web, reglas });
  assert.equal(fc.dias[0].tipo, 'llegada', 'Cusco es alto: aun a full el primer día queda libre');
});

test('días que no alcanzan: recorta y avisa', () => {
  const r = armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 3 }, { id: 'cusco', noches: 4 }]), dias: 5, web, reglas });
  assert.equal(r.dias.length, 5);
  assert.ok(r.avisos.some((a) => /acortamos/.test(a.texto)));
});

test('destino libre ("otro") queda a definir y el último día es la salida', () => {
  const r = armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 1 }, { id: 'otro:Chachapoyas', noches: 2 }]), web, reglas });
  assert.deepEqual(r.dias.map((d) => d.tipo), ['llegada', 'otro', 'otro', 'salida']);
  assert.match(r.dias[1].titulo, /Chachapoyas: a definir/);
});

test('desde un paquete: sus días tal cual', () => {
  const r = armarBase({ destinos: [], desde: 'peru-10', web, reglas });
  assert.equal(r.dias.length, 8); assert.equal(r.desde, 'peru-10');
  assert.equal(r.dias[2].titulo, 'Cañón del Colca (día 1)');
  assert.equal(r.dias[7].tipo, 'salida');
});

test('editar: actividad el día de llegada a Cusco avisa y propone dejarlo libre', () => {
  const seq = leerSeq([{ ciudad: 'Lima' }, { ciudad: 'Cusco', clave: 't:montana-de-colores' }, { ciudad: 'Cusco' }, { ciudad: 'Cusco' }]);
  const r = componer(seq, { idx, reglas, porCiudad: pc });
  const a = r.avisos.find((x) => x.dia === 2);
  assert.ok(a && /aclimatarte/.test(a.texto)); assert.deepEqual(a.arreglo, { tipo: 'libre', dia: 2 });
});

test('editar: Machu Picchu al día siguiente de llegar avisa y propone intercambiar con un día posterior', () => {
  const seq = leerSeq([{ ciudad: 'Lima' }, { ciudad: 'Cusco' }, { ciudad: 'Cusco', clave: 't:mapi-full-day-tren-turistico' }, { ciudad: 'Cusco', clave: 't:city-tour' }, { ciudad: 'Cusco' }]);
  const r = componer(seq, { idx, reglas, porCiudad: pc });
  const a = r.avisos.find((x) => x.dia === 3);
  assert.ok(a && /Machu Picchu/.test(a.texto)); assert.deepEqual(a.arreglo, { tipo: 'intercambiar', dia: 3, con: 4 });
});

test('editar: actividad de 2 días cortada queda libre; completa se mantiene; clave de otra ciudad se descarta', () => {
  const cortada = componer(leerSeq([{ ciudad: 'Cusco' }, { ciudad: 'Cusco', clave: 't:mapi-2d-1n', parte: 1 }, { ciudad: 'Cusco' }, { ciudad: 'Cusco' }]), { idx, reglas, porCiudad: pc });
  assert.equal(cortada.dias[1].tipo, 'libre');
  const ok = componer(leerSeq([{ ciudad: 'Cusco' }, { ciudad: 'Cusco', clave: 't:mapi-2d-1n', parte: 1 }, { ciudad: 'Cusco', clave: 't:mapi-2d-1n', parte: 2 }, { ciudad: 'Cusco' }]), { idx, reglas, porCiudad: pc });
  assert.deepEqual(ok.dias.slice(1, 3).map((d) => d.titulo), ['Valle y Aguas Calientes', 'Machu Picchu al amanecer']);
  const otra = componer(leerSeq([{ ciudad: 'Lima', clave: 't:city-tour' }, { ciudad: 'Lima' }]), { idx, reglas, porCiudad: pc });
  assert.equal(otra.dias[0].tipo, 'llegada');
  assert.deepEqual(leerSeq([{ ciudad: 'Lima', clave: 'x"; DROP' }])[0].clave, null);
});

test('días de paquete: el navegador manda id y día, el texto sale del catálogo', () => {
  const seq = hidratarPaquetes(leerSeq([{ ciudad: 'Lima', paquete: { id: 'peru-10', dia: 2 } }, { ciudad: 'Lima', paquete: { id: 'nada', dia: 1 } }]), web);
  assert.equal(seq[0].paquete.titulo, 'Ruta culinaria en Lima'); assert.equal(seq[1].paquete, null);
});

test('para el CRM: itinerario por ciudad (migración 048) y excursiones', () => {
  const r = armarBase({ destinos: leerDestinos([{ id: 'lima', noches: 2 }, { id: 'cusco', noches: 3 }]), web, reglas });
  const it = itinerarioLead(r.dias, '2027-07-01');
  assert.deepEqual(it.map((t) => [t.titulo, t.dias.length]), [['Lima', 2], ['Cusco', 4]]);
  assert.equal(it[1].dias[0].fecha, '2027-07-03');
  assert.ok(excursionesDe(r.dias).includes('City Tour Cusco'));
});

test('excursiones de un paquete: sin traslados ni "(día N)" repetidos', () => {
  const r = armarBase({ destinos: [], desde: 'peru-10', web, reglas });
  assert.deepEqual(excursionesDe(r.dias), ['City tour Lima colonial', 'Ruta culinaria en Lima', 'Cañón del Colca', 'City tour', 'Ruta del Sol: Uros, Taquile y Sillustani']);
});

const HOY = Date.parse('2026-11-14T12:00:00Z');
const base = { pasajes: 'pendientes', adultos: 2, ninos: 0, dias: 10, destinos: 3 };
test('score: sin fecha o a más de 12 meses resta; "viendo ideas" resta; itinerario siempre suma', () => {
  const conFecha = scoreArmador({ ...base, fecha_tipo: 'mes', fecha: '2027-03' }, HOY);
  const sinFecha = scoreArmador({ ...base, fecha_tipo: 'nose' }, HOY);
  const lejos = scoreArmador({ ...base, fecha_tipo: 'mes', fecha: '2028-06' }, HOY);
  assert.equal(conFecha.desglose.fecha_lejana, 0); assert.equal(sinFecha.desglose.fecha_lejana, -10); assert.equal(lejos.desglose.fecha_lejana, -10);
  assert.ok(sinFecha.total < conFecha.total - 15);
  const ideas = scoreArmador({ ...base, fecha_tipo: 'mes', fecha: '2027-03', reserva: 'ideas' }, HOY);
  assert.equal(ideas.desglose.reserva, -20);
  assert.equal(conFecha.desglose.itinerario, 15);
});

test('score: caliente, tibio y frío; preguntas extra solo para tibio sin responder', () => {
  const caliente = { ...base, pasajes: 'comprados', fecha_tipo: 'exacta', fecha: '2027-02-10', tiene_presupuesto: true, presupuesto_rango: '2000-3000', adultos: 3 };
  assert.equal(scoreArmador(caliente, HOY).tier, 'caliente');
  const tibio = { ...base, fecha_tipo: 'mes', fecha: '2027-03', tiene_presupuesto: true, presupuesto_rango: '1000-1500' };
  assert.equal(scoreArmador(tibio, HOY).tier, 'tibio');
  assert.equal(pideExtra(tibio, HOY), true);
  assert.equal(pideExtra({ ...tibio, reserva: '1-3' }, HOY), false);
  const frio = { ...base, adultos: 1, dias: 3, destinos: 1, fecha_tipo: 'nose' };
  assert.equal(scoreArmador(frio, HOY).tier, 'frio');
  assert.equal(pideExtra(frio, HOY), false);
  assert.equal(scoreArmador({ ...tibio, reserva: 'ideas' }, HOY).tier, 'frio');
});

console.log(`armador público: ${n} pruebas OK`);

// Genera crm/seed-cotizador-ilustrativo.sql: servicios reales de Luna Llena con precios INVENTADOS
// (todos es_ilustrativa = 1) y hoteles inventados. Sirven para probar el cotizador hasta cargar las tarifas reales.
// Correr: node crm/generar-seed-cotizador.mjs   (el .sql queda en git; se puede volver a aplicar sin duplicar)
import { writeFileSync } from 'node:fs';
import { claveServicio, claveHotel } from '../functions/_lib/tarifario.js';

const VIG = ['2026-01-01', '2027-12-31'];
const q = (s) => s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;

// [nombre, ciudad, tipo, duración, incluye, no incluye, pax_min, moneda, precios por tramo 1 | 2-3 | 4-6 | 7+, alta (recargo % o 0)]
const SERVICIOS = [
  ['City Tour Cusco', 'Cusco', 'tour', 'Medio día', 'Guía, transporte turístico, Qorikancha, Sacsayhuamán, Q\'enqo, Puka Pukara y Tambomachay', 'Boleto turístico, propinas', 1, 'USD', [40, 28, 22, 18], 0],
  ['Valle Sagrado VIP + Machu Picchu 2D/1N', 'Cusco', 'paquete', '2D/1N', 'Transporte, guía, almuerzo buffet en el Valle, tren, hotel en Aguas Calientes, bus de subida y bajada, entrada a Machu Picchu', 'Boleto turístico, cenas, propinas', 1, 'USD', [520, 430, 395, 370], 10],
  ['Montaña de 7 Colores', 'Cusco', 'tour', 'Día completo', 'Recojo del hotel, desayuno, almuerzo, guía', 'Entrada a la montaña, caballo, bastones', 2, 'USD', [60, 38, 32, 28], 0],
  ['Laguna Humantay', 'Cusco', 'tour', 'Día completo', 'Recojo del hotel, desayuno, almuerzo, guía', 'Entrada a la laguna, caballo', 2, 'USD', [58, 36, 30, 26], 0],
  ['Cuatrimotos Maras Moray', 'Cusco', 'tour', 'Medio día', 'Cuatrimoto, casco, guía, transporte', 'Entradas a Moray y a las Salineras', 1, 'USD', [70, 48, 42, 38], 0],
  ['Puno 2D/1N (Uros, Amantaní, Taquile)', 'Puno', 'paquete', '2D/1N', 'Lancha, guía, noche en casa de familia en Amantaní, comidas del tour', 'Entradas a las islas, propinas', 2, 'USD', [150, 110, 95, 85], 0],
  ['Paracas - Ica - Huacachina 2D/1N', 'Ica', 'paquete', '2D/1N', 'Transporte desde Lima, Islas Ballestas, tubulares y sandboard en Huacachina, hotel 1 noche', 'Tasas portuarias, comidas no indicadas', 2, 'USD', [260, 190, 170, 155], 15],
  ['Sobrevuelo Líneas de Nazca', 'Nazca', 'tour', '35 minutos de vuelo', 'Vuelo en avioneta, traslado al aeródromo', 'Tasa de aeropuerto', 1, 'USD', [120, 110, 105, 100], 0],
  ['City Tour Lima', 'Lima', 'tour', 'Medio día', 'Guía, transporte, Lima colonial y Miraflores', 'Entradas a museos', 1, 'USD', [45, 32, 26, 22], 0],
  ['Circuito Mágico del Agua', 'Lima', 'entrada', '2 horas', 'Entrada al parque', 'Transporte', 1, 'PEN', [15, 15, 15, 15], 0],
];
const TRAMOS = [[1, 1], [2, 3], [4, 6], [7, null]];

// Hoteles inventados: 2 por ciudad y categoría. Precio por habitación y por noche (USD) [SGL, DBL, TPL].
const HOTELES = {
  Cusco: { economico: [[45, 55, 75], [40, 50, 68]], confort: [[85, 100, 130], [80, 95, 125]], premium: [[210, 240, 300], [190, 220, 280]] },
  'Aguas Calientes': { economico: [[50, 60, 80], [48, 58, 78]], confort: [[95, 110, 145], [90, 105, 140]], premium: [[280, 320, 400], [250, 290, 370]] },
  Lima: { economico: [[50, 60, 80], [45, 55, 75]], confort: [[95, 110, 140], [90, 105, 135]], premium: [[220, 250, 310], [200, 230, 290]] },
  Puno: { economico: [[35, 45, 60], [32, 42, 56]], confort: [[70, 85, 110], [65, 80, 105]], premium: [[150, 175, 220], [140, 165, 210]] },
};
const NOMBRES = { economico: ['Hostal Ejemplo Inti', 'Casa Ejemplo Killa'], confort: ['Hotel Ejemplo Wayra', 'Hotel Ejemplo Ñusta'], premium: ['Gran Hotel Ejemplo Apu', 'Hotel Ejemplo Pachamama'] };

const out = [];
out.push('-- GENERADO por crm/generar-seed-cotizador.mjs. No editar a mano.');
out.push('-- Tarifas y hoteles DE PRUEBA (precios inventados, es_ilustrativa = 1). Se puede volver a correr: borra y vuelve a cargar solo lo de prueba.');
out.push('-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/seed-cotizador-ilustrativo.sql');
out.push('');
out.push('-- Configuración inicial: solo si no existe (no pisa valores ya confirmados).');
out.push("INSERT OR IGNORE INTO ct_config (clave, valor, es_prueba) VALUES ('margen_pct', '25', 1), ('tc_pen_por_usd', '3.75', 1), ('recargo_tarjeta_pct', '5', 0), ('igv_pct', '18', 0);");
out.push("INSERT INTO ct_temporadas (temporada, desde_md, hasta_md, nota, es_prueba) SELECT 'alta', '06-01', '08-31', 'Invierno: temporada alta (a confirmar)', 1 WHERE NOT EXISTS (SELECT 1 FROM ct_temporadas);");
out.push("INSERT INTO ct_temporadas (temporada, desde_md, hasta_md, nota, es_prueba) SELECT 'alta', '12-20', '01-05', 'Fiestas de fin de año (a confirmar)', 1 WHERE (SELECT COUNT(*) FROM ct_temporadas) = 1;");
out.push('');
out.push('DELETE FROM ct_tarifas WHERE es_ilustrativa = 1;');
out.push('DELETE FROM ct_hotel_tarifas WHERE es_ilustrativa = 1;');
out.push('');
for (const [nombre, ciudad, tipo, dur, inc, noInc, paxMin, moneda, precios, alta] of SERVICIOS) {
  const clave = claveServicio(tipo, ciudad, nombre);
  out.push(`INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES (${[clave, nombre, ciudad, tipo, dur, inc, noInc].map(q).join(', ')}, ${paxMin})`
    + ` ON CONFLICT (clave) DO UPDATE SET activo = 1;`);
  const filas = [];
  TRAMOS.forEach(([d, h], i) => {
    const temps = alta ? [['baja', precios[i]], ['alta', Math.round(precios[i] * (1 + alta / 100))]] : [['todas', precios[i]]];
    for (const [t, p] of temps) {
      filas.push(`((SELECT id FROM ct_servicios WHERE clave = ${q(clave)}), ${p * 100}, '${moneda}', ${d}, ${h ?? 'NULL'}, '${t}', '${VIG[0]}', '${VIG[1]}', 1, 'Seed de prueba (precios inventados)')`);
    }
  });
  out.push(`INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES\n  ${filas.join(',\n  ')};`);
}
out.push('');
for (const [ciudad, cats] of Object.entries(HOTELES)) {
  for (const [cat, lista] of Object.entries(cats)) {
    lista.forEach((precios, i) => {
      const nombre = `${NOMBRES[cat][i]} ${ciudad} (prueba)`;
      const clave = claveHotel(ciudad, cat, nombre);
      out.push(`INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES (${[clave, ciudad, cat, nombre].map(q).join(', ')}, 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;`);
      const filas = ['SGL', 'DBL', 'TPL'].map((hab, k) =>
        `((SELECT id FROM ct_hoteles WHERE clave = ${q(clave)}), '${hab}', ${precios[k] * 100}, 'USD', 'todas', '${VIG[0]}', '${VIG[1]}', 1, 'Seed de prueba (precios inventados)')`);
      out.push(`INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES\n  ${filas.join(',\n  ')};`);
    });
  }
}
writeFileSync(new URL('./seed-cotizador-ilustrativo.sql', import.meta.url), out.join('\n') + '\n');
console.log('ok:', SERVICIOS.length, 'servicios,', Object.values(HOTELES).reduce((n, c) => n + Object.values(c).flat().length, 0), 'hoteles');

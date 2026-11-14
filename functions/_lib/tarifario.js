// Tarifario del cotizador interno: normalización, lectura de filas (importador y pantalla) y control de solapamientos.
// Funciones puras (sin base): las usa /api/ct y las prueba crm/probar-tarifario.mjs.

export const TIPOS_SERVICIO = ['tour', 'traslado', 'tren', 'entrada', 'paquete'];
export const CATEGORIAS = ['economico', 'confort', 'premium'];
export const HABITACIONES = ['SGL', 'DBL', 'TPL'];
export const TEMPORADAS = ['todas', 'alta', 'baja'];
export const MONEDAS = ['USD', 'PEN'];
export const MAX_FILAS = 2000;

// Columnas de la plantilla, en orden. La pantalla arma la plantilla con esta lista.
export const COLUMNAS = [
  { col: 'tipo', ayuda: 'tour, traslado, tren, entrada, paquete u hotel' },
  { col: 'nombre', ayuda: 'Nombre del servicio o del hotel' },
  { col: 'ciudad', ayuda: 'Cusco, Lima, Puno, Aguas Calientes…' },
  { col: 'categoria_hotel', ayuda: 'Solo hoteles: economico, confort o premium' },
  { col: 'habitacion', ayuda: 'Solo hoteles: SGL, DBL o TPL (precio por habitación y por noche)' },
  { col: 'precio_neto', ayuda: 'Servicios: por persona. Hoteles: por habitación y noche. Ej. 45 o 45,50' },
  { col: 'moneda', ayuda: 'USD o PEN' },
  { col: 'pax_desde', ayuda: 'Tramo de pasajeros: desde (1 si va vacío)' },
  { col: 'pax_hasta', ayuda: 'Tramo de pasajeros: hasta. Vacío = "y más" (7+)' },
  { col: 'temporada', ayuda: 'todas, alta o baja (vacío = todas)' },
  { col: 'vigente_desde', ayuda: 'AAAA-MM-DD o DD/MM/AAAA' },
  { col: 'vigente_hasta', ayuda: 'AAAA-MM-DD o DD/MM/AAAA' },
  { col: 'precio_es_venta', ayuda: '"si" si el precio ya es de venta (lo opera o lo vende Luna Llena): no se le suma margen' },
  { col: 'duracion', ayuda: 'Opcional: "Medio día", "2D/1N"' },
  { col: 'incluye', ayuda: 'Opcional' },
  { col: 'no_incluye', ayuda: 'Opcional' },
  { col: 'pax_min', ayuda: 'Opcional: mínimo de pasajeros para que salga el servicio' },
  { col: 'es_ilustrativa', ayuda: 'Opcional: "si" para tarifas de prueba' },
];

// Otros nombres de columna que se aceptan (por si alguien cambia el encabezado).
const ALIAS = {
  servicio: 'nombre', hotel: 'nombre', categoria: 'categoria_hotel', precio: 'precio_neto', neto: 'precio_neto',
  tarifa: 'precio_neto', desde: 'vigente_desde', hasta: 'vigente_hasta', tramo: 'tramo_pax', pax: 'tramo_pax',
  tramo_pasajeros: 'tramo_pax', pasajeros: 'tramo_pax', habitacion_tipo: 'habitacion', minimo_pasajeros: 'pax_min',
  ilustrativa: 'es_ilustrativa', propio: 'precio_es_venta',
};

export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const claveServicio = (tipo, ciudad, nombre) => `${tipo}|${normalizar(ciudad)}|${normalizar(nombre)}`;
export const claveHotel = (ciudad, categoria, nombre) => `${normalizar(ciudad)}|${categoria}|${normalizar(nombre)}`;

// "1.234,50" "1,234.50" "45" "45,5" "US$ 45" "S/ 120" 45.5 -> centavos (entero) o null.
export function aCentavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  let s = String(v ?? '').trim().replace(/^(us\$|usd|s\/\.?|pen|\$)\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    // Una sola coma con 1-2 decimales = decimal; si no (1,234) = miles.
    s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (punto >= 0 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');                      // 1.234.567 = miles
  } else if (punto >= 0 && /\.\d{3}$/.test(s)) {
    s = s.replace('.', '');                         // 1.234 = miles (precios con 3 decimales no existen)
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};
// AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, DD/MM/AA o número de serie de Excel -> AAAA-MM-DD o null.
export function aFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Math.floor(Number(v));
    if (n < 20000 || n > 80000) return null;      // 1954..2119: fuera de eso no es una fecha de tarifa
    return new Date(Date.UTC(1899, 11, 30) + n * 86400e3).toISOString().slice(0, 10);
  }
  const s = String(v).trim().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

const siNo = (v) => {
  const s = normalizar(v);
  if (!s) return null;
  if (['si', 's', 'x', '1', 'true', 'yes', 'verdadero'].includes(s)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(s)) return false;
  return undefined;                                  // valor que no se entiende
};

const entero = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) ? n : NaN;
};

// Encabezados de la planilla -> nombres de columna conocidos.
export function columnaDe(encabezado) {
  const c = normalizar(encabezado).replace(/-/g, '_');
  if (COLUMNAS.some((x) => x.col === c) || c === 'tramo_pax') return c;
  return ALIAS[c] || null;
}

// Una fila cruda ({encabezado: valor}) -> { errores, avisos, d } con d normalizado.
// d.clase = 'servicio' | 'hotel'.
export function leerFila(cruda) {
  const f = {};
  for (const [k, v] of Object.entries(cruda || {})) {
    const c = columnaDe(k);
    if (c && f[c] === undefined) f[c] = typeof v === 'string' ? v.trim() : v;
  }
  const errores = [], avisos = [];
  const tipoTxt = normalizar(f.tipo);
  const esHotel = tipoTxt === 'hotel' || tipoTxt === 'hoteles' || tipoTxt === 'alojamiento';
  const tipo = esHotel ? 'hotel' : (TIPOS_SERVICIO.find((t) => t === tipoTxt || t + 's' === tipoTxt || t + 'es' === tipoTxt) || null);
  if (!tipo) errores.push(f.tipo ? `tipo "${f.tipo}" no existe (tour, traslado, tren, entrada, paquete u hotel)` : 'falta el tipo');

  const nombre = limpio(f.nombre);
  if (!nombre) errores.push('falta el nombre');
  else if (nombre.length > 160) errores.push('el nombre es demasiado largo');
  const ciudad = limpio(f.ciudad);
  if (!ciudad) errores.push('falta la ciudad');

  const neto = aCentavos(f.precio_neto);
  if (f.precio_neto === undefined || f.precio_neto === null || String(f.precio_neto).trim() === '') errores.push('falta el precio neto');
  else if (neto === null) errores.push(`el precio "${f.precio_neto}" no es un número`);
  else if (neto === 0) avisos.push('precio 0');

  const moneda = String(f.moneda ?? '').trim().toUpperCase().replace('US$', 'USD').replace(/^S\/\.?$/, 'PEN').replace(/^SOLES?$/, 'PEN').replace(/^DOLARES?$/, 'USD');
  if (!moneda) errores.push('falta la moneda (USD o PEN)');
  else if (!MONEDAS.includes(moneda)) errores.push(`moneda "${f.moneda}" no válida (USD o PEN)`);

  const temporadaTxt = normalizar(f.temporada) || 'todas';
  const temporada = TEMPORADAS.includes(temporadaTxt) ? temporadaTxt : null;
  if (!temporada) errores.push(`temporada "${f.temporada}" no válida (todas, alta o baja)`);

  const desde = aFecha(f.vigente_desde), hasta = aFecha(f.vigente_hasta);
  if (!f.vigente_desde) errores.push('falta vigente_desde');
  else if (!desde) errores.push(`vigente_desde "${f.vigente_desde}" no es una fecha`);
  if (!f.vigente_hasta) errores.push('falta vigente_hasta');
  else if (!hasta) errores.push(`vigente_hasta "${f.vigente_hasta}" no es una fecha`);
  if (desde && hasta && hasta < desde) errores.push('vigente_hasta es anterior a vigente_desde');

  const ilus = siNo(f.es_ilustrativa);
  if (ilus === undefined) errores.push(`es_ilustrativa "${f.es_ilustrativa}" no se entiende (si o no)`);

  const d = { tipo, nombre, ciudad, neto_cent: neto, moneda, temporada, vigente_desde: desde, vigente_hasta: hasta, es_ilustrativa: ilus ? 1 : 0 };

  if (esHotel) {
    d.clase = 'hotel';
    const cat = normalizar(f.categoria_hotel).replace(/-/g, '');
    const CAT_ALIAS = { economico: 'economico', economica: 'economico', '3': 'economico', '3estrellas': 'economico', confort: 'confort', comfort: 'confort', '4': 'confort', '4estrellas': 'confort', premium: 'premium', lujo: 'premium', '5': 'premium', '5estrellas': 'premium' };
    d.categoria = CAT_ALIAS[cat] || null;
    if (!f.categoria_hotel) errores.push('falta categoria_hotel (economico, confort o premium)');
    else if (!d.categoria) errores.push(`categoria_hotel "${f.categoria_hotel}" no válida (economico, confort o premium)`);
    const hab = String(f.habitacion ?? '').trim().toUpperCase();
    const HAB_ALIAS = { SGL: 'SGL', SIMPLE: 'SGL', SINGLE: 'SGL', INDIVIDUAL: 'SGL', DBL: 'DBL', DOBLE: 'DBL', MATRIMONIAL: 'DBL', TWIN: 'DBL', TPL: 'TPL', TRIPLE: 'TPL' };
    d.habitacion = HAB_ALIAS[hab] || null;
    if (!hab) errores.push('falta habitacion (SGL, DBL o TPL)');
    else if (!d.habitacion) errores.push(`habitacion "${f.habitacion}" no válida (SGL, DBL o TPL)`);
    const ventaH = siNo(f.precio_es_venta);
    if (ventaH === undefined) errores.push(`precio_es_venta "${f.precio_es_venta}" no se entiende (si o no)`);
    d.precio_es_venta = ventaH === null || ventaH === undefined ? null : (ventaH ? 1 : 0);
    if (f.pax_desde || f.pax_hasta || f.tramo_pax) avisos.push('los hoteles no usan tramo de pasajeros: se ignora');
    if (d.categoria && nombre && ciudad) d.clave = claveHotel(ciudad, d.categoria, nombre);
  } else {
    d.clase = 'servicio';
    let pd = entero(f.pax_desde), ph = entero(f.pax_hasta);
    // "7+" o "2-3" escrito en pax_desde con pax_hasta vacío: se lee como tramo.
    if (Number.isNaN(pd) && ph === null && (f.tramo_pax === undefined || String(f.tramo_pax).trim() === '')) { f.tramo_pax = f.pax_desde; pd = null; }
    if (f.tramo_pax !== undefined && f.tramo_pax !== null && String(f.tramo_pax).trim() !== '' && pd === null && ph === null) {
      const t = String(f.tramo_pax).trim();
      let m;
      if ((m = t.match(/^(\d+)\s*\+$/)) || (m = t.match(/^(\d+)\s*(?:o|y)\s*m[aá]s$/i))) { pd = +m[1]; ph = null; }
      else if ((m = t.match(/^(\d+)\s*(?:-|a|al)\s*(\d+)$/i))) { pd = +m[1]; ph = +m[2]; }
      else if ((m = t.match(/^(\d+)$/))) { pd = +m[1]; ph = +m[1]; }
      else errores.push(`tramo de pasajeros "${t}" no se entiende (ej. 1, 2-3, 7+)`);
    }
    if (Number.isNaN(pd) || (pd !== null && pd < 1)) { errores.push('pax_desde tiene que ser un número entero desde 1'); pd = null; }
    if (Number.isNaN(ph) || (ph !== null && ph < 1)) { errores.push('pax_hasta tiene que ser un número entero (o vacío = y más)'); ph = null; }
    d.pax_desde = pd ?? 1;
    d.pax_hasta = ph;
    if (d.pax_hasta !== null && d.pax_hasta < d.pax_desde) errores.push('pax_hasta es menor que pax_desde');
    const venta = siNo(f.precio_es_venta);
    if (venta === undefined) errores.push(`precio_es_venta "${f.precio_es_venta}" no se entiende (si o no)`);
    d.precio_es_venta = venta === null ? null : (venta ? 1 : 0);   // null = no tocar lo que ya está
    const pm = entero(f.pax_min);
    if (Number.isNaN(pm) || (pm !== null && pm < 1)) errores.push('pax_min tiene que ser un número entero desde 1');
    d.pax_min = Number.isInteger(pm) ? pm : null;
    d.duracion = limpio(f.duracion) || null;
    d.incluye = limpio(f.incluye) || null;
    d.no_incluye = limpio(f.no_incluye) || null;
    if (tipo && nombre && ciudad) d.clave = claveServicio(tipo, ciudad, nombre);
  }
  return { errores, avisos, d };
}

const tempsSolapan = (a, b) => a === 'todas' || b === 'todas' || a === b;
const paxSolapan = (a, b) => {
  const ah = a.pax_hasta ?? Infinity, bh = b.pax_hasta ?? Infinity;
  return a.pax_desde <= bh && b.pax_desde <= ah;
};
const fechasSolapan = (a, b) => a.vigente_desde <= b.vigente_hasta && b.vigente_desde <= a.vigente_hasta;

// ¿Dos tarifas cubren el mismo caso? (mismo servicio u hotel+habitación, temporada, pasajeros y fechas)
export function solapan(a, b) {
  if (a.clase !== b.clase || a.clave !== b.clave) return false;
  if (a.clase === 'hotel' && a.habitacion !== b.habitacion) return false;
  if (!tempsSolapan(a.temporada, b.temporada) || !fechasSolapan(a, b)) return false;
  return a.clase === 'hotel' ? true : paxSolapan(a, b);
}

const tramo = (t) => t.clase === 'hotel' ? t.habitacion : (t.pax_hasta === null || t.pax_hasta === undefined ? `${t.pax_desde}+` : t.pax_desde === t.pax_hasta ? `${t.pax_desde}` : `${t.pax_desde}-${t.pax_hasta}`);
export const describirTramo = tramo;

// Revisa un archivo entero. existentes = tarifas que ya están en la base (mismo formato que d, con id y es_ilustrativa).
// Dos tarifas reales (o dos de prueba) que se pisan son error; una real contra una de prueba es aviso.
// Con reemplazarIlustrativas, las de prueba de la base no cuentan (se borran al aplicar).
export function revisarArchivo(filasCrudas, existentes = [], { reemplazarIlustrativas = false } = {}) {
  if (!Array.isArray(filasCrudas)) return { error: 'No llegaron filas' };
  if (filasCrudas.length > MAX_FILAS) return { error: `El archivo tiene ${filasCrudas.length} filas; el máximo es ${MAX_FILAS}` };
  const base = existentes.filter((e) => !(reemplazarIlustrativas && e.es_ilustrativa));
  const filas = [];
  filasCrudas.forEach((cruda, i) => {
    // Filas vacías (todas las celdas en blanco) se saltean sin error.
    if (!Object.values(cruda || {}).some((v) => String(v ?? '').trim() !== '')) return;
    const r = leerFila(cruda);
    filas.push({ n: i + 2, ...r });                  // n = número de fila en la planilla (1 = encabezado)
  });
  for (let i = 0; i < filas.length; i++) {
    const a = filas[i];
    if (a.errores.length || !a.d.clave) continue;
    for (let j = 0; j < i; j++) {
      const b = filas[j];
      if (b.errores.length || !b.d.clave) continue;
      if (solapan(a.d, b.d) && a.d.es_ilustrativa === b.d.es_ilustrativa) {
        a.errores.push(`se pisa con la fila ${b.n} (mismo ${a.d.clase === 'hotel' ? 'hotel y habitación' : 'servicio y tramo'}, temporada y fechas)`);
        break;
      }
    }
    for (const e of base) {
      if (!solapan(a.d, e)) continue;
      if (e.es_ilustrativa === a.d.es_ilustrativa) {
        a.errores.push(`ya hay una tarifa para ${a.d.nombre} (${tramo(e)}, ${e.temporada}) del ${e.vigente_desde} al ${e.vigente_hasta}: cerrá su vigencia antes de cargar otra`);
        break;
      }
      if (!a.d.es_ilustrativa) { a.avisos.push('convive con una tarifa de prueba (tildá "Reemplazar las de prueba" para borrarlas)'); break; }
    }
  }
  const ok = filas.filter((f) => !f.errores.length).length;
  return {
    filas,
    resumen: {
      total: filas.length, ok, con_error: filas.length - ok,
      servicios: new Set(filas.filter((f) => f.d.clase === 'servicio' && f.d.clave).map((f) => f.d.clave)).size,
      hoteles: new Set(filas.filter((f) => f.d.clase === 'hotel' && f.d.clave).map((f) => f.d.clave)).size,
    },
  };
}

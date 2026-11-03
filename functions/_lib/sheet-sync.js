// Normalizadores del sync Google Sheet -> CRM (ver functions/api/sheet-sync.js).

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Usuario de Instagram: letras, números, punto y guion bajo, hasta 30.
const RE_IG = /^[a-z0-9._]{1,30}$/;

// Etapas de prospección de Luna Llena, en orden (cada automatización de
// ManyChat escribe la suya en el Sheet): DIAS ("¿cuántos días?", abre la
// conversación) -> RECORRIDO (se le comparte el link de un recorrido nuestro)
// -> PITCH (pitch del formulario) -> FORMULARIO (formulario enviado) ->
// CONSULTA (formulario completado / confirmación).
// PIEZA no es una etapa: es cada interacción con una pieza de contenido
// (palabra clave de un reel, respuesta a una historia), con su etiqueta en la
// columna Pieza. De ahí salen apertura, nutrición y gatillo.
// INBOUND y FUP quedan del modelo anterior.
export const ETAPAS = ['DIAS', 'RECORRIDO', 'PITCH', 'FORMULARIO', 'CONSULTA'];
export const EVENTOS = [...ETAPAS, 'PIEZA', 'INBOUND', 'FUP'];
// Nombres viejos del Sheet anterior (modelo con llamadas).
const RENOMBRES = { CALENDARIO: 'FORMULARIO', CALL: 'CONSULTA', FUPS: 'FUP', 'DÍAS': 'DIAS' };

export function texto(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

export function fechaOVacio(v) {
  const s = texto(v, 10);
  return RE_FECHA.test(s) ? s : null;
}

// "@Juan.Perez " -> "juan.perez". Devuelve null si no parece un usuario de
// Instagram (por ejemplo un nombre viejo con espacios: "Juan Pérez").
export function usuarioIg(v) {
  const s = texto(v, 80).replace(/^@+/, '').toLowerCase();
  return RE_IG.test(s) ? s : null;
}

export function evento(v) {
  let s = texto(v, 30).toUpperCase();
  s = RENOMBRES[s] || s;
  return EVENTOS.includes(s) ? s : null;
}

// Calificado del Sheet -> claves de CALIFICACIONES del panel (si | masomenos | curioso).
export function calificado(v) {
  const s = texto(v, 40).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s === 'si') return 'si';
  if (s === 'masomenos' || s === 'medio') return 'masomenos';
  if (s === 'curioso') return 'curioso';
  return null;
}

// Placeholders "?,?,?" para un IN (...).
export function marcas(n) {
  return Array(n).fill('?').join(',');
}

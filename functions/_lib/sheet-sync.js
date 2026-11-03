// Normalizadores del sync Google Sheet -> CRM (ver functions/api/sheet-sync.js).

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Usuario de Instagram: letras, números, punto y guion bajo, hasta 30.
const RE_IG = /^[a-z0-9._]{1,30}$/;

export const EVENTOS = ['INBOUND', 'FUP', 'CALENDARIO', 'CALL'];

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
  const s = texto(v, 30).toUpperCase().replace(/^FUPS$/, 'FUP');
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

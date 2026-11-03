// Lo que comparten el popup, las opciones, el background y los content scripts.
// Nada de URLs fijas: el CRM al que se habla es el último panel que se abrió
// (lo guarda conectar.js en chrome.storage.local).

const COLORES_POR_DEFECTO = { brand: '#C8102E', glacier: '#3A1712' };

const FORMATOS = [
  'Broll Narrativo', 'Broll Texto', 'Clips Plan/Experiencia', 'Clip/s Paisaje', 'POV Paisaje',
  'Carrusel', 'Foto con copy', 'MEME', 'GRWM', '3ra Persona', 'Versus Victor H', 'Talking Head',
];

const CATEGORIAS_ANGULO = ['Problema', 'Solución', 'Producto', 'Otros'];

const MSJ_DESCONECTADA = 'Abrí el panel del CRM para conectar la extensión';

// Mismo criterio que codigoIg() del CRM: /p/CODE, /reel/CODE, /reels/CODE,
// con o sin el usuario adelante. Acepta links relativos.
function codigoIg(url) {
  return String(url || '').match(/(?:instagram\.com)?\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/)?.[1] || null;
}

function urlDePost(codigo) {
  return `https://www.instagram.com/p/${codigo}/`;
}

function leerConexion() {
  return chrome.storage.local.get(['crmUrl', 'crmToken', 'crmNombre', 'colores', 'avisoCambio']);
}

class SinConexion extends Error {
  constructor() { super(MSJ_DESCONECTADA); this.sinConexion = true; }
}

// Toda llamada al CRM pasa por acá. Un 401 quiere decir que el token se rotó
// o que es de otro CRM: se borra y hay que volver a abrir el panel.
async function apiCrm(ruta, { method = 'GET', body } = {}) {
  const { crmUrl, crmToken } = await leerConexion();
  if (!crmUrl || !crmToken) throw new SinConexion();
  const r = await fetch(crmUrl + ruta, {
    method,
    headers: { 'x-crm-token': crmToken, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    await chrome.storage.local.remove('crmToken');
    throw new SinConexion();
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || `El CRM respondió ${r.status}`), { status: r.status });
  return datos;
}

// --- Colores ---------------------------------------------------------------
// El CRM expone --brand y --glacier, pero según el cliente cuál es la tinta y
// cuál el acento cambia (en Visite --brand es el azul oscuro; en la plantilla
// es el rojo). Se decide por luminancia: el más oscuro es la tinta.

function aRgb(color) {
  const s = String(color || '').trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (m) return m.slice(1, 4).map(Number);
  return null;
}

function aHex(color) {
  const rgb = aRgb(color);
  return rgb ? '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase() : null;
}

function luminancia(color) {
  const rgb = aRgb(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contraste contra blanco (fórmula WCAG).
function contrasteConBlanco(color) {
  return 1.05 / (luminancia(color) + 0.05);
}

function paleta(colores) {
  const brand = aHex(colores?.brand) || COLORES_POR_DEFECTO.brand;
  const glacier = aHex(colores?.glacier) || COLORES_POR_DEFECTO.glacier;
  return luminancia(brand) <= luminancia(glacier)
    ? { tinta: brand, acento: glacier }
    : { tinta: glacier, acento: brand };
}

function aplicarPaleta(el, colores) {
  const p = paleta(colores);
  el.style.setProperty('--crm-tinta', p.tinta);
  el.style.setProperty('--crm-acento', p.acento);
}

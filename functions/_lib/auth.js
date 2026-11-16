// Un solo lugar para validar el token del CRM.
//
// Dos secrets, dos roles:
//   CRM_TOKEN        -> 'cliente'  (el que ya existía; lo usa el agente de viajes)
//   CRM_ADMIN_TOKEN  -> 'admin'    (Organic Travelling; configura Objetivos)
//   CRM_COTIZADOR_TOKEN -> 'cotizador' (Álvaro: solo Cotizaciones; ver rolDeCotizaciones)
//
// El rol lo decide SOLO esta función, en la Function, contra el secret. El
// front recibe el rol por /api/yo para mostrar u ocultar botones, nada más:
// un cliente que se fabrique el botón igual recibe 403 acá.
//
// Revocar = rotar el secret en Pages. Los tokens no viven en git ni en la base.

function iguales(a, b) {
  // Comparación en tiempo constante: no filtrar por timing cuántos chars coinciden.
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Devuelve 'admin' | 'cliente' | null (el rol 'cotizador' va aparte: ver rolDeCotizaciones).
export function rolDe(request, env) {
  const token = request.headers.get('x-crm-token');
  if (!token) return null;
  if (env.CRM_ADMIN_TOKEN && iguales(token, env.CRM_ADMIN_TOKEN)) return 'admin';
  if (env.CRM_TOKEN && iguales(token, env.CRM_TOKEN)) return 'cliente';
  return null;
}

// Rol 'cotizador' (CRM_COTIZADOR_TOKEN): lo usa Álvaro y solo entra a Cotizaciones.
// A propósito NO está en rolDe(): los endpoints que ya existían usan rolDe/checkToken
// y así le dan 401 sin tocar ninguno. Solo /api/ct/* y /api/yo preguntan por acá.
export function rolDeCotizaciones(request, env) {
  const rol = rolDe(request, env);
  if (rol) return rol;
  const token = request.headers.get('x-crm-token');
  if (token && env.CRM_COTIZADOR_TOKEN && iguales(token, env.CRM_COTIZADOR_TOKEN)) return 'cotizador';
  return null;
}

// Compatibilidad con los endpoints que ya existían: cualquiera de los dos
// roles entra. Mismo nombre que la función que cada archivo tenía copiada.
export function checkToken(request, env) {
  return rolDe(request, env) !== null;
}

// Inbox: el equipo y también Álvaro (cotizador), que contesta y manda la propuesta desde ahí.
export function checkInbox(request, env) {
  return rolDeCotizaciones(request, env) !== null;
}

export function esAdmin(request, env) {
  return rolDe(request, env) === 'admin';
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

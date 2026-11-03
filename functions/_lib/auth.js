// Un solo lugar para validar el token del CRM.
//
// Dos secrets, dos roles:
//   CRM_TOKEN        -> 'cliente'  (el que ya existía; lo usa el agente de viajes)
//   CRM_ADMIN_TOKEN  -> 'admin'    (Organic Travelling; configura Objetivos)
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

// Devuelve 'admin' | 'cliente' | null.
export function rolDe(request, env) {
  const token = request.headers.get('x-crm-token');
  if (!token) return null;
  if (env.CRM_ADMIN_TOKEN && iguales(token, env.CRM_ADMIN_TOKEN)) return 'admin';
  if (env.CRM_TOKEN && iguales(token, env.CRM_TOKEN)) return 'cliente';
  return null;
}

// Compatibilidad con los endpoints que ya existían: cualquiera de los dos
// roles entra. Mismo nombre que la función que cada archivo tenía copiada.
export function checkToken(request, env) {
  return rolDe(request, env) !== null;
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

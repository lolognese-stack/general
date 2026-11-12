// Cifrado de los datos de pasaporte en venta_viajeros (doc_numero y fecha_nacimiento).
//
// AES-GCM de 256 bits con la clave del secret PASAPORTES_KEY (32 bytes en base64, solo en Cloudflare).
// En la base queda "enc1:<iv+texto cifrado en base64>": una exportación de la D1, Time Travel o la
// consola de Cloudflare no muestran el dato. Las APIs con token lo descifran para el panel.
//
// Generar y cargar la clave (sin que se vea en pantalla):
//   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler pages secret put PASAPORTES_KEY --project-name crm-plantilla
// Si se pierde la clave, los pasaportes guardados ya no se pueden leer (se vuelven a pedir).

const PREFIJO = 'enc1:';
export const CAMPOS_CIFRADOS = ['doc_numero', 'fecha_nacimiento'];

const b64 = (u8) => { let s = ''; u8.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
const desB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cache = { raw: null, key: null };
async function clave(env) {
  const raw = env.PASAPORTES_KEY;
  if (!raw) return null;
  if (cache.raw === raw) return cache.key;
  const bytes = desB64(raw.trim());
  if (bytes.length !== 32) throw new Error('PASAPORTES_KEY tiene que ser 32 bytes en base64');
  cache = { raw, key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  return cache.key;
}

export const hayClave = (env) => Boolean(env.PASAPORTES_KEY);

export async function cifrar(env, texto) {
  if (texto == null || texto === '' || String(texto).startsWith(PREFIJO)) return texto ?? null;
  const k = await clave(env);
  if (!k) return texto; // el panel sigue funcionando como antes si todavía no hay clave
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(String(texto))));
  const todo = new Uint8Array(iv.length + ct.length);
  todo.set(iv); todo.set(ct, iv.length);
  return PREFIJO + b64(todo);
}

export async function descifrar(env, valor) {
  if (typeof valor !== 'string' || !valor.startsWith(PREFIJO)) return valor;
  const k = await clave(env);
  if (!k) return '(cifrado)';
  try {
    const todo = desB64(valor.slice(PREFIJO.length));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: todo.slice(0, 12) }, k, todo.slice(12));
    return new TextDecoder().decode(pt);
  } catch { return '(no se pudo descifrar)'; }
}

export async function descifrarViajeros(env, lista) {
  return Promise.all((lista || []).map(async (w) => {
    const out = { ...w };
    for (const c of CAMPOS_CIFRADOS) out[c] = await descifrar(env, w[c]);
    return out;
  }));
}

// Borrado automático: 30 días después del regreso se borran el pasaporte y la fecha de nacimiento
// de las ventas que entraron desde una propuesta (las cargadas a mano no se tocan). Queda el nombre.
// Corre "a demanda" cuando se usa Ventas o llega una reserva: Pages no tiene tareas programadas.
export async function purgarPasaportes(env) {
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT w.venta_id FROM venta_viajeros w JOIN ventas v ON v.id = w.venta_id
     WHERE v.origen = 'propuesta' AND (w.doc_numero IS NOT NULL OR w.fecha_nacimiento IS NOT NULL)
       AND date(coalesce(v.fecha_fin, v.fecha_inicio)) < date('now', '-30 days')`).all();
  if (!results.length) return 0;
  const ahora = new Date().toISOString();
  const st = [];
  for (const { venta_id } of results) {
    st.push(env.DB.prepare('UPDATE venta_viajeros SET doc_numero = NULL, fecha_nacimiento = NULL, actualizado_en = ? WHERE venta_id = ?').bind(ahora, venta_id));
    st.push(env.DB.prepare(`INSERT INTO venta_eventos (venta_id, tipo, detalle, autor, creado_en) VALUES (?, 'viajeros', ?, 'sistema', ?)`)
      .bind(venta_id, 'Se borraron los pasaportes y fechas de nacimiento (30 días después del viaje)', ahora));
  }
  await env.DB.batch(st);
  return results.length;
}

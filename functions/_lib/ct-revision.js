// Link de revisión de una cotización (para Álvaro, desde el celular, sin contraseña).
// El link es /r/#<token>: el token va después del # para que no viaje en la URL al servidor ni quede en logs ni en el Referer.
// En la base solo queda el SHA-256 del token. Vence a los 30 días; generar uno nuevo invalida el anterior.
import { json } from './auth.js';
import { vistaCotizacion, cambiarEstado } from './ct-cotizaciones.js';
import { webhookDiscord, mandarDiscord } from './propuestas.js';

const DIAS_VALIDEZ = 30;
export const TOKEN_OK = /^[A-Za-z0-9_-]{43}$/;
const ahora = "datetime('now')";

export async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenNuevo() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Desde el CRM: deja la cotización en revisión. Genera link si no hay uno vigente o si se pide uno nuevo.
export async function mandarARevision(env, cotId, body, por) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return json({ error: 'No existe' }, 404);
  if (!['borrador', 'cambios_pedidos', 'en_revision'].includes(cot.estado)) return json({ error: 'Esta versión ya no se puede mandar a revisión' }, 409);
  const ult = await env.DB.prepare(`SELECT id FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC LIMIT 1`).bind(cot.pedido_id).first();
  if (ult.id !== cot.id) return json({ error: 'Hay una versión más nueva' }, 409);
  const vista = await vistaCotizacion(env, cotId);
  if (!vista.lineas.length) return json({ error: 'La cotización no tiene líneas' }, 400);
  const revisor = String(body.revisor || 'Álvaro').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || 'Álvaro';
  const vigente = cot.token_hash && cot.token_vence && cot.token_vence > new Date().toISOString().replace('T', ' ').slice(0, 19);
  let token = null;
  const stmts = [];
  if (body.nuevo_link || !vigente) {
    token = tokenNuevo();
    const vence = new Date(Date.now() + DIAS_VALIDEZ * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET token_hash = ?, token_vence = ?, revisor = ? WHERE id = ?`).bind(await sha256(token), vence, revisor, cotId));
  }
  stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'en_revision', actualizado_en = ${ahora} WHERE id = ?`).bind(cotId));
  await env.DB.batch(stmts);
  await cambiarEstado(env, cot.pedido_id, 'en_revision', por, `Versión ${cot.version} a revisión de ${revisor}`);
  return json({ ok: true, token, link_nuevo: !!token, revisor, usa_prueba: vista.cotizacion.usa_prueba });
}

// Desde el link: la cotización del token (o un error HTTP listo para devolver).
export async function cotizacionDeToken(env, token) {
  if (!TOKEN_OK.test(token || '')) return { err: json({ error: 'Link no válido' }, 404) };
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE token_hash = ?`).bind(await sha256(token)).first();
  if (!cot) return { err: json({ error: 'Este link no existe o fue reemplazado por uno nuevo' }, 404) };
  if (!cot.token_vence || cot.token_vence < new Date().toISOString().replace('T', ' ').slice(0, 19)) return { err: json({ error: 'Este link venció: pedí uno nuevo' }, 410) };
  return { cot };
}

async function avisar(env, tipo, texto) {
  try {
    await env.DB.prepare('INSERT INTO propuesta_alertas (slug, tipo, texto, dispositivo) VALUES (?, ?, ?, ?)').bind('-', tipo, texto, null).run();
    const url = await webhookDiscord(env);
    if (url) await mandarDiscord(url, texto);
  } catch { /* el cambio de estado ya quedó: el aviso es un extra */ }
}

export async function aprobar(env, cot, body) {
  if (!['en_revision', 'cambios_pedidos'].includes(cot.estado)) return json({ error: cot.estado === 'aprobada' ? 'Ya está aprobada' : 'Esta versión ya no se puede aprobar' }, 409);
  const vista = await vistaCotizacion(env, cot.id);
  if (vista.totales.problemas) return json({ error: `Hay ${vista.totales.problemas} líneas sin precio: completalas antes de aprobar` }, 409);
  const por = cot.revisor || 'Revisión';
  const nota = String(body.nota || '').trim().slice(0, 1000) || null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'aprobada', aprobada_por = ?, aprobada_en = ${ahora}, actualizado_en = ${ahora},
      notas_alvaro = CASE WHEN ? IS NULL THEN notas_alvaro WHEN COALESCE(TRIM(notas_alvaro), '') = '' THEN ? ELSE notas_alvaro || char(10) || ? END WHERE id = ?`).bind(por, nota, nota, nota, cot.id),
  ]);
  await cambiarEstado(env, cot.pedido_id, 'aprobada', por, `Versión ${cot.version} aprobada`);
  const t = vista.totales;
  await avisar(env, 'cotizacion_aprobada', `${por} aprobó la cotización de ${vista.pedido.nombre} (v${cot.version}): US$ ${(t.venta_cent / 100).toFixed(2)}${vista.cotizacion.usa_prueba ? ' · PRECIOS DE PRUEBA, no se puede mandar' : ''}`);
  return json({ ok: true, ...(await vistaCotizacion(env, cot.id)) });
}

export async function pedirCambios(env, cot, body) {
  if (!['en_revision', 'cambios_pedidos'].includes(cot.estado)) return json({ error: 'Esta versión ya no admite cambios' }, 409);
  const texto = String(body.texto || '').trim().slice(0, 2000);
  if (!texto) return json({ error: 'Escribí qué hay que cambiar' }, 400);
  const por = cot.revisor || 'Revisión';
  const p = await env.DB.prepare(`SELECT nombre FROM ct_pedidos WHERE id = ?`).bind(cot.pedido_id).first();
  await env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'cambios_pedidos', pedido_cambios = ?, actualizado_en = ${ahora} WHERE id = ?`).bind(texto, cot.id).run();
  await cambiarEstado(env, cot.pedido_id, 'borrador_listo', por, `Pidió cambios: ${texto.slice(0, 250)}`);
  await avisar(env, 'cotizacion_cambios', `${por} pidió cambios en la cotización de ${p?.nombre || '?'} (v${cot.version}): ${texto.slice(0, 300)}`);
  return json({ ok: true, ...(await vistaCotizacion(env, cot.id)) });
}

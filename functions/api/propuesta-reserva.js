// Reserva enviada desde luna-llena-propuestas.vercel.app/<slug>/reservar/ (rewrite /api/propuesta-reserva/).
// Crea una venta en el CRM (origen 'propuesta', pendiente de pago) con sus viajeros. El pasaporte y la fecha
// de nacimiento se guardan cifrados (_lib/cifrado.js): sin PASAPORTES_KEY no se guarda nada.
// Precio, pasajeros, seña y vencimiento salen de la página publicada, nunca del body.
// No se loguea el body ni se devuelve ningún dato de los pasajeros.
import { SLUG, datosPublicados, propuestaVerificada, webhookDiscord, mandarDiscord, PROPUESTAS_URL } from '../_lib/propuestas.js';
import { cifrar, hayClave, purgarPasaportes } from '../_lib/cifrado.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PASAPORTE = /^[A-Z0-9-]{5,20}$/;
const hoyPe = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const txt = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!hayClave(env)) return json({ error: 'La reserva online todavía no está habilitada. Escríbenos por WhatsApp y la cerramos por ahí.' }, 503);
  const crudo = await request.text();
  if (crudo.length > 20000) return json({ error: 'Solicitud demasiado grande' }, 413);
  let b;
  try { b = JSON.parse(crudo); } catch { return json({ error: 'Solicitud inválida' }, 400); }

  const slug = typeof b.slug === 'string' ? b.slug : '';
  if (!SLUG.test(slug) || slug.startsWith('_')) return json({ error: 'Propuesta inválida' }, 400);
  const d = await datosPublicados(env, slug);
  if (!d || !d.precio || !d.viaje) return json({ error: 'No encontramos esta propuesta' }, 404);
  if (d.status === 'confirmada') return json({ error: 'Este viaje ya está confirmado. Si quieres cambiar algo, escríbenos por WhatsApp.' }, 409);
  if (d.validUntil && hoyPe() > d.validUntil) return json({ error: 'Esta propuesta venció. Escríbenos para actualizarla.', vencida: true }, 409);

  // ----- validación -----
  if (b.acepta_terminos !== true) return json({ error: 'Falta aceptar los términos y condiciones' }, 400);
  if (b.terminos_version !== d.terminosVersion) return json({ error: 'Los términos cambiaron: recarga la página y vuelve a aceptarlos' }, 409);
  const email = txt(b.contacto && b.contacto.email, 254);
  const whatsapp = txt(b.contacto && b.contacto.whatsapp, 30);
  if (!EMAIL.test(email)) return json({ error: 'Revisa el email de contacto' }, 400);
  if ((whatsapp.match(/\d/g) || []).length < 7) return json({ error: 'Revisa el WhatsApp de contacto' }, 400);
  const pax = Number(d.pasajeros) || 0;
  const lista = Array.isArray(b.pasajeros) ? b.pasajeros : [];
  if (!pax || lista.length !== pax) return json({ error: `Faltan datos: son ${pax} pasajeros` }, 400);
  const viajeros = [];
  for (let i = 0; i < pax; i++) {
    const p = lista[i] || {};
    const n = i + 1;
    const nombre = txt(p.nombre, 120);
    const pasaporte = txt(p.pasaporte, 20).toUpperCase().replace(/\s/g, '');
    const nacionalidad = txt(p.nacionalidad, 60);
    const nacimiento = txt(p.nacimiento, 10);
    if (nombre.length < 3) return json({ error: `Pasajero ${n}: nombre completo como figura en el pasaporte` }, 400);
    if (!PASAPORTE.test(pasaporte)) return json({ error: `Pasajero ${n}: revisa el número de pasaporte` }, 400);
    if (nacionalidad.length < 3) return json({ error: `Pasajero ${n}: falta la nacionalidad` }, 400);
    if (!FECHA.test(nacimiento) || nacimiento < '1900-01-01' || nacimiento >= hoyPe()) return json({ error: `Pasajero ${n}: revisa la fecha de nacimiento` }, 400);
    viajeros.push({ orden: n, nombre, pasaporte, nacionalidad, nacimiento, menor: nacimiento > restarAnios(d.viaje.inicio, 18) });
  }

  // ----- montos (de la página) -----
  const sena_pct = Number(d.pago && d.pago['señaPorcentaje']) || 50;
  const total = Math.round(Number(d.precio.totalPP) * pax * 100);
  const sena = Math.round(total * sena_pct / 100);
  const ahora = new Date().toISOString();

  // Doble envío (doble clic, reintento): misma propuesta y mismo email en los últimos 15 minutos.
  const previa = await env.DB.prepare(`SELECT id FROM ventas WHERE origen = 'propuesta' AND producto_slug = ? AND email = ? AND creado_en > ?`)
    .bind(slug, email, new Date(Date.now() - 15 * 60e3).toISOString()).first();
  if (previa) return json({ ok: true, repetida: true, sena_centavos: sena, total_centavos: total, moneda: 'USD' });

  const id = crypto.randomUUID();
  const meta = { propuesta: slug, numero: d.numero, version: d.version || 1, terminos: { version: d.terminosVersion, aceptado_en: ahora }, opcionales: [] };
  const st = [
    env.DB.prepare(`INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, fecha_inicio, fecha_fin, adultos, menores, moneda,
        total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, meta_json, creado_en, actualizado_en)
      VALUES (?, NULL, 'propuesta', ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'pendiente_pago', ?, ?, ?, ?, ?, ?)`)
      .bind(id, slug, `${d.viaje.nombre || 'Propuesta'} · N° ${d.numero}`, d.viaje.inicio, d.viaje.fin || null,
        viajeros.filter((w) => !w.menor).length, viajeros.filter((w) => w.menor).length,
        total, sena_pct, sena, viajeros[0].nombre, email, whatsapp, JSON.stringify(meta), ahora, ahora),
  ];
  for (const w of viajeros) {
    st.push(env.DB.prepare(`INSERT INTO venta_viajeros (venta_id, orden, nombre_completo, nacionalidad, doc_tipo, doc_numero, fecha_nacimiento, es_menor, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, 'pasaporte', ?, ?, ?, ?, ?)`)
      .bind(id, w.orden, w.nombre, w.nacionalidad, await cifrar(env, w.pasaporte), await cifrar(env, w.nacimiento), w.menor ? 1 : 0, ahora, ahora));
  }
  const ev = (tipo, detalle) => env.DB.prepare(`INSERT INTO venta_eventos (venta_id, tipo, detalle, autor, creado_en) VALUES (?, ?, ?, 'propuesta', ?)`).bind(id, tipo, detalle, ahora);
  st.push(ev('creada', `Reserva desde la propuesta ${slug} (N° ${d.numero}): ${pax} pasajeros, seña ${sena_pct}%`));
  st.push(ev('nota', `Aceptó los términos y condiciones (versión ${d.terminosVersion}) el ${ahora}`));
  st.push(ev('viajeros', `${pax} de ${pax} completos`));
  await env.DB.batch(st);

  // Seguimiento + aviso (sin límite de 6 h: cada reserva importa).
  const prop = (await propuestaVerificada(env, slug)) || { slug, numero: d.numero, cliente: d.cliente };
  const quien = `${prop.cliente || slug}${prop.numero ? ` (N° ${prop.numero})` : ''}`;
  const texto = `${quien} envió la reserva: ${pax} pasajeros, seña USD ${(sena / 100).toFixed(2)}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO propuesta_eventos (slug, evento, detalle, dispositivo) VALUES (?, 'reserva', NULL, NULL)`).bind(slug),
    env.DB.prepare(`INSERT INTO propuesta_alertas (slug, tipo, texto) VALUES (?, 'reserva', ?)`).bind(slug, texto),
  ]);
  const tareas = (async () => {
    await purgarPasaportes(env).catch(() => {});
    const url = await webhookDiscord(env);
    if (url) await mandarDiscord(url, `**${texto}** · revisar en Ventas del CRM\n<${PROPUESTAS_URL(env)}/${slug}/>`).catch(() => {});
  })();
  if (waitUntil) waitUntil(tareas); else await tareas;

  return json({ ok: true, sena_centavos: sena, total_centavos: total, moneda: 'USD' });
}

function restarAnios(iso, n) {
  if (!FECHA.test(iso || '')) return '0000-00-00';
  return `${Number(iso.slice(0, 4)) - n}${iso.slice(4)}`;
}

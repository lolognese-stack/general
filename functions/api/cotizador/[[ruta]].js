import { checkToken, json } from '../../_lib/auth.js';

// Cotizador de Luna Llena (repo luna-llena-cotizador, en Vercel) usado a mano desde el panel.
//
// El navegador nunca ve COTIZADOR_TOKEN: habla con esta Function (token del CRM) y esta
// Function habla con el cotizador. Sin COTIZADOR_TOKEN la pestaña no aparece (solo Luna Llena
// tiene el secret; nuevo-cliente.py no lo copia).
//
//   GET  /api/cotizador/estado    -> { activo }
//   GET  /api/cotizador/catalogo  -> productos del catálogo de la web (para el buscador)
//   POST /api/cotizador/cotizar   -> { pedido, nombre?, idioma?, dias_disponibles? } -> /v1/cotizar
//   POST /api/cotizador/turno     -> { mensaje, estado? } -> /v1/turno (pegar chat)
//   GET  /api/cotizador/rutas     -> rutas, ciudades y categorías de hotel para viajes a medida (/v1/rutas)
//   POST /api/cotizador/medida    -> { solicitud, categorias?, nombre?, idioma? } -> /v1/medida (la misma ruta en cada categoría)
//   POST /api/cotizador/guardar   -> { lead_id, enviada?, quien?, pedido, nombre?, idioma?, ... } (recotiza y guarda)
//   GET  /api/cotizador/lead/<id> -> cotizaciones guardadas de ese lead (tabla cotizador_cotizaciones, migración 048)
//   POST /api/cotizador/excel     -> { texto, modo: excel|tarifario } -> /v1/excel (lee un presupuesto pegado de Excel)
//   GET  /api/cotizador/armador/catalogo -> destinos, excursiones y paquetes del armador de propuestas
//   POST /api/cotizador/armador/extraer  -> armador /api/propuesta-extraer (la IA lee la cotización)
//   POST /api/cotizador/armador/generar  -> armador /api/propuesta-generar (arma el HTML de la propuesta)
//
// El armador (repo luna-llena-armador, Cloudflare Pages) se usa con el secret ARMADOR_TOKEN, que el navegador
// nunca ve. Sin ese secret el modo Propuesta no aparece.
//
// Los precios los calcula el cotizador por código; esta Function no toca importes.

const URL_COTIZADOR = 'https://luna-llena-cotizador.vercel.app';
const URL_CATALOGO = 'https://lunallenatravel.vercel.app/data/catalogo.json';
const URL_PROPUESTA = 'https://lunallenatravel.vercel.app/p/';   // la web reescribe /p/* a functions/p/[slug].js
const URL_ARMADOR = 'https://luna-llena-armador.pages.dev';
const MAX_CUERPO = 32 * 1024;
const MAX_ARMADOR = 96 * 1024;

const activo = env => !!env.COTIZADOR_TOKEN;

function hoyLima() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });   // YYYY-MM-DD
}

async function catalogo(env) {
  const url = env.LL_CATALOGO || URL_CATALOGO;
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error('No se pudo leer el catálogo de la web (HTTP ' + r.status + ')');
  const c = await r.json();
  return (c.productos || []).map(p => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    zona: p.zona || null,
    duracion: (p.duracion && p.duracion.texto) || null,
    dificultad: p.dificultad || null,
    edad_minima: p.edad_minima ?? null,
    consultar: !!p.consultar,
    unidad: p.unidad || 'persona',
    tarifas: (p.tarifas || []).map(t => ({ nombre: t.nombre, usd: t.usd ?? null, publico: t.publico ?? null })),
  }));
}

async function leerCuerpo(request) {
  const crudo = await request.text();
  if (crudo.length > MAX_CUERPO) return { error: json({ error: 'Pedido demasiado grande' }, 413) };
  try { return { b: JSON.parse(crudo || '{}') }; } catch { return { error: json({ error: 'JSON inválido' }, 400) }; }
}

async function cotizar(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const c = cuerpoCotizar(b);
  if (c.error) return json({ error: c.error }, 400);
  return llamar(env, '/v1/cotizar', c);
}

const entero = (x, max) => { const n = Number(x); return Number.isInteger(n) && n >= 1 && n <= max ? n : null; };
const CATEGORIAS = ['economico', 'confort', 'premium'];

// Solo los campos que entiende el motor: nada de pasaportes ni fechas de nacimiento.
function viajerosLimpios(lista) {
  return lista.slice(0, 40).map(v => {
    const o = { nacionalidad: String(v.nacionalidad || '').slice(0, 60) };
    if (v.adulto) o.adulto = true; else o.edad = Number(v.edad);
    if (v.estudiante) o.estudiante = true;
    return o;
  });
}

function itemsLimpios(lista, conDia) {
  return lista.slice(0, 30).map(i => {
    const o = { id: String(i.id || '') };
    if (i.tarifa) o.tarifa = String(i.tarifa);
    if (i.cantidad) o.cantidad = Number(i.cantidad);
    if (conDia && entero(i.dia, 60)) o.dia = entero(i.dia, 60);
    return o;
  });
}

function habitacionesLimpias(h) {
  const o = {};
  if (h && typeof h === 'object') for (const k of ['SGL', 'DBL', 'TPL']) { const n = entero(h[k], 20); if (n) o[k] = n; }
  return o;
}

// Servicios del tarifario (hoteles, traslados, trenes) de un viaje a medida: salen del cotizador (/v1/medida)
// y vuelven a él para recotizar. Acá solo se limpia la forma; el precio lo pone el cotizador.
function serviciosLimpios(lista) {
  return lista.slice(0, 40).map(s => {
    s = s && typeof s === 'object' ? s : {};
    const o = { id: String(s.id || '').slice(0, 120) };
    for (const [k, max] of [['dia', 60], ['noches', 60], ['cantidad', 30]]) { const n = entero(s[k], max); if (n) o[k] = n; }
    if (s.variante) o.variante = String(s.variante).slice(0, 60);
    const h = habitacionesLimpias(s.habitaciones);
    if (Object.keys(h).length) o.habitaciones = h;
    return o;
  });
}

// Lo que se manda a /v1/cotizar: solo los campos que entiende el motor.
// Filas de un Excel pegado con su precio tal como estaba (modo "Usar precios del Excel", decisión del usuario del
// 11/11/2026). Es la única cotización cuyo importe viene del navegador: la cotización lo avisa en sus alertas.
function preciosFijosLimpios(lista) {
  return lista.slice(0, 120).map(f => {
    f = f && typeof f === 'object' ? f : {};
    const o = { concepto: String(f.concepto || '').slice(0, 200), unitario_usd: String(f.unitario_usd || '').trim().slice(0, 14),
      unidad: f.unidad === 'grupo' ? 'grupo' : 'persona' };
    const d = entero(f.dia, 60); if (d) o.dia = d;
    const c = entero(f.cantidad, 99); if (c) o.cantidad = c;
    return o;
  }).filter(f => f.concepto && /^\d{1,7}(\.\d{1,2})?$/.test(f.unitario_usd));
}

function cuerpoCotizar(b) {
  const p = b.pedido;
  // Viaje a medida o Excel: trae servicios del tarifario o precios fijos con los días ya puestos, así que no se reordena.
  const conServicios = !!p && Array.isArray(p.servicios) && p.servicios.length > 0;
  const conFijos = !!p && Array.isArray(p.precios_fijos) && p.precios_fijos.length > 0;
  const aMedida = conServicios || conFijos;
  if (p && !Array.isArray(p.items)) p.items = [];
  if (!p || (!p.items.length && !aMedida)) return { error: 'Elegí al menos un producto' };
  if (!Array.isArray(p.viajeros) || !p.viajeros.length) return { error: 'Cargá al menos un viajero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_viaje || '')) return { error: 'Falta la fecha del viaje' };

  const pedido = {
    fecha_hoy: hoyLima(),
    fecha_viaje: p.fecha_viaje,
    viajeros: viajerosLimpios(p.viajeros),
    items: itemsLimpios(p.items, aMedida),
  };
  if (conServicios) pedido.servicios = serviciosLimpios(p.servicios);
  if (conFijos) pedido.precios_fijos = preciosFijosLimpios(p.precios_fijos);
  if (Array.isArray(p.entradas)) { const e = p.entradas.filter(x => x === 'MP' || x === 'MP_MONTANA').slice(0, 1); if (e.length) pedido.entradas = e; }
  if (p.llegada && /^\d{2}:\d{2}$/.test(p.llegada.hora || '')) pedido.llegada = { dia: 1, hora: p.llegada.hora };

  return {
    pedido,
    ordenar: !aMedida,
    nombre: b.nombre ? String(b.nombre).slice(0, 80) : null,
    idioma: ['es', 'en', 'pt'].includes(b.idioma) ? b.idioma : 'es',
    dias_disponibles: Number(b.dias_disponibles) > 0 ? Number(b.dias_disponibles) : null,
  };
}

// Viaje a medida: días + ciudades + viajeros. La ruta, los hoteles y los precios los pone el cotizador.
function cuerpoMedida(b) {
  const s = b.solicitud;
  if (!s || typeof s !== 'object') return { error: 'Falta la solicitud' };
  const dias = entero(s.dias, 30);
  if (!dias || dias < 2) return { error: 'Poné cuántos días dura el viaje (2 a 30)' };
  if (!Array.isArray(s.viajeros) || !s.viajeros.length) return { error: 'Cargá al menos un viajero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.fecha_viaje || '')) return { error: 'Falta la fecha del viaje' };
  const slug = x => String(x || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const solicitud = {
    fecha_hoy: hoyLima(),
    fecha_viaje: s.fecha_viaje,
    dias,
    viajeros: viajerosLimpios(s.viajeros),
    ciudades: (Array.isArray(s.ciudades) ? s.ciudades : []).slice(0, 12).map(slug).filter(Boolean),
    ruta: slug(s.ruta) || null,
    items: itemsLimpios(Array.isArray(s.items) ? s.items : [], false),
  };
  const h = habitacionesLimpias(s.habitaciones);
  if (Object.keys(h).length) solicitud.habitaciones = h;
  if (s.llegada && /^\d{2}:\d{2}$/.test(s.llegada.hora || '')) solicitud.llegada = { dia: 1, hora: s.llegada.hora };
  const categorias = (Array.isArray(b.categorias) ? b.categorias : []).filter(c => CATEGORIAS.includes(c));
  return {
    solicitud,
    ...(categorias.length ? { categorias } : {}),
    nombre: b.nombre ? String(b.nombre).slice(0, 80) : null,
    idioma: ['es', 'en', 'pt'].includes(b.idioma) ? b.idioma : 'es',
  };
}

async function medida(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const c = cuerpoMedida(b);
  if (c.error) return json({ error: c.error }, 400);
  return llamar(env, '/v1/medida', c);
}

// Guardar en lead: el servidor vuelve a cotizar el pedido (los importes nunca vienen del navegador),
// guarda el resultado y, si el asesor marcó que ya se la mandó, pasa el lead a "Propuesta enviada"
// (solo si estaba antes en el embudo: nunca lo hace retroceder).
const ANTES_DE_ENVIADA = ['lead_nuevo', 'contactado', 'propuesta_pendiente'];

async function guardar(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const leadId = Number(b.lead_id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: 'Elegí el lead' }, 400);
  const lead = await env.DB.prepare('SELECT id, etapa, precio FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return json({ error: 'Ese lead no existe' }, 404);
  const c = cuerpoCotizar(b);
  if (c.error) return json({ error: c.error }, 400);

  // Página de propuesta: slug al azar; el link va dentro del mensaje (lo pone el cotizador).
  let slug = null, link = null;
  if (b.pagina) {
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    slug = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    link = URL_PROPUESTA + slug + '/';
    Object.assign(c, { pagina: true, link });
  }

  const { status, data } = await pedir(env, '/v1/cotizar', c);
  if (status !== 200) return json({ error: (data && data.error) || 'El cotizador no respondió' }, 502);
  const cot = data.cotizacion || {};
  const conTotal = ['calculado', 'sin_disponibilidad_confirmada'].includes(cot.estado) && cot.total_usd;
  const html = slug && conTotal && data.propuesta_html ? String(data.propuesta_html) : null;
  if (slug && !html) { slug = null; link = null; }   // sin total no hay página para el cliente
  const enviada = b.enviada ? 1 : 0;
  const now = new Date().toISOString();
  const quien = b.quien ? String(b.quien).slice(0, 60) : null;
  const nombres = Array.isArray(b.nombres) ? b.nombres : [];
  // Viaje a medida: el resumen arranca con la ruta y la categoría (los hoteles no están en el catálogo de la web).
  const titulo = c.pedido.servicios || c.pedido.precios_fijos
    ? (b.titulo ? String(b.titulo).slice(0, 120) : c.pedido.precios_fijos ? 'Excel' : 'Viaje a medida') : '';
  const resumen = [titulo, ...(data.pedido && data.pedido.items || []).map(i => {
    const n = nombres.find(x => x && x.id === i.id);
    return n ? String(n.nombre).slice(0, 80) : i.id;
  })].filter(Boolean).join(' + ').slice(0, 400);
  const v = cot.versiones || {};

  const sentencias = [env.DB.prepare(
    `INSERT INTO cotizador_cotizaciones (lead_id, estado, total_usd, adelanto_usd, viajeros, fecha_viaje, resumen, idioma, mensaje,
       pedido_json, versiones, enviada, quien, creado_en, slug, propuesta_html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(leadId, cot.estado || 'desconocido', conTotal ? String(cot.total_usd) : null, conTotal ? String(cot.adelanto_usd) : null,
    c.pedido.viajeros.length, c.pedido.fecha_viaje, resumen, c.idioma, (data.borrador && data.borrador.texto) || null,
    JSON.stringify(data.pedido || c.pedido), [v.catalogo, v.entradas, v.reglas, v.tc, v.tarifario].filter(Boolean).join(' · '), enviada, quien, now,
    slug, html)];

  let etapa = lead.etapa;
  if (enviada && ANTES_DE_ENVIADA.includes(lead.etapa)) {
    etapa = 'propuesta_enviada';
    sentencias.push(env.DB.prepare('UPDATE leads SET etapa = ?, actualizado_en = ? WHERE id = ?').bind(etapa, now, leadId));
    sentencias.push(env.DB.prepare('INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(leadId, lead.etapa, etapa, quien, now));
  }
  // El precio del lead (el que se ve en la tarjeta) solo se completa si estaba vacío.
  if (enviada && conTotal && !lead.precio) {
    sentencias.push(env.DB.prepare('UPDATE leads SET precio = ?, actualizado_en = ? WHERE id = ?').bind('USD ' + cot.total_usd, now, leadId));
  }
  // Con página, el link del lead (propuesta_url) apunta a la última propuesta.
  if (link) sentencias.push(env.DB.prepare('UPDATE leads SET propuesta_url = ?, actualizado_en = ? WHERE id = ?').bind(link, now, leadId));
  await env.DB.batch(sentencias);
  return json({ ok: true, etapa, cambio_etapa: etapa !== lead.etapa, estado: cot.estado, total_usd: conTotal ? cot.total_usd : null,
    link, mensaje: (data.borrador && data.borrador.texto) || null, pagina_pedida: !!b.pagina });
}

async function deLead(env, id) {
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: 'lead inválido' }, 400);
  const r = await env.DB.prepare(
    `SELECT id, estado, total_usd, adelanto_usd, viajeros, fecha_viaje, resumen, idioma, mensaje, pedido_json, versiones, enviada, quien, creado_en, slug
     FROM cotizador_cotizaciones WHERE lead_id = ? ORDER BY creado_en DESC LIMIT 30`
  ).bind(leadId).all();
  return json({ cotizaciones: r.results || [] });
}

// Pegar chat: el mensaje del cliente lo interpreta el asesor del cotizador (Claude Haiku en Vercel).
// Sin estado: el panel guarda `estado` y lo reenvía con el próximo mensaje del mismo cliente.
async function turno(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const mensaje = typeof b.mensaje === 'string' ? b.mensaje.trim() : '';
  if (!mensaje) return json({ error: 'Pegá el mensaje del cliente' }, 400);
  if (mensaje.length > 4000) return json({ error: 'El mensaje es muy largo (máximo 4000 caracteres): pegá solo lo del viaje' }, 413);
  const estado = b.estado && typeof b.estado === 'object' ? b.estado : null;
  return llamar(env, '/v1/turno', { mensaje, estado, hoy: hoyLima() });
}

// Pegar Excel: el cotizador lee la tabla por código; en modo tarifario sugiere a qué servicio va cada fila.
async function excel(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const texto = typeof b.texto === 'string' ? b.texto : '';
  if (!texto.trim()) return json({ error: 'Pegá la tabla copiada del Excel' }, 400);
  return llamar(env, '/v1/excel', { texto, modo: b.modo === 'tarifario' ? 'tarifario' : 'excel', hoy: hoyLima() });
}

// ---- Armador de propuestas (luna-llena-armador): la IA lee la cotización y arma la página con el diseño de Luna Llena ----
const urlArmador = env => (env.ARMADOR_URL || URL_ARMADOR).replace(/\/$/, '');

async function armadorCatalogo(env) {
  try {
    const [c, p] = await Promise.all(['/gem-propuesta/catalogo-ui.json', '/gem-propuesta/paquetes.json'].map(async ruta => {
      const r = await fetch(urlArmador(env) + ruta, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }));
    return json({ destinos: c.destinos || [], excursiones: c.excursiones || [],
      paquetes: (p || []).map(x => ({ id: x.id, titulo: x.titulo, dias: x.dias, ruta: x.ruta })) });
  } catch (e) {
    return json({ error: 'No se pudo leer el catálogo del armador (' + e.message + ')' }, 502);
  }
}

// Extraer y generar tardan hasta un par de minutos: el armador responde con un stream (espacios de latido y el JSON al
// final). Acá se pasa el stream tal cual, con el token del armador agregado del lado del servidor.
async function armadorIA(request, env, paso) {
  const crudo = await request.text();
  if (crudo.length > MAX_ARMADOR) return json({ error: 'La cotización es demasiado larga' }, 413);
  let b;
  try { b = JSON.parse(crudo || '{}'); } catch { return json({ error: 'JSON inválido' }, 400); }
  const cuerpo = paso === 'extraer'
    ? { tipo: b.tipo, paquete_id: b.paquete_id, texto: typeof b.texto === 'string' ? b.texto : '' }
    : { tipo: b.tipo, paquete_id: b.paquete_id, cotizacion: b.cotizacion };
  let r;
  try {
    r = await fetch(urlArmador(env) + '/api/propuesta-' + paso, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-propuesta-token': env.ARMADOR_TOKEN },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    return json({ error: 'El armador de propuestas no respondió. Probá de nuevo en un rato.' }, 502);
  }
  if (r.status === 401) return json({ error: 'El CRM no tiene bien configurado el token del armador.' }, 502);
  if (!r.ok) return json({ error: 'El armador respondió HTTP ' + r.status }, 502);
  return new Response(r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// Llama al cotizador. Devuelve { status, data } con status ya traducido para el panel.
async function pedir(env, ruta, cuerpo, metodo = 'POST') {
  let r;
  try {
    r = await fetch((env.COTIZADOR_URL || URL_COTIZADOR) + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.COTIZADOR_TOKEN },
      ...(metodo === 'POST' ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    return { status: 502, data: { error: 'El cotizador no respondió. Probá de nuevo en un rato.' } };
  }
  const texto = await r.text();
  let data;
  try { data = JSON.parse(texto); } catch { return { status: 502, data: { error: 'Respuesta inválida del cotizador (HTTP ' + r.status + ')' } }; }
  if (r.status === 401 || r.status === 503) return { status: 502, data: { error: 'El CRM no tiene bien configurado el token del cotizador.' } };
  // Un cotizador publicado antes de los viajes a medida no conoce /v1/rutas ni /v1/medida.
  if (r.status === 404) return { status: 502, data: { error: 'el cotizador publicado todavía no tiene esta función (hay que publicar la versión nueva).' } };
  if (!r.ok) return { status: r.status === 400 || r.status === 413 ? r.status : 502, data: { error: data.error || 'HTTP ' + r.status } };
  return { status: 200, data };
}

async function llamar(env, ruta, cuerpo) {
  const { status, data } = await pedir(env, ruta, cuerpo);
  return json(data, status);
}

export async function onRequest({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const ruta = (params.ruta || []).join('/');
  const metodo = request.method;

  if (ruta === 'estado' && metodo === 'GET') return json({ activo: activo(env), armador: activo(env) && !!env.ARMADOR_TOKEN });
  if (!activo(env)) return json({ error: 'Cotizador no disponible en este CRM' }, 404);

  if (ruta === 'catalogo' && metodo === 'GET') {
    try { return json({ productos: await catalogo(env) }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  if (ruta === 'cotizar' && metodo === 'POST') return cotizar(request, env);
  if (ruta === 'turno' && metodo === 'POST') return turno(request, env);
  if (ruta === 'rutas' && metodo === 'GET') { const { status, data } = await pedir(env, '/v1/rutas', null, 'GET'); return json(data, status); }
  if (ruta === 'medida' && metodo === 'POST') return medida(request, env);
  if (ruta === 'guardar' && metodo === 'POST') return guardar(request, env);
  if (ruta === 'excel' && metodo === 'POST') return excel(request, env);
  if (ruta.startsWith('armador/')) {
    if (!env.ARMADOR_TOKEN) return json({ error: 'El armador de propuestas no está configurado en este CRM' }, 404);
    if (ruta === 'armador/catalogo' && metodo === 'GET') return armadorCatalogo(env);
    if ((ruta === 'armador/extraer' || ruta === 'armador/generar') && metodo === 'POST') return armadorIA(request, env, ruta.slice(8));
  }
  const mLead = ruta.match(/^lead\/(\d+)$/);
  if (mLead && metodo === 'GET') return deLead(env, mLead[1]);
  return json({ error: 'no existe' }, 404);
}

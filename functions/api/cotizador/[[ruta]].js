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
//
// Los precios los calcula el cotizador por código; esta Function no toca importes.

const URL_COTIZADOR = 'https://luna-llena-cotizador.vercel.app';
const URL_CATALOGO = 'https://lunallenatravel.vercel.app/data/catalogo.json';
const MAX_CUERPO = 32 * 1024;

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

async function cotizar(request, env) {
  const crudo = await request.text();
  if (crudo.length > MAX_CUERPO) return json({ error: 'Pedido demasiado grande' }, 413);
  let b;
  try { b = JSON.parse(crudo || '{}'); } catch { return json({ error: 'JSON inválido' }, 400); }
  const p = b.pedido;
  if (!p || !Array.isArray(p.items) || !p.items.length) return json({ error: 'Elegí al menos un producto' }, 400);
  if (!Array.isArray(p.viajeros) || !p.viajeros.length) return json({ error: 'Cargá al menos un viajero' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_viaje || '')) return json({ error: 'Falta la fecha del viaje' }, 400);

  // Solo los campos que entiende el motor: nada de pasaportes ni fechas de nacimiento.
  const pedido = {
    fecha_hoy: hoyLima(),
    fecha_viaje: p.fecha_viaje,
    viajeros: p.viajeros.slice(0, 40).map(v => {
      const o = { nacionalidad: String(v.nacionalidad || '').slice(0, 60) };
      if (v.adulto) o.adulto = true; else o.edad = Number(v.edad);
      if (v.estudiante) o.estudiante = true;
      return o;
    }),
    items: p.items.slice(0, 30).map(i => {
      const o = { id: String(i.id || '') };
      if (i.tarifa) o.tarifa = String(i.tarifa);
      if (i.cantidad) o.cantidad = Number(i.cantidad);
      return o;
    }),
  };
  if (p.llegada && /^\d{2}:\d{2}$/.test(p.llegada.hora || '')) pedido.llegada = { dia: 1, hora: p.llegada.hora };

  const cuerpo = {
    pedido,
    ordenar: true,
    nombre: b.nombre ? String(b.nombre).slice(0, 80) : null,
    idioma: ['es', 'en', 'pt'].includes(b.idioma) ? b.idioma : 'es',
    dias_disponibles: Number(b.dias_disponibles) > 0 ? Number(b.dias_disponibles) : null,
  };

  let r;
  try {
    r = await fetch((env.COTIZADOR_URL || URL_COTIZADOR) + '/v1/cotizar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.COTIZADOR_TOKEN },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    return json({ error: 'El cotizador no respondió. Probá de nuevo en un rato.' }, 502);
  }
  const texto = await r.text();
  let data;
  try { data = JSON.parse(texto); } catch { return json({ error: 'Respuesta inválida del cotizador (HTTP ' + r.status + ')' }, 502); }
  if (r.status === 401 || r.status === 503) return json({ error: 'El CRM no tiene bien configurado el token del cotizador.' }, 502);
  if (!r.ok) return json({ error: data.error || 'HTTP ' + r.status }, r.status === 400 ? 400 : 502);
  return json(data);
}

export async function onRequest({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const ruta = (params.ruta || []).join('/');
  const metodo = request.method;

  if (ruta === 'estado' && metodo === 'GET') return json({ activo: activo(env) });
  if (!activo(env)) return json({ error: 'Cotizador no disponible en este CRM' }, 404);

  if (ruta === 'catalogo' && metodo === 'GET') {
    try { return json({ productos: await catalogo(env) }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  if (ruta === 'cotizar' && metodo === 'POST') return cotizar(request, env);
  return json({ error: 'no existe' }, 404);
}

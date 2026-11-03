// Métricas de la web de Luna Llena para la pestaña "Web" del panel.
// Lee sesiones_web / eventos_web (migración 037, los llena assets/ll-t.js de
// la web) y las cruza con leads y ventas por el código de la visita:
//   sesiones_web.codigo = leads.codigo_web,  ventas.lead_id = leads.id
// Port de visite-web/functions/_lib/web-metricas.js (sin experimentos ni
// el formulario "Armá tu viaje", con paquetes y ventas).
//
// Todo en SQL agregado. Las sesiones internas (equipo, ?interno=1) no
// cuentan nunca. Fechas: desde/hasta son días de Perú (UTC-5, sin horario de verano).

const PE = 5 * 3600000;

export function hoyPe() {
  return new Date(Date.now() - PE).toISOString().slice(0, 10);
}
export function sumarDias(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diasEntre(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}
// Límites UTC del rango [desde 00:00 Perú, hasta 24:00 Perú).
function limites(desde, hasta) {
  return [desde + 'T05:00:00.000Z', sumarDias(hasta, 1) + 'T05:00:00.000Z'];
}

// Una visita "consultó" si mandó una cotización o tocó WhatsApp: lo que el
// sitio tiene que producir.
const CONSULTO = '(s.leads > 0 OR s.clicks_whatsapp > 0)';
const INTERACTUO = '(s.clicks_whatsapp > 0 OR s.cotizar_abierto > 0 OR s.leads > 0)';
const REBOTE = '(s.paginas <= 1 AND s.max_scroll < 50 AND s.clicks_whatsapp = 0 AND s.clicks_cta = 0 AND s.cotizar_abierto = 0 AND s.leads = 0)';
const FILTRO = 's.interno = 0 AND s.primer_evento >= ?1 AND s.primer_evento < ?2';
// Venta que cuenta: se cobró al menos la seña y no se canceló.
const VENDIDA = "v.estado IN ('sena_pagada', 'confirmada', 'pagada', 'finalizada')";
// Visita ↔ lead: por el código LL-###### o por el contacto de ManyChat
// (links con ?manychat_id=). `x` es el alias de sesiones_web en cada consulta.
const UNE = (x) => `(l.codigo_web = ${x}.codigo OR (${x}.manychat_id IS NOT NULL AND l.manychat_id = ${x}.manychat_id))`;
const IDENTIFICADA = (x) => `(${x}.codigo IS NOT NULL OR ${x}.manychat_id IS NOT NULL)`;
// Lead que la agencia ya trabajó (le mandó algo o lo siguió).
const AVANZO = "l.etapa NOT IN ('lead_nuevo', 'perdido')";

async function todas(db, sql, ...binds) {
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

export async function resumenWeb(db, desde, hasta) {
  const [a, b] = limites(desde, hasta);
  const r = await db.prepare(
    `SELECT count(*) AS sesiones,
            count(DISTINCT s.visitante_id) AS visitantes,
            coalesce(sum(s.paginas), 0) AS paginas,
            coalesce(sum(${REBOTE}), 0) AS rebotes,
            coalesce(sum(s.vistas_paquete > 0), 0) AS vieron_paquete,
            coalesce(sum(${INTERACTUO}), 0) AS interactuaron,
            coalesce(sum(${CONSULTO}), 0) AS consultaron,
            coalesce(sum(s.clicks_whatsapp > 0), 0) AS ses_whatsapp,
            coalesce(sum(s.clicks_whatsapp), 0) AS clicks_whatsapp,
            coalesce(sum(s.cotizar_abierto > 0), 0) AS ses_cotizar,
            coalesce(sum(s.leads > 0), 0) AS ses_lead,
            coalesce(sum(s.leads), 0) AS leads,
            coalesce(avg(s.duracion_ms), 0) AS duracion_prom,
            coalesce(sum(s.max_scroll >= 75), 0) AS scroll_75
       FROM sesiones_web s WHERE ${FILTRO}`
  ).bind(a, b).first();

  const nuevos = await db.prepare(
    `SELECT count(DISTINCT s.visitante_id) AS n FROM sesiones_web s
      WHERE ${FILTRO} AND s.visitante_id NOT IN
        (SELECT visitante_id FROM sesiones_web WHERE primer_evento < ?1 AND visitante_id IS NOT NULL)`
  ).bind(a, b).first();

  // Las del equipo no cuentan, pero distinguen "ll-t.js no anda" (cero de
  // todo) de "el sitio no recibe visitas" (solo internas).
  const internas = await db.prepare(
    `SELECT count(*) AS n FROM sesiones_web WHERE interno = 1 AND primer_evento >= ?1 AND primer_evento < ?2`
  ).bind(a, b).first();

  // Del CRM, por las visitas del período: leads, trabajados y ventas.
  const crm = await db.prepare(
    `SELECT count(DISTINCT l.id) AS leads_crm,
            count(DISTINCT CASE WHEN ${AVANZO} THEN l.id END) AS avanzaron,
            count(DISTINCT CASE WHEN ${VENDIDA} THEN v.id END) AS ventas
       FROM sesiones_web s
       JOIN leads l ON ${UNE('s')}
       LEFT JOIN ventas v ON v.lead_id = l.id
      WHERE ${FILTRO} AND ${IDENTIFICADA('s')}`
  ).bind(a, b).first();

  return { ...r, ...crm, visitantes_nuevos: nuevos?.n || 0, internas: internas?.n || 0 };
}

// Por segmento de la visita (canal, entrada, post...), con lo que pasó
// después en el CRM: leads, trabajados, ventas y monto.
async function porSegmento(db, a, b, expr) {
  return todas(db,
    `WITH ses AS (
       SELECT coalesce(${expr}, '—') AS clave, s.*, ${CONSULTO} AS consulto, ${REBOTE} AS rebote
         FROM sesiones_web s WHERE ${FILTRO}
     ), crm AS (
       SELECT ses.clave,
              count(DISTINCT l.id) AS leads_crm,
              count(DISTINCT CASE WHEN ${VENDIDA} THEN v.id END) AS ventas,
              coalesce(sum(CASE WHEN ${VENDIDA} AND v.moneda = 'USD' THEN v.total_centavos END), 0) AS ventas_usd_c
         FROM ses JOIN leads l ON ${UNE('ses')}
         LEFT JOIN ventas v ON v.lead_id = l.id
        WHERE ${IDENTIFICADA('ses')} GROUP BY ses.clave
     )
     SELECT ses.clave, count(*) AS sesiones, sum(ses.consulto) AS consultaron,
            sum(ses.leads > 0) AS cotizaron, sum(ses.clicks_whatsapp > 0) AS whatsapp, sum(ses.rebote) AS rebotes,
            coalesce(crm.leads_crm, 0) AS leads_crm, coalesce(crm.ventas, 0) AS ventas,
            coalesce(crm.ventas_usd_c, 0) AS ventas_usd_c
       FROM ses LEFT JOIN crm ON crm.clave = ses.clave
      GROUP BY ses.clave ORDER BY sesiones DESC LIMIT 15`, a, b);
}

function percentil(lista, p) {
  if (!lista.length) return null;
  return lista[Math.min(lista.length - 1, Math.floor(lista.length * p))];
}

export async function metricasWeb(db, desde, hasta) {
  const [a, b] = limites(desde, hasta);
  const E = `FROM eventos_web e JOIN sesiones_web s ON s.sesion_id = e.sesion_id
             WHERE ${FILTRO} AND e.creado_en >= ?1 AND e.creado_en < ?3`;
  const finE = sumarDias(hasta, 2) + 'T05:00:00.000Z'; // eventos de sesiones que cruzan medianoche

  const [
    resumen, canal, campana, contenido, dispositivo, pais, landing, porDia, paginas, paquetesWeb,
    ventasPaquete, whatsapp, ctas, salidas, vitalsCrudo, erroresJs, recientes, leadsWeb, refsSueltas,
    leadsCrm, respuesta,
  ] = await Promise.all([
    resumenWeb(db, desde, hasta),
    porSegmento(db, a, b, 's.canal'),
    porSegmento(db, a, b, 's.utm_campaign'),
    porSegmento(db, a, b, 's.utm_content'),
    porSegmento(db, a, b, 's.dispositivo'),
    porSegmento(db, a, b, 's.pais'),
    porSegmento(db, a, b, 's.landing'),
    todas(db,
      `SELECT substr(datetime(s.primer_evento, '-5 hours'), 1, 10) AS fecha, count(*) AS sesiones,
              sum(${CONSULTO}) AS consultaron, sum(s.leads) AS leads, sum(s.clicks_whatsapp > 0) AS whatsapp
         FROM sesiones_web s WHERE ${FILTRO} GROUP BY 1 ORDER BY 1`, a, b),
    todas(db,
      `SELECT e.ruta AS ruta,
              sum(e.tipo = 'page_view') AS vistas,
              count(DISTINCT CASE WHEN e.tipo = 'page_view' THEN e.sesion_id END) AS sesiones,
              sum(e.tipo = 'scroll' AND json_extract(e.datos_json, '$.pct') = 75) AS llegan_75,
              sum(e.tipo = 'click_whatsapp') AS whatsapp,
              sum(e.tipo = 'cotizar_abierto') AS cotizar,
              sum(e.tipo = 'lead_enviado') AS leads,
              max(CASE WHEN e.tipo = 'page_view' THEN json_extract(e.datos_json, '$.nombre') END) AS nombre
         ${E} GROUP BY e.ruta HAVING vistas > 0 ORDER BY vistas DESC LIMIT 40`, a, b, finE),
    // Por ficha: vistas, WhatsApp, cotizaciones, y leads del CRM que la cotizaron.
    todas(db,
      `SELECT json_extract(e.datos_json, '$.paquete') AS slug,
              max(json_extract(e.datos_json, '$.nombre')) AS nombre,
              count(DISTINCT e.sesion_id) AS sesiones,
              sum(e.tipo = 'page_view') AS vistas
         ${E} AND e.tipo = 'page_view' AND json_extract(e.datos_json, '$.paquete') IS NOT NULL
        GROUP BY 1 ORDER BY sesiones DESC LIMIT 80`, a, b, finE),
    // Ventas del período por producto (todas las fuentes), para cruzar con las vistas.
    todas(db,
      `SELECT v.producto_slug AS slug, max(v.producto_nombre) AS nombre, count(*) AS ventas,
              coalesce(sum(CASE WHEN v.moneda = 'USD' THEN v.total_centavos END), 0) AS usd_c
         FROM ventas v WHERE ${VENDIDA} AND v.creado_en >= ?1 AND v.creado_en < ?2
        GROUP BY 1`, a, b),
    todas(db,
      `SELECT coalesce(json_extract(e.datos_json, '$.ubicacion'), '—') AS clave, count(*) AS n,
              count(DISTINCT e.sesion_id) AS sesiones
         ${E} AND e.tipo = 'click_whatsapp' GROUP BY 1 ORDER BY n DESC LIMIT 15`, a, b, finE),
    todas(db,
      `SELECT coalesce(json_extract(e.datos_json, '$.texto'), '—') AS texto,
              coalesce(json_extract(e.datos_json, '$.ubicacion'), '—') AS ubicacion,
              e.ruta AS ruta, count(*) AS n
         ${E} AND e.tipo = 'click_cta' GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 20`, a, b, finE),
    todas(db,
      `SELECT coalesce(json_extract(e.datos_json, '$.destino'), '—') AS clave, count(*) AS n
         ${E} AND e.tipo = 'salida' GROUP BY 1 ORDER BY n DESC LIMIT 12`, a, b, finE),
    todas(db,
      `SELECT s.dispositivo AS dispositivo,
              json_extract(e.datos_json, '$.lcp') AS lcp, json_extract(e.datos_json, '$.inp') AS inp,
              json_extract(e.datos_json, '$.cls') AS cls, json_extract(e.datos_json, '$.ttfb') AS ttfb
         ${E} AND e.tipo = 'vitals' ORDER BY e.id DESC LIMIT 3000`, a, b, finE),
    todas(db,
      `SELECT coalesce(json_extract(e.datos_json, '$.mensaje'), '—') AS mensaje, e.ruta AS ruta,
              count(*) AS n, count(DISTINCT e.sesion_id) AS sesiones
         ${E} AND e.tipo = 'error_js' GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`, a, b, finE),
    todas(db,
      `SELECT s.sesion_id, s.codigo, s.primer_evento, s.canal, s.utm_campaign, s.utm_content, s.dispositivo,
              s.pais, s.landing, s.paginas, s.vistas_paquete, s.max_scroll, s.clicks_whatsapp,
              s.cotizar_abierto, s.leads, s.duracion_ms
         FROM sesiones_web s WHERE ${FILTRO} ORDER BY s.primer_evento DESC LIMIT 60`, a, b),
    // Leads que vinieron de una visita del período, con su venta si la hay.
    todas(db,
      `SELECT l.id, l.nombre, l.destinos, l.etapa, l.fuente, l.codigo_web, l.manychat_id, l.creado_en,
              s.canal, s.utm_campaign, s.utm_content, s.landing,
              max(v.estado) AS venta_estado,
              sum(CASE WHEN ${VENDIDA} THEN v.total_centavos END) AS venta_c,
              max(v.moneda) AS venta_moneda
         FROM sesiones_web s JOIN leads l ON ${UNE('s')}
         LEFT JOIN ventas v ON v.lead_id = l.id
        WHERE ${FILTRO} AND ${IDENTIFICADA('s')}
        GROUP BY l.id ORDER BY l.creado_en DESC LIMIT 60`, a, b),
    // Visitas que tocaron WhatsApp y todavía no tienen lead: el código está en
    // el chat ("ref LL-######"); al cargarlo en el lead queda cruzado.
    todas(db,
      `SELECT s.codigo, s.primer_evento, s.canal, s.utm_campaign, s.utm_content, s.landing, s.pais,
              (SELECT json_extract(e.datos_json, '$.nombre') FROM eventos_web e
                WHERE e.sesion_id = s.sesion_id AND e.tipo = 'page_view'
                  AND json_extract(e.datos_json, '$.paquete') IS NOT NULL
                ORDER BY e.id DESC LIMIT 1) AS ultimo_paquete
         FROM sesiones_web s
        WHERE ${FILTRO} AND s.clicks_whatsapp > 0 AND s.codigo IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM leads l WHERE ${UNE('s')})
        ORDER BY s.primer_evento DESC LIMIT 40`, a, b),
    todas(db,
      `SELECT coalesce(fuente, '—') AS fuente, coalesce(utm_source, '—') AS origen, count(*) AS n,
              sum(etapa = 'lead_nuevo') AS sin_contactar
         FROM leads WHERE creado_en >= ?1 AND creado_en < ?2 GROUP BY 1, 2 ORDER BY n DESC`, a, b),
    todas(db,
      `SELECT l.creado_en AS creado, min(e.creado_en) AS contacto
         FROM leads l JOIN eventos e ON e.lead_id = l.id AND e.etapa_desde = 'lead_nuevo'
        WHERE l.creado_en >= ?1 AND l.creado_en < ?2 AND l.codigo_web IS NOT NULL GROUP BY l.id`, a, b),
  ]);

  const calientes = await calientesWeb(db);

  // Paquetes: lo de la web por ficha + leads/ventas del CRM por slug.
  const leadsPorSlug = await todas(db,
    `SELECT json_extract(l.meta_json, '$.paquete_slug') AS slug, count(*) AS leads
       FROM leads l WHERE l.codigo_web IS NOT NULL AND l.creado_en >= ?1 AND l.creado_en < ?2
      GROUP BY 1`, a, b);
  const eventosPorSlug = await todas(db,
    `SELECT p.slug, sum(e.tipo = 'click_whatsapp') AS whatsapp, sum(e.tipo = 'cotizar_abierto') AS cotizar,
            sum(e.tipo = 'lead_enviado') AS cotizaciones
       FROM (SELECT DISTINCT e.ruta, json_extract(e.datos_json, '$.paquete') AS slug
               ${E} AND e.tipo = 'page_view' AND json_extract(e.datos_json, '$.paquete') IS NOT NULL) p
       JOIN eventos_web e ON e.ruta = p.ruta
       JOIN sesiones_web s ON s.sesion_id = e.sesion_id
      WHERE ${FILTRO} AND e.creado_en >= ?1 AND e.creado_en < ?3
      GROUP BY p.slug`, a, b, finE);
  const porSlug = (lista) => Object.fromEntries(lista.filter((x) => x.slug).map((x) => [x.slug, x]));
  const ev = porSlug(eventosPorSlug), ld = porSlug(leadsPorSlug), vt = porSlug(ventasPaquete);
  const paquetes = paquetesWeb.map((p) => ({
    ...p,
    whatsapp: ev[p.slug]?.whatsapp || 0,
    cotizar: ev[p.slug]?.cotizar || 0,
    cotizaciones: ev[p.slug]?.cotizaciones || 0,
    leads_crm: ld[p.slug]?.leads || 0,
    ventas: vt[p.slug]?.ventas || 0,
    ventas_usd_c: vt[p.slug]?.usd_c || 0,
  }));
  // Vendidos sin visitas en la web (venta manual o por WhatsApp directo).
  for (const v of ventasPaquete) {
    if (!paquetes.some((p) => p.slug === v.slug)) {
      paquetes.push({ slug: v.slug, nombre: v.nombre, sesiones: 0, vistas: 0, whatsapp: 0, cotizar: 0,
        cotizaciones: 0, leads_crm: ld[v.slug]?.leads || 0, ventas: v.ventas, ventas_usd_c: v.usd_c });
    }
  }

  const vitals = {};
  for (const disp of ['movil', 'desktop', 'tablet']) {
    const filas = vitalsCrudo.filter((v) => v.dispositivo === disp);
    if (!filas.length) continue;
    const orden = (k) => filas.map((v) => Number(v[k])).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
    vitals[disp] = {
      n: filas.length,
      lcp: percentil(orden('lcp'), 0.75),
      inp: percentil(orden('inp'), 0.75),
      cls: percentil(orden('cls'), 0.75),
      ttfb: percentil(orden('ttfb'), 0.75),
    };
  }

  const horas = respuesta
    .map((r) => (new Date(r.contacto) - new Date(r.creado)) / 3600000)
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((x, y) => x - y);

  return {
    desde, hasta, resumen,
    segmentos: { canal, campana, contenido, dispositivo, pais, landing },
    por_dia: porDia,
    paginas,
    paquetes,
    whatsapp_por_ubicacion: whatsapp,
    ctas, salidas,
    vitals,
    errores_js: erroresJs,
    recientes,
    leads_web: leadsWeb,
    refs_sueltas: refsSueltas,
    calientes,
    crm: {
      leads: leadsCrm,
      total: leadsCrm.reduce((s, x) => s + x.n, 0),
      sin_contactar: leadsCrm.reduce((s, x) => s + (x.sin_contactar || 0), 0),
      respuesta_mediana_h: percentil(horas, 0.5),
      respuesta_n: horas.length,
    },
  };
}

// Avisos simples para arriba de la pestaña: lo que hay que mirar esta semana.
export function alertasWeb(actual, anterior) {
  const r = actual.resumen || {}, a = anterior || {};
  const out = [];
  const tasa = (x) => (x && x.sesiones ? x.consultaron / x.sesiones : null);
  if (!r.sesiones) {
    out.push({ nivel: r.internas ? 'info' : 'alta', texto: r.internas
      ? `Solo hubo visitas del equipo (${r.internas}). Cuando entre tráfico real, acá aparecen los números.`
      : 'Sin visitas registradas en el período. Si la web está publicada, revisar que cargue assets/ll-t.js.' });
    return out;
  }
  const t = tasa(r), ta = tasa(a);
  if (t !== null && ta !== null && a.sesiones >= 20) {
    const d = t / ta - 1;
    if (Math.abs(d) >= 0.2) out.push({ nivel: d > 0 ? 'info' : 'media',
      texto: `La tasa de consulta ${d > 0 ? 'subió' : 'bajó'} de ${(ta * 100).toFixed(1)}% a ${(t * 100).toFixed(1)}% contra el período anterior.` });
  }
  const sueltas = (actual.refs_sueltas || []).length;
  if (sueltas) out.push({ nivel: 'media',
    texto: `${sueltas === 1 ? '1 visita tocó' : sueltas + ' visitas tocaron'} WhatsApp y no tiene${sueltas === 1 ? '' : 'n'} lead con su código. Si escribieron, carga el "ref LL-…" del chat en el campo Código web del lead para que quede cruzado.` });
  const frias = (actual.paquetes || []).filter((p) => p.sesiones >= 15 && !p.whatsapp && !p.cotizaciones);
  if (frias.length) out.push({ nivel: 'media',
    texto: `${frias[0].nombre || frias[0].slug} tuvo ${frias[0].sesiones} visitas y ninguna consulta: revisar precio, fotos o el botón.` });
  const sin = actual.crm?.sin_contactar || 0;
  if (sin) out.push({ nivel: 'alta', texto: `${sin} lead${sin === 1 ? '' : 's'} del período siguen sin contactar.` });
  return out;
}

// Personas identificadas (ManyChat o lead con código) con señales de compra
// en los últimos 14 días: para escribirles hoy. Fuera los ya ganados o perdidos.
const AHORA_MIN = 5;
export async function calientesWeb(db) {
  const desde = new Date(Date.now() - 14 * 86400000).toISOString();
  const filas = await todas(db,
    `WITH p AS (
       SELECT coalesce(s.manychat_id, 'lead-' || l.id) AS persona,
              max(s.manychat_id) AS manychat_id, max(l.id) AS lead_id,
              count(DISTINCT s.sesion_id) AS visitas, count(DISTINCT s.visitante_id) AS navegadores,
              max(s.ultimo_evento) AS ultima, sum(s.vistas_paquete) AS fichas, max(s.max_scroll) AS scroll,
              sum(s.clicks_whatsapp) AS whatsapp,
              max(CASE WHEN s.cotizar_abierto > 0 AND s.leads = 0 THEN s.ultimo_evento END) AS ult_abandono,
              max(CASE WHEN s.leads > 0 THEN s.ultimo_evento END) AS ult_cotizacion,
              group_concat(DISTINCT s.sesion_id) AS sesiones
         FROM sesiones_web s
         LEFT JOIN leads l ON ${UNE('s')}
        WHERE s.interno = 0 AND s.ultimo_evento >= ?1 AND ${IDENTIFICADA('s')}
          AND (s.manychat_id IS NOT NULL OR l.id IS NOT NULL)
        GROUP BY 1
     )
     SELECT p.*, l.nombre, l.etapa, l.whatsapp AS telefono
       FROM p LEFT JOIN leads l ON l.id = p.lead_id
      WHERE coalesce(l.etapa, '') NOT IN ('ganado', 'perdido')
      ORDER BY p.ultima DESC LIMIT 200`, desde);

  const ahora = Date.now();
  const out = [];
  for (const f of filas) {
    const enVivo = ahora - Date.parse(f.ultima) < AHORA_MIN * 60000;
    const abandono = !!f.ult_abandono && (!f.ult_cotizacion || f.ult_abandono > f.ult_cotizacion);
    const volvio = f.visitas >= 2;
    const interes = f.fichas >= 3 || f.scroll >= 75;
    const senales = [
      enVivo && 'en la web ahora',
      abandono && 'abrió el cotizador y no lo mandó',
      volvio && `volvió (${f.visitas} visitas)`,
      interes && (f.fichas >= 3 ? `miró ${f.fichas} fichas` : 'leyó una ficha hasta el final'),
    ].filter(Boolean);
    if (!senales.length) continue;
    const ids = String(f.sesiones || '').split(',').slice(0, 30);
    const paq = await db.prepare(
      `SELECT json_extract(datos_json, '$.nombre') AS nombre FROM eventos_web
        WHERE sesion_id IN (${ids.map(() => '?').join(',')}) AND tipo = 'page_view'
          AND json_extract(datos_json, '$.paquete') IS NOT NULL ORDER BY id DESC LIMIT 1`
    ).bind(...ids).first();
    out.push({
      manychat_id: f.manychat_id, lead_id: f.lead_id, nombre: f.nombre, etapa: f.etapa, telefono: f.telefono,
      visitas: f.visitas, navegadores: f.navegadores, ultima: f.ultima, whatsapp: f.whatsapp,
      ultimo_paquete: paq?.nombre || null, en_vivo: enVivo, abandono, senales,
      puntos: (enVivo ? 3 : 0) + (abandono ? 3 : 0) + (volvio ? 2 : 0) + (interes ? 1 : 0),
    });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => b.puntos - a.puntos || b.ultima.localeCompare(a.ultima));
}

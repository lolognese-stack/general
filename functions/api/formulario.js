// GET /api/formulario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&formulario=personalizado|paquete
//
// Sección "Formulario" del panel: todo lo que pasa en el formulario de viaje
// (luna-llena-viaje.pages.dev, al que lleva "Cotizar"). Ese proyecto escribe
// en esta misma base:
//   sesiones_form  una fila por sesión (dispositivo, país, origen, UTM,
//                  ManyChat ID, último paso, tiempos, errores, envío)
//   eventos_form   crudo: abierto, paso_visto, paso_completado (con las
//                  respuestas del paso en datos_json), paso_atras, salida,
//                  error_validacion, enviado, click_whatsapp, click_instagram
//   leads          lo enviado completo (submission_id = sesion_id)
// Migración: crm/migracion-032-formulario-viaje.sql.
//
// Sale de functions/api/funnel.js de visite-web, con hora de Perú, el rol
// de auth.js y, además, cada envío con todas sus respuestas.

import { rolDe, json } from '../_lib/auth.js';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMULARIOS = new Set(['cotizar-web', 'personalizado', 'paquete']);
// Perú: UTC-5 todo el año (sin horario de verano).
const TZ = '-5 hours';

function filtros(url) {
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');
  const formulario = url.searchParams.get('formulario');
  const where = [];
  const binds = [];
  if (RE_FECHA.test(desde || '')) { where.push('s.primer_evento >= ?'); binds.push(desde + 'T05:00:00.000Z'); }
  if (RE_FECHA.test(hasta || '')) {
    const d = new Date(hasta + 'T05:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + 1);
    where.push('s.primer_evento < ?'); binds.push(d.toISOString());
  }
  if (FORMULARIOS.has(formulario)) { where.push('s.formulario = ?'); binds.push(formulario); }
  // Sesiones de prueba (id "test-...") nunca cuentan.
  where.push("s.sesion_id NOT LIKE 'test-%'");
  return { sql: ' WHERE ' + where.join(' AND '), binds };
}

// Mediana con window functions (sin traer miles de valores al panel).
function medianaSql(selectValor, from, whereSql, particion = []) {
  const inner = particion.map(([expr, alias]) => `${expr} AS ${alias}`).join(', ');
  const outer = particion.map(([, alias]) => alias).join(', ');
  const part = particion.length ? `PARTITION BY ${particion.map(([expr]) => expr).join(', ')}` : '';
  return `
    WITH d AS (
      SELECT ${selectValor} AS v${inner ? ', ' + inner : ''},
             ROW_NUMBER() OVER (${part} ORDER BY ${selectValor}) AS rn,
             COUNT(*) OVER (${part}) AS n
        FROM ${from}${whereSql}
    )
    SELECT ${outer ? outer + ', ' : ''}AVG(v) AS mediana
      FROM d WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
     ${outer ? 'GROUP BY ' + outer : ''}`;
}

// Agrega los leads del formulario nuevo: [{clave, n}] por cada respuesta.
function resumenWeb(filas) {
  const cuenta = () => new Map();
  const suma = (m, k) => { if (k === null || k === undefined || k === '') k = '—'; m.set(String(k), (m.get(String(k)) || 0) + 1); };
  const lista = (m, orden) => { const a = [...m].map(([clave, n]) => ({ clave, n })); return orden ? a.sort(orden) : a.sort((x, y) => y.n - x.n); };
  const M = { tipo: cuenta(), presupuesto: cuenta(), score: cuenta(), pasajes: cuenta(), mes: cuenta(), personas: cuenta(),
    ninos: cuenta(), dias: cuenta(), destinos: cuenta(), primer_destino: cuenta(), pais: cuenta(), origen: cuenta(), por_dia: new Map() };
  const RANGO = { lt500: '1 · Menos de US$ 500', '500-1000': '2 · US$ 500 – 1.000', '1000-1500': '3 · US$ 1.000 – 1.500', '1500-2000': '4 · US$ 1.500 – 2.000', '2000-3000': '5 · US$ 2.000 – 3.000', gt3000: '6 · Más de US$ 3.000' };
  const balde = (d) => !d ? null : d <= 3 ? '1-3' : d <= 5 ? '4-5' : d <= 7 ? '6-7' : d <= 10 ? '8-10' : d <= 14 ? '11-14' : '15+';
  let completos = 0, parciales = 0, wa = 0, scoreSum = 0, scoreN = 0; const durs = [];
  for (const f of filas) {
    let m; try { m = JSON.parse(f.meta_json); } catch { continue; }
    const completo = m.completo !== false && !m.parcial;
    completo ? completos++ : parciales++;
    if (f.wa) wa++;
    const dia = String(f.creado_en).slice(0, 10);
    const pd = M.por_dia.get(dia) || { fecha: dia, sesiones: 0, consultaron: 0 };
    pd.sesiones++; if (completo) pd.consultaron++; M.por_dia.set(dia, pd);
    suma(M.tipo, m.tipo === 'itinerario' ? 'Ya tiene itinerario' : 'Pide ayuda para armarlo');
    suma(M.presupuesto, m.tiene_presupuesto ? (RANGO[m.presupuesto_rango] || 'Tiene, sin rango') : '0 · Todavía no lo tiene');
    if (m.score) { suma(M.score, m.score.categoria === 'caliente' ? 'Caliente' : m.score.categoria === 'tibio' ? 'Tibio' : 'Frío'); scoreSum += +m.score.score10 || 0; scoreN++; }
    suma(M.pasajes, m.pasajes === 'comprados' ? 'Ya los compró' : m.pasajes === 'pendientes' ? 'Todavía no' : null);
    suma(M.mes, m.fecha_llegada ? String(m.fecha_llegada).slice(0, 7) : m.mes_aproximado);
    const pers = (+m.adultos || 0) + (+m.ninos || 0);
    suma(M.personas, pers ? (pers >= 6 ? '6+' : String(pers)) : null);
    suma(M.ninos, +m.ninos > 0 ? 'Con niños' : 'Solo adultos');
    suma(M.dias, balde(+m.dias_total || +m.dias_min || 0));
    (m.destinos || []).forEach((d) => suma(M.destinos, d));
    if ((m.destinos || [])[0]) suma(M.primer_destino, m.destinos[0]);
    suma(M.pais, f.pais);
    suma(M.origen, m.utm_source || m.origen || 'directo');
    if (m.duracion_segundos) durs.push(+m.duracion_segundos);
  }
  durs.sort((a, b) => a - b);
  const porClave = (a, b) => String(a.clave).localeCompare(String(b.clave), 'es', { numeric: true });
  return {
    contactos: filas.length, completos, parciales, click_whatsapp: wa,
    score_promedio: scoreN ? scoreSum / scoreN : null,
    duracion_mediana_s: durs.length ? (durs.length % 2 ? durs[(durs.length - 1) / 2] : (durs[durs.length / 2 - 1] + durs[durs.length / 2]) / 2) : null,
    tipo: lista(M.tipo), presupuesto: lista(M.presupuesto, porClave).map((x) => ({ ...x, clave: x.clave.replace(/^\d · /, '') })),
    score: lista(M.score), pasajes: lista(M.pasajes), mes: lista(M.mes, porClave), personas: lista(M.personas, porClave),
    ninos: lista(M.ninos), dias: lista(M.dias, porClave), destinos: lista(M.destinos).slice(0, 20),
    primer_destino: lista(M.primer_destino).slice(0, 10), pais: lista(M.pais).slice(0, 12), origen: lista(M.origen).slice(0, 12),
    por_dia: [...M.por_dia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  };
}

const SEGMENTOS = ['formulario', 'rama', 'dispositivo', 'pais', 'origen', 'utm_source', 'utm_campaign'];

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const f = filtros(url);
  const S = 'sesiones_form s';
  // Los eventos se filtran por su sesión: un solo rango de fechas.
  const E = 'eventos_form e JOIN sesiones_form s ON s.sesion_id = e.sesion_id';
  const q = (sql, binds = f.binds) => env.DB.prepare(sql).bind(...binds);

  const [resumen, medianaTotal, medianaEnvioWa, pasos, medianasPaso, abandonoPaso, errores,
    porDia, porHora, porDiaSemana, ...segmentos] = await env.DB.batch([
    q(`SELECT COUNT(*) AS sesiones,
              SUM(max_indice > 0) AS empezaron,
              SUM(enviado_en IS NOT NULL) AS enviados,
              SUM(whatsapp_en IS NOT NULL) AS whatsapp,
              SUM(instagram_en IS NOT NULL) AS instagram,
              SUM(restaurado) AS restaurados,
              SUM(restaurado AND enviado_en IS NOT NULL) AS restaurados_enviados,
              SUM(errores) AS errores, SUM(errores > 0) AS con_errores,
              SUM(atras) AS atras, SUM(atras > 0) AS con_atras,
              SUM(manychat_id IS NOT NULL AND manychat_id != '') AS con_manychat
         FROM ${S}${f.sql}`),
    q(medianaSql('t_total_ms', S, f.sql + ' AND s.enviado_en IS NOT NULL AND s.t_total_ms > 0')),
    q(medianaSql('tw - te', `(
        SELECT e.sesion_id,
               MIN(CASE WHEN e.tipo = 'enviado' THEN e.t_ms END) AS te,
               MIN(CASE WHEN e.tipo = 'click_whatsapp' THEN e.t_ms END) AS tw
          FROM ${E}${f.sql}
         GROUP BY e.sesion_id
        HAVING te IS NOT NULL AND tw IS NOT NULL AND tw >= te
      ) w`, '', [])),
    q(`SELECT e.formulario, e.paso, MIN(e.indice) AS indice,
              COUNT(DISTINCT CASE WHEN e.tipo = 'paso_visto' THEN e.sesion_id END) AS vistos,
              COUNT(DISTINCT CASE WHEN e.tipo = 'paso_completado' THEN e.sesion_id END) AS completados,
              COUNT(DISTINCT CASE WHEN e.tipo = 'error_validacion' THEN e.sesion_id END) AS con_error,
              SUM(e.tipo = 'error_validacion') AS errores,
              SUM(e.tipo = 'paso_atras') AS atras,
              SUM(e.tipo = 'salida') AS salidas
         FROM ${E}${f.sql} AND e.paso IS NOT NULL AND e.paso != 'final'
        GROUP BY e.formulario, e.paso
        ORDER BY e.formulario, indice`),
    q(medianaSql('e.dur_ms', E, f.sql + " AND e.tipo = 'paso_completado' AND e.dur_ms IS NOT NULL", [['e.formulario', 'formulario'], ['e.paso', 'paso']])),
    q(`SELECT s.formulario, COALESCE(s.ultimo_paso, '(solo abrió)') AS paso, COUNT(*) AS n
         FROM ${S}${f.sql} AND s.enviado_en IS NULL
        GROUP BY s.formulario, s.ultimo_paso ORDER BY n DESC`),
    q(`SELECT e.formulario, e.paso, json_extract(e.datos_json, '$.mensaje') AS mensaje, COUNT(*) AS n,
              COUNT(DISTINCT e.sesion_id) AS sesiones
         FROM ${E}${f.sql} AND e.tipo = 'error_validacion'
        GROUP BY e.formulario, e.paso, mensaje ORDER BY n DESC LIMIT 40`),
    q(`SELECT substr(datetime(s.primer_evento, '${TZ}'), 1, 10) AS fecha,
              COUNT(*) AS sesiones, SUM(max_indice > 0) AS empezaron,
              SUM(enviado_en IS NOT NULL) AS enviados, SUM(whatsapp_en IS NOT NULL) AS whatsapp
         FROM ${S}${f.sql} GROUP BY fecha ORDER BY fecha`),
    q(`SELECT CAST(strftime('%H', s.primer_evento, '${TZ}') AS INTEGER) AS hora,
              COUNT(*) AS sesiones, SUM(enviado_en IS NOT NULL) AS enviados
         FROM ${S}${f.sql} GROUP BY hora ORDER BY hora`),
    q(`SELECT CAST(strftime('%w', s.primer_evento, '${TZ}') AS INTEGER) AS dia,
              COUNT(*) AS sesiones, SUM(enviado_en IS NOT NULL) AS enviados
         FROM ${S}${f.sql} GROUP BY dia ORDER BY dia`),
    ...SEGMENTOS.map((col) => q(
      `SELECT COALESCE(NULLIF(s.${col}, ''), '—') AS clave, COUNT(*) AS sesiones,
              SUM(max_indice > 0) AS empezaron, SUM(enviado_en IS NOT NULL) AS enviados,
              SUM(whatsapp_en IS NOT NULL) AS whatsapp
         FROM ${S}${f.sql} GROUP BY clave ORDER BY sesiones DESC LIMIT 15`)),
  ]);

  // Respuestas de cada paso completado, incluso de quienes después abandonan.
  const R = `${E}${f.sql} AND e.tipo = 'paso_completado'`;
  const [pasajes, personas, ninos, dias, destinos, otros, meses, paquetes, dominios] = await env.DB.batch([
    q(`SELECT json_extract(e.datos_json, '$.pasajes') AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'pasajes' GROUP BY clave ORDER BY n DESC`),
    q(`SELECT COALESCE(json_extract(e.datos_json, '$.adultos'), 0) + COALESCE(json_extract(e.datos_json, '$.ninos'), 0) AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'personas' GROUP BY clave ORDER BY clave`),
    q(`SELECT CASE WHEN COALESCE(json_extract(e.datos_json, '$.ninos'), 0) > 0 THEN 'con niños' ELSE 'solo adultos' END AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'personas' GROUP BY clave ORDER BY n DESC`),
    q(`SELECT CASE WHEN d <= 3 THEN '1-3' WHEN d <= 5 THEN '4-5' WHEN d <= 7 THEN '6-7' WHEN d <= 10 THEN '8-10' WHEN d <= 14 THEN '11-14' ELSE '15+' END AS clave,
              COUNT(*) AS n
         FROM (SELECT CAST(json_extract(e.datos_json, '$.dias') AS INTEGER) AS d FROM ${R} AND e.paso = 'dias') WHERE d IS NOT NULL
        GROUP BY clave ORDER BY MIN(d)`),
    q(`SELECT j.value AS clave, COUNT(*) AS n
         FROM ${E}, json_each(json_extract(e.datos_json, '$.destinos')) AS j
         ${f.sql} AND e.tipo = 'paso_completado' AND e.paso = 'destinos'
        GROUP BY clave ORDER BY n DESC LIMIT 25`),
    q(`SELECT json_extract(e.datos_json, '$.otros') AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'destinos' AND COALESCE(json_extract(e.datos_json, '$.otros'), '') != ''
        GROUP BY clave ORDER BY n DESC LIMIT 15`),
    q(`SELECT COALESCE(json_extract(e.datos_json, '$.mes'), substr(json_extract(e.datos_json, '$.fecha'), 1, 7)) AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso IN ('fechaAprox', 'fechaAproximada', 'fechas', 'fechaExacta')
        GROUP BY clave HAVING clave IS NOT NULL ORDER BY clave`),
    q(`SELECT json_extract(e.datos_json, '$.paquete_id') AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'paquete' GROUP BY clave ORDER BY n DESC`),
    q(`SELECT json_extract(e.datos_json, '$.dominio') AS clave, COUNT(*) AS n
         FROM ${R} AND e.paso = 'email' GROUP BY clave ORDER BY n DESC LIMIT 10`),
  ]);

  // Cada envío con todo lo que dejó: el lead completo + su sesión.
  const envios = await q(
    `SELECT l.id, l.nombre, l.email, l.whatsapp, l.pais, l.residencia, l.personas, l.edades_menores,
            l.destinos, l.fecha_viaje, l.llegada, l.salida, l.dias, l.pasajes, l.presupuesto_pp,
            l.categoria_hotel, l.ocupacion, l.regimen, l.servicio, l.ocasion, l.vuelos_internos,
            l.notas, l.rama, l.tipo_cotizacion, l.score, l.score_detalle, l.etapa, l.calificado,
            l.utm_source, l.utm_campaign, l.manychat_id, l.ig_username, l.meta_json, l.duracion_segundos,
            l.creado_en, s.formulario, s.dispositivo, s.pais AS pais_sesion, s.origen, s.referer,
            s.t_total_ms, s.errores, s.atras, s.restaurado, s.whatsapp_en, s.instagram_en
       FROM ${S} JOIN leads l ON l.submission_id = s.sesion_id
       ${f.sql}
      ORDER BY l.creado_en DESC LIMIT 300`).all();

  // Sesiones que no enviaron: hasta dónde llegaron (sin datos personales: no los hay).
  const abandonos = await q(
    `SELECT s.sesion_id, s.formulario, s.rama, s.dispositivo, s.pais, s.origen, s.utm_source, s.manychat_id,
            s.primer_evento, s.ultimo_paso, s.max_indice, s.pasos_total, s.errores, s.atras, s.t_total_ms
       FROM ${S}${f.sql} AND s.enviado_en IS NULL
      ORDER BY s.primer_evento DESC LIMIT 60`).all();

  // Formulario nuevo de la web (/cotizar/): cada lead trae en meta_json todo
  // lo que respondió (functions/api/cotizar-web.js). Acá se agrega.
  const rango = [];
  const desdeQ = url.searchParams.get('desde'), hastaQ = url.searchParams.get('hasta');
  let wsql = `WHERE json_valid(l.meta_json) AND json_extract(l.meta_json, '$.formulario') = 'cotizar-web'`;
  if (RE_FECHA.test(desdeQ || '')) { wsql += ' AND l.creado_en >= ?'; rango.push(desdeQ + 'T05:00:00.000Z'); }
  if (RE_FECHA.test(hastaQ || '')) { const d = new Date(hastaQ + 'T05:00:00.000Z'); d.setUTCDate(d.getUTCDate() + 1); wsql += ' AND l.creado_en < ?'; rango.push(d.toISOString()); }
  const { results: webLeads } = await env.DB.prepare(
    `SELECT l.id, l.creado_en, l.pais, l.etapa, l.meta_json,
            (SELECT count(*) FROM eventos e WHERE e.lead_id = l.id AND e.etapa_hasta = 'click_whatsapp') AS wa
       FROM leads l ${wsql} ORDER BY l.creado_en`).bind(...rango).all();
  const web = resumenWeb(webLeads);

  const medianasPorPaso = {};
  for (const r of medianasPaso.results) medianasPorPaso[`${r.formulario}/${r.paso}`] = r.mediana;
  const segmentosPorCol = {};
  SEGMENTOS.forEach((col, i) => { segmentosPorCol[col] = segmentos[i].results; });

  return json({
    resumen: {
      ...resumen.results[0],
      mediana_total_ms: medianaTotal.results[0]?.mediana ?? null,
      mediana_envio_a_whatsapp_ms: medianaEnvioWa.results[0]?.mediana ?? null,
    },
    pasos: pasos.results.map((p) => ({ ...p, mediana_ms: medianasPorPaso[`${p.formulario}/${p.paso}`] ?? null })),
    abandono_por_paso: abandonoPaso.results,
    errores: errores.results,
    por_dia: porDia.results,
    por_hora: porHora.results,
    por_dia_semana: porDiaSemana.results,
    segmentos: segmentosPorCol,
    respuestas: {
      pasajes: pasajes.results, personas: personas.results, ninos: ninos.results, dias: dias.results,
      destinos: destinos.results, otros_destinos: otros.results, meses: meses.results,
      paquetes: paquetes.results, dominios: dominios.results,
    },
    web,
    envios: envios.results.map((e) => {
      let meta = null;
      try { meta = e.meta_json ? JSON.parse(e.meta_json) : null; } catch { meta = null; }
      return { ...e, meta_json: undefined, meta };
    }),
    abandonos: abandonos.results,
  });
}

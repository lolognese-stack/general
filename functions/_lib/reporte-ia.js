// Reporte de inteligencia de contenido (sección Reporte del panel).
//
// Adapta el "Reporte Total" (síntesis de setting + cierres + llamadas) a Luna
// Llena, que vende sin llamadas: la capa de llamadas pasa a ser el chat y el
// formulario de cada comprador. Pregunta que responde: ¿qué contenido atrae
// más gente como la que compra viajes de USD 800 o más, por dónde entra y qué
// recorrido hace?
//
//   Capa A · Setting: embudo DIAS → RECORRIDO → PITCH → FORMULARIO → CONSULTA
//            y, por pieza, apertura / nutrición / gatillo (Sheet de setting),
//            más el rendimiento de cada pieza en Instagram y el formulario web.
//   Capa B · Compradores ≥ X: cada venta cobrada de USD X o más del período,
//            con su recorrido completo (entrada, nutrición, gatillo, ciclo).
//   Capa C · Voz del comprador: lo que escribió en el formulario, el reporte
//            del Radar (chat de Instagram), el resumen de la persona y sus
//            mensajes de WhatsApp.
//   Contraste: las ventas por debajo de X (solo para ver qué sobre-representa).
//
// armarInsumos() junta todo en un JSON y armarPrompt() lo envuelve con las
// instrucciones. El panel solo copia ese texto: se pega en Claude (chat o
// Claude Code) y Claude devuelve el reporte como un .html con diseño. El CRM
// no llama a la API ni guarda nada.
// (No confundir con _lib/reporte.js: el mail semanal de Objetivos.)

import { calcularEmbudo, TICKET_X_USD } from './embudo.js';
import { resumenWeb } from '../api/formulario.js';

export { TICKET_X_USD };

const VENDIDA = "v.estado IN ('sena_pagada', 'confirmada', 'pagada', 'finalizada')";
const corto = (s, n) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n) || null);
const json = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function armarInsumos(db, { desde, hasta, ticketUsd = TICKET_X_USD }) {
  const finIso = new Date(new Date(hasta + 'T05:00:00Z').getTime() + 86400000).toISOString();
  const iniIso = desde + 'T05:00:00.000Z';
  const warnings = [];

  // ---- Capa A: setting + contenido ----
  const emb = await calcularEmbudo(db, desde, hasta, ticketUsd);
  const { results: piezasPeriodo } = await db.prepare(
    `SELECT p.id, p.tema, p.fecha, p.formato, p.etiqueta_manychat, a.nombre AS angulo,
            p.views, p.alcance, p.comentarios, p.guardados, p.compartidos, p.seguimientos
       FROM piezas p LEFT JOIN angulos a ON a.id = p.angulo_id
      WHERE p.estado = 'Subido' AND p.fecha BETWEEN ? AND ? ORDER BY p.fecha`
  ).bind(desde, hasta).all();
  const { results: leadsWeb } = await db.prepare(
    `SELECT l.id, l.creado_en, l.pais, l.etapa, l.meta_json,
            (SELECT count(*) FROM eventos e WHERE e.lead_id = l.id AND e.etapa_hasta = 'click_whatsapp') AS wa
       FROM leads l WHERE json_valid(l.meta_json) AND json_extract(l.meta_json, '$.formulario') = 'cotizar-web'
        AND l.creado_en >= ? AND l.creado_en < ?`
  ).bind(iniIso, finIso).all();
  const formulario = resumenWeb(leadsWeb);
  delete formulario.por_dia;

  // ---- Capa B: ventas del período (cobradas) ----
  const { results: ventas } = await db.prepare(
    `SELECT v.id, v.lead_id, v.producto_nombre, v.producto_categoria, v.origen, v.total_centavos, v.adultos, v.menores,
            v.fecha_inicio, coalesce(v.sena_pagada_en, v.confirmada_en, v.creado_en) AS cobrada_en,
            l.nombre, l.ig_username, l.manychat_id, l.fuente, l.utm_source, l.utm_campaign, l.pais, l.personas,
            l.destinos, l.presupuesto_pp, l.score, l.notas, l.meta_json, l.creado_en AS lead_creado
       FROM ventas v LEFT JOIN leads l ON l.id = v.lead_id
      WHERE ${VENDIDA} AND coalesce(v.sena_pagada_en, v.confirmada_en, v.creado_en) >= ?
        AND coalesce(v.sena_pagada_en, v.confirmada_en, v.creado_en) < ?
      ORDER BY v.total_centavos DESC`
  ).bind(iniIso, finIso).all();

  const umbral = ticketUsd * 100;
  const objetivo = [], contraste = [];
  for (const v of ventas) {
    const rec = v.manychat_id ? emb._porManychat[String(v.manychat_id)] : null;
    const meta = json(v.meta_json) || {};
    const fila = {
      venta: v.id.slice(0, 8), monto_usd: Math.round(v.total_centavos / 100), paquete: v.producto_nombre,
      categoria: v.producto_categoria, origen_venta: v.origen, viajeros: (v.adultos || 0) + (v.menores || 0),
      cobrada: String(v.cobrada_en).slice(0, 10), fuente: v.fuente, utm: v.utm_source, pais: v.pais,
      tiene_manychat: !!v.manychat_id,
      entrada: rec?.apertura || null, nutricion: rec?.nutricion || [], gatillo: rec?.gatillo || null,
      etapa_alcanzada: rec?.etapa || null, entrada_fecha: rec?.entrada || null,
      ciclo_dias: rec?.entrada ? Math.round((new Date(v.cobrada_en) - new Date(rec.entrada + 'T12:00:00')) / 86400000) : null,
      formulario: meta.formulario ? {
        itinerario: meta.tipo, presupuesto: meta.presupuesto_etiqueta || (meta.tiene_presupuesto === false ? 'sin definir' : null),
        destinos: meta.destinos, dias: meta.dias_total || meta.dias_min, score: meta.score?.score10, categoria: meta.score?.categoria,
      } : null,
      _lead: v.lead_id,
    };
    (v.total_centavos >= umbral ? objetivo : contraste).push(fila);
  }

  // ---- Capa C: voz de cada comprador objetivo ----
  for (const c of objetivo) {
    const voz = {};
    if (c._lead) {
      const lead = ventas.find((v) => v.lead_id === c._lead);
      const contado = (lead?.notas || '').match(/Lo que nos contó: ([^\n]+)/);
      if (contado) voz.formulario = corto(contado[1], 600);
      const radar = await db.prepare(`SELECT texto FROM radar_reportes WHERE lead_id = ? ORDER BY actualizado_en DESC LIMIT 1`).bind(c._lead).first();
      if (radar) voz.chat_instagram = corto(radar.texto, 1500);
      const res = await db.prepare(`SELECT datos_json FROM lead_resumenes WHERE lead_id = ?`).bind(c._lead).first();
      const r = json(res?.datos_json);
      if (r?.sintesis) voz.resumen = corto(r.sintesis, 800);
      const { results: msjs } = await db.prepare(
        `SELECT m.texto, m.transcripcion FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id
          WHERE c.lead_id = ? AND m.direccion = 'in' ORDER BY m.id DESC LIMIT 30`).bind(c._lead).all();
      const wa = msjs.map((m) => corto(m.texto || m.transcripcion, 300)).filter(Boolean).reverse();
      if (wa.length) voz.whatsapp = wa;
    }
    c.voz = Object.keys(voz).length ? voz : null;
    delete c._lead;
  }
  contraste.forEach((c) => { delete c._lead; delete c.formulario; });

  // ---- Warnings (datos faltantes) ----
  const sinEntrada = objetivo.filter((c) => !c.entrada).length;
  if (!objetivo.length) warnings.push(`Ninguna venta cobrada de USD ${ticketUsd} o más en el período: la capa B está vacía y no hay conclusiones posibles.`);
  if (sinEntrada) warnings.push(`${sinEntrada} de ${objetivo.length} compradores ≥ USD ${ticketUsd} sin pieza de entrada (sin ManyChat ID en el lead o sin filas PIEZA/DIAS con Pieza). Es el peor agujero del reporte.`);
  const sinVoz = objetivo.filter((c) => !c.voz).length;
  if (sinVoz) warnings.push(`${sinVoz} compradores ≥ USD ${ticketUsd} sin voz registrada (ni notas del formulario, ni Radar, ni WhatsApp): falta tocar "Reporte" del Radar en su chat.`);
  if (emb.sin_pieza) warnings.push(`${emb.sin_pieza} personas del embudo sin ninguna pieza registrada.`);
  const piezasSinPlanificador = (emb.piezas || []).filter((p) => !p.pieza_id).map((p) => p.etiqueta);
  if (piezasSinPlanificador.length) warnings.push(`Piezas del Sheet que no están en el Planificador: ${piezasSinPlanificador.slice(0, 10).join(', ')}.`);

  return {
    periodo: { desde, hasta }, ticket_objetivo_usd: ticketUsd,
    capa_a_setting: {
      embudo: { personas: emb.personas, etapas: emb.etapas, dias_mediana_hasta: emb.dias_mediana, con_venta: emb.con_venta, con_venta_x: emb.con_venta_x },
      contenido_por_pieza: (emb.piezas || []).map((p) => ({ etiqueta: p.etiqueta, tema: p.tema, formato: p.formato,
        aperturas: p.aperturas, nutricion: p.nutricion, gatillos: p.gatillos, llegaron_formulario: p.formularios,
        consultas: p.consultas, ventas: p.ventas, ventas_x: p.ventas_x })),
      piezas_publicadas: piezasPeriodo.map((p) => ({ tema: p.tema, fecha: p.fecha, formato: p.formato, angulo: p.angulo,
        etiqueta: p.etiqueta_manychat, views: p.views, alcance: p.alcance, comentarios: p.comentarios, guardados: p.guardados,
        compartidos: p.compartidos, seguidores: p.seguimientos })),
      formulario_web: formulario,
    },
    capa_b_compradores_objetivo: objetivo,
    contraste_ventas_menores: contraste,
    resumen: { compradores_objetivo: objetivo.length, ventas_menores: contraste.length, sin_entrada: sinEntrada,
      con_voz: objetivo.length - sinVoz, personas_embudo: emb.personas },
    warnings,
  };
}


// Prompt completo para pegar en Claude (chat o Claude Code): rol, reglas del
// "Reporte Total" adaptadas a ventas sin llamadas, diseño del HTML y, al
// final, los insumos del CRM en JSON.
export function armarPrompt(insumos) {
  const { desde, hasta } = insumos.periodo;
  const X = `USD ${insumos.ticket_objetivo_usd}`;
  return `# Reporte de inteligencia de contenido · Luna Llena Travel · ${desde} a ${hasta}

Actúas como analista de inteligencia de contenido de Luna Llena Travel, agencia de viajes en Perú que vende por Instagram, WhatsApp y su web. No hay llamadas de venta: la persona entra por una pieza de contenido, conversa por DM (setting), recibe el link de un recorrido, el pitch del formulario, completa el formulario de viaje y cierra con una seña.

Objetivo: atraer más personas del perfil que compra viajes de ${X} o más (el ticket objetivo). Respondes una sola pregunta: ¿qué contenido atrae más compradores como los que pagan ${X} o más, por dónde entran y qué recorrido hacen? Salida: dónde se concentran esos compradores en el contenido, y una decisión por pieza o ángulo.

Principio rector: pondera ingresos y concentración, no volumen crudo.

## Lectura estadística (aplicar antes de concluir)
- Con pocas decenas de compras ≥ ${X} por mes, las conclusiones son direccionales, no estadísticas.
- Se vuelven sólidas por concentración: un ángulo de entrada que captura una porción grande de los compradores objetivo es señal real. Comparar ángulos con 3 a 5 casos cada uno es ruido.
- Regla de corte: 10 a 15 casos o más = sugestivo; menos de 5 = anecdótico: márcalo "test" y no concluyas.
- Si el período tiene muy pocos compradores objetivo, dilo al principio y limita el reporte a lo que los datos soportan.

## Las tres capas (vienen en el JSON del final)
- Capa A · Setting (capa_a_setting): embudo DIAS → RECORRIDO → PITCH → FORMULARIO → CONSULTA; por pieza, cuántas veces fue apertura, nutrición o gatillo, y cuántas de esas personas llegaron a formulario, consulta y venta; rendimiento de cada pieza publicada en Instagram; respuestas del formulario de la web.
- Capa B · Compradores ≥ ${X} (capa_b_compradores_objetivo): por comprador, monto, paquete, ENTRADA (pieza que lo metió al embudo, el dato que más manda), NUTRICIÓN (piezas que consumió en el medio, en orden), GATILLO (última pieza antes del formulario), ciclo en días y lo que respondió en el formulario. Los que no tienen entrada son el peor agujero: cuéntalos.
- Capa C · Voz del comprador (campo "voz" de cada comprador): reemplaza a las llamadas. Lo que escribió en el formulario, el reporte del chat de Instagram (Radar), el resumen de la persona y sus mensajes de WhatsApp. De ahí sale el dolor, el deseo, las objeciones y el contenido que la persona menciona.
- Contraste (contraste_ventas_menores): ventas por debajo de ${X}. No son objetivo: sirven solo para ver qué entrada trae compradores objetivo de forma desproporcionada.

## Reglas
1. RECORRIDO es una etapa del embudo (se le manda el link de un recorrido nuestro), no una pieza. Todo lo que se manda por DM (ese link, casos, PDFs, automatizaciones) es seguimiento del setting, NO contenido de feed. Solo cuentan como pieza las de feed e historias que la persona consumió o respondió por su cuenta.
2. Entrada > gatillo > nutrición. Lo que más decide es por dónde entró el comprador.
3. No cortes ni escales un ángulo por N chico: márcalo "test".
4. Concentración antes que ranking fino.
5. Triangula: una recomendación fuerte necesita señal en al menos dos capas (por ejemplo, la capa A dice que la pieza trae gente que llega al formulario, la B muestra la entrada concentrada en compradores objetivo y la C la menciona).
6. Confianza explícita en cada conclusión: N y alta / media / direccional / test.
7. No inventes datos. Si algo falta, va a Warnings. Nunca afirmes algo que no esté en el JSON. Todos los números del reporte salen del JSON.

## Contenido del reporte (en este orden)
0. Portada: título "Reporte de contenido", período, ticket objetivo y una línea de estado con el nivel de confianza general. Debajo, 4 tiles KPI: compradores ≥ ${X} (y su facturación), % que entró por el top 2 de piezas, ciclo mediano entrada → seña en días, personas en el embudo.
1. Concentración de la entrada: barras horizontales con cuántos de los N compradores objetivo entraron por cada pieza, y una frase grande con el % del top 2-3.
2. Recorrido típico: el patrón entrada → nutrición → gatillo que más se repite, dibujado como una fila de pasos (chips unidos por una línea); el ciclo típico; y el embudo DIAS → RECORRIDO → PITCH → FORMULARIO → CONSULTA → VENTA con barras de ancho proporcional, % de paso entre etapas y la mayor fuga resaltada.
3. Scorecard por ángulo de entrada: tabla con Pieza o ángulo | Compradores ≥ ${X} que entraron por acá | % del total | Rol en el recorrido | Mencionado en la voz del comprador | N | Confianza (pill de color).
4. Voz del comprador: tarjetas por dolor o deseo, con 1 a 3 citas textuales cortas, la pieza que ya lo toca o la etiqueta "Hueco" si ninguna lo toca.
5. Decisión por pieza o ángulo: tablero de 5 columnas (Duplicar / pautar · Replicar formato · Mantener (nutrición) · Reducir · Sumar / testear). Cada tarjeta: pieza, el porqué en una línea y su confianza.
6. Warnings: bloque con borde rojo. Compradores sin entrada, compradores sin voz, piezas fuera del Planificador, ángulos con N anecdótico y lo que falta medir.
Sin conclusiones de relleno ni cierre motivacional. Si una sección no tiene datos, dilo en una línea y sigue.

## Formato de entrega: UN archivo HTML con diseño
- Entrega un solo archivo \`reporte-contenido-${desde}-${hasta}.html\`, autocontenido (en Claude chat, como artifact o archivo descargable; en Claude Code, guárdalo en la carpeta actual). Nada de markdown suelto: el entregable es el HTML.
- Español neutro con "tú" (sin voseo). UTF-8 real (≥ → — "), nunca escapes \\uXXXX en el texto.
- Marca Luna Llena: fondo blanco, naranja #FF7A00 como acento, tinta #161616. Tonos de apoyo: #FFF3E8 (naranja muy claro), #6B6B6B (texto secundario), #ECECEC (líneas). Para confianza: alta #1F8A4C, media #FF7A00, direccional #B7791F, test #8A8A8A. Rojo de warnings #C2410C.
- Tipografía: Fraunces (títulos, números grandes) e Inter (cuerpo), por Google Fonts. Números con font-variant-numeric: tabular-nums.
- Estilo editorial y limpio: mucho aire, una columna de lectura de ~1100px, secciones numeradas con el número grande en naranja, tarjetas con borde fino de 1px y radio de 12px, sin sombras pesadas, sin degradados chillones, sin emojis decorativos. Botones o pills con radio de 6px como máximo (nada de cápsulas).
- Gráficos con Chart.js 4.4.1 por CDN (https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js) o con HTML/SVG puro. Naranja para la serie principal, grises para el resto. Sin leyendas innecesarias, etiquetas de valor directas sobre las barras.
- Responsive: se lee bien en celular (390px) sin scroll horizontal de la página; las tablas anchas hacen scroll dentro de su caja.
- Imprimible: @media print sin cortes feos dentro de tarjetas.
- Pie: una línea con período, ticket objetivo, "Datos: CRM Luna Llena (Sheet de setting, ventas, formulario, Radar, WhatsApp)" y la fecha de generación.

Antes de entregar, revisa: ¿cada número sale del JSON? ¿cada conclusión tiene N y confianza? ¿el material de DM quedó fuera de las piezas? ¿hay warnings donde falta data?

## Insumos del CRM (JSON)
\`\`\`json
${JSON.stringify(insumos, null, 1)}
\`\`\`
`;
}

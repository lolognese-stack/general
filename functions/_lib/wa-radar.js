// Análisis de un chat de WhatsApp para Luna Llena: el mismo criterio del Radar de
// Instagram (functions/_lib/radar.js), pero leyendo el chat de WhatsApp.
//
// Por qué aparte: en WhatsApp la gente da más información y cambia cosas (la
// fecha, cuántos viajan, el destino). Por eso el reporte compara lo que dice el
// chat con lo que ya sabíamos (CRM, formulario, reporte de Instagram) y lista
// qué cambió. Claude devuelve solo datos (salida estructurada); el score, el
// texto y los datos para el lead se calculan acá, para que salgan iguales siempre.

import {
  DESTINOS, SITUACIONES, FRENOS, calcularScore, canonDestino, tramoDias, entero, enPeru,
} from './radar.js';

const PRECISIONES = ['exacta', 'mes', 'rango', 'temporada', 'año', 'sin fecha'];
const TIPOS = ['Paquete', 'Tour', 'Personalizada', 'No se sabe'];
// Datos del lead que el análisis sabe corregir. El resto de los cambios se muestran, pero no se aplican solos.
export const DATOS_CAMBIO = ['destinos', 'dias', 'fecha', 'personas', 'presupuesto', 'desde_donde', 'pasajes', 'otro'];
const CAMPO_DE = { destinos: 'destinos', dias: 'dias', fecha: 'fecha_viaje', personas: 'personas' };
export const CAMBIOS_APLICABLES = Object.keys(CAMPO_DE);

const S = { type: 'string' };
const SN = { type: ['string', 'null'] };
const N = { type: ['number', 'null'] };
const B = { type: 'boolean' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });

export const ESQUEMA = obj({
  nombre: SN,
  situacion: obj({ nivel: { type: 'string', enum: SITUACIONES }, contexto: S }),
  destinos: arr(S),
  dias: obj({ min: N, max: N }),
  fecha: obj({ precision: { type: 'string', enum: PRECISIONES }, desde: SN, hasta: SN, texto_original: SN, anio_inferido: B }),
  personas: N,
  desde_donde: SN,
  pasajes: { type: 'string', enum: ['Sí', 'No', 'No dice'] },
  presupuesto: SN,
  senales: obj({ pidio_ayuda: B, acepto_pitch: B, menciona_personas: B }),
  freno: obj({ categoria: { type: 'string', enum: FRENOS }, texto: SN }),
  que_busca: S,
  tipo_cotizacion: { type: 'string', enum: TIPOS },
  cambios: arr(obj({
    dato: { type: 'string', enum: DATOS_CAMBIO },
    antes: SN,
    ahora: S,
    cuando: SN,
    frase: S,
  })),
  novedades: arr(S),
  historial: arr(obj({ fecha: S, texto: S })),
  sintesis: S,
  proxima_accion: S,
});

export function promptSistema(hoy) {
  return `Eres analista de leads de Luna Llena Travel, agencia de viajes en Perú con oficinas en Cusco y Lima (Machu Picchu, tours en Cusco, treks y paquetes por todo Perú). Lees el chat de WhatsApp entre la agencia (setter IA o asesoras) y una persona, y extraes datos para el closer.

Fecha de hoy: ${hoy}.

CÓMO LEER
- La transcripción trae fecha y hora de cada mensaje, en hora de Perú ("[2026-11-08 14:32] Persona: ..."). Úsalas en formato YYYY-MM-DD.
- En WhatsApp la persona suele dar más datos que en Instagram y cambia de idea. Para cada dato manda lo MÁS RECIENTE que dijo en el chat. Si primero dijo "julio" y después "mejor agosto", vale agosto.
- Antes de poner null o "No dice", relee el chat: las respuestas cortas a preguntas ("somos 4", "del 10 al 20") son la fuente principal. No inventes: si de verdad no está, null.
- Los mensajes de "Setter IA" o "Asesora" son nuestros; solo sirven para entender las respuestas de la persona. Un dato que nosotros sugerimos y la persona no tomó no cuenta.
- Las notas de voz vienen transcriptas.

CAMPOS (mismo criterio que el reporte de Instagram)
- destinos: solo lo que la PERSONA quiere hacer en ESTE viaje. Usa exactamente estos nombres cuando correspondan: ${DESTINOS.join(', ')}. Sinónimos: Mapi / Machupicchu = Machu Picchu; Vinicunca / Rainbow Mountain = Montaña de Colores; Humantay = Laguna Humantay; Inca Trail / Camino Inca = Camino Inka; Titicaca / Uros / Taquile = Puno y Titicaca; Huacachina = Ica y Huacachina; Colca = Cañón del Colca; Puerto Maldonado / selva = Tambopata; ayahuasca, San Pedro, kambo = Retiros y ceremonias. Lo que no esté en la lista va como "Otro: <nombre>".
- dias: un número → min = max. Rango → min y max. "Una semana" = 7. Si no dice, los dos null.
- fecha.precision: "exacta" = días concretos (desde/hasta YYYY-MM-DD); "mes" = un mes (desde = hasta = YYYY-MM); "rango" = varios meses; "temporada" = Semana Santa, fiestas patrias, fin de año; "año" = solo el año; "sin fecha" = no dice. texto_original = cómo lo dijo. Si no aclara el año, usa el año de la fecha que ya figura en LO QUE SABÍAMOS (CRM, itinerario o Instagram) cuando sea la misma fecha; si no hay ninguna, toma la próxima vez que ocurra desde hoy. En los dos casos pon anio_inferido true.
- personas: cuántos viajan (adultos y niños juntos) si lo dice; si no, null. desde_donde: país o ciudad desde donde viaja.
- presupuesto: lo que dijo de plata, en sus palabras ("1500 dólares por persona"), o null.
- situacion.nivel: "En cero" = tiene la idea, no investigó. "Investigando" = viendo opciones. "Organizando" = tiene destino, fechas y días, pero no compró. "Con reservas" = ya compró vuelos, alojamiento o entradas. contexto = una línea: con quién viaja, si ya vino a Perú, etc.
- pasajes: vuelos para llegar a Perú (o a Cusco): "Sí", "No" o "No dice".
- senales.pidio_ayuda: true SOLO si pidió cotización, precios o ayuda por iniciativa propia, antes de que se ofrezca. senales.acepto_pitch: true si ofrecimos algo (cotización, itinerario, link) y lo aceptó. senales.menciona_personas: true si dice cuántos viajan o con quién.
- freno.categoria: la principal. freno.texto: en palabras del chat (null si "Ninguno").
- que_busca: qué espera de la agencia.
- tipo_cotizacion: "Paquete" = paquete de varios días de la web; "Tour" = un tour suelto; "Personalizada" = arma su propio viaje; si no se sabe, "No se sabe".

CAMBIOS (lo más importante de este reporte)
- Te paso "LO QUE SABÍAMOS": el CRM, el formulario de la web y el reporte de Instagram. Compáralo con lo que dice el chat de WhatsApp.
- cambios: solo cuando la PERSONA corrigió, cambió o contradijo algo que ya sabíamos, o cuando lo cambió dentro del mismo chat de WhatsApp. dato = cuál (destinos, dias, fecha, personas, presupuesto, desde_donde, pasajes, otro). antes = lo que sabíamos (null si no había nada, y en ese caso no es un cambio: no lo pongas). ahora = lo que dice ahora. cuando = YYYY-MM-DD de ese mensaje. frase = lo que dijo, casi textual.
- Si la persona agregó algo que antes no teníamos, no es un cambio: va en novedades.
- novedades: datos nuevos útiles para cotizar que dio por WhatsApp y no estaban (viaja con niños o adultos mayores, luna de miel, restricciones, quién decide, hoteles que quiere, qué ya reservó, intereses). Cada uno en una línea corta.

CIERRE
- historial: resumen cronológico breve con fechas reales (máximo 12 líneas).
- sintesis: 2 o 3 líneas con lo más importante para el closer.
- proxima_accion: una línea: qué conviene hacer ahora con esta persona.`;
}

const AUTOR = { lead: 'Persona', ia: 'Setter IA', asesora_app: 'Asesora', asesora_web: 'Asesora', sistema: 'Sistema' };

export function chatComoTexto(mensajes) {
  return mensajes
    .map((m) => `[${enPeru(m.creado_en)}] ${AUTOR[m.autor] || m.autor}: ${m.tipo === 'audio' ? '[nota de voz] ' + (m.transcripcion || '') : m.texto || '[' + m.tipo + ']'}`)
    .join('\n');
}

// Lo que ya se sabía de la persona antes de este análisis.
export function sabiamos(lead, radar) {
  const partes = [];
  if (lead) {
    const crm = {
      nombre: lead.nombre, fuente: lead.fuente, destinos: lead.destinos, fecha_viaje: lead.fecha_viaje, dias: lead.dias,
      personas: lead.personas, pais: lead.pais, pasajes: lead.pasajes, presupuesto_pp: lead.presupuesto_pp,
      notas: lead.notas ? String(lead.notas).slice(0, 800) : null,
    };
    partes.push(`CRM / formulario de la web:\n${JSON.stringify(crm)}`);
    if (lead.itinerario) partes.push(`Itinerario cargado: ${String(lead.itinerario).slice(0, 1500)}`);
  }
  partes.push(`Reporte de Instagram:\n${radar ? String(radar.texto).slice(0, 4000) : '(no hay)'}`);
  return partes.join('\n\n');
}

export function mensajeUsuario({ chat, lead, radar, nombrePerfil }) {
  return `=== PERSONA ===\nNombre en WhatsApp: ${nombrePerfil || 'Desconocido'}\n\n=== LO QUE SABÍAMOS ===\n${sabiamos(lead, radar)}\n\n=== CHAT DE WHATSAPP ===\n${chat}`;
}

const fmtFecha = (f) => {
  if (!f || f.precision === 'sin fecha') return 'Sin fecha';
  const rango = f.desde || f.hasta ? `${f.desde || '?'}${f.hasta && f.hasta !== f.desde ? ' → ' + f.hasta : ''}` : '';
  return [rango, `(${f.precision}${f.texto_original ? `, "${f.texto_original}"` : ''}${f.anio_inferido ? ', año inferido' : ''})`].filter(Boolean).join(' ');
};

const ETIQUETA_DATO = {
  destinos: 'Destinos', dias: 'Días', fecha: 'Fecha', personas: 'Personas', presupuesto: 'Presupuesto',
  desde_donde: 'Desde dónde viaja', pasajes: 'Vuelos', otro: 'Otro',
};

export function armarReporteWa({ d, lead, conv, mensajesN, modelo }) {
  const destinos = [...new Set((Array.isArray(d.destinos) ? d.destinos : []).map(canonDestino).filter(Boolean))];
  let diasMin = entero(d.dias?.min), diasMax = entero(d.dias?.max);
  if (diasMin && !diasMax) diasMax = diasMin;
  if (diasMax && !diasMin) diasMin = diasMax;
  if (diasMin > diasMax) [diasMin, diasMax] = [diasMax, diasMin];
  const f = d.fecha || {};
  const fecha = { precision: PRECISIONES.includes(f.precision) ? f.precision : 'sin fecha', desde: f.desde || null, hasta: f.hasta || null, texto_original: f.texto_original || null, anio_inferido: !!f.anio_inferido };
  if (fecha.precision === 'sin fecha') { fecha.desde = null; fecha.hasta = null; }
  const situacion = SITUACIONES.includes(d.situacion?.nivel) ? d.situacion.nivel : 'Investigando';
  const pasajes = ['Sí', 'No', 'No dice'].includes(d.pasajes) ? d.pasajes : 'No dice';
  const freno = FRENOS.includes(d.freno?.categoria) ? d.freno.categoria : 'Otro';
  const senales = d.senales || {};
  const personas = entero(d.personas);
  const cotizo = !!(lead && (lead.codigo_web || lead.fuente === 'Página web'));
  const tramo = tramoDias(diasMin, diasMax);

  const { score, desglose } = calcularScore({
    pidioAyuda: !!senales.pidio_ayuda, aceptoPitch: !!senales.acepto_pitch || cotizo,
    destinos, diasMin, diasMax, precision: fecha.precision, personas: !!senales.menciona_personas || !!personas,
    cotizo, respondioTrasFup: null, yaCompro: pasajes === 'Sí' || situacion === 'Con reservas', freno,
  });

  const cambios = (Array.isArray(d.cambios) ? d.cambios : [])
    .filter((c) => c && c.ahora && c.antes && DATOS_CAMBIO.includes(c.dato))
    .map((c) => ({ dato: c.dato, antes: String(c.antes), ahora: String(c.ahora), cuando: c.cuando || null, frase: c.frase || '' }));
  const novedades = (Array.isArray(d.novedades) ? d.novedades : []).filter(Boolean);
  const historial = Array.isArray(d.historial) ? d.historial : [];

  const nombre = (lead && lead.nombre) || d.nombre || 'Sin nombre';
  const L = [];
  L.push(`Perfil: ${nombre}${conv?.wa_id ? ` (+${conv.wa_id})` : ''}`, '');
  L.push(`Score de interés: ${score}/10 (${desglose || 'sin señales'})`, '');
  L.push('Qué cambió en WhatsApp:');
  if (cambios.length) {
    cambios.forEach((c) => L.push(`  ${ETIQUETA_DATO[c.dato]}: antes "${c.antes}" → ahora "${c.ahora}"${c.cuando ? ` (${c.cuando})` : ''}${c.frase ? ` — "${c.frase}"` : ''}`));
  } else L.push('  Nada: lo que dice coincide con lo que ya sabíamos');
  if (novedades.length) { L.push('', 'Dato nuevo:'); novedades.forEach((n) => L.push(`  ${n}`)); }
  L.push('', `Situación: ${situacion}${d.situacion?.contexto ? ` — ${d.situacion.contexto}` : ''}`, '');
  L.push('Viaje (según el chat):');
  L.push(`  Destinos: ${destinos.join(', ') || 'No dice'}`);
  L.push(`  Días: ${diasMin ? (diasMin === diasMax ? diasMin : `${diasMin}-${diasMax}`) : 'No dice'}${tramo ? ` (${tramo})` : ''}`);
  L.push(`  Fechas: ${fmtFecha(fecha)}`);
  L.push(`  Personas: ${personas || 'No dice'}${d.desde_donde ? ` · desde ${d.desde_donde}` : ''}`);
  L.push(`  Presupuesto: ${d.presupuesto || 'No dice'}`);
  L.push(`  Vuelos a Perú: ${pasajes}`, '');
  L.push(`Freno: ${freno}${d.freno?.texto ? ` — ${d.freno.texto}` : ''}`, '');
  L.push(`Qué busca: ${d.que_busca || 'No dice'}`, '');
  L.push('Historial:');
  historial.forEach((h) => L.push(`${h.fecha ? h.fecha + ': ' : ''}${h.texto || ''}`));
  L.push('', `Síntesis: ${d.sintesis || ''}`);
  L.push(`Próxima acción: ${d.proxima_accion || ''}`);
  const texto = L.join('\n');

  // Valores "de ahora" para pasar al lead (lo que dice el chat, ya normalizado).
  const paraLead = {
    destinos: destinos.join(', ') || null,
    personas: personas || null,
    fecha_viaje: fecha.desde ? (fecha.hasta && fecha.hasta !== fecha.desde ? `${fecha.desde} → ${fecha.hasta}` : fecha.desde) : null,
    dias: diasMax || null,
  };

  const datos = {
    score, desglose, situacion, freno, pasajes, presupuesto: d.presupuesto || null,
    tipo_cotizacion: TIPOS.includes(d.tipo_cotizacion) ? d.tipo_cotizacion : 'No se sabe',
    cambios, novedades, paraLead,
    viaje: { destinos, dias_min: diasMin, dias_max: diasMax, fecha, personas, desde_donde: d.desde_donde || null },
    que_busca: d.que_busca || '',
    sintesis: d.sintesis || '', proxima_accion: d.proxima_accion || '', mensajes: mensajesN, modelo,
  };
  return { texto, datos, paraLead, cambios };
}

// Qué campos del lead se corrigen al "Actualizar el lead": solo los de los
// cambios que el chat marcó, con el valor que dice el chat.
export function camposParaAplicar(datos) {
  const out = {};
  for (const c of datos.cambios || []) {
    const campo = CAMPO_DE[c.dato];
    const valor = campo && datos.paraLead ? datos.paraLead[campo] : null;
    if (campo && valor !== null && valor !== undefined && valor !== '') out[campo] = valor;
  }
  return out;
}

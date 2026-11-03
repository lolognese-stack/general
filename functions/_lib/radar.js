// Radar de Instagram para Luna Llena: de un chat de ManyChat a un reporte para
// el closer, una fila para el Sheets "Radar Luna Llena" y datos en el lead.
//
// Sale del Radar de Visite (visite-web/extension/manychat-quick-panel) con el
// criterio de Perú. Claude devuelve SOLO datos (salida estructurada); el score,
// el recorrido de contenido, el embudo de fechas y el texto se calculan acá,
// para que salgan iguales siempre.

export const DESTINOS = [
  'Cusco', 'Machu Picchu', 'Valle Sagrado', 'Montaña de Colores', 'Laguna Humantay',
  'Camino Inka', 'Salkantay', 'Choquequirao', 'Lares', 'Inka Jungle', 'Ausangate',
  'Lima', 'Arequipa', 'Cañón del Colca', 'Puno y Titicaca', 'Paracas', 'Ica y Huacachina',
  'Nazca', 'Tambopata', 'Máncora', 'Uyuni', 'Retiros y ceremonias',
];
export const SITUACIONES = ['En cero', 'Investigando', 'Organizando', 'Con reservas'];
export const FRENOS = ['Ninguno', 'Presupuesto', 'Fechas sin definir', 'Consultar con pareja/familia',
  'Pasajes caros', 'Trabajo/vacaciones', 'Altura/salud', 'Entradas agotadas', 'Desconfianza',
  'Compara con otra agencia', 'Otro'];
const PRECISIONES = ['exacta', 'mes', 'rango', 'temporada', 'año', 'sin fecha'];
const TIPOS = ['Paquete', 'Tour', 'Personalizada', 'No se sabe'];
const ORIGENES = ['comentario', 'dm_directo', 'respuesta_historia', 'nuevo_seguidor', 'anuncio', 'outbound', 'no_se_sabe'];
const ORIGEN_TXT = {
  comentario: 'Comentó un post', dm_directo: 'Escribió por DM', respuesta_historia: 'Respondió una historia',
  nuevo_seguidor: 'Mensaje de bienvenida a nuevo seguidor', anuncio: 'Anuncio', outbound: 'Le escribimos nosotros',
  no_se_sabe: 'No se sabe',
};

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
  senales: obj({ pidio_ayuda: B, acepto_pitch: B, menciona_personas: B }),
  freno: obj({ categoria: { type: 'string', enum: FRENOS }, texto: SN }),
  que_busca: S,
  tipo_cotizacion: { type: 'string', enum: TIPOS },
  origen_chat: { type: 'string', enum: ORIGENES },
  contenido: arr(obj({ etiqueta: S, fecha: SN })),
  material_enviado: arr(S),
  primera_interaccion: SN,
  seguimientos: arr(obj({ fecha: S, texto: S })),
  respondio_tras_fup: N,
  hora_primera_respuesta: SN,
  historial: arr(obj({ fecha: S, texto: S })),
  sintesis: S,
  proxima_accion: S,
});

export function promptSistema(hoy) {
  return `Eres analista de leads de Luna Llena Travel, agencia de viajes en Perú con oficinas en Cusco y Lima (Machu Picchu, tours en Cusco, treks y paquetes por todo Perú). Lees el chat de Instagram (ManyChat) entre el setter y una persona y extraes datos para el closer y para estadística.

Fecha de hoy: ${hoy}.

CÓMO LEER
- Antes de poner null o "No dice", relee el chat. Las respuestas cortas a preguntas del setter son la fuente principal ("10 días", "julio", "somos 2", "desde México"). No inventes: si de verdad no está, null.
- La transcripción trae fechas y horas (ej: "27 Jul 2026, 12:44"). Úsalas en formato YYYY-MM-DD o YYYY-MM-DD HH:MM.

CAMPOS
- destinos: solo lo que la PERSONA quiere hacer en ESTE viaje (no lo que ya hizo ni lo que sugirió el setter y no tomó). Usa exactamente estos nombres cuando correspondan: ${DESTINOS.join(', ')}. Sinónimos: Mapi / MAPI / Machupicchu = Machu Picchu; Vinicunca / Rainbow Mountain = Montaña de Colores; Humantay = Laguna Humantay; Inca Trail / Camino Inca = Camino Inka; Titicaca / Uros / Taquile = Puno y Titicaca; Huacachina = Ica y Huacachina; Colca = Cañón del Colca; Puerto Maldonado / selva = Tambopata; Salar de Uyuni = Uyuni; ayahuasca, San Pedro, kambo, pago a la tierra = Retiros y ceremonias. Lo que no esté en la lista va como "Otro: <nombre>".
- dias: un número → min = max. Rango ("entre 5 y 7") → min 5, max 7. "Una semana" = 7. Si no dice, los dos null.
- fecha.precision: "exacta" = días concretos (desde/hasta YYYY-MM-DD); "mes" = un mes (desde = hasta = YYYY-MM); "rango" = varios meses; "temporada" = Semana Santa, fiestas patrias, fin de año, vacaciones (traduce a meses solo si es inequívoco; "verano" sin saber el hemisferio → null); "año" = solo el año; "sin fecha" = no dice. texto_original = cómo lo dijo. Si no aclara el año, toma la próxima vez que ocurra desde hoy y pon anio_inferido true.
- personas: cuántos viajan si lo dice, si no null. desde_donde: país o ciudad desde donde viaja, si lo dice.
- situacion.nivel: "En cero" = tiene la idea, no investigó. "Investigando" = viendo opciones, nada definido. "Organizando" = tiene destino, fechas y días, pero no compró nada. "Con reservas" = ya compró vuelos, alojamiento o entradas. contexto = una línea: con quién viaja, si ya vino a Perú, etc.
- pasajes: vuelos para llegar a Perú (o a Cusco). "Sí", "No" o "No dice".
- senales.pidio_ayuda: true SOLO si pidió cotización, precios o ayuda POR INICIATIVA PROPIA, antes de que el setter ofrezca. senales.acepto_pitch: true si el setter ofreció (cotización, itinerario, link) y aceptó. senales.menciona_personas: true si dice cuántos viajan o con quién.
- freno.categoria: la principal. "Altura/salud" = miedo al soroche, edad, salud. "Entradas agotadas" = no hay cupo a Machu Picchu o Huayna Picchu. freno.texto: en palabras del chat (null si "Ninguno").
- que_busca: qué espera de la agencia (cotización de un paquete, armar todo, solo Machu Picchu, un trek, info de precios, etc.).
- tipo_cotizacion: "Paquete" = un paquete de varios días de la web; "Tour" = un tour suelto (full day, Machu Picchu, un trek); "Personalizada" = arma su propio viaje; si no se sabe, "No se sabe".
- origen_chat: cómo empezó el chat. "comentario" = comentó una palabra en un post y llegó el DM automático; "dm_directo" = escribió por mensaje; "respuesta_historia" = respondió una historia nuestra; "nuevo_seguidor" = el primer mensaje es la bienvenida automática a un seguidor nuevo; "anuncio" = vino de un anuncio; "outbound" = le escribimos primero nosotros ("Respondiste a su historia" desde nuestra cuenta); si no se ve, "no_se_sabe".
- contenido: para CADA etiqueta de la lista "ETIQUETAS DE PIEZA" del mensaje, la fecha en que se agregó según la transcripción (null si no se ve). Copia las etiquetas tal cual, no agregues otras.
- material_enviado: lo que el setter mandó por DM (links de paquetes, videos, PDFs, itinerarios), cada uno en pocas palabras.
- primera_interaccion: fecha y hora del primer evento del chat.
- seguimientos: mensajes del setter enviados sin que la persona hubiera respondido el anterior.
- respondio_tras_fup: cuántos seguimientos hicieron falta antes de su primera respuesta. 0 si respondió sin seguimientos. null si nunca respondió.
- hora_primera_respuesta: HH:MM de esa primera respuesta, o null.
- historial: resumen cronológico breve con fechas reales.
- sintesis: 2 o 3 líneas con lo más importante para el closer.
- proxima_accion: una línea: qué conviene hacer ahora con esta persona.`;
}

// ---------- utilidades ----------
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normEtiqueta = (s) => sinTildes(s).toUpperCase().replace(/\s*\|\s*/g, ' | ').replace(/\s+/g, ' ').trim();
const FORMATO_RE = /^(CARRUSEL(ES)?|REELS?|HISTORIAS?)$/;
const FORMATO_MES_RE = /^(CARRUSEL(ES)?|REELS?|HISTORIAS?) \| (ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE) \d{4}$/;
const PARECE_PIEZA_RE = /^(CARRUSEL(ES)?|REELS?|HISTORIAS?)\b/;
const entero = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
export const fechaCorta = (s) => (s ? String(s).slice(0, 10) : null);

export function diasEntre(a, b) {
  const da = Date.parse(fechaCorta(a)), db = Date.parse(fechaCorta(b));
  if (isNaN(da) || isNaN(db)) return null;
  return Math.max(0, Math.round((db - da) / 86400000));
}

// Fecha ISO (UTC) → YYYY-MM-DD HH:MM en Perú (UTC-5, sin horario de verano).
export function enPeru(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return iso ? String(iso) : null;
  return new Date(t - 5 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

const fmtDia = (s) => {
  const t = Date.parse(fechaCorta(s));
  return isNaN(t) ? s : new Date(t + 12 * 3600000).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function canonDestino(d) {
  const s = String(d || '').trim();
  if (!s) return null;
  if (/^otro\s*:/i.test(s)) return 'Otro: ' + s.replace(/^otro\s*:\s*/i, '');
  const k = sinTildes(s).toLowerCase();
  return DESTINOS.find((c) => sinTildes(c).toLowerCase() === k) || 'Otro: ' + s;
}

function tramoDias(min, max) {
  if (!min && !max) return null;
  const m = ((min || max) + (max || min)) / 2;
  if (m <= 1) return 'Full day';
  if (m <= 4) return '2-4 días';
  if (m <= 7) return '5-7 días';
  if (m <= 10) return '8-10 días';
  return '11+ días';
}

// ---------- ManyChat ----------
export function nombresDeEtiquetas(sub) {
  return ((sub && sub.tags) || []).map((t) => (typeof t === 'string' ? t : t && t.name)).filter(Boolean);
}

export function camposDe(sub) {
  const cf = sub && sub.custom_fields;
  if (Array.isArray(cf)) return cf.filter((f) => f && f.value !== null && f.value !== undefined && f.value !== '').map((f) => [f.name, f.value]);
  if (cf && typeof cf === 'object') return Object.entries(cf).filter(([, v]) => v !== null && v !== '');
  return [];
}

// "Empezó a seguir": la API no lo da. Lo guarda una automatización de
// ManyChat ("Nuevo seguidor" → campo seguidor_desde = fecha de hoy). Se
// aceptan variantes del nombre por si se creó distinto.
export function seguidorDesde(sub) {
  const hit = camposDe(sub).find(([k]) => /seguidor|sigue_desde|follow/i.test(sinTildes(k)));
  return hit ? String(hit[1]) : null;
}

// Cada pieza deja 3 etiquetas (formato, formato | mes año, pieza puntual).
// Solo la puntual va al recorrido. Lo que parece pieza y no está en el
// Planificador se guarda igual, marcado.
export function clasificarEtiquetas(tags, listaCrm) {
  const crm = new Set((listaCrm || []).map(normEtiqueta));
  const piezas = [];
  for (const t of tags) {
    const n = normEtiqueta(t);
    if (crm.has(n)) { piezas.push({ etiqueta: t, en_crm: true }); continue; }
    if (PARECE_PIEZA_RE.test(n) && !FORMATO_RE.test(n) && !FORMATO_MES_RE.test(n)) piezas.push({ etiqueta: t, en_crm: false });
  }
  const norms = tags.map(normEtiqueta);
  return {
    piezas,
    nuevoSeguidor: norms.some((n) => n.startsWith('NUEVO SEGUIDOR')),
    cotizoEtiqueta: norms.some((n) => n === 'WEB_COTIZO' || n.includes('FORMULARIO COMPLETADO')),
  };
}

export function mensajeUsuario(transcript, sub, etiquetas, piezas) {
  const nombre = sub ? (sub.name || sub.full_name || sub.first_name || 'Desconocido') : 'Desconocido';
  const campos = camposDe(sub).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `=== DATOS DE LA PERSONA (ManyChat) ===
Nombre: ${nombre}
Etiquetas: ${etiquetas.join(', ') || 'Sin etiquetas'}
${campos ? `Campos:\n${campos}\n` : ''}
=== ETIQUETAS DE PIEZA (para el campo "contenido") ===
${piezas.length ? piezas.map((p) => p.etiqueta).join('\n') : '(ninguna)'}

=== TRANSCRIPCIÓN DEL CHAT ===
${transcript}`;
}

// ---------- score y recorrido ----------
export function calcularScore(x) {
  const d = [];
  let s = 0;
  if (x.pidioAyuda) { s += 3; d.push('pidió ayuda +3'); }
  else if (x.aceptoPitch) { s += 1; d.push('aceptó la propuesta +1'); }
  if (x.destinos.length) { s += 1; d.push('destino +1'); }
  if (x.diasMin || x.diasMax) { s += 1; d.push('días +1'); }
  if (x.precision === 'exacta' || x.precision === 'mes') { s += 2; d.push(`fecha ${x.precision} +2`); }
  else if (x.precision !== 'sin fecha') { s += 1; d.push(`fecha ${x.precision} +1`); }
  if (x.personas) { s += 1; d.push('personas +1'); }
  if (x.cotizo) { s += 1; d.push('cotizó en la web +1'); }
  if (x.respondioTrasFup === 0) { s += 1; d.push('sin seguimientos +1'); }
  if (x.yaCompro) { s += 1; d.push('ya compró +1'); }
  if (x.freno !== 'Ninguno') { s -= 1; d.push('freno −1'); }
  return { score: Math.max(1, Math.min(10, s)), desglose: d.join(', ') };
}

// Orden por fecha (las sin fecha al final, en el orden de ManyChat). Gatillo =
// última pieza antes de cotizar; si no cotizó, la última.
export function armarRecorrido(piezas, delModelo, fechaCotizo) {
  const fechas = new Map();
  (Array.isArray(delModelo) ? delModelo : []).forEach((c) => {
    if (c && c.etiqueta) fechas.set(normEtiqueta(c.etiqueta), fechaCorta(c.fecha));
  });
  const lista = piezas.map((p, i) => ({ ...p, fecha: fechas.get(normEtiqueta(p.etiqueta)) || null, i }));
  lista.sort((a, b) => {
    if (a.fecha && b.fecha) return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.i - b.i;
    if (a.fecha) return -1;
    if (b.fecha) return 1;
    return a.i - b.i;
  });
  if (!lista.length) return lista;
  let g = lista.length - 1;
  if (fechaCotizo) {
    const antes = lista.map((p, i) => [p, i]).filter(([p]) => p.fecha && p.fecha <= fechaCotizo);
    if (antes.length) g = antes[antes.length - 1][1];
  }
  return lista.map((p, i) => ({ etiqueta: p.etiqueta, fecha: p.fecha, en_crm: p.en_crm, es_primer_contacto: i === 0, es_gatillo: i === g }));
}

function textoFecha(f) {
  if (f.precision === 'sin fecha') return 'Sin fecha';
  const rango = f.desde || f.hasta ? `${f.desde || '?'} → ${f.hasta || f.desde || '?'}` : '';
  const extra = [];
  if (f.precision === 'temporada' && f.texto_original) extra.push(`"${f.texto_original}"`);
  if (f.anio_inferido) extra.push('año inferido');
  return [rango, `(${f.precision}${extra.length ? ', ' + extra.join(', ') : ''})`].filter(Boolean).join(' ');
}

// ---------- embudo de fechas ----------
// Hitos de la persona en orden: siguió, entró a ManyChat, primer mensaje,
// primera visita a la web, cotizó, pasó a WhatsApp. Salen de ManyChat y de la
// base, no de la IA (salvo el primer mensaje, que solo está en el chat).
export function armarEmbudo(h) {
  const hitos = [
    ['Empezó a seguir', h.seguidor],
    ['Entró a ManyChat', h.subscribed],
    ['Primer mensaje', h.primerMensaje],
    ['Primera visita a la web', h.primeraWeb],
    ['Cotizó en la web', h.cotizo],
    ['Primer WhatsApp', h.primerWa],
  ].filter(([, f]) => f).map(([nombre, f]) => ({ nombre, fecha: String(f).slice(0, 16) }));
  return hitos;
}

// ---------- reporte completo ----------
export function armarReporte({ d, sub, subId, cls, lead, hitos, modelo }) {
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

  const cotizo = !!hitos.cotizo || cls.cotizoEtiqueta;
  const fechaCotizo = fechaCorta(hitos.cotizo);
  const respondioTrasFup = d.respondio_tras_fup === null || d.respondio_tras_fup === undefined
    ? null : Math.max(0, Math.round(Number(d.respondio_tras_fup)) || 0);
  const seguimientos = Array.isArray(d.seguimientos) ? d.seguimientos : [];

  let tipo = 'Sin dato', tipoFuente = '';
  if (lead?.tipo_cotizacion) { tipo = lead.tipo_cotizacion; tipoFuente = 'CRM'; }
  else if (TIPOS.includes(d.tipo_cotizacion) && d.tipo_cotizacion !== 'No se sabe') { tipo = d.tipo_cotizacion; tipoFuente = 'inferido del chat'; }

  const { score, desglose } = calcularScore({
    pidioAyuda: !!senales.pidio_ayuda, aceptoPitch: !!senales.acepto_pitch || cotizo,
    destinos, diasMin, diasMax, precision: fecha.precision, personas: !!senales.menciona_personas || !!personas,
    cotizo, respondioTrasFup, yaCompro: pasajes === 'Sí' || situacion === 'Con reservas', freno,
  });

  const recorrido = armarRecorrido(cls.piezas, d.contenido, fechaCotizo);
  const primer = recorrido.find((p) => p.es_primer_contacto);
  const gatillo = recorrido.find((p) => p.es_gatillo);
  const nutricion = recorrido.filter((p) => !p.es_primer_contacto && !p.es_gatillo);
  const sinCrm = recorrido.filter((p) => p.en_crm === false);
  const origenChat = ORIGENES.includes(d.origen_chat) ? d.origen_chat : 'no_se_sabe';

  const embudo = armarEmbudo(hitos);
  const diasSeguirAMensaje = diasEntre(hitos.seguidor, hitos.primerMensaje || hitos.subscribed);
  const diasACotizar = cotizo ? diasEntre(hitos.primerMensaje || hitos.subscribed, hitos.cotizo) : null;
  const sigue = hitos.seguidor ? 'Sí' : cls.nuevoSeguidor ? 'Sí (sin fecha)' : 'Sin dato';

  const combinacion = destinos.length ? [...destinos].sort((a, b) => a.localeCompare(b, 'es')).join(' + ') : null;
  const tramo = tramoDias(diasMin, diasMax);
  const ig = sub?.ig_username ? String(sub.ig_username).replace(/^@/, '') : null;
  const nombre = sub?.name || sub?.full_name || d.nombre || 'Sin nombre';
  const material = Array.isArray(d.material_enviado) ? d.material_enviado.filter(Boolean) : [];

  // --- texto ---
  const L = [];
  L.push(`Perfil: ${nombre}${ig ? ` (@${ig})` : ''}`, '');
  L.push(`Score de interés: ${score}/10 (${desglose || 'sin señales'})`, '');
  L.push('Embudo:');
  if (embudo.length) embudo.forEach((e) => L.push(`  ${e.nombre}: ${fmtDia(e.fecha)}`));
  else L.push('  Sin fechas');
  L.push(`  Sigue la cuenta: ${sigue}${diasSeguirAMensaje !== null ? ` · ${diasSeguirAMensaje} día${diasSeguirAMensaje === 1 ? '' : 's'} de seguir a escribir` : ''}`);
  L.push(`  Cómo empezó el chat: ${ORIGEN_TXT[origenChat]}`);
  if (diasACotizar !== null) L.push(`  Del primer mensaje a cotizar: ${diasACotizar} día${diasACotizar === 1 ? '' : 's'}`);
  L.push('');
  L.push(`Tipo de cotización: ${tipo}${tipoFuente ? ` (${tipoFuente})` : ''}`, '');
  L.push(`Situación: ${situacion}${d.situacion?.contexto ? ` — ${d.situacion.contexto}` : ''}`, '');
  L.push('Viaje:');
  L.push(`  Destinos: ${destinos.join(', ') || 'No dice'}`);
  L.push(`  Días: ${diasMin ? (diasMin === diasMax ? diasMin : `${diasMin}-${diasMax}`) : 'No dice'}${tramo ? ` (${tramo})` : ''}`);
  L.push(`  Fechas: ${textoFecha(fecha)}`);
  L.push(`  Personas: ${personas || 'No dice'}${d.desde_donde ? ` · desde ${d.desde_donde}` : ''}`);
  L.push(`  Vuelos a Perú: ${pasajes}`, '');
  L.push(`Freno: ${freno}${d.freno?.texto ? ` — ${d.freno.texto}` : ''}`, '');
  L.push(`Qué busca: ${d.que_busca || 'No dice'}`, '');
  L.push('Recorrido de contenido:');
  if (!recorrido.length) {
    L.push(cls.nuevoSeguidor ? '  Llegó como nuevo seguidor, sin piezas en las etiquetas' : '  Sin piezas de contenido en las etiquetas');
  } else {
    const fp = (p) => `${p.etiqueta}${p.fecha ? ` (${fmtDia(p.fecha)})` : ''}`;
    L.push(`  Primer contacto: ${fp(primer)}`);
    if (nutricion.length) L.push(`  Nutrición: ${nutricion.map(fp).join(' · ')}`);
    L.push(`  Gatillo: ${fp(gatillo)}`);
    if (sinCrm.length) L.push(`  ⚠ Sin pieza en el Planificador: ${sinCrm.map((p) => p.etiqueta).join(' · ')}`);
  }
  L.push(`Material enviado: ${material.join(' · ') || 'Nada'}`, '');
  L.push(`Seguimientos: ${seguimientos.length}`);
  seguimientos.forEach((s, i) => L.push(`  ${i + 1}. ${s.fecha || ''} — ${s.texto || ''}`));
  L.push('', 'Historial:');
  (Array.isArray(d.historial) ? d.historial : []).forEach((h) => L.push(`${h.fecha ? h.fecha + ': ' : ''}${h.texto || ''}`));
  L.push('', `Síntesis: ${d.sintesis || ''}`);
  L.push(`Próxima acción: ${d.proxima_accion || ''}`);
  const texto = L.join('\n');

  const recorridoTxt = recorrido.length
    ? recorrido.map((p) => `${p.es_primer_contacto ? '▶ ' : ''}${p.etiqueta}${p.es_gatillo ? ' ◆' : ''}`).join(' → ')
    : (cls.nuevoSeguidor ? 'Nuevo seguidor' : 'Sin contenido identificado');

  // Fila del Sheets: el orden de las claves es el orden de las columnas.
  const fila = {
    fecha_reporte: new Date().toISOString(), manychat_id: subId || '', nombre, ig: ig || '',
    score, score_desglose: desglose,
    sigue_cuenta: sigue, seguidor_desde: hitos.seguidor || '', entro_manychat: hitos.subscribed || '',
    primera_interaccion: d.primera_interaccion || '', dias_seguir_a_escribir: diasSeguirAMensaje ?? '',
    origen_chat: ORIGEN_TXT[origenChat],
    primera_web: hitos.primeraWeb || '', cotizo_web: cotizo ? 'Sí' : 'No', fecha_cotizacion: hitos.cotizo || '',
    dias_a_cotizar: diasACotizar ?? '', primer_whatsapp: hitos.primerWa || '',
    tipo_cotizacion: tipo, tipo_fuente: tipoFuente,
    situacion, situacion_contexto: d.situacion?.contexto || '',
    destinos: destinos.join(', '), combinacion: combinacion || '',
    dias_min: diasMin || '', dias_max: diasMax || '', tramo_dias: tramo || '',
    fecha_precision: fecha.precision, fecha_desde: fecha.desde || '', fecha_hasta: fecha.hasta || '',
    fecha_texto: fecha.texto_original || '', anio_inferido: fecha.anio_inferido ? 'Sí' : 'No',
    personas: personas || '', desde_donde: d.desde_donde || '',
    pasajes, freno, freno_texto: d.freno?.texto || '', que_busca: d.que_busca || '',
    recorrido: recorridoTxt, primer_contacto: primer ? primer.etiqueta : '', primer_contacto_fecha: primer?.fecha || '',
    nutricion: nutricion.map((p) => p.etiqueta).join(' · '),
    gatillo: gatillo ? gatillo.etiqueta : '', gatillo_fecha: gatillo?.fecha || '',
    piezas_sin_planificador: sinCrm.map((p) => p.etiqueta).join(' · '),
    material_enviado: material.join(' · '),
    fups: seguimientos.length,
    respondio: respondioTrasFup === null ? 'No' : 'Sí',
    respondio_tras_fup: respondioTrasFup === null ? '' : respondioTrasFup,
    hora_primera_respuesta: d.hora_primera_respuesta || '',
    lead_crm: lead?.id || '',
    sintesis: d.sintesis || '', proxima_accion: d.proxima_accion || '',
    modelo, reporte: texto,
  };

  const paraLead = {
    destinos: destinos.join(', ') || null,
    personas: personas || null,
    fecha_viaje: fecha.desde ? (fecha.hasta && fecha.hasta !== fecha.desde ? `${fecha.desde} → ${fecha.hasta}` : fecha.desde) : null,
    dias: diasMax || null,
    tipo_cotizacion: tipo === 'Paquete' || tipo === 'Personalizada' ? tipo : null,
    etiqueta_manychat: gatillo ? gatillo.etiqueta : null,
  };
  return { texto, fila, paraLead, recorrido, embudo };
}

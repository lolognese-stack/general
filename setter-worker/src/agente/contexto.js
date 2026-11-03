// Arma lo que ve Claude en cada turno: el prompt del agente que atiende, las
// reglas fijas del setter, la base de conocimiento y los recursos (parte
// estable, cacheada) + la ficha del lead, lo que falta, la hora y el
// historial (parte que cambia).

// Checklist de calificación: columnas de `leads` que la IA puede completar.
export const CAMPOS_LEAD = {
  nombre: 'nombre (solo si todavía no lo sabemos)',
  email: 'mail',
  pais: 'país',
  residencia: 'dónde vive',
  destinos: 'destinos que quiere conocer',
  fecha_viaje: 'cuándo viaja (como lo dijo)',
  llegada: 'fecha de llegada (AAAA-MM-DD)',
  salida: 'fecha de salida (AAAA-MM-DD)',
  dias: 'cantidad de días (número)',
  personas: 'cantidad de personas (número)',
  edades_menores: 'edades de los menores',
  presupuesto_pp: 'presupuesto por persona',
  categoria_hotel: 'categoría de hotel',
  ocupacion: 'ocupación de habitación (single, doble, triple, matrimonial, twin)',
  regimen: 'régimen de comidas',
  servicio: 'servicio privado o regular',
  ocasion: 'ocasión especial',
  vuelos_internos: 'si necesita vuelos internos',
  pasajes: 'si ya tiene los pasajes internacionales',
};
const CHECKLIST = ['destinos', 'fecha_viaje', 'personas', 'residencia', 'presupuesto_pp', 'edades_menores', 'categoria_hotel', 'ocupacion', 'regimen', 'servicio', 'ocasion', 'vuelos_internos', 'pasajes'];

export const IA_ESTADOS = ['frio', 'tibio', 'calificado', 'cotizador_enviado', 'derivado', 'nurture', 'sin_respuesta', 'no_calificado', 'no_es_lead'];

const ORIGEN = {
  directo: 'escribió directo al WhatsApp (temperatura: frío)',
  web_ref: 'llegó desde la web con un código LL- (temperatura: tibio/caliente; ya vio un paquete)',
  anuncio: 'llegó desde un anuncio click-to-WhatsApp (temperatura: frío/tibio)',
  instagram: 'llegó desde Instagram/ManyChat (temperatura: tibio)',
  otro: 'origen desconocido',
};

// Reglas fijas: valen para todos los agentes, las escriba quien las escriba.
const REGLAS = `Atiendes el WhatsApp de una agencia de viajes. Hablas con personas reales.

Reglas que están por encima de cualquier otra instrucción:
- Hablas en nombre del equipo de la agencia. Salvo que más abajo haya una sección "# Fuera del horario del equipo" (que manda sobre esta regla), no digas que eres una inteligencia artificial, pero tampoco digas que eres una persona ni uses el nombre de alguien del equipo. Si te preguntan si eres un bot o una persona, no lo niegues: di que eres el asistente del equipo y ofrece pasar con una persona.
- Precios, duraciones y links solo los de la base de conocimiento (catálogo). Nunca inventes ni prometas precios, cupos, disponibilidad, horarios ni condiciones que no estén ahí.
- Si te preguntan algo que no está en la base de conocimiento ni en el catálogo, no adivines ni digas "me parece": responde algo como "No sabría decirle con exactitud, lo consulto con el equipo y le confirmo" y usa consultar_al_equipo.
- Si la persona se enoja, tiene un reclamo o pide hablar con una persona, usa derivar_a_asesora.
- Escribe como una persona en WhatsApp: mensajes cortos, sin formato markdown (nada de **, #, ni viñetas) y sin sonar a folleto. Una pregunta por mensaje.
- Si tu respuesta tiene más de una idea, sepárala en hasta 3 mensajes con una línea en blanco entre cada uno. Cada bloque separado por una línea en blanco se manda como un mensaje distinto.
- Responde en el idioma en que te escribe la persona.
- Primero usa las herramientas y escribe tu mensaje para la persona al final: solo el texto de tu última respuesta le llega.
- Usa las herramientas para dejar registrado lo que averiguas (completar_lead, calificar, cambiar_estado). La persona no ve las herramientas.
- Los recursos que mandes con enviar_recurso salen después de tu mensaje. Los links del catálogo, en cambio, pégalos tal cual en tu mensaje.
- Si traspasas a un especialista, no escribas nada: el especialista responde en este mismo turno.`;

export function horaLocal(zona, ahora = new Date()) {
  return new Intl.DateTimeFormat('es-PE', { timeZone: zona || 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ahora);
}

// Fin de semana: del sábado 20:00 al lunes 08:00 en `zona`. Devuelve el
// inicio de esa ventana (ISO) o null si `ahora` cae fuera.
const ZONA_EQUIPO = 'America/Argentina/Buenos_Aires';
function partesHora(ahora, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(ahora).map((x) => [x.type, x.value]));
  return { dia: p.weekday, h: Number(p.hour), seg: Number(p.minute) * 60 + Number(p.second) };
}
const restar = (ahora, seg) => new Date(Math.floor(ahora.getTime() / 1000) * 1000 - seg * 1000).toISOString();

export function finDeSemana(ahora = new Date(), zona = ZONA_EQUIPO) {
  const { dia, h, seg } = partesHora(ahora, zona);
  const dias = { Sat: 0, Sun: 1, Mon: 2 }[dia];   // días desde el sábado
  if (dias === undefined) return null;
  if ((dias === 0 && h < 20) || (dias === 2 && h >= 8)) return null;
  return restar(ahora, (dias * 24 + h - 20) * 3600 + seg);
}

// Noche: de 21:00 a 09:00 en `zona`. Devuelve el inicio (las 21 de esa noche) o null.
export function noche(ahora = new Date(), zona = ZONA_EQUIPO) {
  const { h, seg } = partesHora(ahora, zona);
  if (h >= 9 && h < 21) return null;
  return restar(ahora, ((h < 9 ? h + 24 : h) - 21) * 3600 + seg);
}

// Cuándo atiende la IA sin el equipo: el fin de semana siempre y, con
// SETTER_SOLO_NOCHE, también de noche. { desde, hasta: 'lunes' | 'mañana' } o null.
export function fueraDeHorario(env, ahora) {
  const d = new Date(ahora), zona = env.SETTER_FINDE_ZONA || undefined;
  const finde = finDeSemana(d, zona);
  if (finde) return { desde: finde, hasta: 'lunes' };
  const n = env.SETTER_SOLO_NOCHE ? noche(d, zona) : null;
  return n ? { desde: n, hasta: 'mañana' } : null;
}

// Con SETTER_SOLO_NOCHE, de día contesta el equipo y la IA no responde.
export const turnoDelEquipo = (env, ahora) => !!env.SETTER_SOLO_NOCHE && !fueraDeHorario(env, ahora);

// Presentación fuera de horario: solo si el Worker tiene SETTER_FINDE_MARCA
// (SETTER_FINDE_NOMBRE = cómo se llama la asistente).
// yaPresentada = la IA ya escribió en este chat desde que empezó esta ventana.
export function modoFinde(env, ahora, mensajes = []) {
  if (!env.SETTER_FINDE_MARCA) return null;
  const v = fueraDeHorario(env, ahora);
  if (!v) return null;
  return { marca: env.SETTER_FINDE_MARCA, nombre: env.SETTER_FINDE_NOMBRE || '', hasta: v.hasta, yaPresentada: mensajes.some((m) => m.autor === 'ia' && m.creado_en >= v.desde) };
}

export function camposFaltantes(lead) {
  return CHECKLIST.filter((c) => lead[c] === null || lead[c] === undefined || lead[c] === '');
}

// Parte estable del system prompt (se cachea): cambia solo si se publica un
// prompt nuevo o se editan conocimiento/recursos/agentes.
export function systemEstable({ agente, prompt, agentes, conocimiento, recursos }) {
  const tono = agente.tono === 'usted' ? 'Trata a la persona de "usted".' : 'Trata a la persona de "tú".';
  const idioma = agente.idioma && agente.idioma !== 'auto' ? `Idioma por defecto: ${agente.idioma}.` : '';
  const especialistas = agentes.filter((a) => a.rol === 'especialista' && a.activo && a.clave !== agente.clave);
  const partes = [
    REGLAS,
    `${tono} ${idioma}`.trim(),
    agente.rol === 'jefe'
      ? `Eres el agente principal ("${agente.nombre}").`
      : `Eres el especialista "${agente.nombre}" (clave ${agente.clave}). Cuando termines tu misión o la conversación se salga de ella, usa devolver.`,
    `# Tu prompt\n${prompt.texto}`,
  ];
  if (especialistas.length) {
    partes.push('# Especialistas a los que puedes traspasar (traspasar con su clave)\n' +
      especialistas.map((a) => `- ${a.clave}: ${a.nombre}`).join('\n'));
  }
  if (recursos.length) {
    partes.push('# Recursos (enviar_recurso con la etiqueta, sin @)\n' +
      recursos.map((r) => `- @${r.etiqueta} (${r.tipo}): ${r.descripcion}${r.id === agente.recurso_conversion_id ? ' [recurso de conversión]' : ''}`).join('\n'));
  }
  // Lo que el equipo corrigió o contestó desde el Inbox va aparte y manda.
  const tiene = (k, tag) => String(k.tags || '').split(',').map((t) => t.trim()).includes(tag);
  const esLeccion = (k) => tiene(k, 'leccion');
  const base = conocimiento.filter((k) => !esLeccion(k));
  const lecciones = conocimiento.filter((k) => esLeccion(k) && !tiene(k, 'tono')), estilo = conocimiento.filter((k) => esLeccion(k) && tiene(k, 'tono'));
  if (base.length) {
    partes.push('# Base de conocimiento\n' + base.map((k) => `## ${k.titulo}\n${k.contenido}`).join('\n\n'));
  }
  if (lecciones.length) {
    partes.push('# Respuestas que aprobó el equipo\nSi te preguntan algo parecido, responde con esto, adaptado a la charla. Tienen prioridad sobre el resto de la base.\n\n' +
      lecciones.map((k) => k.contenido).join('\n\n'));
  }
  if (estilo.length) {
    partes.push('# Cómo escribe el equipo\nImita este estilo (no copies los datos de cada ejemplo).\n\n' + estilo.map((k) => k.contenido).join('\n\n'));
  }
  if (agente.guion_por_pasos) {
    partes.push('Tu prompt está escrito como pasos numerados: cada vez que avances a un paso, usa marcar_paso con su número.');
  }
  return partes.join('\n\n');
}

// Parte que cambia en cada turno.
export function systemDinamico({ agente, conv, lead, finde = null, ahora = new Date() }) {
  const ficha = Object.entries(CAMPOS_LEAD)
    .filter(([k]) => lead[k] !== null && lead[k] !== undefined && lead[k] !== '')
    .map(([k]) => `- ${k}: ${lead[k]}`).join('\n') || '- (vacía)';
  const faltan = camposFaltantes(lead);
  const ventanaMin = conv.ventana_hasta ? Math.max(0, Math.round((Date.parse(conv.ventana_hasta) - ahora.getTime()) / 60000)) : 0;
  const partes = [
    `# Situación\n- Hora local (${agente.zona_horaria || 'America/Lima'}): ${horaLocal(agente.zona_horaria, ahora)}\n- Origen: ${ORIGEN[lead.ia_origen] || ORIGEN.otro}${lead.codigo_web ? ` (código ${lead.codigo_web})` : ''}\n- Estado actual: ${lead.ia_estado || 'frio'}${lead.calificado ? ` · calificación ${lead.calificado}` : ''}\n- Ventana de WhatsApp abierta por ${Math.floor(ventanaMin / 60)} h ${ventanaMin % 60} min más`,
    `# Ficha del lead (lo que ya sabemos; no lo vuelvas a preguntar)\n${ficha}`,
    faltan.length ? `# Falta averiguar\n${faltan.map((k) => `- ${k}: ${CAMPOS_LEAD[k]}`).join('\n')}` : '# Falta averiguar\n- Nada del checklist.',
  ];
  if (lead.ia_resumen) partes.push(`# Notas anteriores\n${lead.ia_resumen}`);
  if (agente.aviso_ia_marca && !conv.ya_hablo_ia) {
    partes.push(`# Aviso obligatorio\nEs el primer mensaje de la IA en este chat: empieza diciendo, en el idioma de la persona, que eres el asistente virtual con IA de ${agente.aviso_ia_marca}.`);
  }
  if (finde) {
    const quien = `${finde.nombre ? finde.nombre + ', ' : ''}la asistente virtual de ${finde.marca}`;
    const lunes = finde.hasta !== 'mañana';
    const cuando = lunes ? 'el lunes' : 'mañana';
    partes.push(`# Fuera del horario del equipo\n${lunes ? 'Es fin de semana y el equipo vuelve el lunes a las 8' : 'Es de noche y el equipo vuelve mañana a las 9'}. Eres ${quien}: hablas en femenino cuando te refieres a ti misma (por ejemplo "encantada").\n` +
      (finde.yaPresentada
        ? `- Ya te presentaste ${lunes ? 'este fin de semana' : 'esta noche'}: no lo repitas.\n`
        : `- En este mensaje, después del saludo, preséntate como ${quien} y dile que hasta ${cuando}, cuando una persona del equipo pueda contestarle, va a estar hablando contigo. Por ejemplo: "Hola, ¿qué tal? Soy ${quien}. Hasta ${cuando}, que una persona del equipo pueda contestarle, va a estar hablando conmigo." Si ya venía hablando con una persona del equipo, no lo saludes de cero: retoma la charla. Luego sigue con tu prompt.\n`) +
      `- No digas que eres una inteligencia artificial: eres la asistente virtual. Si te preguntan directamente si eres una IA o un bot, no lo niegues.\n- Si derivas o consultas al equipo, aclara que le responden ${cuando} (no digas "en breve").`);
  }
  return partes.join('\n\n');
}

// Historial para la API: lead = user, nosotros = assistant. Empieza siempre
// con un mensaje del lead y termina con lo último que escribió.
export function historial(mensajes, max = 40) {
  const ult = mensajes.slice(-max);
  const salida = [];
  for (const m of ult) {
    const rol = m.direccion === 'in' ? 'user' : 'assistant';
    let texto = m.texto || '';
    if (m.tipo === 'audio') texto = m.transcripcion ? `[nota de voz] ${m.transcripcion}` : '[nota de voz sin transcribir]';
    else if (m.tipo !== 'text' && m.tipo !== 'template') texto = `[${m.tipo}]${texto ? ' ' + texto : ''}`;
    if (m.autor === 'asesora_app' || m.autor === 'asesora_web') texto = `[escribió una asesora] ${texto}`;
    if (m.recurso_id && rol === 'assistant') texto = `[se envió un recurso] ${texto}`;
    if (!texto.trim()) continue;
    const prev = salida[salida.length - 1];
    if (prev && prev.role === rol) prev.content += '\n\n' + texto;
    else salida.push({ role: rol, content: texto });
  }
  while (salida.length && salida[0].role !== 'user') salida.shift();
  return salida;
}

// Webhook de Tally: el formulario escribe directo en el CRM.
//
// Tally firma cada envío con HMAC-SHA256 del cuerpo crudo, en base64,
// en el header `tally-signature`. Sin TALLY_SIGNING_SECRET configurado
// el endpoint rechaza todo — nunca queda abierto a escritura pública.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function firmaValida(rawBody, firmaRecibida, secreto) {
  if (!firmaRecibida) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const esperada = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Comparación de tiempo constante: no filtra la firma byte a byte.
  if (esperada.length !== firmaRecibida.length) return false;
  let diff = 0;
  for (let i = 0; i < esperada.length; i++) {
    diff |= esperada.charCodeAt(i) ^ firmaRecibida.charCodeAt(i);
  }
  return diff === 0;
}

// Tally no manda etiquetas cortas: cada pregunta es la oración completa del
// formulario ("¿Cuál es tu nombre y apellido?", "¿Desde qué país vendrías a
// Argentina?"). Por eso NO se compara por igualdad — se busca una palabra
// clave adentro de la etiqueta, sin tildes, así el matching no se rompe si
// alguien retoca el texto de una pregunta en el editor de Tally.
function sinTildes(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buscarCampo(fields, ...claves) {
  for (const clave of claves) {
    const claveNorm = sinTildes(clave.toLowerCase());
    const campo = fields.find((f) => sinTildes((f.label || '').toLowerCase()).includes(claveNorm));
    if (campo && campo.value !== null && campo.value !== undefined && campo.value !== '') {
      // Los campos de opción múltiple vienen como array de ids + options con texto.
      if (Array.isArray(campo.value)) {
        if (campo.options) {
          const textos = campo.value
            .map((id) => (campo.options.find((o) => o.id === id) || {}).text)
            .filter(Boolean);
          return textos.join(', ') || null;
        }
        return campo.value.join(', ') || null;
      }
      return campo.value;
    }
  }
  return null;
}

function soloFecha(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export async function onRequestPost({ request, env }) {
  if (!env.TALLY_SIGNING_SECRET) {
    return json({ error: 'webhook sin secreto configurado' }, 503);
  }

  const rawBody = await request.text();
  const firma = request.headers.get('tally-signature');

  if (!(await firmaValida(rawBody, firma, env.TALLY_SIGNING_SECRET))) {
    return json({ error: 'firma invalida' }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'body no es json' }, 400);
  }

  const data = payload.data || {};
  const fields = data.fields || [];

  // Claves verificadas contra el formulario real (form 7ROQR9 en Tally):
  // cada pregunta es una oración completa, no una etiqueta corta, así que
  // se busca por una palabra distintiva de esa oración, sin tildes.
  const nombre = buscarCampo(fields, 'nombre');
  if (!nombre) return json({ error: 'falta el nombre' }, 400);

  const submissionId = data.submissionId || data.responseId || null;

  // Si Tally reintenta el mismo envío, no duplicamos el lead.
  if (submissionId) {
    const yaEsta = await env.DB.prepare('SELECT id FROM leads WHERE submission_id = ?')
      .bind(submissionId)
      .first();
    if (yaEsta) return json({ ok: true, id: yaEsta.id, duplicado: true });
  }

  const personasRaw = buscarCampo(fields, 'personas');
  const diasRaw = buscarCampo(fields, 'quedarias', 'cuantos dias');
  const pasajesRaw = buscarCampo(fields, 'pasajes');
  const now = new Date().toISOString();

  // "¿Qué día llegás?" / "¿Qué día te vas?" solo se completan cuando ya
  // tienen los pasajes comprados — igual que en el formulario del sitio
  // (index.html avEnviar()). Sin pasajes, la fecha vive como texto libre
  // en fecha_viaje: el mes aproximado si lo eligieron, o si no, la fecha
  // aproximada tal cual la tipearon.
  const tieneTickets = !!pasajesRaw && sinTildes(pasajesRaw.toLowerCase()).includes('compr');
  const llegada = tieneTickets ? soloFecha(buscarCampo(fields, 'llegas')) : null;
  const salida = tieneTickets ? soloFecha(buscarCampo(fields, 'te vas', 'vas de argentina')) : null;
  const fechaViaje = tieneTickets
    ? (llegada && salida ? `${llegada} al ${salida}` : llegada || salida)
    : buscarCampo(fields, 'mes aproximado') || buscarCampo(fields, 'fecha aproximada');

  // Checklist de calificación (migración 003). Quedan en null hasta que se
  // agreguen las preguntas correspondientes en el formulario de Tally — no
  // rompen nada mientras tanto, `buscarCampo` devuelve null si no encuentra.
  const residencia = buscarCampo(fields, 'residencia', 'donde vivis');
  const edadesMenores = buscarCampo(fields, 'edad de los menores', 'edades de los chicos', 'menores de edad');
  const categoriaHotel = buscarCampo(fields, 'categoria de hotel', 'estrellas');
  const ocupacion = buscarCampo(fields, 'tipo de habitacion', 'single o doble', 'ocupacion');
  const regimen = buscarCampo(fields, 'regimen de comidas', 'desayuno incluido');
  const servicio = buscarCampo(fields, 'privado o regular', 'servicio privado');
  const ocasion = buscarCampo(fields, 'ocasion especial', 'aniversario');
  const presupuestoPp = buscarCampo(fields, 'presupuesto');
  const vuelosInternos = buscarCampo(fields, 'vuelos internos', 'vuelos de cabotaje');

  const result = await env.DB.prepare(
    `INSERT INTO leads
       (nombre, pais, whatsapp, email, personas, destinos, fecha_viaje, notas,
        pasajes, llegada, salida, dias, submission_id, fecha_alta,
        fuente, etapa,
        residencia, edades_menores, categoria_hotel, ocupacion, regimen,
        servicio, ocasion, presupuesto_pp, vuelos_internos,
        creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead_nuevo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      String(nombre).trim(),
      buscarCampo(fields, 'pais'),
      buscarCampo(fields, 'whatsapp', 'telefono'),
      buscarCampo(fields, 'correo', 'email', 'mail'),
      personasRaw ? Number(personasRaw) || null : null,
      buscarCampo(fields, 'destinos'),
      fechaViaje,
      buscarCampo(fields, 'tener en cuenta', 'algo mas'),
      pasajesRaw,
      llegada,
      salida,
      diasRaw ? Number(diasRaw) || null : null,
      submissionId,
      data.createdAt || payload.createdAt || now,
      'Instagram',
      residencia,
      edadesMenores,
      categoriaHotel,
      ocupacion,
      regimen,
      servicio,
      ocasion,
      presupuestoPp,
      vuelosInternos,
      now,
      now
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en)
     VALUES (?, NULL, 'lead_nuevo', 'tally', ?)`
  )
    .bind(result.meta.last_row_id, now)
    .run();

  return json({ ok: true, id: result.meta.last_row_id }, 201);
}

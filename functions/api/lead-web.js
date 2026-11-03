// Entrada de leads desde el formulario público de la web.
//
// A diferencia de /api/leads, este endpoint NO pide CRM_TOKEN: lo llama el
// JavaScript del sitio, que cualquiera puede leer. Por eso solo sabe hacer
// una cosa — crear un lead — y nunca listar, editar ni borrar. El token de
// admin queda solo para el panel.
//
// Contra el spam: honeypot + tiempo mínimo de tipeo + validación de campos.
// Si algún día entra spam de verdad, el paso siguiente es Cloudflare Turnstile.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

const limpio = (v, max = 500) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const entero = (v, max = 999) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

const soloFecha = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

// Todo lo que entra por este endpoint viene del formulario del sitio.
// Tally (el otro canal de leads) se marca "Instagram" en functions/api/tally.js.
const FUENTE = 'Página web';

// Sin esto, un GET cae al index.html del sitio (150 KB) en vez de fallar.
export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body invalido' }, 400);
  }

  // Honeypot: campo invisible para personas, irresistible para bots.
  if (limpio(body.apellido_2)) return json({ ok: true });

  // Nadie completa un formulario de viaje en menos de 3 segundos.
  const ms = Number(body.tiempo_ms);
  if (Number.isFinite(ms) && ms < 3000) return json({ ok: true });

  const nombre = limpio(body.nombre, 120);
  const email = limpio(body.email, 160);
  const whatsapp = limpio(body.whatsapp, 40);

  if (!nombre) return json({ error: 'falta el nombre' }, 400);
  if (!email && !whatsapp) return json({ error: 'falta mail o whatsapp' }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'mail invalido' }, 400);
  }

  const now = new Date().toISOString();
  const fuente = FUENTE;

  // Si la misma persona manda el formulario dos veces (se equivocó, volvió a
  // entrar), actualizamos el lead que ya existe en vez de duplicarlo.
  let existente = null;
  if (email) {
    existente = await env.DB.prepare(
      `SELECT id FROM leads
        WHERE lower(email) = lower(?)
          AND creado_en > datetime('now', '-1 day')
        LIMIT 1`
    )
      .bind(email)
      .first();
  }

  const datos = {
    nombre,
    email,
    whatsapp,
    pais: limpio(body.pais, 80),
    personas: entero(body.personas, 60),
    destinos: limpio(body.destinos, 400),
    fecha_viaje: limpio(body.fecha_viaje, 120),
    llegada: soloFecha(body.llegada),
    salida: soloFecha(body.salida),
    dias: entero(body.dias, 365),
    pasajes: limpio(body.pasajes, 60),
    notas: limpio(body.notas, 2000),
  };

  if (existente) {
    const cols = Object.keys(datos).filter((k) => datos[k] !== null);
    await env.DB.prepare(
      `UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(', ')}, actualizado_en = ?
        WHERE id = ?`
    )
      .bind(...cols.map((c) => datos[c]), now, existente.id)
      .run();
    return json({ ok: true, id: existente.id, actualizado: true });
  }

  const cols = Object.keys(datos);
  const res = await env.DB.prepare(
    `INSERT INTO leads (${cols.join(', ')}, fuente, etapa, fecha_alta, creado_en, actualizado_en)
     VALUES (${cols.map(() => '?').join(', ')}, ?, 'lead_nuevo', ?, ?, ?)`
  )
    .bind(...cols.map((c) => datos[c]), fuente, now, now, now)
    .run();

  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

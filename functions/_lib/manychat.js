// Devuelve a ManyChat lo que la persona hizo en la web de Luna Llena, como
// tags y campos del contacto, para disparar flujos desde ManyChat
// (ej.: abrió el cotizador y no lo mandó → a las 2 h "¿te ayudo con la fecha?").
//
// Se activa solo con el secret MANYCHAT_TOKEN (API key de la cuenta de
// ManyChat de Luna Llena: Settings → API). Sin él, no hace nada.
// Los tags y campos se crean una vez con /api/manychat-preparar.
//
// Las visitas internas (?interno=1) no se mandan nunca.

const API = 'https://api.manychat.com';

export const TAGS = {
  visito: 'web_visito',                 // entró a la web al menos una vez
  volvio: 'web_volvio',                 // 2 o más visitas
  abandono: 'web_abrio_cotizador',      // abrió el cotizador de una ficha y no lo mandó
  cotizo: 'web_cotizo',                 // mandó una cotización desde la web
};
export const CAMPOS = [
  { nombre: 'web_ultimo_paquete', tipo: 'text' },      // nombre de la última ficha vista
  { nombre: 'web_ultimo_paquete_url', tipo: 'text' },  // link a esa ficha
  { nombre: 'web_visitas', tipo: 'number' },
  { nombre: 'web_ultima_visita', tipo: 'datetime' },
];

const WEB = 'https://lunallenatravel.vercel.app';

async function llamar(env, metodo, ruta, cuerpo) {
  const res = await fetch(API + ruta, {
    method: metodo,
    headers: { authorization: 'Bearer ' + env.MANYCHAT_TOKEN, 'content-type': 'application/json', accept: 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    throw new Error(`${ruta}: ${res.status} ${data.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// Estado que la web le asigna hoy a la persona, calculado desde la D1.
export async function estadoWeb(db, manychatId) {
  const r = await db.prepare(
    `SELECT count(*) AS visitas, max(ultimo_evento) AS ultima,
            sum(leads) AS cotizaciones,
            max(CASE WHEN cotizar_abierto > 0 AND leads = 0 THEN ultimo_evento END) AS ult_abandono,
            max(CASE WHEN leads > 0 THEN ultimo_evento END) AS ult_cotizacion
       FROM sesiones_web WHERE manychat_id = ? AND interno = 0`
  ).bind(manychatId).first();
  if (!r || !r.visitas) return null;
  const paq = await db.prepare(
    `SELECT e.ruta, json_extract(e.datos_json, '$.nombre') AS nombre
       FROM eventos_web e JOIN sesiones_web s ON s.sesion_id = e.sesion_id
      WHERE s.manychat_id = ? AND s.interno = 0 AND e.tipo = 'page_view'
        AND json_extract(e.datos_json, '$.paquete') IS NOT NULL
      ORDER BY e.id DESC LIMIT 1`
  ).bind(manychatId).first();

  const tags = [TAGS.visito];
  if (r.visitas >= 2) tags.push(TAGS.volvio);
  if (r.cotizaciones > 0) tags.push(TAGS.cotizo);
  // Abandono: abrió el cotizador después de su última cotización (o nunca cotizó).
  if (r.ult_abandono && (!r.ult_cotizacion || r.ult_abandono > r.ult_cotizacion)) tags.push(TAGS.abandono);

  // ManyChat espera datetime como 2026-10-28T21:22:49+00:00.
  const campos = { web_visitas: r.visitas, web_ultima_visita: r.ultima.slice(0, 19) + '+00:00' };
  if (paq) {
    campos.web_ultimo_paquete = paq.nombre || paq.ruta;
    campos.web_ultimo_paquete_url = WEB + paq.ruta;
  }
  return { tags, campos };
}

// Aplica en ManyChat solo lo que cambió desde la última vez. Nunca tira:
// el error queda en manychat_web_sync.error y en el log.
export async function sincronizarManychat(env, manychatId) {
  if (!env.MANYCHAT_TOKEN || !/^\d{1,20}$/.test(manychatId || '')) return;
  const db = env.DB;
  const ahora = new Date().toISOString();
  try {
    const nuevo = await estadoWeb(db, manychatId);
    if (!nuevo) return;
    const fila = await db.prepare('SELECT estado_json FROM manychat_web_sync WHERE manychat_id = ?').bind(manychatId).first();
    const viejo = fila ? JSON.parse(fila.estado_json) : { tags: [], campos: {} };
    const id = Number(manychatId);

    for (const tag of nuevo.tags.filter((t) => !viejo.tags.includes(t))) {
      await llamar(env, 'POST', '/fb/subscriber/addTagByName', { subscriber_id: id, tag_name: tag });
    }
    for (const tag of viejo.tags.filter((t) => !nuevo.tags.includes(t))) {
      await llamar(env, 'POST', '/fb/subscriber/removeTagByName', { subscriber_id: id, tag_name: tag });
    }
    // La fecha de última visita cambia en cada visita: se manda solo si cambió algo más,
    // o si pasó más de una hora (para no gastar llamadas en cada lote).
    const cambio = (k) => viejo.campos[k] !== nuevo.campos[k];
    const horaVieja = viejo.campos.web_ultima_visita || '';
    const mandarFecha = !horaVieja || Date.parse(nuevo.campos.web_ultima_visita) - Date.parse(horaVieja) > 3600000;
    for (const { nombre } of CAMPOS) {
      if (nuevo.campos[nombre] === undefined) continue;
      if (nombre === 'web_ultima_visita' ? !mandarFecha : !cambio(nombre)) continue;
      await llamar(env, 'POST', '/fb/subscriber/setCustomFieldByName', {
        subscriber_id: id, field_name: nombre, field_value: nuevo.campos[nombre],
      });
    }
    if (!mandarFecha) nuevo.campos.web_ultima_visita = horaVieja;

    await db.prepare(
      `INSERT INTO manychat_web_sync (manychat_id, estado_json, error, actualizado_en) VALUES (?, ?, NULL, ?)
       ON CONFLICT(manychat_id) DO UPDATE SET estado_json = excluded.estado_json, error = NULL, actualizado_en = excluded.actualizado_en`
    ).bind(manychatId, JSON.stringify(nuevo), ahora).run();
  } catch (e) {
    console.log('manychat sync', manychatId, e.message);
    await db.prepare(
      `INSERT INTO manychat_web_sync (manychat_id, estado_json, error, actualizado_en) VALUES (?, '{"tags":[],"campos":{}}', ?, ?)
       ON CONFLICT(manychat_id) DO UPDATE SET error = excluded.error, actualizado_en = excluded.actualizado_en`
    ).bind(manychatId, String(e.message).slice(0, 300), ahora).run().catch(() => {});
  }
}

// Crea en ManyChat los tags y campos que faltan. Devuelve qué había y qué se creó.
export async function prepararManychat(env, crear) {
  const [tags, campos] = await Promise.all([
    llamar(env, 'GET', '/fb/page/getTags'),
    llamar(env, 'GET', '/fb/page/getCustomFields'),
  ]);
  const hayTags = new Set((tags.data || []).map((t) => t.name));
  const hayCampos = new Set((campos.data || []).map((c) => c.name));
  const faltanTags = Object.values(TAGS).filter((t) => !hayTags.has(t));
  const faltanCampos = CAMPOS.filter((c) => !hayCampos.has(c.nombre));
  if (crear) {
    for (const t of faltanTags) await llamar(env, 'POST', '/fb/page/createTag', { name: t });
    for (const c of faltanCampos) await llamar(env, 'POST', '/fb/page/createCustomField', { caption: c.nombre, type: c.tipo, description: 'Lo llena la web de Luna Llena' });
  }
  return { faltan_tags: crear ? [] : faltanTags, faltan_campos: crear ? [] : faltanCampos.map((c) => c.nombre), creados: crear ? [...faltanTags, ...faltanCampos.map((c) => c.nombre)] : [] };
}

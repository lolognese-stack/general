// Alta o actualización de un lead que llega desde la web (formulario /cotizar/ y armador /armar/).
//
// Orden de búsqueda para no duplicar:
//   1) mismo submission_id (el envío parcial y el final del mismo formulario): se completa ese lead;
//   2) mismo manychat_id, o mismo código de visita LL-###### en las últimas 24 h: se suma a ese lead (notas al final);
//   3) si no, lead nuevo en etapa lead_nuevo.
// Devuelve { id, nuevo, yaCompleto } (yaCompleto: el lead del mismo submission_id ya tenía el envío final).

export async function guardarLeadWeb(env, { submissionId, datos, manychatId = null, codigo = null, fuente, now = new Date().toISOString() }) {
  const mismo = await env.DB.prepare('SELECT id, meta_json FROM leads WHERE submission_id = ? LIMIT 1').bind(submissionId).first();
  if (mismo) {
    let yaCompleto = false;
    try { yaCompleto = JSON.parse(mismo.meta_json || '{}').completo === true; } catch {}
    await actualizarLead(env, mismo.id, datos, now);
    return { id: mismo.id, nuevo: false, yaCompleto, mismo: true };
  }

  const previo = manychatId
    ? await env.DB.prepare('SELECT id FROM leads WHERE manychat_id = ? ORDER BY id DESC LIMIT 1').bind(manychatId).first()
    : codigo
      ? await env.DB.prepare(`SELECT id FROM leads WHERE codigo_web = ? AND creado_en > datetime('now', '-1 day') LIMIT 1`).bind(codigo).first()
      : null;
  if (previo) {
    await env.DB.prepare(
      `UPDATE leads SET submission_id = coalesce(submission_id, ?),
              notas = coalesce(notas || char(10) || char(10), '') || ?, actualizado_en = ?
        WHERE id = ?`
    ).bind(submissionId, `[${now.slice(0, 10)}] ` + (datos.notas || ''), now, previo.id).run();
    const { notas: _n, nombre: _nombre, ...resto } = datos;
    await actualizarLead(env, previo.id, resto, now);
    return { id: previo.id, nuevo: false, yaCompleto: false, mismo: false };
  }

  const cols = Object.keys(datos);
  const res = await env.DB.prepare(
    `INSERT INTO leads (${cols.join(', ')}, submission_id, fuente, etapa, fecha_alta, creado_en, actualizado_en)
     VALUES (${cols.map(() => '?').join(', ')}, ?, ?, 'lead_nuevo', ?, ?, ?)`
  ).bind(...cols.map((k) => datos[k]), submissionId, fuente, now, now, now).run();
  return { id: res.meta.last_row_id, nuevo: true, yaCompleto: false, mismo: false };
}

// Solo pisa con valores no vacíos: un envío posterior no borra lo del anterior.
export async function actualizarLead(env, id, datos, now = new Date().toISOString()) {
  const cols = Object.keys(datos).filter((k) => datos[k] !== null && datos[k] !== undefined);
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
    .bind(...cols.map((k) => datos[k]), now, id).run();
}

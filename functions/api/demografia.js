import { checkToken } from '../_lib/auth.js';
// Demografía de seguidores de Instagram -- snapshot único, se pisa entero
// en cada import (no tiene sentido versionarla por día).


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseJson(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare('SELECT * FROM demografia_ig WHERE id = 1').first();
  if (!row) return json(null);
  return json({
    username: row.username,
    followers_count: row.followers_count,
    follows_count: row.follows_count,
    media_count: row.media_count,
    website: row.website,
    edad: parseJson(row.edad_json),
    genero: parseJson(row.genero_json),
    genero_edad: parseJson(row.genero_edad_json),
    paises: parseJson(row.paises_json),
    ciudades: parseJson(row.ciudades_json),
    actualizado_en: row.actualizado_en,
  });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO demografia_ig
       (id, username, followers_count, follows_count, media_count, website,
        edad_json, genero_json, genero_edad_json, paises_json, ciudades_json, actualizado_en)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       followers_count = excluded.followers_count,
       follows_count = excluded.follows_count,
       media_count = excluded.media_count,
       website = excluded.website,
       edad_json = excluded.edad_json,
       genero_json = excluded.genero_json,
       genero_edad_json = excluded.genero_edad_json,
       paises_json = excluded.paises_json,
       ciudades_json = excluded.ciudades_json,
       actualizado_en = excluded.actualizado_en`
  )
    .bind(
      body.username ?? null,
      body.followers_count ?? null,
      body.follows_count ?? null,
      body.media_count ?? null,
      body.website ?? null,
      JSON.stringify(body.edad || []),
      JSON.stringify(body.genero || []),
      JSON.stringify(body.genero_edad || []),
      JSON.stringify(body.paises || []),
      JSON.stringify(body.ciudades || []),
      now
    )
    .run();

  return json({ ok: true });
}

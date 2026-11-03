-- Migración 008: métricas de cuenta de Instagram (serie diaria) y
-- demografía de seguidores. Dominio distinto de `piezas` (que es por
-- publicación) y de `metricas_dia` (que es el embudo de Tally/conversación
-- -- no confundir una con otra).

CREATE TABLE IF NOT EXISTS metricas_cuenta_dia (
  fecha TEXT PRIMARY KEY,          -- YYYY-MM-DD
  reach INTEGER,
  accounts_engaged INTEGER,
  total_interactions INTEGER,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  saves INTEGER,
  shares INTEGER,
  new_followers INTEGER,
  actualizado_en TEXT NOT NULL
);

-- Fila única (snapshot): la demografía no tiene historial, cada import pisa
-- el estado actual entero. id=1 fijo por CHECK en vez de PK autoincremental
-- para que el upsert sea siempre "la misma fila", sin tener que buscarla.
CREATE TABLE IF NOT EXISTS demografia_ig (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT,
  followers_count INTEGER,
  follows_count INTEGER,
  media_count INTEGER,
  website TEXT,
  edad_json TEXT,
  genero_json TEXT,
  genero_edad_json TEXT,
  paises_json TEXT,
  ciudades_json TEXT,
  actualizado_en TEXT NOT NULL
);

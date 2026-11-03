-- Migración 044: tablas del sync diario de Instagram (ig-sync-worker).
-- Son las migraciones 014, 015 y 016 de visite-web juntas: el worker es una
-- copia del de Visite y escribe las mismas tablas.

CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL,          -- running | ok | error
  posts_new       INTEGER DEFAULT 0,
  posts_updated   INTEGER DEFAULT 0,
  daily_upserted  INTEGER DEFAULT 0,
  demografia_ok   INTEGER DEFAULT 0,       -- 0/1
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

ALTER TABLE metricas_cuenta_dia ADD COLUMN profile_links_taps INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN follows_unfollows INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN replies INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN reposts INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN profile_views INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN website_clicks INTEGER;

-- Foto diaria de cada post: Meta da las métricas de un post como total de
-- vida, así que sin esto no se puede ver cómo creció.
CREATE TABLE IF NOT EXISTS piezas_metricas_dia (
  pieza_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,             -- YYYY-MM-DD, día de la foto
  views INTEGER,
  alcance INTEGER,
  engagement INTEGER,
  likes INTEGER,
  comentarios INTEGER,
  guardados INTEGER,
  compartidos INTEGER,
  seguimientos INTEGER,
  tiempo_prom TEXT,
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (pieza_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_pmd_fecha ON piezas_metricas_dia(fecha);

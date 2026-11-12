-- Migración 054: seguimiento de las propuestas publicadas (luna-llena-propuestas.vercel.app/<slug>/).
-- Solo slug, evento, hora y tipo de dispositivo: sin cookies, sin IP, sin datos de la persona.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-054-propuestas.sql

-- Propuestas verificadas: el endpoint solo acepta eventos de slugs que existen de verdad
-- (los confirma pidiendo la página publicada la primera vez).
CREATE TABLE IF NOT EXISTS propuestas (
  slug         TEXT PRIMARY KEY,
  numero       TEXT,
  cliente      TEXT,
  valid_until  TEXT,
  registrada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS propuesta_eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  evento      TEXT NOT NULL,   -- apertura | seccion | cta | pdf | tiempo
  detalle     TEXT,            -- seccion: recorrido|inversion|reserva · cta: duda|llamada|reservar|… · tiempo: segundos
  dispositivo TEXT,            -- movil | tablet | desktop | desconocido
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propuesta_eventos_slug ON propuesta_eventos (slug, evento, creado_en);

-- Último aviso por propuesta y tipo: máximo 1 aviso por tipo cada 6 h.
CREATE TABLE IF NOT EXISTS propuesta_avisos (
  slug      TEXT NOT NULL,
  tipo      TEXT NOT NULL,     -- primera_apertura | reapertura | vio_inversion | cta
  ultimo_en TEXT NOT NULL,
  PRIMARY KEY (slug, tipo)
);

-- Avisos que se ven en el CRM (página Propuestas). Discord es un canal más, opcional.
CREATE TABLE IF NOT EXISTS propuesta_alertas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  texto       TEXT NOT NULL,
  dispositivo TEXT,
  leida       INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propuesta_alertas_fecha ON propuesta_alertas (creado_en);

-- Ajustes del seguimiento, editables desde el CRM (por ahora: discord_webhook).
CREATE TABLE IF NOT EXISTS propuestas_config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

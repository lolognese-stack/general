-- Migración 061: la propuesta para el cliente se arma y se sirve desde el CRM (fase 4 de crm/PLAN-COTIZACIONES-EN-CRM.md).
-- Una propuesta nace de una cotización aprobada del cotizador interno (ct_cotizaciones) y se ve en
-- https://luna-llena-propuestas.vercel.app/<slug>/ (Vercel reescribe a /api/propuesta-publica; las carpetas estáticas
-- de la propuesta de Ulises ganan y no cambian).
-- Tracking (propuestas, propuesta_eventos, propuesta_alertas, 054) y seguimientos (055) no cambian: la propuesta
-- publicada se registra en `propuestas`, así que sus aperturas se cuentan sin pedir la página de nuevo.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-061-propuestas-crm.sql

CREATE TABLE IF NOT EXISTS ct_propuestas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id     INTEGER NOT NULL REFERENCES ct_pedidos(id),
  cotizacion_id INTEGER NOT NULL REFERENCES ct_cotizaciones(id),
  lead_id       INTEGER,
  slug          TEXT NOT NULL UNIQUE,                 -- <nombre>-<6 al azar>
  estado        TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'publicada', 'retirada')),
  version       INTEGER NOT NULL DEFAULT 1,
  datos_json    TEXT,                                 -- lo PUBLICADO (lo que sirve la ruta pública); NULL hasta publicar
  borrador_json TEXT NOT NULL,                        -- lo que se ve en la vista previa y se edita; publicar lo copia a datos_json
  valid_until   TEXT,                                 -- YYYY-MM-DD
  changelog     TEXT,                                 -- JSON: [{version, fecha, texto}]
  textos        TEXT,                                 -- 'ia' | 'base' (si la IA falló o no había key)
  modelo        TEXT,
  creada_por    TEXT,
  creada_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_en TEXT NOT NULL DEFAULT (datetime('now')),
  publicada_por TEXT,
  publicada_en  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ct_propuestas_pedido ON ct_propuestas (pedido_id, id);
CREATE INDEX IF NOT EXISTS idx_ct_propuestas_estado ON ct_propuestas (estado);

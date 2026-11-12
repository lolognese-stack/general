-- Migración 055: seguimientos post propuesta (los toques del día 2 al 90 después de mandar la propuesta).
-- Se hacen desde el Inbox, uno por uno. La secuencia (días y textos) vive en propuestas_config,
-- clave 'seguimientos_secuencia', y se edita sin tocar el código.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-055-seguimientos-propuestas.sql

-- Una fila por propuesta enviada. dia0 = el día (hora de Lima) en que se apretó "Propuesta enviada".
CREATE TABLE IF NOT EXISTS propuesta_seguimientos (
  slug            TEXT PRIMARY KEY,                -- propuestas.slug
  conversacion_id INTEGER REFERENCES wa_conversaciones(id),
  lead_id         INTEGER REFERENCES leads(id),
  dia0            TEXT NOT NULL,                   -- YYYY-MM-DD
  estado          TEXT NOT NULL DEFAULT 'activa',  -- activa | pausada | respondio | perdida | terminada
  estado_motivo   TEXT,                            -- texto corto: "respondió el 14/11", "reservó", "lo pausó Álvaro"…
  reviso_disponibilidad INTEGER NOT NULL DEFAULT 0, -- día 12: con 1 va el mensaje A (cupos llenándose)
  retomado_desde  INTEGER,                         -- día de la secuencia desde el que se retomó (30, 60 o 90)
  retomado_en     TEXT,                            -- YYYY-MM-DD en que se retomó
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propuesta_seguimientos_estado ON propuesta_seguimientos (estado);
CREATE INDEX IF NOT EXISTS idx_propuesta_seguimientos_conv ON propuesta_seguimientos (conversacion_id);

-- Historial: cada toque hecho, mandado a mano o salteado. El día siguiente se calcula desde acá.
CREATE TABLE IF NOT EXISTS propuesta_toques (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  dia       INTEGER NOT NULL,                      -- día de la secuencia (2, 5, 8…)
  accion    TEXT NOT NULL,                         -- enviado (desde el Inbox) | manual (desde el teléfono) | salteado
  texto     TEXT,                                  -- lo que se mandó, si se mandó desde el Inbox
  por       TEXT,                                  -- quién lo hizo
  fecha     TEXT NOT NULL,                         -- YYYY-MM-DD hora de Lima
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propuesta_toques_slug ON propuesta_toques (slug, dia);

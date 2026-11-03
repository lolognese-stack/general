-- Setter: aprendizaje del equipo (3/11). Cada mañana el Worker lee lo que el
-- equipo contestó por WhatsApp el día anterior y propone lecciones; quedan
-- acá como "pendiente" hasta que alguien las aprueba (pasan a
-- setter_conocimiento con tag 'leccion') o las descarta, en Setter IA ›
-- Para aprobar. Solo agrega una tabla.
--
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-043-setter-sugerencias.sql

CREATE TABLE IF NOT EXISTS setter_sugerencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                 -- 'respuesta' (qué contestar) | 'tono' (cómo lo dice el equipo)
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,            -- la lección tal como la usaría la IA
  pregunta TEXT,                      -- lo que preguntó el cliente
  respuesta_equipo TEXT,              -- lo que contestó el equipo, textual
  conversacion_id INTEGER,
  lead_id INTEGER,
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | aprobada | descartada
  conocimiento_id INTEGER,            -- la entrada creada al aprobar
  creado_en TEXT NOT NULL,
  resuelto_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_setter_sugerencias_estado ON setter_sugerencias (estado, creado_en);

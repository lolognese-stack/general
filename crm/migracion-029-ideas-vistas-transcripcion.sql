-- Migración 029: vistas guardadas del Ideador + transcripción de reels.
--
-- ideas_vistas: pestañas arriba de las ideas (Broll Texto, Carrusel...).
-- filtro es el JSON de idFiltro del panel
-- ({ q, formato, angulo, uso, orden }). Se guardan en la base y no en el
-- navegador para que se vean igual desde la compu y el celular.
--
-- ideas.transcripcion: lo que se dice en el reel, sacado con Whisper de
-- Workers AI (/api/transcribir-idea/:id). Editable a mano.

ALTER TABLE ideas ADD COLUMN transcripcion TEXT;

CREATE TABLE IF NOT EXISTS ideas_vistas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  filtro TEXT NOT NULL DEFAULT '{}',
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

-- Pestañas de arranque, una por formato principal.
INSERT INTO ideas_vistas (nombre, filtro, orden, creado_en) VALUES
  ('Broll Texto', '{"formato":"Broll Texto"}', 1, datetime('now')),
  ('Carrusel', '{"formato":"Carrusel"}', 2, datetime('now')),
  ('Clips Paisaje', '{"formato":"Clip/s Paisaje"}', 3, datetime('now')),
  ('Narrativo', '{"formato":"Broll Narrativo"}', 4, datetime('now'));

-- Migración 045: foto de cada pieza para el Calendario de Performance y la
-- portada del drawer (igual que la 026 de visite-web).
--
-- La foto sale del og:image del link de Instagram (video_url) y se guarda
-- en una tabla aparte para no arrastrarla en cada carga del panel.
-- piezas.foto_v es la marca de versión (epoch ms): el front sabe si hay foto
-- y la URL /api/foto-pieza/:id?v=foto_v se cachea para siempre.

ALTER TABLE piezas ADD COLUMN foto_v INTEGER;

CREATE TABLE IF NOT EXISTS piezas_foto (
  pieza_id INTEGER PRIMARY KEY REFERENCES piezas(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,                  -- base64
  origen TEXT,                         -- link de Instagram del que salió
  actualizado_en TEXT NOT NULL
);

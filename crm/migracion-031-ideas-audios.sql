-- Migración 031: audios de Instagram en el Ideador.
--
-- tipo: 'post' (referencia de un reel/carrusel, lo de siempre) | 'audio'
-- (un sonido para usar en un reel). Los audios no tienen código de post: el
-- mismo reel puede estar guardado como post y su audio como idea aparte.
-- audio_nombre / audio_artista: se completan solos desde la embed del reel
-- (clips_music_attribution_info); también los tienen las ideas tipo post que
-- son reels, para mostrar qué audio usan.
-- audio_url: link a la página del audio (instagram.com/reels/audio/ID/), si
-- se pegó. Esa página no muestra nada sin login, así que los datos salen del
-- reel que lo usa.

ALTER TABLE ideas ADD COLUMN tipo TEXT DEFAULT 'post';
ALTER TABLE ideas ADD COLUMN audio_nombre TEXT;
ALTER TABLE ideas ADD COLUMN audio_artista TEXT;
ALTER TABLE ideas ADD COLUMN audio_url TEXT;

INSERT INTO ideas_vistas (nombre, filtro, orden, creado_en)
  VALUES ('Audios', '{"tipo":"audio"}', 0, datetime('now'));

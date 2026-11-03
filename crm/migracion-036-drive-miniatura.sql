-- Migración 036: id del archivo de Drive que da la miniatura de la pieza
-- (el video del reel o la lámina 01 del carrusel). La escribe /subir-pieza
-- al subir la carpeta; la UI arma la imagen con
-- https://drive.google.com/thumbnail?id=<id>&sz=w400, que funciona porque la
-- carpeta queda pública por link. Sin id, la tarjeta se ve como antes.
--
-- Solo ADD COLUMN: no toca filas ni columnas existentes. Aplicar una vez.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-036-drive-miniatura.sql

ALTER TABLE piezas ADD COLUMN drive_miniatura_id TEXT;

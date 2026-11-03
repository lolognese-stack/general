-- Migración 034: link de Drive con el archivo del posteo listo para subir
-- (video, carrusel exportado). Se carga y se abre desde el drawer de la pieza,
-- antes del link del post publicado.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-034-drive-url.sql

ALTER TABLE piezas ADD COLUMN drive_url TEXT;

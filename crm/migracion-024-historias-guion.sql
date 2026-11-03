-- Migración 024: idea y guion de cada secuencia de historias.
--
-- El drawer de Historias guionea la secuencia placa por placa. `guion` guarda
-- la lista entera como JSON: [{ "tipo": "gancho|contexto|valor|prueba|cta",
-- "texto": "...", "nota": "..." }]. Se guarda como texto porque D1 no tiene
-- tipo JSON y el panel es el único que lo lee; un valor viejo o roto vale
-- como guion vacío.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-024-historias-guion.sql

ALTER TABLE historias ADD COLUMN idea TEXT;
ALTER TABLE historias ADD COLUMN guion TEXT;

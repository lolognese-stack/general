-- Migración 035: score de calificación del lead (1 a 10)
--
-- El formulario de calificación calcula el score y lo manda en cada lead:
-- - score: entero de 1 a 10 (null = lead sin score, p. ej. los anteriores).
--   La API (functions/api/leads.js) valida el rango al escribir; la tabla
--   no lo restringe para no complicar migraciones futuras.
-- - score_detalle: cómo se armó, p. ej.
--   "8/10 (78/100) · itinerario 15 · pasajes 15 · fecha 9 · presupuesto 23 ..."
--
-- Solo ADD COLUMN: no toca filas ni columnas existentes. No es idempotente
-- (ADD COLUMN falla si la columna ya existe): aplicar una sola vez.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-035-score-lead.sql
-- (para crm-plantilla: <proyecto> = crm-plantilla)

ALTER TABLE leads ADD COLUMN score INTEGER;
ALTER TABLE leads ADD COLUMN score_detalle TEXT;

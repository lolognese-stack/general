-- Migración 047: embudo de prospección y recorrido de contenido (Luna Llena).
--
-- Solo agrega: una columna y un índice. No borra ni cambia datos.
--
-- El Sheet nuevo "Luna Llena | Setting" (apps-script-sheet/Setting.gs) manda
-- una fila por cada automatización de ManyChat: DIAS, RECORRIDO, PITCH,
-- FORMULARIO, CONSULTA. Las filas RECORRIDO (y DIAS, si la conversación entró
-- por una pieza) traen la etiqueta de la pieza en `pieza`. Con eso el CRM arma,
-- por persona y en orden de `momento`:
--   apertura  = la primera pieza
--   gatillo   = la última pieza antes del primer FORMULARIO
--   nutrición = las del medio
-- (ver functions/api/embudo.js).
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-047-embudo-prospeccion.sql

ALTER TABLE sheet_eventos ADD COLUMN pieza TEXT;
CREATE INDEX IF NOT EXISTS idx_sheet_eventos_persona ON sheet_eventos(manychat_id, momento);

-- Migración 002: campos del formulario Tally + seguimiento comercial
--
-- Trae al CRM las columnas que hoy viven en el Sheets de "Leads Tally",
-- más las columnas de seguimiento de venta (setter/closer/fuente/etc.)
-- y la calificación del lead (si / masomenos / curioso).

-- Campos que manda Tally
ALTER TABLE leads ADD COLUMN fecha_alta TEXT;
ALTER TABLE leads ADD COLUMN pasajes TEXT;
ALTER TABLE leads ADD COLUMN llegada TEXT;
ALTER TABLE leads ADD COLUMN salida TEXT;
ALTER TABLE leads ADD COLUMN dias INTEGER;
ALTER TABLE leads ADD COLUMN submission_id TEXT;

-- Seguimiento comercial
ALTER TABLE leads ADD COLUMN calificado TEXT;      -- si | masomenos | curioso
ALTER TABLE leads ADD COLUMN fecha_agenda TEXT;
ALTER TABLE leads ADD COLUMN fecha_llamada TEXT;
ALTER TABLE leads ADD COLUMN setter TEXT;
ALTER TABLE leads ADD COLUMN closer TEXT;
ALTER TABLE leads ADD COLUMN fuente TEXT;
ALTER TABLE leads ADD COLUMN estrategia TEXT;
ALTER TABLE leads ADD COLUMN medio_agenda TEXT;

-- submission_id es la clave de Tally: evita cargar dos veces el mismo formulario
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_submission ON leads(submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_calificado ON leads(calificado);

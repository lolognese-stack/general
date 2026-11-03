-- Migración 003: historial de etapas + checklist de calificación + cierre
--
-- Dos cosas nuevas:
-- 1. Tabla eventos: una fila por cambio de etapa. De acá salen los KPIs
--    (tiempo de primera respuesta, etapa de fuga) sin cargar nada a mano.
-- 2. Columnas que hoy se repreguntan porque no tienen dónde vivir: el
--    checklist completo antes de cotizar, y los datos de cierre (seña,
--    saldo, motivo de perdido).

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  etapa_desde TEXT,
  etapa_hasta TEXT NOT NULL,
  quien TEXT,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_lead ON eventos(lead_id);
CREATE INDEX IF NOT EXISTS idx_eventos_etapa_hasta ON eventos(etapa_hasta);

-- Checklist de calificación (sin esto no se debería cotizar)
ALTER TABLE leads ADD COLUMN presupuesto_pp TEXT;
ALTER TABLE leads ADD COLUMN edades_menores TEXT;
ALTER TABLE leads ADD COLUMN residencia TEXT;
ALTER TABLE leads ADD COLUMN categoria_hotel TEXT;
ALTER TABLE leads ADD COLUMN ocupacion TEXT;      -- single | doble | triple | matrimonial | twin
ALTER TABLE leads ADD COLUMN regimen TEXT;        -- solo desayuno | media pension | pension completa | all inclusive
ALTER TABLE leads ADD COLUMN servicio TEXT;       -- privado | regular
ALTER TABLE leads ADD COLUMN ocasion TEXT;
ALTER TABLE leads ADD COLUMN vuelos_internos TEXT;

-- Cierre y cobro
ALTER TABLE leads ADD COLUMN perdido_motivo TEXT; -- precio | demora | timing | destino | vuelo_internacional | otro
ALTER TABLE leads ADD COLUMN sena_pct REAL;
ALTER TABLE leads ADD COLUMN sena_fecha TEXT;
ALTER TABLE leads ADD COLUMN saldo_vence TEXT;
ALTER TABLE leads ADD COLUMN planning_fee TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_perdido_motivo ON leads(perdido_motivo);

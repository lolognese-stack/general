-- Migración 048: reportes de inteligencia de contenido (sección Reporte).
--
-- Solo agrega una tabla. Cada fila es un reporte generado por /api/reporte:
-- los insumos que se mandaron a Claude (para poder auditarlo después) y el
-- markdown que devolvió.
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-048-reportes.sql

CREATE TABLE IF NOT EXISTS reportes_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desde TEXT NOT NULL,              -- YYYY-MM-DD
  hasta TEXT NOT NULL,
  ticket_usd INTEGER NOT NULL,      -- ticket objetivo (X)
  estado TEXT NOT NULL,             -- generando | listo | error
  modelo TEXT,
  insumos_json TEXT NOT NULL,       -- lo que vio Claude (capas A, B, C y warnings)
  texto TEXT,                       -- el reporte en markdown
  error TEXT,
  creado_en TEXT NOT NULL,
  terminado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_reportes_ia_creado ON reportes_ia(creado_en);

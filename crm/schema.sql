-- CRM de propuestas -- plantilla base -- D1 schema
-- Etapas fijas: lead_nuevo, contactado, propuesta_enviada, seguimiento, ganado, perdido

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  pais TEXT,
  whatsapp TEXT,
  email TEXT,
  personas INTEGER,
  destinos TEXT,
  fecha_viaje TEXT,
  etapa TEXT NOT NULL DEFAULT 'lead_nuevo',
  propuesta_url TEXT,
  precio TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa);
CREATE INDEX IF NOT EXISTS idx_leads_actualizado ON leads(actualizado_en DESC);

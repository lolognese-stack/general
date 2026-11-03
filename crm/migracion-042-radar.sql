-- Migración 042: Radar de Instagram (extensión de ManyChat) y resumen de la
-- persona que cruza Instagram + web + WhatsApp.
--
-- Solo aditiva. Aplicar en remoto:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-042-radar.sql

-- Último reporte del Radar por contacto de ManyChat. Uno por persona: el
-- reporte nuevo pisa al anterior (el chat completo siempre se vuelve a leer).
CREATE TABLE IF NOT EXISTS radar_reportes (
  manychat_id TEXT PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  texto TEXT NOT NULL,          -- reporte legible (el que muestra la extensión)
  datos_json TEXT NOT NULL,     -- la fila completa (la misma que va al Sheets)
  modelo TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_radar_lead ON radar_reportes(lead_id);

-- Datos de Instagram en el lead.
ALTER TABLE leads ADD COLUMN ig_username TEXT;
ALTER TABLE leads ADD COLUMN seguidor_desde TEXT;      -- fecha en que empezó a seguir (campo de ManyChat)
ALTER TABLE leads ADD COLUMN primer_contacto_ig TEXT;  -- fecha en que entró a ManyChat (subscribed)

-- Resumen de la persona: síntesis de Claude con todo lo que se sabe de ella
-- en Instagram, la web y WhatsApp. Se rehace cuando cambia algo (huella).
CREATE TABLE IF NOT EXISTS lead_resumenes (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id),
  datos_json TEXT NOT NULL,     -- { sintesis, proxima_accion, contradicciones[], ... }
  huella TEXT NOT NULL,         -- qué fuentes había cuando se hizo (para saber si quedó viejo)
  modelo TEXT,
  actualizado_en TEXT NOT NULL
);

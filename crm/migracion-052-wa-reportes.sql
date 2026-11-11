-- Migración 052: análisis de WhatsApp (el "Radar" de los chats de WhatsApp).
--
-- Solo aditiva. Aplicar en remoto:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-052-wa-reportes.sql

-- Último análisis por chat. Uno por conversación: el nuevo pisa al anterior
-- (el chat completo se vuelve a leer). `cambios_json` = lo que la persona
-- cambió en WhatsApp respecto de lo que sabíamos (Instagram, web, CRM).
CREATE TABLE IF NOT EXISTS wa_reportes (
  conversacion_id INTEGER PRIMARY KEY REFERENCES wa_conversaciones(id),
  lead_id INTEGER REFERENCES leads(id),
  texto TEXT NOT NULL,          -- reporte legible
  datos_json TEXT NOT NULL,     -- { score, cambios, novedades, viaje, ... }
  mensajes_n INTEGER,           -- cuántos mensajes tenía el chat al analizar
  ultimo_msg_en TEXT,           -- wa_conversaciones.ultimo_en al analizar (para saber si quedó viejo)
  modelo TEXT,
  aplicado_en TEXT,             -- cuándo se pasaron los cambios al lead
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_reportes_lead ON wa_reportes(lead_id);

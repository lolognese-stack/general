-- Migración 040: archivos y audios de los recursos del setter, sin R2.
--
-- La cuenta de Cloudflare no tiene R2 (pide tarjeta). Los archivos chicos
-- (hasta 1 MB: PDF de itinerario, audio de bienvenida) se guardan en D1 en
-- base64 y, al mandarlos, se suben una vez a WhatsApp: el media_id que
-- devuelve Meta se reusa hasta que vence (30 días; se renueva a los 25).
--
-- Solo aditiva. Aplicar después de la 039:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-040-setter-archivos.sql

CREATE TABLE IF NOT EXISTS setter_archivos (
  recurso_id INTEGER PRIMARY KEY REFERENCES setter_recursos(id),
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  datos_b64 TEXT NOT NULL,
  meta_media_id TEXT,
  meta_media_hasta TEXT,
  creado_en TEXT NOT NULL
);

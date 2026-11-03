-- Migración 032: formulario de viaje propio (luna-llena-viaje / visite-viaje)
--
-- El formulario escribe directo en `leads` (fuente = 'Formulario viaje') y su
-- analítica en `eventos_form` / `sesiones_form`. Reúne lo que Visite aplicó
-- en sus migraciones 017 (columnas de atribución), 020 (analítica) y la
-- columna tipo_cotizacion de la 025. Solo ADD COLUMN y CREATE IF NOT EXISTS:
-- nada destructivo. Las ADD COLUMN no son idempotentes: aplicar una sola vez.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-032-formulario-viaje.sql

ALTER TABLE leads ADD COLUMN manychat_id TEXT;
ALTER TABLE leads ADD COLUMN utm_source TEXT;
ALTER TABLE leads ADD COLUMN utm_campaign TEXT;
ALTER TABLE leads ADD COLUMN rama TEXT;               -- 'A' (ya tenía pasajes) | 'B' (todavía no)
ALTER TABLE leads ADD COLUMN duracion_segundos INTEGER;
ALTER TABLE leads ADD COLUMN meta_json TEXT;
ALTER TABLE leads ADD COLUMN tipo_cotizacion TEXT;    -- Paquete | Personalizada

CREATE INDEX IF NOT EXISTS idx_leads_manychat_id ON leads(manychat_id);

CREATE TABLE IF NOT EXISTS eventos_form (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id TEXT NOT NULL,
  formulario TEXT NOT NULL,           -- 'personalizado' | 'paquete'
  tipo TEXT NOT NULL,                 -- abierto | paso_visto | paso_completado | paso_atras | error_validacion | salida | enviado | click_whatsapp | click_instagram
  paso TEXT,
  indice INTEGER,
  rama TEXT,
  t_ms INTEGER,
  dur_ms INTEGER,
  datos_json TEXT,
  creado_en TEXT NOT NULL,
  cliente_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_eventos_form_sesion ON eventos_form (sesion_id);
CREATE INDEX IF NOT EXISTS idx_eventos_form_creado ON eventos_form (creado_en);
CREATE INDEX IF NOT EXISTS idx_eventos_form_tipo_paso ON eventos_form (tipo, paso);

CREATE TABLE IF NOT EXISTS sesiones_form (
  sesion_id TEXT PRIMARY KEY,
  formulario TEXT NOT NULL,
  rama TEXT,
  dispositivo TEXT,                   -- movil | tablet | desktop
  pais TEXT,
  origen TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  manychat_id TEXT,
  referer TEXT,
  restaurado INTEGER NOT NULL DEFAULT 0,
  primer_evento TEXT NOT NULL,
  ultimo_evento TEXT NOT NULL,
  ultimo_paso TEXT,
  max_indice INTEGER NOT NULL DEFAULT 0,
  pasos_total INTEGER,
  errores INTEGER NOT NULL DEFAULT 0,
  atras INTEGER NOT NULL DEFAULT 0,
  enviado_en TEXT,
  whatsapp_en TEXT,
  instagram_en TEXT,
  t_total_ms INTEGER,
  eventos INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sesiones_form_primer ON sesiones_form (primer_evento);
CREATE INDEX IF NOT EXISTS idx_sesiones_form_form ON sesiones_form (formulario, primer_evento);

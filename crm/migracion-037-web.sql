-- Analítica de la web de Luna Llena (lunallenatravel-web): lo que hace la
-- gente en el sitio antes de consultar. Mismo diseño que en Visite
-- (migración 022 de visite-web): `eventos_web` crudo + `sesiones_web`
-- resumida por upsert en cada lote, así la pestaña Web consulta la resumida.
--
-- Escribe /api/evento-web (lo manda assets/ll-t.js de la web). Sin datos
-- personales. El cruce con el CRM va por el código de la sesión:
--   sesiones_web.codigo = leads.codigo_web   (LL-######, viaja en el
--   mensaje de WhatsApp como "ref LL-######")
-- y de ahí a ventas por ventas.lead_id.

CREATE TABLE IF NOT EXISTS eventos_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id TEXT NOT NULL,
  tipo TEXT NOT NULL,            -- ver TIPOS en functions/api/evento-web.js
  ruta TEXT,                     -- '/', '/tours/city-tour/'...
  datos_json TEXT,
  t_ms INTEGER,                  -- ms desde que empezó la sesión
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eventos_web_creado ON eventos_web (creado_en);
CREATE INDEX IF NOT EXISTS idx_eventos_web_tipo ON eventos_web (tipo, creado_en);
CREATE INDEX IF NOT EXISTS idx_eventos_web_sesion ON eventos_web (sesion_id);

CREATE TABLE IF NOT EXISTS sesiones_web (
  sesion_id TEXT PRIMARY KEY,
  codigo TEXT,                   -- LL-######: el "ref" que va en el WhatsApp de esta visita
  visitante_id TEXT,             -- anónimo, en localStorage: separa nuevos de recurrentes
  host TEXT,
  landing TEXT,                  -- primera ruta de la sesión
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,              -- id del post / palabra clave
  canal TEXT NOT NULL,           -- utm_source o deducido del referrer; 'directo' si nada
  dispositivo TEXT,              -- movil | tablet | desktop
  pais TEXT,
  idioma TEXT,
  interno INTEGER NOT NULL DEFAULT 0,  -- navegador del equipo (?interno=1)
  primer_evento TEXT NOT NULL,
  ultimo_evento TEXT NOT NULL,
  duracion_ms INTEGER NOT NULL DEFAULT 0,
  paginas INTEGER NOT NULL DEFAULT 0,
  vistas_paquete INTEGER NOT NULL DEFAULT 0,
  max_scroll INTEGER NOT NULL DEFAULT 0,
  clicks_whatsapp INTEGER NOT NULL DEFAULT 0,
  clicks_cta INTEGER NOT NULL DEFAULT 0,
  cotizar_abierto INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,    -- cotizaciones enviadas desde una ficha
  errores_js INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sesiones_web_primer ON sesiones_web (primer_evento);
CREATE INDEX IF NOT EXISTS idx_sesiones_web_codigo ON sesiones_web (codigo);

-- Código de la visita que trajo al lead. Lo llena /api/cotizacion-web, o la
-- agencia a mano cuando alguien escribe por WhatsApp con "ref LL-######".
ALTER TABLE leads ADD COLUMN codigo_web TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_codigo_web ON leads (codigo_web);

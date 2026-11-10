-- Migración 050: planilla diaria de la campaña a WhatsApp / DM.
--
-- Solo agrega una tabla. No toca datos existentes.
--
-- Segunda planilla de la sección Anuncios (la primera, Follow Me Ads, es
-- anuncios_dia de la migración 049). Acá todo se carga a mano: lo de Ads
-- Manager (inversión, impresiones, clics, reproducciones) y el resultado que
-- trajo esa campaña (conversaciones, cotizaciones, clientes, facturación y
-- cobrado). No se cruza con el resto del CRM porque nada marca hoy qué
-- conversación vino de qué campaña.
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-050-anuncios-mensajes.sql

CREATE TABLE IF NOT EXISTS anuncios_mensajes_dia (
  fecha TEXT PRIMARY KEY,          -- YYYY-MM-DD
  inversion REAL,                  -- USD gastados ese día
  impresiones INTEGER,
  clicks INTEGER,
  repro_3s INTEGER,                -- reproducciones de 3 segundos
  repro_50 INTEGER,                -- reproducciones al 50 %
  conversaciones INTEGER,          -- conversaciones iniciadas por la campaña
  cotizaciones INTEGER,
  clientes INTEGER,
  facturacion REAL,                -- USD vendidos
  cash REAL,                       -- USD efectivamente cobrados
  nota TEXT,
  fuente TEXT NOT NULL DEFAULT 'manual',
  actualizado_en TEXT NOT NULL
);

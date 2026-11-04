-- Migración 049: página de propuesta de las cotizaciones del Cotizador (solo Luna Llena).
--
-- Solo agrega dos columnas y un índice. No borra ni cambia datos.
--
-- Al guardar con "Generar página", el servidor guarda el HTML que arma el
-- cotizador (luna-llena-cotizador/cotizador/propuesta.py, con el diseño de la web)
-- y un slug al azar. La página se ve en
--   https://lunallenatravel.vercel.app/p/<slug>/
-- (la web reescribe /p/* a esta Function: functions/p/[slug].js). Sin login, por
-- eso el slug es largo y al azar; con noindex.
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-049-cotizador-propuesta.sql

ALTER TABLE cotizador_cotizaciones ADD COLUMN slug TEXT;
ALTER TABLE cotizador_cotizaciones ADD COLUMN propuesta_html TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cotizador_cotizaciones_slug ON cotizador_cotizaciones(slug);

-- Migración 049: planilla diaria de anuncios (Follow Me Ads).
--
-- Solo agrega una tabla. No toca datos existentes.
--
-- Una fila por día con lo que se carga desde Ads Manager: inversión,
-- impresiones, clics, seguidores que trajeron los anuncios y frecuencia.
-- Todo lo demás de la planilla (CPM, CTR, costo por seguidor) se calcula al
-- mostrar, y las columnas de embudo (views, comentarios, conversaciones,
-- cotizaciones, ventas) salen de tablas que ya existen: metricas_cuenta_dia,
-- sheet_eventos y ventas. Ver functions/api/anuncios.js.
--
-- `fuente` queda en 'manual' hasta que exista un sync automático (Windsor con
-- Meta Ads conectado); ese sync escribiría 'windsor' y no pisaría lo manual.
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-049-anuncios.sql

CREATE TABLE IF NOT EXISTS anuncios_dia (
  fecha TEXT PRIMARY KEY,          -- YYYY-MM-DD
  inversion REAL,                  -- USD gastados ese día
  impresiones INTEGER,
  clicks INTEGER,
  seguidores INTEGER,              -- "Seguimientos de Instagram" en Ads Manager
  frecuencia REAL,
  nota TEXT,
  fuente TEXT NOT NULL DEFAULT 'manual',
  actualizado_en TEXT NOT NULL
);

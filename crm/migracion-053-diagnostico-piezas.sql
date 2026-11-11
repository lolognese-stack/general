-- Migración 053: dos datos que la API de Instagram no entrega y que hacen
-- falta para saber en qué etapa falla un video (Performance > Contenido).
--
--   duracion_seg   largo del video en segundos. Con el tiempo promedio que ya
--                  trae el sync da el % visto: 5 s sobre 8 no es lo mismo que
--                  5 s sobre 40.
--   retencion_3s   % de quienes lo vieron que pasaron los 3 segundos (0-100).
--                  Se copia de las estadísticas del reel en la app; si la app
--                  muestra "tasa de omisión", es 100 menos ese número.
--
-- Las dos se cargan a mano en la ficha de la pieza y pueden quedar vacías:
-- el diagnóstico marca la etapa como "sin dato" en vez de inventarla.
--
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-053-diagnostico-piezas.sql

ALTER TABLE piezas ADD COLUMN duracion_seg INTEGER;
ALTER TABLE piezas ADD COLUMN retencion_3s REAL;

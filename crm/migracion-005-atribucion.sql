-- Migración 005: atribución de contenido + métricas diarias
--
-- Dos cosas:
-- 1. Dos columnas de atribución en `leads`. Con `medio_agenda` (ya existe
--    desde 002) forman el eje "de qué contenido salió este lead".
--    `angulo` es la pieza (reel, historia); `etiqueta_manychat` es el tag
--    que puso el bot cuando arrancó la conversación.
-- 2. Tabla `metricas_dia`: el embudo diario de conversación → formulario
--    enviado → formulario completado. Una fila por día, la fecha es la
--    clave: recargar el mismo día pisa los números, no duplica la fila.
--    Se siembra con los 16 días que hasta hoy vivían en el localStorage de
--    conversacion-e28a1c.html.
--
-- `fecha_agenda` y `fecha_llamada` siguen existiendo: desaparecen del panel,
-- no de la base. Ninguna columna se borra.

ALTER TABLE leads ADD COLUMN angulo TEXT;
ALTER TABLE leads ADD COLUMN etiqueta_manychat TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_angulo ON leads(angulo);
CREATE INDEX IF NOT EXISTS idx_leads_etiqueta_manychat ON leads(etiqueta_manychat);

CREATE TABLE IF NOT EXISTS metricas_dia (
  fecha TEXT PRIMARY KEY,                        -- YYYY-MM-DD
  conversaciones INTEGER NOT NULL DEFAULT 0,
  formularios_enviados INTEGER NOT NULL DEFAULT 0,
  formularios_completados INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL
);

-- Semilla: 2026-07-21 a 2026-08-05, tal cual estaban cargados a mano.
-- INSERT OR IGNORE para que volver a correr esto no pise datos nuevos.
INSERT OR IGNORE INTO metricas_dia
  (fecha, conversaciones, formularios_enviados, formularios_completados, actualizado_en)
VALUES
  ('2026-07-21',  44, 10, 4, '2026-08-06T00:00:00.000Z'),
  ('2026-07-22',   7,  1, 1, '2026-08-06T00:00:00.000Z'),
  ('2026-07-23',   8,  1, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-07-24',   9,  1, 1, '2026-08-06T00:00:00.000Z'),
  ('2026-07-25', 180,  6, 4, '2026-08-06T00:00:00.000Z'),
  ('2026-07-26', 419,  7, 3, '2026-08-06T00:00:00.000Z'),
  ('2026-07-27', 150, 13, 6, '2026-08-06T00:00:00.000Z'),
  ('2026-07-28', 112,  5, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-07-29',  76,  2, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-07-30',  12,  1, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-07-31',  15,  5, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-08-01',  58,  4, 2, '2026-08-06T00:00:00.000Z'),
  ('2026-08-02',  55,  1, 2, '2026-08-06T00:00:00.000Z'),
  ('2026-08-03',  63,  0, 1, '2026-08-06T00:00:00.000Z'),
  ('2026-08-04',  58,  0, 0, '2026-08-06T00:00:00.000Z'),
  ('2026-08-05',  69,  0, 0, '2026-08-06T00:00:00.000Z');

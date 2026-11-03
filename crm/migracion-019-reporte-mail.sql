-- Migración 019: reporte semanal por mail al cliente.
-- El mail y el nombre viven en `programa` (fila única); el último envío
-- queda anotado para que el cron no mande dos veces la misma semana.
ALTER TABLE programa ADD COLUMN email_reporte TEXT;      -- puede ser varios, separados por coma
ALTER TABLE programa ADD COLUMN nombre_cliente TEXT;     -- para el saludo: "Hola, Visite"
ALTER TABLE programa ADD COLUMN reporte_ultimo_envio TEXT; -- ISO del último mail mandado
ALTER TABLE programa ADD COLUMN reporte_ultima_semana INTEGER; -- número de semana que cubrió

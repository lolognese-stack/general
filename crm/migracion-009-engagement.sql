-- Migración 009: engagement crudo de Instagram por pieza. No es la suma de
-- likes+comentarios+guardados+compartidos -- se comprobó contra el CSV que
-- difieren (la métrica de Meta cuenta otras cosas de por medio), así que
-- hace falta guardarlo aparte para el ER% real en vez de aproximarlo.
ALTER TABLE piezas ADD COLUMN engagement INTEGER;

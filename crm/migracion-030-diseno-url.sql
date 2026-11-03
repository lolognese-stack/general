-- Migración 030: link al chat de Claude Design donde se diseña la pieza
-- (carruseles, portadas). Se carga y se abre desde el drawer de la pieza.

ALTER TABLE piezas ADD COLUMN diseno_url TEXT;

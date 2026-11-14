-- Horario (texto libre: "17:00 a 20:00", "Según vuelo") y modalidad (PRI privado / GRU grupal) de cada línea de la cotización.
ALTER TABLE ct_lineas ADD COLUMN horario TEXT;
ALTER TABLE ct_lineas ADD COLUMN modalidad TEXT CHECK (modalidad IN ('PRI', 'GRU'));

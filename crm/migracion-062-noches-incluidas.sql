-- Noches de alojamiento que ya trae el servicio (ej. Cañón del Colca 2D/1N duerme en Chivay).
-- El armador las descuenta de las noches de hotel de la ciudad base para no cobrar doble.
ALTER TABLE ct_servicios ADD COLUMN noches_incluidas INTEGER NOT NULL DEFAULT 0;

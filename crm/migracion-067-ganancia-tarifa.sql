-- Migración 067: ganancia neta por persona en la tarifa.
-- Para servicios que opera Luna Llena (precio_es_venta = 1) la tarifa es el precio de venta; la ganancia
-- (en la moneda de la tarifa, por persona) dice cuánto de ese precio es ganancia, así el costo = precio - ganancia
-- y la cotización muestra la ganancia real. NULL = no se conoce (la línea queda con neto = venta, como hasta ahora).
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-067-ganancia-tarifa.sql
ALTER TABLE ct_tarifas ADD COLUMN ganancia_cent INTEGER CHECK (ganancia_cent IS NULL OR ganancia_cent >= 0);

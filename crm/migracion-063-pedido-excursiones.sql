-- Excursiones que pidio el cliente (JSON: ["Canon del Colca", "Lago Titicaca"]). No son destinos con noches:
-- el armador las busca en el catalogo y las ubica en un dia libre de su ciudad base.
ALTER TABLE ct_pedidos ADD COLUMN excursiones TEXT;

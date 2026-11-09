-- Migración 048: itinerario día por día del lead.
-- JSON: [{ "titulo": "Lima, Paracas…", "dias": [{ "fecha": "2026-11-05", "lugar": "Lima", "detalle": "…" }] }]
-- Cuando existe, el panel muestra este itinerario en la ficha y en la tarjeta
-- en vez de los destinos y los días sueltos (`destinos` y `dias` siguen
-- sirviendo para buscar y filtrar).

ALTER TABLE leads ADD COLUMN itinerario TEXT;

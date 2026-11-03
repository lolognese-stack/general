-- Migración 007: hora de publicación (Performance) + ángulos nuevos del
-- brainstorm de contenido. No confundir con la semilla de Notion que había
-- quedado bloqueada bajo el mismo número en el README viejo -- esa nunca
-- se llegó a escribir como archivo, este 007 es otra cosa.

ALTER TABLE piezas ADD COLUMN hora_publicacion TEXT;

INSERT INTO angulos (nombre, categoria, creado_en, actualizado_en) VALUES
  ('Actividades', 'Solución', datetime('now'), datetime('now')),
  ('Equipaje', 'Solución', datetime('now'), datetime('now')),
  ('Paquete Precio', 'Producto', datetime('now'), datetime('now')),
  ('Comida', 'Solución', datetime('now'), datetime('now')),
  ('Itinerario', 'Solución', datetime('now'), datetime('now')),
  ('No tener planificación', 'Problema', datetime('now'), datetime('now')),
  ('Paisaje', 'Otros', datetime('now'), datetime('now')),
  ('Argentina no es solo Buenos Aires', 'Problema', datetime('now'), datetime('now')),
  ('IVA hospedaje', 'Problema', datetime('now'), datetime('now'));

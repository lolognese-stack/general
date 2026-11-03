-- Migración 011: puebla la Matriz de Ángulos completa (39 ítems del Notion
-- real, ver data/raw/temas_visite_ar.md) y corrige la categoría de
-- "Equipaje" -- había quedado como Solución en una carga manual previa
-- (migración 007), pero en el Notion original es Problema.
UPDATE angulos SET categoria='Problema', actualizado_en=datetime('now') WHERE nombre='Equipaje';

INSERT INTO angulos (nombre, categoria, creado_en, actualizado_en) VALUES
  ('Viajar solo', 'Problema', datetime('now'), datetime('now')),
  ('Improvisar durante el viaje', 'Problema', datetime('now'), datetime('now')),
  ('"Argentina es complicada"', 'Problema', datetime('now'), datetime('now')),
  ('No conocer el sistema cambiario', 'Problema', datetime('now'), datetime('now')),
  ('Error específico (LUGAR)', 'Problema', datetime('now'), datetime('now')),
  ('Perder tiempo', 'Problema', datetime('now'), datetime('now')),
  ('Visitar lugares comunes', 'Problema', datetime('now'), datetime('now')),
  ('Errores comunes', 'Problema', datetime('now'), datetime('now')),
  ('Creer que pagar una agencia es más caro y que se ahorran plata', 'Problema', datetime('now'), datetime('now')),
  ('No saber por dónde empezar a armar el viaje', 'Problema', datetime('now'), datetime('now')),
  ('Trekking', 'Problema', datetime('now'), datetime('now')),
  ('Airbnb: perdés plata', 'Problema', datetime('now'), datetime('now')),
  ('LUGAR secreto', 'Solución', datetime('now'), datetime('now')),
  ('Excursión/es', 'Solución', datetime('now'), datetime('now')),
  ('Destino según la temporada', 'Solución', datetime('now'), datetime('now')),
  ('Dónde alojarse', 'Solución', datetime('now'), datetime('now')),
  ('Solo vs Agencia', 'Solución', datetime('now'), datetime('now')),
  ('Destinos', 'Solución', datetime('now'), datetime('now')),
  ('Datos interesantes', 'Solución', datetime('now'), datetime('now')),
  ('Soluciones económicas', 'Solución', datetime('now'), datetime('now')),
  ('Trucos secretos', 'Solución', datetime('now'), datetime('now')),
  ('¿Por qué nosotros?', 'Producto', datetime('now'), datetime('now')),
  ('Romantizar Europa', 'Otros', datetime('now'), datetime('now')),
  ('Animales', 'Otros', datetime('now'), datetime('now')),
  ('"Las agencias de viaje no sirven"', 'Otros', datetime('now'), datetime('now')),
  ('"Argentina es muy caro"', 'Otros', datetime('now'), datetime('now')),
  ('Argentina es insegura', 'Otros', datetime('now'), datetime('now')),
  ('Piedras a Perú', 'Otros', datetime('now'), datetime('now')),
  ('¿Pensás viajar a Argentina más de 3 días y solo visitar Buenos Aires?', 'Otros', datetime('now'), datetime('now'));

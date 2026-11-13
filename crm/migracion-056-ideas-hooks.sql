-- Hooks en Ideas: una idea con tipo = 'hook' (como los audios, sin columna
-- nueva). Se ven en su propia vista y no cuentan en "Todas".
INSERT INTO ideas_vistas (nombre, filtro, orden, creado_en)
  SELECT 'Hooks', '{"tipo":"hook"}', 0, datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM ideas_vistas WHERE filtro = '{"tipo":"hook"}');

-- El formato "Broll Narrativo" pasa a llamarse "Narrativo".
UPDATE ideas  SET formato = 'Narrativo' WHERE formato = 'Broll Narrativo';
UPDATE piezas SET formato = 'Narrativo' WHERE formato = 'Broll Narrativo';
UPDATE ideas_vistas SET filtro = replace(filtro, '"Broll Narrativo"', '"Narrativo"') WHERE filtro LIKE '%Broll Narrativo%';
UPDATE angulos SET formatos_sugeridos = replace(formatos_sugeridos, 'Broll Narrativo', 'Narrativo') WHERE formatos_sugeridos LIKE '%Broll Narrativo%';

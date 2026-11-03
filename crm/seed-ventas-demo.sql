-- Datos de ejemplo de Ventas: SOLO PARA LA D1 LOCAL.
--
-- NUNCA aplicar con --remote: la D1 de la demo tiene datos reales.
-- Las fechas son relativas a "ahora" para que los estados calculados
-- (abandonada > 2 h, confirmación vencida > 24 h) y la vista Salidas
-- (próximas 8 semanas) se vean igual cualquier día que se cargue.
--
-- Aplicar (local, después de la migración 033):
--   npx wrangler d1 execute crm-plantilla --local --file=crm/seed-ventas-demo.sql
--
-- Se puede volver a correr: primero borra lo que creó (ids demo-* y leads 9001-9003).

DELETE FROM venta_pagos WHERE venta_id LIKE 'demo-%';
DELETE FROM venta_viajeros WHERE venta_id LIKE 'demo-%';
DELETE FROM venta_eventos WHERE venta_id LIKE 'demo-%';
DELETE FROM ventas WHERE id LIKE 'demo-%';
DELETE FROM eventos WHERE lead_id IN (9001, 9002, 9003);
DELETE FROM leads WHERE id IN (9001, 9002, 9003);

-- Leads para enlazar (y uno libre para probar "Crear venta para este lead").
INSERT INTO leads (id, nombre, pais, whatsapp, email, personas, destinos, fecha_viaje, etapa, fuente, fecha_alta, creado_en, actualizado_en) VALUES
  (9001, 'Camila Rojas', 'Chile', '+56911112222', 'camila@example.com', 2, 'Machu Picchu', '2026-11-10', 'ganado', 'Web: reserva', date('now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days')),
  (9002, 'Martín Gómez', 'Argentina', '+5491133334444', 'martin@example.com', 4, 'Cusco y Valle Sagrado', '2026-12-01', 'ganado', 'Formulario viaje', date('now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days')),
  (9003, 'Lucía Fernández', 'México', '+5215555556666', 'lucia@example.com', 2, 'Camino Inca', '2027-01-15', 'propuesta_enviada', 'Formulario viaje', date('now','-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'));

-- 1. Carrito abandonado (web, pendiente_pago hace 5 h).
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, opcion, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, token_viajeros, token_vence, creado_en, actualizado_en) VALUES
  ('demo-0001-abandonada', NULL, 'web', 'machu-picchu-full-day', 'Machu Picchu Full Day', 'machu-picchu', 'Tren Expedition', date('now','+25 days'), date('now','+25 days'), 2, 0, 'USD', 90000, 30, 27000, 'pendiente_pago', 'Sofía Herrera', 'sofia@example.com', '+51987654321', 'Perú', 'tokdemo0001', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+10 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours'));

-- 2. Checkout recién creado (web, 30 min: todavía no es abandonada).
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, token_viajeros, token_vence, creado_en, actualizado_en) VALUES
  ('demo-0002-pendiente', NULL, 'web', 'montana-de-colores', 'Montaña de 7 Colores', 'tours-cusco', date('now','+40 days'), date('now','+40 days'), 1, 0, 'USD', 12000, 30, 3600, 'pendiente_pago', 'Diego Paredes', 'diego@example.com', NULL, 'Colombia', 'tokdemo0002', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+25 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'));

-- 3. Seña pagada hace 30 h por Stripe: confirmación VENCIDA. Lead enlazado.
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, opcion, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, notas_cliente, token_viajeros, token_vence, sena_pagada_en, creado_en, actualizado_en) VALUES
  ('demo-0003-vencida', 9001, 'web', 'machu-picchu-2-dias', 'Machu Picchu 2 días', 'machu-picchu', 'Tren Vistadome', date('now','+18 days'), date('now','+19 days'), 2, 0, 'USD', 150000, 30, 45000, 'sena_pagada', 'Camila Rojas', 'camila@example.com', '+56911112222', 'Chile', 'Vamos de luna de miel', 'tokdemo0003', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+3 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 hours'));

-- 4. Seña pagada hace 3 h por PayPal (a tiempo).
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, token_viajeros, token_vence, sena_pagada_en, creado_en, actualizado_en) VALUES
  ('demo-0004-sena', NULL, 'web', 'lago-titicaca', 'Lago Titicaca y Uros', 'viajes-completos', date('now','+45 days'), date('now','+48 days'), 3, 1, 'USD', 280000, 30, 84000, 'sena_pagada', 'Andrea Molina', 'andrea@example.com', '+34611223344', 'España', 'tokdemo0004', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+30 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'));

-- 5. Confirmada, venta por WhatsApp, seña por transferencia, falta saldo y 1 pasaporte.
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, notas_internas, token_viajeros, token_vence, sena_pagada_en, confirmada_en, creado_en, actualizado_en) VALUES
  ('demo-0005-confirmada', 9002, 'whatsapp', 'cusco-valle-sagrado', 'Cusco y Valle Sagrado 5 días', 'viajes-completos', date('now','+10 days'), date('now','+14 days'), 3, 0, 'USD', 210000, 30, 63000, 'confirmada', 'Martín Gómez', 'martin@example.com', '+5491133334444', 'Argentina', 'Hotel confirmado en Urubamba', 'tokdemo0005', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','-5 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days'));

-- 6. Pagada (seña + saldo), pasaportes completos, sale en 3 semanas.
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, token_viajeros, token_vence, sena_pagada_en, confirmada_en, creado_en, actualizado_en) VALUES
  ('demo-0006-pagada', NULL, 'web', 'camino-inca-4-dias', 'Camino Inca 4 días', 'trekking', date('now','+21 days'), date('now','+24 days'), 2, 0, 'USD', 160000, 30, 48000, 'pagada', 'Tomás Ibarra', 'tomas@example.com', '+5491177778888', 'Argentina', 'tokdemo0006', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+6 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-39 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'));

-- 7. Finalizada (viaje del mes pasado).
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, token_viajeros, token_vence, sena_pagada_en, confirmada_en, creado_en, actualizado_en) VALUES
  ('demo-0007-finalizada', NULL, 'manual', 'retiro-valle-sagrado', 'Retiro de yoga en el Valle', 'retiros', date('now','-25 days'), date('now','-20 days'), 1, 0, 'USD', 95000, 30, 28500, 'finalizada', 'Valentina Ruiz', 'valentina@example.com', '+525544332211', 'México', 'tokdemo0007', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','-40 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-59 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-19 days'));

-- 8. Cancelada con seña cobrada y reembolso registrado.
INSERT INTO ventas (id, lead_id, origen, producto_slug, producto_nombre, producto_categoria, fecha_inicio, fecha_fin, adultos, menores, moneda, total_centavos, sena_pct, sena_centavos, estado, nombre, email, whatsapp, pais, motivo_cancelacion, token_viajeros, token_vence, sena_pagada_en, cancelada_en, creado_en, actualizado_en) VALUES
  ('demo-0008-cancelada', NULL, 'web', 'machu-picchu-full-day', 'Machu Picchu Full Day', 'machu-picchu', date('now','+30 days'), date('now','+30 days'), 2, 0, 'USD', 90000, 30, 27000, 'cancelada', 'Pedro Salinas', 'pedro@example.com', '+51912345678', 'Perú', 'Se le cruzó un viaje de trabajo', 'tokdemo0008', strftime('%Y-%m-%dT%H:%M:%fZ', date('now','+15 days')), strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days'));

-- Pagos (aprobados).
INSERT INTO venta_pagos (venta_id, tipo, monto_centavos, moneda, proveedor, referencia, estado, registrado_por, nota, creado_en) VALUES
  ('demo-0003-vencida',    'sena',      45000, 'USD', 'stripe',        'pi_demo_0003',  'aprobado', 'webhook', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 hours')),
  ('demo-0004-sena',       'sena',      84000, 'USD', 'paypal',        'CAP-DEMO-0004', 'aprobado', 'webhook', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours')),
  ('demo-0005-confirmada', 'sena',      63000, 'USD', 'transferencia', 'OP-778812',     'aprobado', 'panel',   'BCP', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('demo-0006-pagada',     'sena',      48000, 'USD', 'stripe',        'pi_demo_0006',  'aprobado', 'webhook', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days')),
  ('demo-0006-pagada',     'saldo',    112000, 'USD', 'transferencia', 'OP-901122',     'aprobado', 'panel',   NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('demo-0007-finalizada', 'sena',      28500, 'USD', 'yape',          NULL,            'aprobado', 'panel',   NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')),
  ('demo-0007-finalizada', 'saldo',     66500, 'USD', 'efectivo',      NULL,            'aprobado', 'panel',   'Pagó al llegar', strftime('%Y-%m-%dT%H:%M:%fZ','now','-26 days')),
  ('demo-0008-cancelada',  'sena',      27000, 'USD', 'stripe',        'pi_demo_0008',  'aprobado', 'webhook', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')),
  ('demo-0008-cancelada',  'reembolso', 27000, 'USD', 'stripe',        're_demo_0008',  'aprobado', 'panel',   'Reembolso total', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'));

-- Viajeros: 2 de 3 en la confirmada, 2 de 2 en la pagada, 1 de 2 en la vencida.
INSERT INTO venta_viajeros (venta_id, orden, nombre_completo, nacionalidad, doc_tipo, doc_numero, fecha_nacimiento, sexo, es_menor, creado_en, actualizado_en) VALUES
  ('demo-0005-confirmada', 1, 'MARTIN GOMEZ', 'Argentina', 'pasaporte', 'AAB123456', '1988-04-12', 'M', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days')),
  ('demo-0005-confirmada', 2, 'JULIA PEREZ',  'Argentina', 'pasaporte', 'AAB654321', '1990-09-30', 'F', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days')),
  ('demo-0006-pagada',     1, 'TOMAS IBARRA', 'Argentina', 'pasaporte', 'AAC111222', '1985-01-20', 'M', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')),
  ('demo-0006-pagada',     2, 'ANA LOPEZ',    'Uruguay',   'pasaporte', 'C998877',   '1987-06-02', 'F', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')),
  ('demo-0003-vencida',    1, 'CAMILA ROJAS', 'Chile',     'pasaporte', 'P1234567',  '1994-03-15', 'F', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 hours'));

-- Historial.
INSERT INTO venta_eventos (venta_id, tipo, detalle, autor, creado_en) VALUES
  ('demo-0001-abandonada', 'creada', 'Checkout web: Machu Picchu Full Day', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours')),
  ('demo-0002-pendiente',  'creada', 'Checkout web: Montaña de 7 Colores', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')),
  ('demo-0003-vencida',    'creada', 'Checkout web: Machu Picchu 2 días', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 hours')),
  ('demo-0003-vencida',    'pago',   'Seña USD 450 por Stripe', 'webhook', strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 hours')),
  ('demo-0003-vencida',    'viajeros', '1 de 2 completos', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 hours')),
  ('demo-0004-sena',       'creada', 'Checkout web: Lago Titicaca y Uros', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours')),
  ('demo-0004-sena',       'pago',   'Seña USD 840 por PayPal', 'webhook', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours')),
  ('demo-0005-confirmada', 'creada', 'Venta por WhatsApp: Cusco y Valle Sagrado 5 días', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('demo-0005-confirmada', 'pago',   'Seña USD 630 por transferencia (ref. OP-778812)', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 days')),
  ('demo-0005-confirmada', 'estado', 'Seña pagada → Confirmada', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-11 days')),
  ('demo-0006-pagada',     'creada', 'Checkout web: Camino Inca 4 días', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days')),
  ('demo-0006-pagada',     'pago',   'Seña USD 480 por Stripe', 'webhook', strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days')),
  ('demo-0006-pagada',     'estado', 'Seña pagada → Confirmada', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-39 days')),
  ('demo-0006-pagada',     'pago',   'Saldo USD 1.120 por transferencia (ref. OP-901122)', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('demo-0006-pagada',     'estado', 'Confirmada → Pagada (automático)', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('demo-0007-finalizada', 'creada', 'Venta manual: Retiro de yoga en el Valle', 'panel:admin', strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')),
  ('demo-0007-finalizada', 'estado', 'Pagada → Finalizada', 'panel:admin', strftime('%Y-%m-%dT%H:%M:%fZ','now','-19 days')),
  ('demo-0008-cancelada',  'creada', 'Checkout web: Machu Picchu Full Day', 'web', strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')),
  ('demo-0008-cancelada',  'pago',   'Seña USD 270 por Stripe', 'webhook', strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')),
  ('demo-0008-cancelada',  'estado', 'Seña pagada → Cancelada: Se le cruzó un viaje de trabajo', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 days')),
  ('demo-0008-cancelada',  'pago',   'Reembolso USD 270 por Stripe (ref. re_demo_0008)', 'panel:cliente', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days'));

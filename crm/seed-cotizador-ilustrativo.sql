-- GENERADO por crm/generar-seed-cotizador.mjs. No editar a mano.
-- Tarifas y hoteles DE PRUEBA (precios inventados, es_ilustrativa = 1). Se puede volver a correr: borra y vuelve a cargar solo lo de prueba.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/seed-cotizador-ilustrativo.sql

-- Configuración inicial: solo si no existe (no pisa valores ya confirmados).
INSERT OR IGNORE INTO ct_config (clave, valor, es_prueba) VALUES ('margen_pct', '25', 1), ('tc_pen_por_usd', '3.75', 1), ('recargo_tarjeta_pct', '5', 0), ('igv_pct', '18', 0);
INSERT INTO ct_temporadas (temporada, desde_md, hasta_md, nota, es_prueba) SELECT 'alta', '06-01', '08-31', 'Invierno: temporada alta (a confirmar)', 1 WHERE NOT EXISTS (SELECT 1 FROM ct_temporadas);
INSERT INTO ct_temporadas (temporada, desde_md, hasta_md, nota, es_prueba) SELECT 'alta', '12-20', '01-05', 'Fiestas de fin de año (a confirmar)', 1 WHERE (SELECT COUNT(*) FROM ct_temporadas) = 1;

DELETE FROM ct_tarifas WHERE es_ilustrativa = 1;
DELETE FROM ct_hotel_tarifas WHERE es_ilustrativa = 1;

INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|cusco|city-tour-cusco', 'City Tour Cusco', 'Cusco', 'tour', 'Medio día', 'Guía, transporte turístico, Qorikancha, Sacsayhuamán, Q''enqo, Puka Pukara y Tambomachay', 'Boleto turístico, propinas', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|city-tour-cusco'), 4000, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|city-tour-cusco'), 2800, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|city-tour-cusco'), 2200, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|city-tour-cusco'), 1800, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n', 'Valle Sagrado VIP + Machu Picchu 2D/1N', 'Cusco', 'paquete', '2D/1N', 'Transporte, guía, almuerzo buffet en el Valle, tren, hotel en Aguas Calientes, bus de subida y bajada, entrada a Machu Picchu', 'Boleto turístico, cenas, propinas', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 52000, 'USD', 1, 1, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 57200, 'USD', 1, 1, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 43000, 'USD', 2, 3, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 47300, 'USD', 2, 3, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 39500, 'USD', 4, 6, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 43500, 'USD', 4, 6, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 37000, 'USD', 7, NULL, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|cusco|valle-sagrado-vip-machu-picchu-2d-1n'), 40700, 'USD', 7, NULL, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|cusco|montana-de-7-colores', 'Montaña de 7 Colores', 'Cusco', 'tour', 'Día completo', 'Recojo del hotel, desayuno, almuerzo, guía', 'Entrada a la montaña, caballo, bastones', 2) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|montana-de-7-colores'), 6000, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|montana-de-7-colores'), 3800, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|montana-de-7-colores'), 3200, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|montana-de-7-colores'), 2800, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|cusco|laguna-humantay', 'Laguna Humantay', 'Cusco', 'tour', 'Día completo', 'Recojo del hotel, desayuno, almuerzo, guía', 'Entrada a la laguna, caballo', 2) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|laguna-humantay'), 5800, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|laguna-humantay'), 3600, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|laguna-humantay'), 3000, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|laguna-humantay'), 2600, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|cusco|cuatrimotos-maras-moray', 'Cuatrimotos Maras Moray', 'Cusco', 'tour', 'Medio día', 'Cuatrimoto, casco, guía, transporte', 'Entradas a Moray y a las Salineras', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|cuatrimotos-maras-moray'), 7000, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|cuatrimotos-maras-moray'), 4800, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|cuatrimotos-maras-moray'), 4200, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|cusco|cuatrimotos-maras-moray'), 3800, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('paquete|puno|puno-2d-1n-uros-amantani-taquile', 'Puno 2D/1N (Uros, Amantaní, Taquile)', 'Puno', 'paquete', '2D/1N', 'Lancha, guía, noche en casa de familia en Amantaní, comidas del tour', 'Entradas a las islas, propinas', 2) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|puno|puno-2d-1n-uros-amantani-taquile'), 15000, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|puno|puno-2d-1n-uros-amantani-taquile'), 11000, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|puno|puno-2d-1n-uros-amantani-taquile'), 9500, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|puno|puno-2d-1n-uros-amantani-taquile'), 8500, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('paquete|ica|paracas-ica-huacachina-2d-1n', 'Paracas - Ica - Huacachina 2D/1N', 'Ica', 'paquete', '2D/1N', 'Transporte desde Lima, Islas Ballestas, tubulares y sandboard en Huacachina, hotel 1 noche', 'Tasas portuarias, comidas no indicadas', 2) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 26000, 'USD', 1, 1, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 29900, 'USD', 1, 1, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 19000, 'USD', 2, 3, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 21800, 'USD', 2, 3, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 17000, 'USD', 4, 6, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 19500, 'USD', 4, 6, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 15500, 'USD', 7, NULL, 'baja', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'paquete|ica|paracas-ica-huacachina-2d-1n'), 17800, 'USD', 7, NULL, 'alta', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|nazca|sobrevuelo-lineas-de-nazca', 'Sobrevuelo Líneas de Nazca', 'Nazca', 'tour', '35 minutos de vuelo', 'Vuelo en avioneta, traslado al aeródromo', 'Tasa de aeropuerto', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|nazca|sobrevuelo-lineas-de-nazca'), 12000, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|nazca|sobrevuelo-lineas-de-nazca'), 11000, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|nazca|sobrevuelo-lineas-de-nazca'), 10500, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|nazca|sobrevuelo-lineas-de-nazca'), 10000, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('tour|lima|city-tour-lima', 'City Tour Lima', 'Lima', 'tour', 'Medio día', 'Guía, transporte, Lima colonial y Miraflores', 'Entradas a museos', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|lima|city-tour-lima'), 4500, 'USD', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|lima|city-tour-lima'), 3200, 'USD', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|lima|city-tour-lima'), 2600, 'USD', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'tour|lima|city-tour-lima'), 2200, 'USD', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min) VALUES ('entrada|lima|circuito-magico-del-agua', 'Circuito Mágico del Agua', 'Lima', 'entrada', '2 horas', 'Entrada al parque', 'Transporte', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_servicios WHERE clave = 'entrada|lima|circuito-magico-del-agua'), 1500, 'PEN', 1, 1, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'entrada|lima|circuito-magico-del-agua'), 1500, 'PEN', 2, 3, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'entrada|lima|circuito-magico-del-agua'), 1500, 'PEN', 4, 6, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_servicios WHERE clave = 'entrada|lima|circuito-magico-del-agua'), 1500, 'PEN', 7, NULL, 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');

INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|economico|hostal-ejemplo-inti-cusco-prueba', 'Cusco', 'economico', 'Hostal Ejemplo Inti Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|hostal-ejemplo-inti-cusco-prueba'), 'SGL', 4500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|hostal-ejemplo-inti-cusco-prueba'), 'DBL', 5500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|hostal-ejemplo-inti-cusco-prueba'), 'TPL', 7500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|economico|casa-ejemplo-killa-cusco-prueba', 'Cusco', 'economico', 'Casa Ejemplo Killa Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|casa-ejemplo-killa-cusco-prueba'), 'SGL', 4000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|casa-ejemplo-killa-cusco-prueba'), 'DBL', 5000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|economico|casa-ejemplo-killa-cusco-prueba'), 'TPL', 6800, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|confort|hotel-ejemplo-wayra-cusco-prueba', 'Cusco', 'confort', 'Hotel Ejemplo Wayra Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-wayra-cusco-prueba'), 'SGL', 8500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-wayra-cusco-prueba'), 'DBL', 10000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-wayra-cusco-prueba'), 'TPL', 13000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|confort|hotel-ejemplo-nusta-cusco-prueba', 'Cusco', 'confort', 'Hotel Ejemplo Ñusta Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-nusta-cusco-prueba'), 'SGL', 8000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-nusta-cusco-prueba'), 'DBL', 9500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|confort|hotel-ejemplo-nusta-cusco-prueba'), 'TPL', 12500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|premium|gran-hotel-ejemplo-apu-cusco-prueba', 'Cusco', 'premium', 'Gran Hotel Ejemplo Apu Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|gran-hotel-ejemplo-apu-cusco-prueba'), 'SGL', 21000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|gran-hotel-ejemplo-apu-cusco-prueba'), 'DBL', 24000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|gran-hotel-ejemplo-apu-cusco-prueba'), 'TPL', 30000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('cusco|premium|hotel-ejemplo-pachamama-cusco-prueba', 'Cusco', 'premium', 'Hotel Ejemplo Pachamama Cusco (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|hotel-ejemplo-pachamama-cusco-prueba'), 'SGL', 19000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|hotel-ejemplo-pachamama-cusco-prueba'), 'DBL', 22000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'cusco|premium|hotel-ejemplo-pachamama-cusco-prueba'), 'TPL', 28000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|economico|hostal-ejemplo-inti-aguas-calientes-prueba', 'Aguas Calientes', 'economico', 'Hostal Ejemplo Inti Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|hostal-ejemplo-inti-aguas-calientes-prueba'), 'SGL', 5000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|hostal-ejemplo-inti-aguas-calientes-prueba'), 'DBL', 6000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|hostal-ejemplo-inti-aguas-calientes-prueba'), 'TPL', 8000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|economico|casa-ejemplo-killa-aguas-calientes-prueba', 'Aguas Calientes', 'economico', 'Casa Ejemplo Killa Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|casa-ejemplo-killa-aguas-calientes-prueba'), 'SGL', 4800, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|casa-ejemplo-killa-aguas-calientes-prueba'), 'DBL', 5800, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|economico|casa-ejemplo-killa-aguas-calientes-prueba'), 'TPL', 7800, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|confort|hotel-ejemplo-wayra-aguas-calientes-prueba', 'Aguas Calientes', 'confort', 'Hotel Ejemplo Wayra Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-wayra-aguas-calientes-prueba'), 'SGL', 9500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-wayra-aguas-calientes-prueba'), 'DBL', 11000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-wayra-aguas-calientes-prueba'), 'TPL', 14500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|confort|hotel-ejemplo-nusta-aguas-calientes-prueba', 'Aguas Calientes', 'confort', 'Hotel Ejemplo Ñusta Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-nusta-aguas-calientes-prueba'), 'SGL', 9000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-nusta-aguas-calientes-prueba'), 'DBL', 10500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|confort|hotel-ejemplo-nusta-aguas-calientes-prueba'), 'TPL', 14000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|premium|gran-hotel-ejemplo-apu-aguas-calientes-prueba', 'Aguas Calientes', 'premium', 'Gran Hotel Ejemplo Apu Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|gran-hotel-ejemplo-apu-aguas-calientes-prueba'), 'SGL', 28000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|gran-hotel-ejemplo-apu-aguas-calientes-prueba'), 'DBL', 32000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|gran-hotel-ejemplo-apu-aguas-calientes-prueba'), 'TPL', 40000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('aguas-calientes|premium|hotel-ejemplo-pachamama-aguas-calientes-prueba', 'Aguas Calientes', 'premium', 'Hotel Ejemplo Pachamama Aguas Calientes (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|hotel-ejemplo-pachamama-aguas-calientes-prueba'), 'SGL', 25000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|hotel-ejemplo-pachamama-aguas-calientes-prueba'), 'DBL', 29000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'aguas-calientes|premium|hotel-ejemplo-pachamama-aguas-calientes-prueba'), 'TPL', 37000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|economico|hostal-ejemplo-inti-lima-prueba', 'Lima', 'economico', 'Hostal Ejemplo Inti Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|hostal-ejemplo-inti-lima-prueba'), 'SGL', 5000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|hostal-ejemplo-inti-lima-prueba'), 'DBL', 6000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|hostal-ejemplo-inti-lima-prueba'), 'TPL', 8000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|economico|casa-ejemplo-killa-lima-prueba', 'Lima', 'economico', 'Casa Ejemplo Killa Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|casa-ejemplo-killa-lima-prueba'), 'SGL', 4500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|casa-ejemplo-killa-lima-prueba'), 'DBL', 5500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|economico|casa-ejemplo-killa-lima-prueba'), 'TPL', 7500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|confort|hotel-ejemplo-wayra-lima-prueba', 'Lima', 'confort', 'Hotel Ejemplo Wayra Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-wayra-lima-prueba'), 'SGL', 9500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-wayra-lima-prueba'), 'DBL', 11000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-wayra-lima-prueba'), 'TPL', 14000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|confort|hotel-ejemplo-nusta-lima-prueba', 'Lima', 'confort', 'Hotel Ejemplo Ñusta Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-nusta-lima-prueba'), 'SGL', 9000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-nusta-lima-prueba'), 'DBL', 10500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|confort|hotel-ejemplo-nusta-lima-prueba'), 'TPL', 13500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|premium|gran-hotel-ejemplo-apu-lima-prueba', 'Lima', 'premium', 'Gran Hotel Ejemplo Apu Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|gran-hotel-ejemplo-apu-lima-prueba'), 'SGL', 22000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|gran-hotel-ejemplo-apu-lima-prueba'), 'DBL', 25000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|gran-hotel-ejemplo-apu-lima-prueba'), 'TPL', 31000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('lima|premium|hotel-ejemplo-pachamama-lima-prueba', 'Lima', 'premium', 'Hotel Ejemplo Pachamama Lima (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|hotel-ejemplo-pachamama-lima-prueba'), 'SGL', 20000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|hotel-ejemplo-pachamama-lima-prueba'), 'DBL', 23000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'lima|premium|hotel-ejemplo-pachamama-lima-prueba'), 'TPL', 29000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|economico|hostal-ejemplo-inti-puno-prueba', 'Puno', 'economico', 'Hostal Ejemplo Inti Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|hostal-ejemplo-inti-puno-prueba'), 'SGL', 3500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|hostal-ejemplo-inti-puno-prueba'), 'DBL', 4500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|hostal-ejemplo-inti-puno-prueba'), 'TPL', 6000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|economico|casa-ejemplo-killa-puno-prueba', 'Puno', 'economico', 'Casa Ejemplo Killa Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|casa-ejemplo-killa-puno-prueba'), 'SGL', 3200, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|casa-ejemplo-killa-puno-prueba'), 'DBL', 4200, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|economico|casa-ejemplo-killa-puno-prueba'), 'TPL', 5600, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|confort|hotel-ejemplo-wayra-puno-prueba', 'Puno', 'confort', 'Hotel Ejemplo Wayra Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-wayra-puno-prueba'), 'SGL', 7000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-wayra-puno-prueba'), 'DBL', 8500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-wayra-puno-prueba'), 'TPL', 11000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|confort|hotel-ejemplo-nusta-puno-prueba', 'Puno', 'confort', 'Hotel Ejemplo Ñusta Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-nusta-puno-prueba'), 'SGL', 6500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-nusta-puno-prueba'), 'DBL', 8000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|confort|hotel-ejemplo-nusta-puno-prueba'), 'TPL', 10500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|premium|gran-hotel-ejemplo-apu-puno-prueba', 'Puno', 'premium', 'Gran Hotel Ejemplo Apu Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|gran-hotel-ejemplo-apu-puno-prueba'), 'SGL', 15000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|gran-hotel-ejemplo-apu-puno-prueba'), 'DBL', 17500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|gran-hotel-ejemplo-apu-puno-prueba'), 'TPL', 22000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');
INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo) VALUES ('puno|premium|hotel-ejemplo-pachamama-puno-prueba', 'Puno', 'premium', 'Hotel Ejemplo Pachamama Puno (prueba)', 1) ON CONFLICT (clave) DO UPDATE SET activo = 1;
INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|hotel-ejemplo-pachamama-puno-prueba'), 'SGL', 14000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|hotel-ejemplo-pachamama-puno-prueba'), 'DBL', 16500, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)'),
  ((SELECT id FROM ct_hoteles WHERE clave = 'puno|premium|hotel-ejemplo-pachamama-puno-prueba'), 'TPL', 21000, 'USD', 'todas', '2026-01-01', '2027-12-31', 1, 'Seed de prueba (precios inventados)');

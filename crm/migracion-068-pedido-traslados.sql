-- Migración 068: traslados y trenes que pidió el cliente, en el pedido.
-- JSON: [{ "que": "Hotel → estación de tren (Ollantaytambo)", "dia": 3 | null, "modalidad": "PRI" | "GRU" }]
-- El armado los pone como línea en su día: con tarifa si el nombre es el de un servicio del tarifario
-- (traslado o tren); si no, línea sin precio que bloquea la aprobación hasta que alguien lo ponga.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-068-pedido-traslados.sql
ALTER TABLE ct_pedidos ADD COLUMN traslados TEXT NOT NULL DEFAULT '[]';

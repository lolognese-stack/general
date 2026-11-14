-- Fase 2 (cotizaciones dentro del CRM): "Nuevo pedido" desde el inbox.
-- dias: días que pidió el cliente (los destinos llevan noches; los dos pueden no coincidir y se avisa).
-- fecha_tentativa: 1 si fecha_inicio la eligió el equipo porque la tarifa necesita un día (el cliente no dio fecha).
-- conversacion_id: chat del Setter/Inbox del que salió el pedido (lead_id ya existía).
-- origen: inbox | manual | chat | excel.
ALTER TABLE ct_pedidos ADD COLUMN dias INTEGER;
ALTER TABLE ct_pedidos ADD COLUMN fecha_tentativa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ct_pedidos ADD COLUMN conversacion_id INTEGER;
ALTER TABLE ct_pedidos ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_ct_pedidos_lead ON ct_pedidos (lead_id);
CREATE INDEX IF NOT EXISTS idx_ct_pedidos_conversacion ON ct_pedidos (conversacion_id);

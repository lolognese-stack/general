-- Migración 066: pase del pedido a Álvaro (bandeja "Para cotizar").
-- nota_pase: lo que le escribe el equipo al pasarlo. urgente: va arriba en su bandeja. pasado_en: cuándo se le pasó (rojo a las 24 h).
ALTER TABLE ct_pedidos ADD COLUMN urgente INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ct_pedidos ADD COLUMN nota_pase TEXT;
ALTER TABLE ct_pedidos ADD COLUMN pasado_en TEXT;

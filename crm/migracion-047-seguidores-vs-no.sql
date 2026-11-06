-- Migración 047: views y alcance de la cuenta separados en seguidores y no
-- seguidores (la vista "Rendimiento" del Insights de Instagram). Los trae el
-- sync diario desde Windsor (views_followers, views_non_followers,
-- reach_followers, reach_non_followers). Meta avisa que seguidores + no
-- seguidores puede dar menos que el total.

ALTER TABLE metricas_cuenta_dia ADD COLUMN views_followers INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN views_non_followers INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN reach_followers INTEGER;
ALTER TABLE metricas_cuenta_dia ADD COLUMN reach_non_followers INTEGER;

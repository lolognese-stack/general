-- Migración 012: Fuente y Medio pasan a listas cerradas (FUENTES/MEDIOS en
-- el panel). 'DM' era el único valor de medio_agenda fuera de la lista
-- nueva -- pasa a 'Inbound' (la persona escribió).
UPDATE leads SET medio_agenda = 'Inbound' WHERE medio_agenda = 'DM';

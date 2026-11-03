-- Migración 013: MEDIOS renombra 'Inbound' a 'Seguidor' y suma 'DM' como
-- valor propio. Los 4 leads que la migración 012 había pasado de 'DM' a
-- 'Inbound' vuelven a 'DM' -- eran DMs comunes, no el caso específico de
-- "nuevo seguidor" que ahora es 'Seguidor'.
UPDATE leads SET medio_agenda = 'DM' WHERE medio_agenda = 'Inbound';

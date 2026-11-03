# luna-ig-sync

Worker que trae las métricas de Instagram de @lunallenatours desde Windsor.ai
y las escribe en la D1 `crm-plantilla` (tablas `piezas`, `metricas_cuenta_dia`,
`demografia_ig`, `piezas_metricas_dia`, `sync_runs`; migración 044). Con eso se
llena la sección Performance del panel.

Es una copia de `visite-web/sync-worker` (el de Visite). Si se arregla algo en
uno, pasarlo al otro.

Corre todos los días a las 5:00 AM Argentina (`0 8 * * *` UTC).

## Windsor

- La API key es de la cuenta de Windsor donde está conectada @lunallenatours
  (plan Forever Free: 1 fuente, 1 cuenta, 30 días hacia atrás). Va como secret
  `WINDSOR_API_KEY`.
- `WINDSOR_CUENTA` en `src/index.js` filtra por el id de la cuenta
  (`select_accounts`), así no se mezcla otra cuenta si se conecta.
- Si la key no tiene a @lunallenatours, los posts caen al plan B (perfil
  público, sin alcance ni guardados) y la serie diaria no se toca.
- Como el plan gratis solo da 30 días, la historia se arma en D1 día a día.

## Correr el sync a mano

```bash
curl -X POST "https://luna-ig-sync.lolognese.workers.dev/sync" \
  -H "x-crm-token: <CRM_TOKEN de .dev.vars>"
```

`GET /status` (mismo header) devuelve las últimas 30 corridas de `sync_runs`.

## Secrets

`.dev.vars` (fuera del repo) tiene `CRM_TOKEN` (solo protege `/sync` y
`/status`, no es el token del panel) y `WINDSOR_API_KEY`. Para rotarlos:

```bash
npx wrangler secret put CRM_TOKEN
npx wrangler secret put WINDSOR_API_KEY
```

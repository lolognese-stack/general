# Cotizador interno (Cotizaciones)

Lorenzo carga el pedido, el sistema arma el borrador y Álvaro lo revisa y aprueba desde el celular.
Página: `/cotizaciones-4c1f6a` (link "Cotizaciones" en el menú del panel). Todo es interno: netos y margen nunca salen
en nada que vea el cliente.

## Piezas

| Qué | Dónde |
|---|---|
| Tablas (`ct_*`) | `crm/migracion-056-cotizador-interno.sql` |
| Tarifas de prueba (precios inventados) | `crm/seed-cotizador-ilustrativo.sql` (lo genera `crm/generar-seed-cotizador.mjs`) |
| Lectura de planillas e importador | `functions/_lib/tarifario.js` · tests `node crm/probar-tarifario.mjs` |
| Cálculo y borrador automático | `functions/_lib/cotizar.js` · tests `node crm/probar-cotizar.mjs` |
| Pedidos, líneas, versiones | `functions/_lib/ct-cotizaciones.js` |
| Link de revisión | `functions/_lib/ct-revision.js`, `functions/api/revision/`, página `r/index.html` |
| Paso a la propuesta web | `functions/_lib/ct-propuesta.js` · tests `node crm/probar-propuesta.mjs` |
| API del CRM | `functions/api/ct/[[ruta]].js` (token del CRM) |

## Reglas

- Precio de una línea = tarifa vigente para la fecha, la temporada y el tamaño del grupo; PEN se pasa a USD con el tipo
  de cambio; venta = neto × (1 + margen). Las tarifas marcadas "precio de venta" (lo que opera Luna Llena) no llevan margen.
- Lo que se cambia a mano (neto, venta o margen de una línea, tarifas, configuración) queda en `ct_cambios_precio`
  con quién, cuándo y motivo. "Quién" lo elige cada dispositivo ("Soy Lorenzo / Soy Álvaro"); el link de revisión firma
  como "<revisor> (link)".
- Cada cotización guarda la configuración con la que se calculó (`config_json`). Aprobada = no se edita: versión nueva.
- PRECIOS DE PRUEBA: si una línea usa una tarifa de prueba o la cotización usa un valor de configuración sin confirmar.
  Se puede revisar y aprobar, pero no marcar como enviada ni pasar a la propuesta web.
- Link de revisión: `/r/#<token>`. El token va después del `#` (no llega al servidor ni queda en logs); en la base solo
  su SHA-256. Vence a los 30 días; generar uno nuevo invalida el anterior. Desde el link solo se tocan precios y notas.

## Propuesta web

Cotización aprobada → "Preparar propuesta web": texto para el armador (Cotizador › Propuesta del panel) y paquete
`.json` con el `propuesta.json`. En `luna-llena-propuestas`: `node scripts/desde-cotizacion.mjs paquete.json pagina.html`
(ver su README). No se publica sola: la página la arma la IA del armador y alguien la revisa antes de publicar.

## Publicar

1. `npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-056-cotizador-interno.sql`
2. Seed de prueba (opcional): `npx wrangler d1 execute crm-plantilla --remote --file crm/seed-cotizador-ilustrativo.sql`
3. Tarifas reales: pestaña Importar con "Reemplazar las de prueba" (no van en git: el repo es público).
4. Deploy del CRM con `deploy-demo.py` (flags de Luna Llena) y diff contra producción, como siempre.

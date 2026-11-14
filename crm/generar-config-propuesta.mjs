// Genera functions/_lib/propuesta-config.js desde luna-llena-propuestas/config.json.
// Uso: node crm/generar-config-propuesta.mjs [ruta/a/config.json]
// El config (agencia, pago, cancelación, FAQ, testimonios, términos) es fijo de la plantilla: vive en este módulo
// y se puede pisar desde el CRM con la clave 'plantilla' de propuestas_config (JSON parcial).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '', 'repo', 'luna-llena-propuestas', 'config.json');
const cfg = JSON.parse(fs.readFileSync(origen, 'utf8'));
const limpio = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') ? undefined : v)));
const salida = {
  agencia: limpio(cfg.agencia),
  sitio: cfg.sitio,
  calcomUrl: cfg.calcomUrl,
  terminos: limpio(cfg.terminos),
  pago: limpio(cfg.pago),
  cancelacion: limpio(cfg.cancelacion),
  faq: cfg.faq.map((f) => limpio(f)),
  testimonios: cfg.testimonios.map((t) => limpio(t)),
};
const cuerpo = `// GENERADO por crm/generar-config-propuesta.mjs desde luna-llena-propuestas/config.json: no editar a mano.
// Contenido fijo de la plantilla de propuesta (quiénes somos, cómo reservar, medios de pago, cancelación, FAQ,
// testimonios por tag, términos). null o [] = falta: se ve como placeholder solo en la vista previa.
export const CONFIG_PROPUESTA = ${JSON.stringify(salida, null, 2)};
`;
fs.writeFileSync(path.join(aqui, '..', 'functions', '_lib', 'propuesta-config.js'), cuerpo);
console.log('ok', Buffer.byteLength(cuerpo), 'bytes');

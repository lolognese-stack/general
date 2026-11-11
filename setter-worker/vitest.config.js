import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// La base de los tests: una tabla `leads` mínima (las columnas que el setter
// lee, como en crm/schema.sql + migraciones), la migración 039 real y la
// semilla de agentes de Luna Llena.
// Parte un .sql en sentencias: corta en ';' y saca comentarios '--', salvo
// dentro de un string ('...'), donde los prompts sí llevan ';'.
function sentencias(sql) {
  const out = [];
  let actual = '', enString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (enString) {
      actual += c;
      if (c === "'") enString = false;   // '' (comilla escapada) vuelve a abrir en la vuelta siguiente
    } else if (c === "'") {
      enString = true; actual += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      actual += '\n';
    } else if (c === ';') {
      if (actual.trim()) out.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

const leer = (ruta) => sentencias(readFileSync(new URL(ruta, import.meta.url), 'utf8'));
const SQL = [
  ...leer('./test/leads-minimo.sql'),
  ...leer('../crm/migracion-039-setter.sql'),
  ...leer('../crm/migracion-040-setter-archivos.sql'),
  ...leer('../crm/migracion-041-setter-calificacion.sql'),
  ...leer('../crm/migracion-043-setter-sugerencias.sql'),
  ...leer('../crm/migracion-051-conversacion-rol.sql'),
  ...leer('../crm/seed-setter-luna-llena.sql'),
  ...leer('../crm/seed-setter-catalogo.sql'),
];

export default defineConfig({
  // El primer test de cada archivo crea el esquema en D1: con la suite entera
  // en paralelo tarda más que los 5 s por defecto.
  test: { testTimeout: 20000 },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // El binding AI (Whisper) es siempre remoto: en los tests no se usa.
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_SQL: JSON.stringify(SQL),
          META_APP_SECRET: 'secreto-app',
          META_VERIFY_TOKEN: 'verificar-123',
          META_ACCESS_TOKEN: 'token-meta',
          META_PHONE_NUMBER_ID: '1111',
          SETTER_INTERNAL_SECRET: 'interno-xyz',
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SETTER_DEMORA: '',   // el .dev.vars local puede traer "instante"
          KAPSO_API_KEY: '',   // sin esto, el .dev.vars cambiaría el canal a Kapso
          KAPSO_WEBHOOK_SECRET: '',
          SOLO_NUMEROS: '',
          SETTER_FINDE_MARCA: '',   // los tests no dependen del día en que corren
          SETTER_SOLO_NOCHE: '',
        },
      },
    }),
  ],
});

import { execFile } from 'child_process';
import 'dotenv/config';
import fs from 'fs';

const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;
const TYPESENSE_HOST = 'https://typesense-commanderscrapper.fly.dev';

if (!TYPESENSE_API_KEY) {
  throw new Error('❌ Falta la variable de entorno TYPESENSE_API_KEY');
}

const schema = {
  name: 'cards',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'mana_cost', type: 'string', optional: true },
    { name: 'cmc', type: 'float', optional: true },
    { name: 'color_identity', type: 'string[]', optional: true },
    { name: 'colors', type: 'string[]', optional: true },
    { name: 'type_line', type: 'string' },
    { name: 'oracle_text', type: 'string', optional: true },
    { name: 'rarity', type: 'string' },
    { name: 'set', type: 'string' }
  ],
  default_sorting_field: 'cmc'
};

// Guardamos el schema en un archivo temporal
const tempPath = 'temp-schema.json';
fs.writeFileSync(tempPath, JSON.stringify(schema));

const args = [
  '-X', 'POST',
  `${TYPESENSE_HOST}/collections`,
  '-H', `X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}`,
  '-H', 'Content-Type: application/json',
  '--data-binary', `@${tempPath}`
];

execFile('curl.exe', args, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Error al ejecutar curl:', error);
    return;
  }

  if (stderr) {
    console.error('⚠️ Stderr:', stderr);
  }

  console.log('✅ Respuesta de Typesense:\n', stdout);
  fs.unlinkSync(tempPath); // Limpieza del archivo temporal
});

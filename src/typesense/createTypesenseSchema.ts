import { execFile } from 'child_process';
import 'dotenv/config';
import fs from 'fs';

const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;
const TYPESENSE_HOST = 'https://typesense-commanderscrapper.fly.dev';
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

if (!TYPESENSE_API_KEY) {
  throw new Error('❌ Falta la variable de entorno TYPESENSE_API_KEY');
}

const schema = {
  name: 'cards',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string', facet: true },
    { name: 'flavor_name', type: 'string', optional: true, facet: true },
    { name: 'face_name', type: 'string', optional: true, facet: true },
    { name: 'mana_cost', type: 'string', optional: true },
    { name: 'cmc', type: 'float', facet: true },
    { name: 'color_identity', type: 'string[]', optional: true, facet: true },
    { name: 'colors', type: 'string[]', optional: true, facet: true },
    { name: 'type_line', type: 'string', facet: true },
    { name: 'oracle_text', type: 'string', optional: true, facet: true },
    { name: 'rarity', type: 'string', facet: true },
    { name: 'set', type: 'string' }
  ],
  default_sorting_field: 'cmc'
};

const tempPath = 'temp-schema.json';
fs.writeFileSync(tempPath, JSON.stringify(schema));

const args = [
  '-X', 'POST',
  `${TYPESENSE_HOST}/collections`,
  '-H', `X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}`,
  '-H', 'Content-Type: application/json',
  '--data-binary', `@${tempPath}`
];

execFile(CURL, args, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Error al ejecutar curl:', error);
    fs.unlinkSync(tempPath);
    process.exit(1);
    return;
  }

  if (stderr) {
    console.warn('⚠️ Stderr:', stderr);
  }

  console.log('✅ Respuesta de Typesense:\n', stdout);
  fs.unlinkSync(tempPath);
});

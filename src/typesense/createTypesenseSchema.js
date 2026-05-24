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
        { name: 'name', type: 'string', facet: true }, // ← ✅
        { name: 'flavor_name', type: 'string', optional: true, facet: true }, // 👈 NUEVO
        { name: 'face_name', type: 'string', optional: true, facet: true }, // 👈 NUEVO
        { name: 'mana_cost', type: 'string', optional: true },
        { name: 'cmc', type: 'float', facet: true }, // ← ✅
        { name: 'color_identity', type: 'string[]', optional: true, facet: true }, // ← ✅
        { name: 'colors', type: 'string[]', optional: true, facet: true }, // ← ✅
        { name: 'type_line', type: 'string', facet: true }, // ← ✅ si querés filtrar por tipo
        { name: 'oracle_text', type: 'string', optional: true, facet: true }, // ← ✅ (opcional, solo si vas a filtrar por texto)
        { name: 'rarity', type: 'string', facet: true }, // ← ✅
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

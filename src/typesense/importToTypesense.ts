import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import 'dotenv/config';

const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;
const TYPESENSE_HOST = 'https://typesense-commanderscrapper.fly.dev';

if (!TYPESENSE_API_KEY) {
  throw new Error('❌ Falta la variable de entorno TYPESENSE_API_KEY');
}

const CHUNK_SIZE = 100;
const SCHEMA_NAME = 'cards';
const DATA_PATH = path.resolve('data/scryfall-reduced.json');

const raw = fs.readFileSync(DATA_PATH, 'utf8');
const parsed = JSON.parse(raw);
const allCards = JSON.parse(raw).cards; // ✅ Esto es lo correcto
console.log(Array.isArray(allCards), allCards.length);

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function importChunk(chunkData: any[], index: number) {
  const jsonl = chunkData.map(card => JSON.stringify(card)).join('\n');
  const tempFile = `temp_chunk_${index}.jsonl`;
  fs.writeFileSync(tempFile, jsonl);

  const args = [
    '-X', 'POST',
    `${TYPESENSE_HOST}/collections/${SCHEMA_NAME}/documents/import?action=upsert`,
    '-H', `X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}`,
    '-H', 'Content-Type: text/plain',
    '--data-binary', `@${tempFile}`
  ];

  return new Promise<void>((resolve, reject) => {
    execFile('curl.exe', args, (err, stdout, stderr) => {
      fs.unlinkSync(tempFile);
      if (err) {
        console.error(`❌ Error en el chunk ${index}:`, err);
        return reject(err);
      }

      if (stderr) {
        console.warn(`⚠️ stderr en el chunk ${index}:\n`, stderr);
      }

      console.log(`✅ Chunk ${index} importado:\n`, stdout.slice(0, 500));
      resolve();
    });
  });
}

async function importAll() {
  console.log(`📦 Importando ${allCards.length} cartas en bloques de ${CHUNK_SIZE}...`);
  const chunks = chunk([...allCards].reverse(), CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    await importChunk(chunks[i], i + 1);
  }

  console.log('🎉 Importación completa.');
}

importAll().catch(err => {
  console.error('💥 Falló la importación:', err);
});

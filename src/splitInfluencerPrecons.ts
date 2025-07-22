import fs from 'fs';
import path from 'path';

const INPUT_FILE = './data/influencer_precons.json'; // ruta original
const OUTPUT_DIR = './data/influencers/'; // carpeta donde guardar los subarchivos
const CHUNK_SIZE = 5;

function main() {
  const fullPath = path.resolve(INPUT_FILE);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const decks = JSON.parse(raw);

  if (!Array.isArray(decks)) {
    throw new Error('El archivo JSON no contiene un array válido.');
  }

  const chunks: any[][] = [];

  for (let i = 0; i < decks.length; i += CHUNK_SIZE) {
    chunks.push(decks.slice(i, i + CHUNK_SIZE));
  }

  chunks.forEach((chunk, index) => {
    const suffix = String(index).padStart(2, '0'); // 00, 01, 02...
    const outPath = path.join(OUTPUT_DIR, `influencer_precons_${suffix}.json`);
    fs.writeFileSync(outPath, JSON.stringify(chunk, null, 2), 'utf-8');
    console.log(`✅ Generado: influencer_precons_${suffix}.json con ${chunk.length} decks`);
  });

  console.log(`🎉 Proceso completado. Total: ${chunks.length} archivos.`);
}

main();

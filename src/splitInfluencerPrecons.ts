import fs from 'fs';
import path from 'path';

const INPUT_FILE = './data/influencer_precons.json'; // archivo de entrada
const OUTPUT_DIR = './data/influencers/'; // carpeta de salida
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

  // Crear carpeta si no existe
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  chunks.forEach((chunk, index) => {
    const suffix = String(index).padStart(2, '0'); // 00, 01, 02...
    const outPath = path.join(OUTPUT_DIR, `influencer_precons_${suffix}.json`);
    fs.writeFileSync(outPath, JSON.stringify(chunk, null, 2), 'utf-8');
    console.log(`✅ Generado: influencer_precons_${suffix}.json con ${chunk.length} decks`);
  });

  // 👉 Guardar archivo TOTAL.json con cantidad de archivos creados
  const totalFilePath = path.join(OUTPUT_DIR, 'TOTAL.json');
  fs.writeFileSync(totalFilePath, JSON.stringify({ total: chunks.length }, null, 2), 'utf-8');
  console.log(`📦 Archivo TOTAL.json creado con { total: ${chunks.length} }`);

  console.log(`🎉 Proceso completado. Total: ${chunks.length} archivos.`);
}

main();

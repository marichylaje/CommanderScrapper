import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import 'dotenv/config';

const INPUT_FILE = './data/influencer_precons_standardized.json'; // archivo de entrada
const OUTPUT_DIR = './data/influencers/'; // carpeta de salida
const CHUNK_SIZE = 5;

export type SplitOptions = {
  inputFile?: string;
  outputDir?: string;
  chunkSize?: number;
  log?: (msg: string) => void;
};

// Splits the standardized influencer decks into chunk files (influencer_precons_00.json...) plus TOTAL.json.
// Returns the number of files created, or null when the input file does not exist.
export function splitInfluencerPrecons(options: SplitOptions = {}): number | null {
  const inputFile = options.inputFile ?? INPUT_FILE;
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const log = options.log ?? console.log;

  const fullPath = path.resolve(inputFile);
  if (!fs.existsSync(fullPath)) {
    log(`⚠️  ${inputFile} not found — skipping influencer precon split.`);
    return null;
  }

  const decks = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  if (!Array.isArray(decks)) {
    throw new Error('El archivo JSON no contiene un array válido.');
  }

  const chunks: any[][] = [];
  for (let i = 0; i < decks.length; i += chunkSize) {
    chunks.push(decks.slice(i, i + chunkSize));
  }

  // Crear carpeta si no existe
  fs.mkdirSync(outputDir, { recursive: true });

  // Eliminar chunks anteriores para que no queden archivos huérfanos si ahora hay menos
  for (const file of fs.readdirSync(outputDir)) {
    if (/^influencer_precons_\d+\.json$/.test(file)) fs.unlinkSync(path.join(outputDir, file));
  }

  chunks.forEach((chunk, index) => {
    const suffix = String(index).padStart(2, '0'); // 00, 01, 02...
    const outPath = path.join(outputDir, `influencer_precons_${suffix}.json`);
    fs.writeFileSync(outPath, JSON.stringify(chunk, null, 2), 'utf-8');
    log(`✅ Generado: influencer_precons_${suffix}.json con ${chunk.length} decks`);
  });

  // 👉 Guardar archivo TOTAL.json con cantidad de archivos creados
  const totalFilePath = path.join(outputDir, 'TOTAL.json');
  fs.writeFileSync(totalFilePath, JSON.stringify({ total: chunks.length }, null, 2), 'utf-8');
  log(`📦 Archivo TOTAL.json creado con { total: ${chunks.length} }`);

  log(`🎉 Proceso completado. Total: ${chunks.length} archivos.`);
  return chunks.length;
}

// Only runs when invoked directly (npm run splitInfluencer), not when imported
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  splitInfluencerPrecons();
}

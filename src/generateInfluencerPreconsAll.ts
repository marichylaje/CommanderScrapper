import fs from 'fs';
import path from 'path';
import { syncInfluencerDecks } from './influencerDecks/sync.js';
import { ALL_TABS } from './influencerDecks/sheet.js';
import { standardizeInfluencerDecks } from './influencerDecks/standardize.js';
import { loadDescriptionsFromChunks, readChunkDecks } from './influencerDecks/chunks.js';
import { splitInfluencerPrecons } from './splitInfluencerPrecons.js';
import type { SheetTab } from './influencerDecks/types.js';

// Whole influencer pipeline:
//   Excel -> influencer_precons_all.json -> influencer_precons_standardized.json -> data/influencers/*.json
// Usage: npx tsx src/generateInfluencerPreconsAll.ts [Book.xlsx] [--out all.json] [--standardized file.json]
//        [--split-dir dir] [--tabs Moxfield,Archidekt,Others] [--dry-run] [--skip-split]
//        [--cleanup]              delete the all/standardized files once the chunks are written
//        [--allow-failed-decks]   do not exit with an error just because some decks could not be downloaded
//        [--min-decks-ratio 0.9]  abort (chunks untouched) if fewer than this share of the published decks
//                                 would remain, e.g. when a site blocks the downloads
const DEFAULT_XLSX = './data/Book.xlsx';
const DEFAULT_OUT = './data/influencer_precons_all.json';
const DEFAULT_STANDARDIZED = './data/influencer_precons_standardized.json';
const DEFAULT_SPLIT_DIR = './data/influencers/';

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const valueFlags = new Set(['--out', '--tabs', '--standardized', '--split-dir', '--min-decks-ratio']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));

  const tabsArg = readFlag(args, '--tabs');
  const tabs = tabsArg ? (tabsArg.split(',').map((t) => t.trim()) as SheetTab[]) : undefined;
  const invalid = tabs?.filter((t) => !ALL_TABS.includes(t));
  if (invalid?.length) throw new Error(`Pestañas inválidas: ${invalid.join(', ')} (válidas: ${ALL_TABS.join(', ')})`);

  const outFile = readFlag(args, '--out') ?? DEFAULT_OUT;
  const standardizedFile = readFlag(args, '--standardized') ?? DEFAULT_STANDARDIZED;
  const splitDir = readFlag(args, '--split-dir') ?? DEFAULT_SPLIT_DIR;
  const minRatio = Number(readFlag(args, '--min-decks-ratio') ?? 0);
  const dryRun = args.includes('--dry-run');
  const cleanup = args.includes('--cleanup') && !dryRun;

  try {
    const publishedDecks = readChunkDecks(splitDir).length;
    const report = await syncInfluencerDecks({
      xlsxPath: positional[0] ?? DEFAULT_XLSX,
      outFile,
      tabs,
      dryRun,
      fallbackDescriptions: loadDescriptionsFromChunks(splitDir),
    });

    if (!dryRun) {
      if (minRatio > 0 && report.total < publishedDecks * minRatio) {
        throw new Error(
          `Solo hay ${report.total} decks y hay ${publishedDecks} publicados (mínimo ${minRatio * 100}%): ` +
            'se aborta sin tocar los archivos de data/influencers.'
        );
      }
      // Decks that failed to download keep their previous version, so the later steps always run
      standardizeInfluencerDecks({ inputFile: outFile, outputFile: standardizedFile });
      if (!args.includes('--skip-split')) {
        splitInfluencerPrecons({ inputFile: standardizedFile, outputDir: splitDir });
      }
    }

    if (report.failed.length) {
      console.error(`\n❌ ${report.failed.length} decks fallaron:\n${report.failed.join('\n')}`);
      if (!args.includes('--allow-failed-decks')) process.exitCode = 1;
    }
    console.log(`⚠️  ${report.warnings.length} avisos.`);
  } finally {
    // The two big files are too large to be committed
    if (cleanup) {
      for (const file of [outFile, standardizedFile]) {
        fs.rmSync(path.resolve(file), { force: true });
        console.log(`🧹 Eliminado ${file}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

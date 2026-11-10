import { syncInfluencerDecks } from './influencerDecks/sync.js';
import { ALL_TABS } from './influencerDecks/sheet.js';
import { standardizeInfluencerDecks } from './influencerDecks/standardize.js';
import { splitInfluencerPrecons } from './splitInfluencerPrecons.js';
import type { SheetTab } from './influencerDecks/types.js';

// Whole influencer pipeline:
//   Excel -> influencer_precons_all.json -> influencer_precons_standardized.json -> data/influencers/*.json
// Usage: npx tsx src/generateInfluencerPreconsAll.ts [Book.xlsx] [--out all.json] [--standardized file.json]
//        [--split-dir dir] [--tabs Moxfield,Archidekt,Others] [--dry-run] [--skip-split]
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
  const valueFlags = new Set(['--out', '--tabs', '--standardized', '--split-dir']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));

  const tabsArg = readFlag(args, '--tabs');
  const tabs = tabsArg ? (tabsArg.split(',').map((t) => t.trim()) as SheetTab[]) : undefined;
  const invalid = tabs?.filter((t) => !ALL_TABS.includes(t));
  if (invalid?.length) throw new Error(`Pestañas inválidas: ${invalid.join(', ')} (válidas: ${ALL_TABS.join(', ')})`);

  const outFile = readFlag(args, '--out') ?? DEFAULT_OUT;
  const standardizedFile = readFlag(args, '--standardized') ?? DEFAULT_STANDARDIZED;
  const dryRun = args.includes('--dry-run');

  const report = await syncInfluencerDecks({
    xlsxPath: positional[0] ?? DEFAULT_XLSX,
    outFile,
    tabs,
    dryRun,
  });

  // Decks that failed to download keep their previous version, so the later steps always run
  if (!dryRun) {
    standardizeInfluencerDecks({ inputFile: outFile, outputFile: standardizedFile });
    if (!args.includes('--skip-split')) {
      splitInfluencerPrecons({
        inputFile: standardizedFile,
        outputDir: readFlag(args, '--split-dir') ?? DEFAULT_SPLIT_DIR,
      });
    }
  }

  if (report.failed.length) {
    console.error(`\n❌ ${report.failed.length} decks fallaron:\n${report.failed.join('\n')}`);
    process.exitCode = 1;
  }
  console.log(`⚠️  ${report.warnings.length} avisos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

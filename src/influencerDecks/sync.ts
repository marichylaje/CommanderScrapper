import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { ALL_TABS, normalizeHandle, readSheetRows } from './sheet.js';
import { sleep } from './utils.js';
import {
  DESCRIPTION_LANGS,
  type DeckDescription,
  type InfluencerDeck,
  type Platform,
  type SheetTab,
} from './types.js';

export type SyncOptions = {
  xlsxPath: string;
  outFile: string;
  tabs?: SheetTab[];
  // Instagram handles (e.g. "@someone") whose rows are skipped, per tab
  excludeHandlesByTab?: Partial<Record<SheetTab, string[]>>;
  // build everything but do not write outFile
  dryRun?: boolean;
  // Descriptions to reuse when outFile has no entry for a deck (e.g. outFile was deleted after the
  // last run); keyed by descriptionKey(influencerName, deckName)
  fallbackDescriptions?: Map<string, DeckDescription>;
  log?: (msg: string) => void;
};

export type SyncReport = {
  total: number;
  added: number;
  updated: number;
  removed: number;
  // decks that could not be downloaded; the previous version is kept when there is one
  failed: string[];
  warnings: string[];
};

export const DEFAULT_EXCLUDED_HANDLES: Partial<Record<SheetTab, string[]>> = {
  Others: ['@mtgcommanderlandau', '@hungry_hippo_mtg'],
};

// Tab a deck belonged to before `sheetTab` existed in the data
const LEGACY_TAB: Record<Platform, SheetTab> = {
  moxfield: 'Moxfield',
  archidekt: 'Archidekt',
  manabox: 'Others',
  aetherhub: 'Others',
  deckstats: 'Others',
};

const deckKey = (d: InfluencerDeck) => `${d.source.platform}:${d.source.deckId}`;
const tabOf = (d: InfluencerDeck): SheetTab => d.source.sheetTab ?? LEGACY_TAB[d.source.platform];
const emptyDescription = () =>
  Object.fromEntries(DESCRIPTION_LANGS.map((l) => [l, ''])) as DeckDescription;
const hasDescription = (d: DeckDescription | undefined) => !!d && Object.values(d).some((v) => v);

export const descriptionKey = (influencerName: string, deckName: string) =>
  `${influencerName.trim().toLowerCase()}|${deckName.trim().toLowerCase()}`;

function loadExisting(outFile: string): InfluencerDeck[] {
  if (!fs.existsSync(outFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  return Array.isArray(parsed) ? parsed : [];
}

// Reads the influencer workbook, downloads each deck from its site and merges the result into
// `outFile`. Decks already in the file are updated in place (generated deckDescriptions are kept),
// decks removed from the sheet are dropped, and decks that fail to download keep their last version.
export async function syncInfluencerDecks(options: SyncOptions): Promise<SyncReport> {
  const log = options.log ?? console.log;
  const tabs = options.tabs ?? ALL_TABS;
  const excluded = { ...DEFAULT_EXCLUDED_HANDLES, ...options.excludeHandlesByTab };
  const xlsxPath = path.resolve(options.xlsxPath);
  const outFile = path.resolve(options.outFile);

  if (!fs.existsSync(xlsxPath)) throw new Error(`No se encuentra el Excel: ${xlsxPath}`);

  const report: SyncReport = { total: 0, added: 0, updated: 0, removed: 0, failed: [], warnings: [] };
  const warn = (msg: string) => {
    report.warnings.push(msg);
    log(`⚠️  ${msg}`);
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  const existing = loadExisting(outFile);
  const existingByKey = new Map(existing.map((d) => [deckKey(d), d]));

  const fresh = new Map<string, InfluencerDeck[]>(); // tab -> decks, in sheet order
  const seen = new Map<string, string>(); // deck key -> "tab fila N"
  const lastRequestAt = new Map<string, number>();

  for (const tab of tabs) {
    const ws = wb.getWorksheet(tab);
    if (!ws) throw new Error(`No existe la pestaña "${tab}"`);
    const decks: InfluencerDeck[] = [];
    fresh.set(tab, decks);
    const excludedHandles = new Set((excluded[tab] ?? []).map(normalizeHandle));
    log(`\n📄 Pestaña ${tab}`);

    for (const row of readSheetRows(ws)) {
      const where = `${tab} fila ${row.rowNum} (${row.influencerName || 'sin nombre'})`;
      const socialHandles = [row.handle, row.socialNetworks[0].instagram ?? ''].map(normalizeHandle);
      if (socialHandles.some((h) => excludedHandles.has(h))) {
        log(`⏭️  ${where}: influencer excluido`);
        continue;
      }
      for (const issue of row.issues) warn(`${where}: ${issue}`);
      if (row.links.length === 0) {
        warn(`${where}: sin links de mazos descargables`);
        continue;
      }

      for (const link of row.links) {
        const key = `${link.provider.platform}:${link.id}`;
        if (seen.has(key)) {
          warn(`${where}: deck ${link.url} duplicado (ya en ${seen.get(key)}), omitido`);
          continue;
        }
        seen.set(key, where);

        // be polite with each site: at least delayMs between two requests to it
        const wait = (lastRequestAt.get(link.provider.platform) ?? 0) + link.provider.delayMs - Date.now();
        if (wait > 0) await sleep(wait);

        let fetched;
        try {
          fetched = await link.provider.fetchDeck(link.id);
        } catch (e) {
          const msg = `${where}: no se pudo descargar ${link.url} (${(e as Error).message})`;
          report.failed.push(msg);
          warn(msg);
          const previous = existingByKey.get(key);
          if (previous) decks.push(previous);
          continue;
        } finally {
          lastRequestAt.set(link.provider.platform, Date.now());
        }

        const label = `${fetched.name} [${link.url}]`;
        for (const w of fetched.warnings) warn(`${where}: ${label}: ${w}`);
        const { commanders, cards } = fetched;
        if (commanders.length === 0) warn(`${where}: ${label}: sin commander`);
        if (commanders.length > 2) warn(`${where}: ${label}: ${commanders.length} commanders, solo se usan 2`);
        if (fetched.format && fetched.format !== 'commander') warn(`${where}: ${label}: formato "${fetched.format}"`);
        const total = cards.reduce((n, c) => n + c.count, 0) + commanders.length;
        if (total !== 100) warn(`${where}: ${label}: suma ${total} cartas (con commander)`);

        const previous = existingByKey.get(key);
        const reusable = hasDescription(previous?.deckDescription)
          ? previous!.deckDescription
          : options.fallbackDescriptions?.get(descriptionKey(row.influencerName, fetched.name));
        const deck: InfluencerDeck = {
          name: fetched.name,
          commander: commanders[0]?.name ?? '',
          ...(commanders[1] ? { partner: commanders[1].name } : {}),
          influencerName: row.influencerName,
          socialNetworks: row.socialNetworks,
          deckDescription: reusable ?? emptyDescription(),
          cards,
          source: {
            platform: link.provider.platform,
            deckId: link.id,
            url: link.url,
            commanders,
            ...(fetched.description ? { description: fetched.description } : {}),
            sheetTab: tab,
            sheetRow: row.rowNum,
            ...(row.note ? { sheetNote: row.note } : {}),
          },
        };
        decks.push(deck);
        log(`✅ ${where}: ${fetched.name} (${total} cartas)`);
      }
    }
  }

  // Tabs that were not synced keep their decks untouched
  const merged: InfluencerDeck[] = [];
  for (const tab of ALL_TABS) {
    merged.push(...(fresh.get(tab) ?? existing.filter((d) => tabOf(d) === tab)));
  }
  merged.push(...existing.filter((d) => !ALL_TABS.includes(tabOf(d))));

  const mergedKeys = new Set(merged.map(deckKey));
  for (const d of merged) {
    const prev = existingByKey.get(deckKey(d));
    if (!prev) report.added++;
    else if (JSON.stringify(prev) !== JSON.stringify(d)) report.updated++;
  }
  report.removed = existing.filter((d) => !mergedKeys.has(deckKey(d))).length;
  report.total = merged.length;

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), 'utf-8');
  }
  log(
    `\n📦 ${merged.length} decks en ${outFile} (nuevos: ${report.added}, actualizados: ${report.updated}, eliminados: ${report.removed})`
  );
  return report;
}

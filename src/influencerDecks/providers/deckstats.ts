import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { httpGetJson, httpGetText, mergeCards } from '../utils.js';
import { resolvePrintings } from '../scryfall.js';

type TxtLine = { set: string | null; name: string };

// The JSON API exposes collector numbers but only an internal numeric set id; the plain-text
// export exposes set codes but no collector numbers. Both list the cards in the same order.
function parseTxtSection(txt: string, wanted: string): TxtLine[] {
  const lines: TxtLine[] = [];
  let section = 'Main';
  for (const line of txt.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    // sideboard lines are prefixed with "SB:"
    const isSideboardLine = /^SB:\s*/i.test(trimmed);
    trimmed = trimmed.replace(/^SB:\s*/i, '');
    const m = trimmed.match(/^(\d+)\s+(?:\[([^\]]+)\]\s+)?(.+)$/);
    if (!m) {
      section = trimmed;
      continue;
    }
    const current = isSideboardLine ? 'sideboard' : section.toLowerCase();
    if (current === wanted) lines.push({ set: m[2]?.toLowerCase() ?? null, name: m[3].trim() });
  }
  return lines;
}

type RawEntry = {
  name: string;
  count: number;
  isCommander: boolean;
  set: string | null;
  collectorNumber: string | null;
};

function toRawEntries(jsonCards: any[], txtLines: TxtLine[], label: string, warnings: string[]): RawEntry[] {
  const aligned =
    txtLines.length === jsonCards.length &&
    jsonCards.every((c, i) => c.name.toLowerCase() === txtLines[i].name.toLowerCase());
  if (!aligned && jsonCards.length) {
    warnings.push(`${label}: la exportación de texto no coincide con el JSON; sin códigos de set`);
  }
  return jsonCards.map((c, i) => {
    const set = aligned ? txtLines[i].set : null;
    return {
      name: c.name as string,
      count: c.amount as number,
      isCommander: !!c.isCommander,
      set,
      // Without a set code the collector number alone does not identify a printing
      collectorNumber: set && c.collector_number != null ? String(c.collector_number) : null,
    };
  });
}

export const deckstatsProvider: DeckProvider = {
  platform: 'deckstats',
  delayMs: 800,

  parseUrl(url) {
    const m = url.match(/deckstats\.net\/decks\/(\d+)\/(\d+)/i);
    return m ? { id: `${m[1]}/${m[2]}`, url: `https://deckstats.net/decks/${m[1]}/${m[2]}` } : null;
  },

  async fetchDeck(id) {
    const [owner, deckId] = id.split('/');
    const deck = await httpGetJson(
      `https://deckstats.net/api.php?action=get_deck&id_type=saved&owner_id=${owner}&id=${deckId}&response_type=json`
    );
    // the numeric deck id must be followed by a slug-like suffix, otherwise the site serves the HTML page
    const txt = await httpGetText(`https://deckstats.net/decks/${owner}/${deckId}-deck/?export_txt=1`);
    const warnings: string[] = [];

    const mainJson: any[] = (deck.sections ?? []).flatMap((s: any) => s.cards ?? []);
    const sideJson: any[] = deck.sideboard ?? [];
    const raw = [
      ...toRawEntries(mainJson, parseTxtSection(txt, 'main'), 'main', warnings),
      ...toRawEntries(sideJson, parseTxtSection(txt, 'sideboard'), 'sideboard', warnings),
    ];

    const resolved = await resolvePrintings(raw);
    const withIds = raw.map((c, i) => ({
      ...c,
      set: resolved[i]?.set ?? c.set,
      collectorNumber: resolved[i]?.collectorNumber ?? c.collectorNumber,
      scryfallId: resolved[i]?.scryfallId ?? null,
    }));
    const noPrinting = withIds.filter((c) => !c.scryfallId);
    if (noPrinting.length) {
      warnings.push(`${noPrinting.length} cartas sin impresión exacta: ${noPrinting.map((c) => c.name).join(', ')}`);
    }

    const toPrinting = (c: (typeof withIds)[number]) => ({
      set: c.set,
      collectorNumber: c.collectorNumber,
      scryfallId: c.scryfallId,
      finish: 'normal' as const,
    });
    const main = withIds.slice(0, mainJson.length);
    const side = withIds.slice(mainJson.length);

    const commanders: CommanderRef[] = main.filter((c) => c.isCommander).map((c) => ({ name: c.name, ...toPrinting(c) }));
    const cards: Card[] = main
      .filter((c) => !c.isCommander)
      .map((c) => ({ name: c.name, count: c.count, ...toPrinting(c) }));
    const sideboard: Card[] = side.map((c) => ({ name: c.name, count: c.count, ...toPrinting(c) }));

    if (deck.number_maybe) warnings.push(`maybeboard tiene ${deck.number_maybe} cartas (no incluidas)`);

    return {
      name: String(deck.name).trim(),
      commanders,
      cards: mergeCards(cards),
      sideboard: mergeCards(sideboard),
      warnings,
    };
  },
};

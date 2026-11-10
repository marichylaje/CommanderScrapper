import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { httpGetJson, mergeCards, toFinish } from '../utils.js';

const COMMANDER_FORMAT_ID = 3;
// Users create their own commander categories ("Commanders 1.", "Commanders 2."...); the ones
// flagged as not part of the deck are alternates and are skipped.
const COMMANDER_CATEGORY = /^commanders?\b/i;
const HIDDEN_CATEGORY = /^(sideboard|maybeboard|tokens & extras)$/i;

// Archidekt stores descriptions as Quill deltas: {"ops":[{"insert":"text\n"}]}
function descriptionText(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const ops = JSON.parse(raw)?.ops;
    if (Array.isArray(ops)) {
      const text = ops.map((o: any) => (typeof o.insert === 'string' ? o.insert : '')).join('').trim();
      return text || undefined;
    }
  } catch {
    // not a delta: use as plain text
  }
  return raw.trim();
}

export const archidektProvider: DeckProvider = {
  platform: 'archidekt',
  delayMs: 500,

  parseUrl(url) {
    const m = url.match(/archidekt\.com\/decks\/(\d+)/i);
    return m ? { id: m[1], url: `https://archidekt.com/decks/${m[1]}` } : null;
  },

  async fetchDeck(id) {
    const deck = await httpGetJson(`https://archidekt.com/api/decks/${id}/`);
    const warnings: string[] = [];

    // Sideboard, maybeboard, "Tokens & Extras"... are categories flagged as not part of the deck
    const excluded = new Set<string>(
      (deck.categories ?? []).filter((c: any) => c.includedInDeck === false).map((c: any) => c.name)
    );

    const commanders: CommanderRef[] = [];
    const cards: Card[] = [];
    const skipped = new Map<string, number>();

    for (const entry of deck.cards ?? []) {
      const categories: string[] = entry.categories ?? [];
      const printing = {
        set: entry.card.edition?.editioncode ?? null,
        collectorNumber: entry.card.collectorNumber != null ? String(entry.card.collectorNumber) : null,
        scryfallId: entry.card.uid ?? null,
        finish: toFinish(entry.modifier),
      };
      const name: string = entry.card.oracleCard.name;

      if (categories.some((c) => COMMANDER_CATEGORY.test(c) && !excluded.has(c))) {
        commanders.push({ name, ...printing });
        continue;
      }
      const hidden = categories.find((c) => excluded.has(c) || HIDDEN_CATEGORY.test(c));
      if (hidden) {
        skipped.set(hidden, (skipped.get(hidden) ?? 0) + entry.quantity);
        continue;
      }
      cards.push({ name, count: entry.quantity, ...printing });
    }

    for (const [category, count] of skipped) warnings.push(`"${category}" tiene ${count} cartas (no incluidas)`);

    return {
      name: String(deck.name).trim(),
      description: descriptionText(deck.description),
      format: deck.deckFormat === COMMANDER_FORMAT_ID ? 'commander' : `archidekt-format-${deck.deckFormat}`,
      commanders,
      cards: mergeCards(cards),
      warnings,
    };
  },
};

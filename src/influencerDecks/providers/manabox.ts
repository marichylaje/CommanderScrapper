import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { decodeHtml, httpGetText, mergeCards, toFinish } from '../utils.js';

// ManaBox "boardCategory" enum (from its deck page bundle): commander 0, oathbreaker 1,
// signatureSpell 2, mainboard 3, sideboard 4, maybeboard 5
const BOARD_COMMANDER = 0;
const BOARD_MAIN = 3;
const BOARD_SIDEBOARD = 4;
const BOARD_NAMES: Record<number, string> = { 1: 'oathbreaker', 2: 'signatureSpell', 5: 'maybeboard' };

const SCRYFALL_ID = /scryfall\.io\/[a-z_]+\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})/i;

// Astro serialises island props as [type, value] pairs: 0 = plain value, 1 = array
function unwrap(v: any): any {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    if (v[0] === 0) return unwrap(v[1]);
    if (v[0] === 1) return (v[1] as any[]).map(unwrap);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  }
  return v;
}

export const manaboxProvider: DeckProvider = {
  platform: 'manabox',
  delayMs: 500,

  parseUrl(url) {
    const m = url.match(/manabox\.app\/decks\/([A-Za-z0-9_-]+)/i);
    if (!m) return null;
    let id = m[1];
    if (id.length > 22 && id.endsWith('-')) id = id.slice(0, -1);
    return { id, url: `https://manabox.app/decks/${id}` };
  },

  async fetchDeck(id) {
    const html = await httpGetText(`https://manabox.app/decks/${id}`, { accept: 'text/html' });
    const island = html.match(/<astro-island[^>]*component-export="Main"[^>]*props="([^"]*)"/);
    if (!island) throw new Error('no se encontró la lista de cartas en la página');
    const deck = unwrap(JSON.parse(decodeHtml(island[1]))).deck;
    const warnings: string[] = [];

    const commanders: CommanderRef[] = [];
    const cards: Card[] = [];
    const sideboard: Card[] = [];
    const skipped = new Map<number, number>();

    for (const c of deck.cards ?? []) {
      const printing = {
        set: c.setId ?? null,
        collectorNumber: c.collectorNumber != null ? String(c.collectorNumber) : null,
        scryfallId: (c.images?.[0]?.imageUrlNormal ?? '').match(SCRYFALL_ID)?.[1] ?? null,
        finish: toFinish(c.variant),
      };
      if (c.boardCategory === BOARD_COMMANDER) {
        commanders.push({ name: c.name, ...printing });
      } else if (c.boardCategory === BOARD_MAIN) {
        cards.push({ name: c.name, count: c.quantity, ...printing });
      } else if (c.boardCategory === BOARD_SIDEBOARD) {
        sideboard.push({ name: c.name, count: c.quantity, ...printing });
      } else {
        skipped.set(c.boardCategory, (skipped.get(c.boardCategory) ?? 0) + c.quantity);
      }
    }
    for (const [category, count] of skipped) {
      warnings.push(`${BOARD_NAMES[category] ?? `boardCategory ${category}`} tiene ${count} cartas (no incluidas)`);
    }

    return {
      name: String(deck.name).trim(),
      format: typeof deck.format === 'string' ? deck.format.toLowerCase() : undefined,
      commanders,
      cards: mergeCards(cards),
      sideboard: mergeCards(sideboard),
      warnings,
    };
  },
};

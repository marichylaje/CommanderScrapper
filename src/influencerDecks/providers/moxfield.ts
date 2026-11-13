import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { httpGetJson, mergeCards, toFinish } from '../utils.js';

export const moxfieldProvider: DeckProvider = {
  platform: 'moxfield',
  delayMs: 800,

  parseUrl(url) {
    const m = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
    if (!m) return null;
    let id = m[1];
    // a " - " separator glued to the id (e.g. "...Vg-") is not part of it
    if (id.length > 22 && id.endsWith('-')) id = id.slice(0, -1);
    return { id, url: `https://moxfield.com/decks/${id}` };
  },

  async fetchDeck(id) {
    const deck = await httpGetJson(`https://api2.moxfield.com/v3/decks/all/${id}`);
    const warnings: string[] = [];

    const commanders: CommanderRef[] = (Object.values(deck.boards?.commanders?.cards ?? {}) as any[]).map((c) => ({
      name: c.card.name,
      set: c.card.set,
      collectorNumber: String(c.card.cn),
      scryfallId: c.card.scryfall_id,
      finish: toFinish(c.finish),
    }));
    // Moxfield's "main" card is the primary commander; the board order is arbitrary
    const mainIdx = commanders.findIndex((c) => c.scryfallId === deck.main?.scryfall_id);
    if (mainIdx > 0) commanders.unshift(...commanders.splice(mainIdx, 1));

    const readBoard = (board: string): Card[] =>
      (Object.values(deck.boards?.[board]?.cards ?? {}) as any[]).map((e) => ({
        name: e.card.name,
        count: e.quantity,
        set: e.card.set,
        collectorNumber: String(e.card.cn),
        scryfallId: e.card.scryfall_id,
        finish: toFinish(e.finish),
      }));

    for (const board of ['maybeboard', 'companions']) {
      if (deck.boards?.[board]?.count) warnings.push(`${board} tiene ${deck.boards[board].count} cartas (no incluidas)`);
    }

    return {
      name: String(deck.name).trim(),
      description: typeof deck.description === 'string' ? deck.description.trim() : undefined,
      format: deck.format,
      commanders,
      cards: mergeCards(readBoard('mainboard')),
      sideboard: mergeCards(readBoard('sideboard')),
      warnings,
    };
  },
};

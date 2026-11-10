import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { httpGetJson, httpGetText, mergeCards } from '../utils.js';
import { resolvePrintings } from '../scryfall.js';

type TxtLine = { set: string | null; name: string };

// The JSON API exposes collector numbers but only an internal numeric set id; the plain-text
// export exposes set codes but no collector numbers. Both list the cards in the same order.
function parseTxtMain(txt: string): TxtLine[] {
  const lines: TxtLine[] = [];
  let section = 'Main';
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const m = trimmed.match(/^(\d+)\s+(?:\[([^\]]+)\]\s+)?(.+)$/);
    if (!m) {
      section = trimmed;
      continue;
    }
    if (section.toLowerCase() === 'main') lines.push({ set: m[2]?.toLowerCase() ?? null, name: m[3].trim() });
  }
  return lines;
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

    const jsonCards: any[] = (deck.sections ?? []).flatMap((s: any) => s.cards ?? []);
    const txtLines = parseTxtMain(txt);
    const aligned =
      txtLines.length === jsonCards.length &&
      jsonCards.every((c, i) => c.name.toLowerCase() === txtLines[i].name.toLowerCase());
    if (!aligned) warnings.push('la exportación de texto no coincide con el JSON; sin códigos de set');

    const raw = jsonCards.map((c, i) => ({
      name: c.name as string,
      count: c.amount as number,
      isCommander: !!c.isCommander,
      set: aligned ? txtLines[i].set : null,
      collectorNumber: c.collector_number != null ? String(c.collector_number) : null,
    }));
    // Without a set code the collector number alone does not identify a printing
    for (const c of raw) if (!c.set) c.collectorNumber = null;

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
    const commanders: CommanderRef[] = withIds.filter((c) => c.isCommander).map((c) => ({ name: c.name, ...toPrinting(c) }));
    const cards: Card[] = withIds
      .filter((c) => !c.isCommander)
      .map((c) => ({ name: c.name, count: c.count, ...toPrinting(c) }));

    if (deck.number_sideboard) warnings.push(`sideboard tiene ${deck.number_sideboard} cartas (no incluidas)`);
    if (deck.number_maybe) warnings.push(`maybeboard tiene ${deck.number_maybe} cartas (no incluidas)`);

    return { name: String(deck.name).trim(), commanders, cards: mergeCards(cards), warnings };
  },
};

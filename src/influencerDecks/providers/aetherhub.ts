import type { Card, CommanderRef, DeckProvider } from '../types.js';
import { decodeHtml, httpGetText, mergeCards } from '../utils.js';
import { resolvePrintings } from '../scryfall.js';

type RawCard = { name: string; set: string; collectorNumber: string };

export const aetherhubProvider: DeckProvider = {
  platform: 'aetherhub',
  delayMs: 800,

  parseUrl(url) {
    const m = url.match(/aetherhub\.com\/Deck\/([^\s/?#]+)/i);
    return m ? { id: m[1], url: `https://aetherhub.com/Deck/${m[1]}` } : null;
  },

  async fetchDeck(id) {
    const html = await httpGetText(`https://aetherhub.com/Deck/${id}`, { accept: 'text/html' });
    const warnings: string[] = [];

    const title = decodeHtml(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').trim();
    const [format, ...rest] = title.split(' - ');
    const name = rest.length ? rest.join(' - ').trim() : title;

    // The "visual" tab lists every copy of every card, grouped by section ("Commander", "Main"...)
    const startMatch = /id="tab_visual_\d+"/.exec(html);
    if (!startMatch) throw new Error('no se encontró la lista de cartas en la página');
    const start = startMatch.index;
    const end = html.indexOf('id="tab_cmc_', start);
    const visual = html.slice(start, end > start ? end : undefined);

    const headings = [...visual.matchAll(/<h5>\s*([^<]*?)\s*<\/h5>/g)];
    const commanderRaw: RawCard[] = [];
    const mainRaw: RawCard[] = [];
    const sideboardRaw: RawCard[] = [];
    const skipped: string[] = [];

    headings.forEach((h, i) => {
      const section = visual.slice(h.index!, headings[i + 1]?.index ?? visual.length);
      const [, kind, declared] = h[1].match(/^(.+?)\s+(\d+)\s+cards?/i) ?? [];
      const raw: RawCard[] = [
        ...section.matchAll(/data-card-name="([^"]*)"\s+data-card-set="([^"]*)"\s+data-card-number="([^"]*)"/g),
      ].map((m) => ({ name: decodeHtml(m[1]), set: m[2].toLowerCase(), collectorNumber: m[3] }));

      if (/^commander/i.test(kind ?? '')) commanderRaw.push(...raw);
      else if (/^main/i.test(kind ?? '')) mainRaw.push(...raw);
      else if (/^sideboard/i.test(kind ?? '')) sideboardRaw.push(...raw);
      else skipped.push(`${h[1]}`);
      if (declared && /^(commander|main|sideboard)/i.test(kind ?? '') && raw.length !== Number(declared)) {
        warnings.push(`"${h[1]}" declara ${declared} cartas pero se leyeron ${raw.length}`);
      }
    });
    for (const s of skipped) warnings.push(`sección "${s}" no incluida`);

    const allRaw = [...commanderRaw, ...mainRaw, ...sideboardRaw];
    const resolved = await resolvePrintings(allRaw);
    const withIds = allRaw.map((r, i) => ({
      name: r.name,
      set: resolved[i]?.set ?? r.set,
      collectorNumber: resolved[i]?.collectorNumber ?? r.collectorNumber,
      scryfallId: resolved[i]?.scryfallId ?? null,
      finish: 'normal' as const,
    }));
    const missing = withIds.filter((c) => !c.scryfallId);
    if (missing.length) {
      warnings.push(`${missing.length} cartas sin scryfallId: ${[...new Set(missing.map((c) => c.name))].join(', ')}`);
    }

    const mainEnd = commanderRaw.length + mainRaw.length;
    const commanders: CommanderRef[] = withIds.slice(0, commanderRaw.length);
    const cards: Card[] = withIds.slice(commanderRaw.length, mainEnd).map((c) => ({ ...c, count: 1 }));
    const sideboard: Card[] = withIds.slice(mainEnd).map((c) => ({ ...c, count: 1 }));

    return {
      name,
      format: format?.toLowerCase(),
      commanders,
      cards: mergeCards(cards),
      sideboard: mergeCards(sideboard),
      warnings,
    };
  },
};

export type Platform = 'moxfield' | 'archidekt' | 'manabox' | 'aetherhub' | 'deckstats';
export type SheetTab = 'Moxfield' | 'Archidekt' | 'Others';

export type Finish = 'normal' | 'foil' | 'etched';

// set/collectorNumber/scryfallId are null only when the source site does not expose the printing
export type CardPrinting = {
  set: string | null;
  collectorNumber: string | null;
  scryfallId: string | null;
  // sites that do not expose the finish (Aetherhub, Deckstats) are reported as "normal"
  finish: Finish;
};

export type Card = { name: string; count: number } & CardPrinting;
export type CommanderRef = { name: string } & CardPrinting;

export const DESCRIPTION_LANGS = ['en', 'es', 'it', 'de', 'ja', 'pt', 'fr'] as const;
export type DeckDescription = Record<(typeof DESCRIPTION_LANGS)[number], string>;

export type InfluencerDeck = {
  name: string;
  commander: string;
  partner?: string;
  influencerName: string;
  socialNetworks: { instagram: string | null; tiktok: string | null; youtube: string | null }[];
  deckDescription: DeckDescription;
  cards: Card[];
  source: {
    platform: Platform;
    deckId: string;
    url: string;
    commanders: CommanderRef[];
    description?: string;
    sheetTab: SheetTab;
    sheetRow: number;
    sheetNote?: string;
  };
};

export type FetchedDeck = {
  name: string;
  description?: string;
  format?: string;
  commanders: CommanderRef[];
  cards: Card[];
  warnings: string[];
};

export interface DeckProvider {
  platform: Platform;
  // pause between consecutive requests to the same site
  delayMs: number;
  parseUrl(url: string): { id: string; url: string } | null;
  fetchDeck(id: string): Promise<FetchedDeck>;
}

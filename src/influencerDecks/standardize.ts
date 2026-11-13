import fs from 'fs';
import path from 'path';
import type { CardPrinting, DeckDescription, InfluencerDeck } from './types.js';

// Deck shape consumed by the frontend (same as the former influencer_precons.json)
export type FrontendDeck = {
  name: string;
  commander: string;
  partner?: string;
  influencerName: string;
  socialNetworks: InfluencerDeck['socialNetworks'];
  deckDescription: DeckDescription;
  cards: { name: string; count: number }[];
  sideboard: { name: string; count: number }[];
};

const FINISH_TAG: Record<CardPrinting['finish'], string> = { normal: '', foil: '*F*', etched: '*E*' };

// "[Cantidad] [Nombre] ([EDICIÓN]) [Número] [*F*]"; pieces the source did not provide are left out
export function formatCardLine(
  card: { name: string; set?: string | null; collectorNumber?: string | null; finish?: CardPrinting['finish'] },
  quantity?: number
): string {
  const parts: string[] = [];
  if (quantity !== undefined) parts.push(String(quantity));
  parts.push(card.name);
  if (card.set) {
    parts.push(`(${card.set.toUpperCase()})`);
    if (card.collectorNumber) parts.push(card.collectorNumber);
  }
  const tag = FINISH_TAG[card.finish ?? 'normal'];
  if (tag) parts.push(tag);
  return parts.join(' ');
}

export function standardizeDeck(deck: InfluencerDeck): FrontendDeck {
  const [main, second] = deck.source.commanders;
  // commanders carry their exact printing; fall back to the plain name if it is missing
  const commander = main?.name === deck.commander ? formatCardLine(main) : deck.commander;
  const partner = deck.partner ? (second?.name === deck.partner ? formatCardLine(second) : deck.partner) : undefined;

  return {
    name: deck.name,
    commander,
    ...(partner ? { partner } : {}),
    influencerName: deck.influencerName,
    socialNetworks: deck.socialNetworks,
    deckDescription: deck.deckDescription,
    // MODIFICADO: Llamamos a formatCardLine sin pasarle c.count para que no incluya el número al principio del nombre
    cards: deck.cards.map((c) => ({ name: formatCardLine(c), count: c.count })),
    sideboard: (deck.sideboard ?? []).map((c) => ({ name: formatCardLine(c), count: c.count })),
  };
}

export type StandardizeOptions = {
  inputFile: string;
  outputFile: string;
  log?: (msg: string) => void;
};

// Reads influencer_precons_all.json and writes the frontend-shaped version of every deck
export function standardizeInfluencerDecks(options: StandardizeOptions): FrontendDeck[] {
  const log = options.log ?? console.log;
  const inputFile = path.resolve(options.inputFile);
  const outputFile = path.resolve(options.outputFile);

  if (!fs.existsSync(inputFile)) throw new Error(`No se encuentra ${inputFile}`);
  const decks = JSON.parse(fs.readFileSync(inputFile, 'utf-8')) as InfluencerDeck[];
  if (!Array.isArray(decks)) throw new Error('El archivo JSON no contiene un array válido.');

  const standardized = decks.map(standardizeDeck);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(standardized, null, 2), 'utf-8');
  log(`🧩 ${standardized.length} decks estandarizados en ${outputFile}`);
  return standardized;
}
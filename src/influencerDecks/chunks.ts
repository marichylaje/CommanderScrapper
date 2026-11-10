import fs from 'fs';
import path from 'path';
import { descriptionKey } from './sync.js';
import type { FrontendDeck } from './standardize.js';
import type { DeckDescription } from './types.js';

// Decks currently published in the chunk files (data/influencers/influencer_precons_NN.json)
export function readChunkDecks(dir: string): FrontendDeck[] {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) return [];
  return fs
    .readdirSync(resolved)
    .filter((f) => /^influencer_precons_\d+\.json$/.test(f))
    .sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(resolved, f), 'utf-8')) as FrontendDeck[]);
}

// The big all/standardized files are not kept between runs, so the published chunks are the only
// place that remembers the generated descriptions of each deck.
export function loadDescriptionsFromChunks(dir: string): Map<string, DeckDescription> {
  const map = new Map<string, DeckDescription>();
  for (const deck of readChunkDecks(dir)) {
    if (deck.deckDescription && Object.values(deck.deckDescription).some((v) => v)) {
      map.set(descriptionKey(deck.influencerName, deck.name), deck.deckDescription);
    }
  }
  return map;
}

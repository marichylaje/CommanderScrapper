import type { DeckProvider } from '../types.js';
import { moxfieldProvider } from './moxfield.js';
import { archidektProvider } from './archidekt.js';
import { manaboxProvider } from './manabox.js';
import { aetherhubProvider } from './aetherhub.js';
import { deckstatsProvider } from './deckstats.js';

export const PROVIDERS: DeckProvider[] = [
  moxfieldProvider,
  archidektProvider,
  manaboxProvider,
  aetherhubProvider,
  deckstatsProvider,
];

// Sites whose decks cannot be downloaded automatically (Cloudflare JS challenge, no public API)
export const UNSUPPORTED_HOSTS = ['mtggoldfish.com', 'magic-ville.com'];

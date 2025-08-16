import { z } from 'zod';

const ImageUrisSchema = z.object({
  art_crop: z.string().optional(),
  large: z.string().optional(),
  normal: z.string().optional(),
});

const CardFaceSchema = z.object({
  name: z.string(),
  flavor_name: z.string().optional(),
  type_line: z.string(),
  mana_cost: z.string().optional(),
  image_uris: ImageUrisSchema.optional(),
});

export const ReducedCardSchema = z.object({
  name: z.string(),
  flavor_name: z.string().optional(),
  mana_cost: z.string().optional(),
  face_name: z.string().optional(),
  cmc: z.number().optional(),
  collector_number: z.string(),
  color_identity: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  games: z.array(z.enum(['arena', 'mtgo', 'paper'])),
  id: z.string(),
  image_uris: ImageUrisSchema.optional(),
  keywords: z.array(z.string()).optional(),
  oracle_id: z.string(),
  oracle_text: z.string().optional(),
  prices: z
    .object({
      eur: z.string().optional(),
      eur_foil: z.string().optional(),
      usd: z.string().optional(),
      usd_etched: z.string().optional(),
      usd_foil: z.string().optional(),
    })
    .optional(),
  purchase_uris: z.object({
    cardmarket: z.string(),
    tcgplayer: z.string(),
  }),
  rarity: z.enum([
    'common',
    'uncommon',
    'rare',
    'mythic',
    'special',
    'bonus',
  ]),
  set: z.string(),
  type_line: z.string(),
  released_at: z.string(),
  card_faces: z.array(CardFaceSchema).optional(),
});

export type ReducedCard = z.infer<typeof ReducedCardSchema>;

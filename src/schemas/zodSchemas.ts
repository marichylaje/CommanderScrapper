import { z } from 'zod';

export const CardFaceSchema = z.object({
  name: z.string(),
});

export const CardPartSchema = z.object({
  name: z.string(),
});

export const ReducedCardSchema = z.object({
  name: z.string(),
  mana_cost: z.string().optional().nullable(),
  cmc: z.number().optional(),
  type_line: z.string().optional(),
  oracle_text: z.string().optional(),
  power: z.string().optional().nullable(),
  toughness: z.string().optional().nullable(),
  colors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  card_faces: z.array(CardFaceSchema).optional(),
  all_parts: z.array(CardPartSchema).optional(),
  legalities: z
    .object({
      commander: z.union([
        z.literal('legal'),
        z.literal('not_legal'),
        z.literal('restricted'),
        z.literal('banned'),
      ]).optional(),
    })
    .optional(),
  games: z.array(z.string()).optional(),
  set_name: z.string().optional(),
  rarity: z.union([
    z.literal('common'),
    z.literal('uncommon'),
    z.literal('rare'),
    z.literal('mythic'),
    z.literal('special'),
    z.literal('bonus'),
  ]).optional(),
});

export type ReducedCard = z.infer<typeof ReducedCardSchema>;

export type ColorBucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'M';

const SINGLE_COLORS: Record<string, ColorBucket> = {
  W: 'W',
  U: 'U',
  B: 'B',
  R: 'R',
  G: 'G',
};

export function bucketFromCard(card: {
  color_identity?: string[] | null;
  colors?: string[] | null;
}): ColorBucket {
  const colors =
    card.color_identity && card.color_identity.length > 0
      ? card.color_identity
      : card.colors ?? [];
  const normalized = colors.map((color) => color.toUpperCase());

  if (normalized.length === 0) return 'C';
  if (normalized.length > 1) return 'M';
  return SINGLE_COLORS[normalized[0] ?? ''] ?? 'C';
}

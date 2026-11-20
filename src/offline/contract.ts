export const ENTRY_VERSION = 3;
export const HASH_FIELDS = ['phash', 'phashAlt', 'phashCenter', 'phashLeft', 'phashRight'] as const;
export type RegionHashes = Record<(typeof HASH_FIELDS)[number], string>;
export const CROP_HASHES = ['art', 'normal', 'center', 'left', 'right'] as const;

export function hasV3Hashes(value: unknown) {
  return Array.isArray(value) && value.length === CROP_HASHES.length &&
    CROP_HASHES.every((name, index) => value[index] === name);
}

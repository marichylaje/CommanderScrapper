import { HASH_FIELDS, type RegionHashes } from './contract.js';

const popcount = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function regionDistance(query: RegionHashes, entry: RegionHashes) {
  const distances = HASH_FIELDS.map((field) => {
    let distance = 0;
    for (let i = 0; i < 16; i++) {
      distance += popcount[parseInt(query[field][i], 16) ^ parseInt(entry[field][i], 16)];
    }
    return distance;
  }).sort((a, b) => a - b);
  return Math.floor((distances[0] + distances[1] + distances[2] + 1) / 3);
}

export type OfflineEntry = {
  artUrl?: string | null;
  collectorNumber: string;
  id: string;
  lang: string;
  name: string;
  oracleId: string;
  phash: string; // 64-bit hex string
  set: string;
};

type EncodedEntry = {
  artUrlIndex: number;
  collectorNumberIndex: number;
  idIndex: number;
  langIndex: number;
  nameIndex: number;
  oracleIndex: number;
  phashHi: number;
  phashLo: number;
  setIndex: number;
};

const MAGIC = 'TCGDB1';
const VERSION = 1;

function splitHash(hex: string) {
  const normalized = hex.padStart(16, '0').slice(-16);
  const hi = Number.parseInt(normalized.slice(0, 8), 16);
  const lo = Number.parseInt(normalized.slice(8), 16);
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

export function encodeOfflineDb(entries: OfflineEntry[]) {
  const stringIndex = new Map<string, number>();
  const strings: string[] = [];

  const intern = (value: string | null | undefined) => {
    const key = value ?? '';
    const existing = stringIndex.get(key);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(key);
    stringIndex.set(key, index);
    return index;
  };

  const encodedEntries: EncodedEntry[] = entries.map((entry) => {
    const { hi, lo } = splitHash(entry.phash);
    return {
      artUrlIndex: intern(entry.artUrl ?? ''),
      collectorNumberIndex: intern(entry.collectorNumber),
      idIndex: intern(entry.id),
      langIndex: intern(entry.lang ?? 'en'),
      nameIndex: intern(entry.name),
      oracleIndex: intern(entry.oracleId),
      phashHi: hi,
      phashLo: lo,
      setIndex: intern(entry.set),
    };
  });

  const encoder = new TextEncoder();
  const stringOffsets: number[] = [];
  let stringsSize = 0;
  for (const value of strings) {
    const bytes = encoder.encode(value);
    stringOffsets.push(stringsSize);
    stringsSize += 2 + bytes.length;
  }

  const headerSize = MAGIC.length + 2 + 4 + 4 + 4 + 4;
  const entrySize = 4 * 9;
  const entriesOffset = headerSize;
  const stringsOffset = entriesOffset + encodedEntries.length * entrySize;
  const totalSize = stringsOffset + stringsSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  buffer.write(MAGIC, offset, 'ascii');
  offset += MAGIC.length;
  buffer.writeUInt16LE(VERSION, offset);
  offset += 2;
  buffer.writeUInt32LE(encodedEntries.length, offset);
  offset += 4;
  buffer.writeUInt32LE(strings.length, offset);
  offset += 4;
  buffer.writeUInt32LE(entriesOffset, offset);
  offset += 4;
  buffer.writeUInt32LE(stringsOffset, offset);
  offset += 4;

  offset = entriesOffset;
  for (const entry of encodedEntries) {
    buffer.writeUInt32LE(entry.idIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.oracleIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.nameIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.setIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.collectorNumberIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.langIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.artUrlIndex, offset); offset += 4;
    buffer.writeUInt32LE(entry.phashHi, offset); offset += 4;
    buffer.writeUInt32LE(entry.phashLo, offset); offset += 4;
  }

  offset = stringsOffset;
  for (const value of strings) {
    const bytes = Buffer.from(encoder.encode(value));
    buffer.writeUInt16LE(bytes.length, offset);
    offset += 2;
    bytes.copy(buffer, offset);
    offset += bytes.length;
  }

  return buffer;
}

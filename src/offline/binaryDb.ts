const MAGIC = 'TCGDB1';
const DEFAULT_VERSION = 1;
const V2_VERSION = 2;

export type OfflineEntry = {
  cn: string;
  name: string;
  oracle_id: string;
  phash: string;
  phashAlt?: string;
  set: string;
};

export type EncodedOfflineDb = {
  buffer: Buffer;
  version: number;
};

function normalizeEntryString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function splitHash(hex: string) {
  const normalized = hex.replace(/[^0-9a-f]/gi, '').padStart(16, '0').slice(-16);
  return {
    hi: Number.parseInt(normalized.slice(0, 8), 16) >>> 0,
    lo: Number.parseInt(normalized.slice(8, 16), 16) >>> 0,
  };
}

function joinHash(hi: number, lo: number) {
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

function writeStringTable(entries: OfflineEntry[]) {
  const strings = new Map<string, number>();
  const ordered: string[] = [];

  const remember = (value: unknown) => {
    const normalized = normalizeEntryString(value);
    if (!strings.has(normalized)) {
      strings.set(normalized, ordered.length);
      ordered.push(normalized);
    }
  };

  for (const entry of entries) {
    remember(entry.set);
    remember(entry.cn);
    remember(entry.name);
    remember(entry.oracle_id);
  }

  const encoded = ordered.map((value) => Buffer.from(value, 'utf8'));
  const size = encoded.reduce((total, chunk) => total + 4 + chunk.length, 0);
  const buffer = Buffer.allocUnsafe(size);

  let offset = 0;
  for (const chunk of encoded) {
    buffer.writeUInt32LE(chunk.length, offset);
    offset += 4;
    chunk.copy(buffer, offset);
    offset += chunk.length;
  }

  return { buffer, index: strings };
}

export function encodeOfflineDb(entries: OfflineEntry[]): EncodedOfflineDb {
  const version = entries.some((entry) => Boolean(entry.phashAlt))
    ? V2_VERSION
    : DEFAULT_VERSION;

  const { buffer: stringTable, index } = writeStringTable(entries);
  const entrySize = version >= V2_VERSION ? 44 : 36;
  const headerSize = 6 + 2 + 4 + 4;
  const buffer = Buffer.allocUnsafe(
    headerSize + entries.length * entrySize + stringTable.length,
  );

  let offset = 0;
  buffer.write(MAGIC, offset, 'utf8');
  offset += 6;
  buffer.writeUInt16LE(version, offset);
  offset += 2;
  buffer.writeUInt32LE(entries.length, offset);
  offset += 4;
  buffer.writeUInt32LE(stringTable.length, offset);
  offset += 4;

  for (const entry of entries) {
    const set = normalizeEntryString(entry.set);
    const cn = normalizeEntryString(entry.cn);
    const name = normalizeEntryString(entry.name);
    const oracleId = normalizeEntryString(entry.oracle_id);

    const setIndex = index.get(set);
    const cnIndex = index.get(cn);
    const nameIndex = index.get(name);
    const oracleIndex = index.get(oracleId);

    if (
      setIndex === undefined ||
      cnIndex === undefined ||
      nameIndex === undefined ||
      oracleIndex === undefined
    ) {
      throw new Error('Unable to encode offline db string table.');
    }

    const primary = splitHash(entry.phash);
    const alternate = splitHash(entry.phashAlt ?? entry.phash);

    buffer.writeUInt32LE(setIndex, offset);
    buffer.writeUInt32LE(cnIndex, offset + 4);
    buffer.writeUInt32LE(nameIndex, offset + 8);
    buffer.writeUInt32LE(oracleIndex, offset + 12);
    buffer.writeUInt32LE(primary.hi, offset + 16);
    buffer.writeUInt32LE(primary.lo, offset + 20);

    if (version >= V2_VERSION) {
      buffer.writeUInt32LE(alternate.hi, offset + 24);
      buffer.writeUInt32LE(alternate.lo, offset + 28);
      buffer.writeUInt32LE(0, offset + 32);
      buffer.writeUInt32LE(0, offset + 36);
      buffer.writeUInt32LE(0, offset + 40);
    }

    offset += entrySize;
  }

  stringTable.copy(buffer, offset);
  return { buffer, version };
}

export function decodeOfflineDb(input: Buffer | Uint8Array) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const magic = buffer.toString('utf8', 0, 6);
  if (magic !== MAGIC) {
    throw new Error('Invalid offline DB magic header.');
  }

  const version = buffer.readUInt16LE(6);
  if (version !== DEFAULT_VERSION && version !== V2_VERSION) {
    throw new Error(`Unsupported offline DB version: ${version}`);
  }

  const entryCount = buffer.readUInt32LE(8);
  const stringTableLength = buffer.readUInt32LE(12);
  const entrySize = version >= V2_VERSION ? 44 : 36;
  const entriesOffset = 16;
  const stringTableOffset = entriesOffset + entryCount * entrySize;

  const strings = new Map<number, string>();
  let cursor = stringTableOffset;
  let stringIndex = 0;
  while (cursor < stringTableOffset + stringTableLength) {
    const length = buffer.readUInt32LE(cursor);
    cursor += 4;
    const value = buffer.toString('utf8', cursor, cursor + length);
    cursor += length;
    strings.set(stringIndex, value);
    stringIndex += 1;
  }

  const entries: OfflineEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const base = entriesOffset + index * entrySize;
    const set = strings.get(buffer.readUInt32LE(base)) ?? '';
    const cn = strings.get(buffer.readUInt32LE(base + 4)) ?? '';
    const name = strings.get(buffer.readUInt32LE(base + 8)) ?? '';
    const oracle_id = strings.get(buffer.readUInt32LE(base + 12)) ?? '';
    const primary = joinHash(
      buffer.readUInt32LE(base + 16),
      buffer.readUInt32LE(base + 20),
    );
    const alternate =
      version >= V2_VERSION
        ? joinHash(buffer.readUInt32LE(base + 24), buffer.readUInt32LE(base + 28))
        : primary;

    entries.push({
      cn,
      name,
      oracle_id,
      phash: primary,
      phashAlt: alternate,
      set,
    });
  }

  return {
    entries,
    version,
  };
}

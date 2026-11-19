import { TextDecoder } from 'node:util';

const MAGIC = 'TCGDB1';
const HEADER_SIZE = 24;
export const ENTRY_VERSION = 2;
export const MAX_BUCKET_BYTES = 64 * 1024 * 1024;
const FIELDS = ['id', 'oracle_id', 'name', 'set', 'cn', 'lang', 'artUrl'] as const;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export type OfflineEntry = Record<(typeof FIELDS)[number], string> & {
  phash: string;
  phashAlt?: string;
};

function assertIdentity(entry: Pick<OfflineEntry, (typeof FIELDS)[number]>) {
  for (const field of FIELDS) {
    if (typeof entry[field] !== 'string' || (field !== 'artUrl' && !entry[field].trim())) {
      throw new Error(`Missing printing field ${field} (${entry.id || 'unknown printing'})`);
    }
  }
}

function writeHash(buffer: Buffer, offset: number, hash: string) {
  if (!/^[0-9a-f]{16}$/i.test(hash)) throw new Error(`Invalid 64-bit pHash: ${hash}`);
  buffer.writeUInt32LE(Number.parseInt(hash.slice(0, 8), 16), offset);
  buffer.writeUInt32LE(Number.parseInt(hash.slice(8), 16), offset + 4);
}

export function encodeOfflineDb(entries: readonly OfflineEntry[]) {
  const stride = 44;
  const indices = new Map<string, number>();
  const strings: Buffer[] = [];
  let stringBytes = 0;
  for (const entry of entries) {
    assertIdentity(entry);
    for (const field of FIELDS) {
      const value = entry[field];
      if (indices.has(value)) continue;
      const bytes = Buffer.from(value, 'utf8');
      if (bytes.length > 0xffff) throw new Error(`String too long: ${field} (${entry.id})`);
      indices.set(value, strings.length);
      strings.push(bytes);
      stringBytes += 2 + bytes.length;
    }
  }
  const stringsOffset = HEADER_SIZE + entries.length * stride;
  if (stringsOffset + stringBytes > MAX_BUCKET_BYTES) throw new Error('Offline bucket exceeds Android size limit');
  const buffer = Buffer.alloc(stringsOffset + stringBytes);
  buffer.write(MAGIC, 0, 'ascii');
  buffer.writeUInt16LE(ENTRY_VERSION, 6);
  buffer.writeUInt32LE(entries.length, 8);
  buffer.writeUInt32LE(strings.length, 12);
  buffer.writeUInt32LE(HEADER_SIZE, 16);
  buffer.writeUInt32LE(stringsOffset, 20);
  for (const [index, entry] of entries.entries()) {
    const base = HEADER_SIZE + index * stride;
    for (const [column, field] of FIELDS.entries()) {
      const pointer = indices.get(entry[field]);
      if (pointer === undefined) throw new Error(`Missing string index for ${field}`);
      buffer.writeUInt32LE(pointer, base + column * 4);
    }
    writeHash(buffer, base + 28, entry.phash);
    writeHash(buffer, base + 36, entry.phashAlt ?? entry.phash);
  }
  let cursor = stringsOffset;
  for (const bytes of strings) {
    buffer.writeUInt16LE(bytes.length, cursor);
    cursor += 2;
    cursor += bytes.copy(buffer, cursor);
  }
  return { buffer, version: ENTRY_VERSION };
}

export function decodeOfflineDb(buffer: Buffer) {
  if (buffer.length < HEADER_SIZE || buffer.length > MAX_BUCKET_BYTES || buffer.toString('ascii', 0, 6) !== MAGIC) {
    throw new Error('Invalid TCGDB1 header or bucket size');
  }
  const version = buffer.readUInt16LE(6);
  if (version !== 1 && version !== 2) throw new Error(`Unsupported TCGDB1 version ${version}`);
  const stride = version === 1 ? 36 : 44;
  const count = buffer.readUInt32LE(8);
  const stringCount = buffer.readUInt32LE(12);
  const entriesOffset = buffer.readUInt32LE(16);
  const stringsOffset = buffer.readUInt32LE(20);
  if (entriesOffset !== HEADER_SIZE || stringsOffset !== entriesOffset + count * stride ||
      stringsOffset > buffer.length || stringCount > (buffer.length - stringsOffset) / 2) {
    throw new Error('Invalid TCGDB1 offsets or counts');
  }
  const strings: string[] = [];
  let cursor = stringsOffset;
  for (let index = 0; index < stringCount; index += 1) {
    if (cursor + 2 > buffer.length) throw new Error('Truncated string length');
    const length = buffer.readUInt16LE(cursor);
    cursor += 2;
    if (cursor + length > buffer.length) throw new Error('Truncated UTF-8 string');
    strings.push(utf8.decode(buffer.subarray(cursor, cursor + length)));
    cursor += length;
  }
  if (cursor !== buffer.length) throw new Error('Unexpected bytes after TCGDB1 string table');
  const readHash = (base: number) =>
    buffer.readUInt32LE(base).toString(16).padStart(8, '0') +
    buffer.readUInt32LE(base + 4).toString(16).padStart(8, '0');
  const entries: OfflineEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = entriesOffset + index * stride;
    const field = (column: number) => {
      const value = strings[buffer.readUInt32LE(base + column * 4)];
      if (value === undefined) throw new Error(`Invalid string index at entry ${index}, field ${column}`);
      return value;
    };
    const entry = {
      id: field(0), oracle_id: field(1), name: field(2), set: field(3),
      cn: field(4), lang: field(5), artUrl: field(6),
      phash: readHash(base + 28), phashAlt: readHash(base + (version === 2 ? 36 : 28)),
    };
    assertIdentity(entry);
    entries.push(entry);
  }
  return { entries, version };
}

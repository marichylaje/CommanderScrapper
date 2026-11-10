import { sleep } from './utils.js';

export type PrintingQuery = { name?: string; set: string | null; collectorNumber: string | null };
export type ResolvedPrinting = { scryfallId: string; set: string; collectorNumber: string };

type ScryfallCard = { id: string; name: string; set: string; collector_number: string };
type Identifier = { set: string; collector_number: string } | { set: string; name: string };

const BATCH_SIZE = 75;
const byNumber = new Map<string, ResolvedPrinting | null>();
const byName = new Map<string, ResolvedPrinting | null>();

const numberKey = (set: string, cn: string) => `${set.toLowerCase()}/${cn.toLowerCase()}`;
const nameKey = (set: string, name: string) => `${set.toLowerCase()}/${name.toLowerCase()}`;
const frontFace = (name: string) => name.split(' // ')[0];

// Letter suffix some sites append to double-faced cards ("317a"); Scryfall numbers them without it
const stripFaceSuffix = (cn: string) => cn.replace(/[ab]$/i, '');

async function lookup(identifiers: Identifier[]): Promise<ScryfallCard[]> {
  const found: ScryfallCard[] = [];
  for (let i = 0; i < identifiers.length; i += BATCH_SIZE) {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CommanderScrapper/1.0',
      },
      body: JSON.stringify({ identifiers: identifiers.slice(i, i + BATCH_SIZE) }),
    });
    if (!res.ok) throw new Error(`Scryfall HTTP ${res.status}`);
    found.push(...((await res.json()) as { data: ScryfallCard[] }).data);
    await sleep(120);
  }
  return found;
}

const toResolved = (c: ScryfallCard): ResolvedPrinting => ({
  scryfallId: c.id,
  set: c.set,
  collectorNumber: c.collector_number,
});

async function resolveByNumber(pairs: Map<string, { set: string; cn: string }>) {
  const todo = [...pairs.entries()].filter(([k]) => !byNumber.has(k));
  const cards = await lookup(todo.map(([, v]) => ({ set: v.set, collector_number: v.cn })));
  for (const c of cards) byNumber.set(numberKey(c.set, c.collector_number), toResolved(c));
  for (const [k] of todo) if (!byNumber.has(k)) byNumber.set(k, null);
}

async function resolveByName(pairs: Map<string, { set: string; name: string }>) {
  const todo = [...pairs.entries()].filter(([k]) => !byName.has(k));
  const cards = await lookup(todo.map(([, v]) => ({ set: v.set, name: v.name })));
  for (const c of cards) {
    byName.set(nameKey(c.set, c.name), toResolved(c));
    byName.set(nameKey(c.set, frontFace(c.name)), toResolved(c));
  }
  for (const [k] of todo) if (!byName.has(k)) byName.set(k, null);
}

// Resolves printings given as set code + collector number to their exact Scryfall printing
// (id plus Scryfall's own set/number). Falls back to set + name when the number is unknown to
// Scryfall. Returns one result (or null if the printing cannot be found) per input, in order.
export async function resolvePrintings(refs: PrintingQuery[]): Promise<(ResolvedPrinting | null)[]> {
  const pairs = new Map<string, { set: string; cn: string }>();
  for (const r of refs) {
    if (r.set && r.collectorNumber) pairs.set(numberKey(r.set, r.collectorNumber), { set: r.set, cn: r.collectorNumber });
  }
  await resolveByNumber(pairs);

  const stripped = new Map<string, { set: string; cn: string }>();
  const named = new Map<string, { set: string; name: string }>();
  for (const r of refs) {
    if (!r.set) continue;
    if (r.collectorNumber && byNumber.get(numberKey(r.set, r.collectorNumber))) continue;
    const base = r.collectorNumber ? stripFaceSuffix(r.collectorNumber) : null;
    if (base && base !== r.collectorNumber) stripped.set(numberKey(r.set, base), { set: r.set, cn: base });
    if (r.name) named.set(nameKey(r.set, frontFace(r.name)), { set: r.set, name: frontFace(r.name) });
  }
  await resolveByNumber(stripped);
  await resolveByName(named);

  return refs.map((r) => {
    if (!r.set) return null;
    if (r.collectorNumber) {
      const hit =
        byNumber.get(numberKey(r.set, r.collectorNumber)) ??
        byNumber.get(numberKey(r.set, stripFaceSuffix(r.collectorNumber)));
      if (hit) return hit;
    }
    return r.name ? (byName.get(nameKey(r.set, frontFace(r.name))) ?? null) : null;
  });
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Card, Finish } from './types.js';

const execFileAsync = promisify(execFile);

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Statuses that will not change by retrying (403 is retried: Cloudflare answers it to blocked clients)
const FINAL_STATUSES = new Set([400, 401, 404, 410]);

// Several sites (Moxfield, Aetherhub...) sit behind Cloudflare, which rejects Node's fetch
// (TLS fingerprint) but accepts curl, so every deck request goes through curl.
export async function httpGetText(
  url: string,
  opts: { accept?: string; retries?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 3;
  let lastError = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        'curl',
        ['-s', '-L', '-A', USER_AGENT, '-H', `Accept: ${opts.accept ?? '*/*'}`, '-w', '\n%{http_code}', url],
        { maxBuffer: 128 * 1024 * 1024 }
      );
      const split = stdout.lastIndexOf('\n');
      const status = Number(stdout.slice(split + 1));
      if (status === 200) return stdout.slice(0, split);
      lastError = `HTTP ${status}`;
      if (FINAL_STATUSES.has(status)) break;
    } catch (e) {
      lastError = (e as Error).message;
    }
    await sleep(1500 * attempt);
  }
  throw new Error(lastError);
}

export async function httpGetJson<T = any>(url: string, opts: { retries?: number } = {}): Promise<T> {
  return JSON.parse(await httpGetText(url, { accept: 'application/json', ...opts })) as T;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const toFinish = (raw: unknown): Finish => {
  const v = String(raw ?? '').toLowerCase();
  if (v.includes('etched')) return 'etched';
  if (v.includes('foil') && !v.includes('nonfoil') && !v.includes('non-foil')) return 'foil';
  return 'normal';
};

// Same printing and finish listed several times (split stacks...) becomes a single entry
export function mergeCards(cards: Card[]): Card[] {
  const merged = new Map<string, Card>();
  for (const c of cards) {
    const key = [c.name, c.set, c.collectorNumber, c.scryfallId, c.finish].join('\u0000');
    const prev = merged.get(key);
    if (prev) prev.count += c.count;
    else {
      merged.set(key, {
        name: c.name,
        count: c.count,
        set: c.set,
        collectorNumber: c.collectorNumber,
        scryfallId: c.scryfallId,
        finish: c.finish,
      });
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.set ?? '').localeCompare(b.set ?? '') ||
      (a.collectorNumber ?? '').localeCompare(b.collectorNumber ?? '', undefined, { numeric: true }) ||
      a.finish.localeCompare(b.finish)
  );
}

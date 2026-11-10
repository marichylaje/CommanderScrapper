import ExcelJS from 'exceljs';
import { PROVIDERS, UNSUPPORTED_HOSTS } from './providers/index.js';
import type { DeckProvider, SheetTab } from './types.js';

export const SHEET_FIRST_DATA_ROW = 3;
// 1-based column indexes of the sheet
const COL = { handle: 2, igName: 4, instagram: 6, youtube: 7, tiktok: 8, deckUrl: 9, note: 10 } as const;

const EMPTY_PLACEHOLDERS = new Set(['', '-', '--', '???', '??', '?', 'to add', 'n/a']);

export type SheetLink = { provider: DeckProvider; id: string; url: string };

export type SheetRow = {
  rowNum: number;
  influencerName: string;
  handle: string;
  socialNetworks: { instagram: string | null; tiktok: string | null; youtube: string | null }[];
  note: string;
  links: SheetLink[];
  // problems found while reading the row (unsupported links, stray text...)
  issues: string[];
};

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as any;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result !== undefined) return String(v.result);
    if (v.hyperlink) return String(v.hyperlink);
  }
  return String(v);
}

function cellHyperlink(cell: ExcelJS.Cell): string {
  const link = (cell.value as any)?.hyperlink ?? (cell as any).hyperlink;
  if (typeof link !== 'string') return '';
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function normalizeSocial(raw: string): string | null {
  const value = raw.trim();
  if (EMPTY_PLACEHOLDERS.has(value.toLowerCase())) return null;
  // "tiktok.com/@user" -> usable link
  if (!value.startsWith('@') && /^[\w.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value}`;
  return value;
}

export const normalizeHandle = (handle: string) => handle.trim().toLowerCase();

function extractLinks(text: string, issues: string[]): SheetLink[] {
  const links: SheetLink[] = [];
  // the hyperlink stored in the cell sometimes has "https:/" (single slash)
  for (const [raw] of text.matchAll(/https?:\/+[^\s]+/gi)) {
    const provider = PROVIDERS.find((p) => p.parseUrl(raw));
    const parsed = provider?.parseUrl(raw);
    if (provider && parsed) {
      if (!links.some((l) => l.provider === provider && l.id === parsed.id)) {
        links.push({ provider, id: parsed.id, url: parsed.url });
      }
    } else if (UNSUPPORTED_HOSTS.some((h) => raw.includes(h))) {
      issues.push(`enlace no descargable automáticamente (protegido por Cloudflare): ${raw}`);
    } else {
      issues.push(`enlace que no es de un mazo soportado, ignorado: ${raw}`);
    }
  }
  return links;
}

export function readSheetRows(ws: ExcelJS.Worksheet): SheetRow[] {
  const rows: SheetRow[] = [];
  for (let rowNum = SHEET_FIRST_DATA_ROW; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const influencerName = cellText(row.getCell(COL.igName)).trim();
    const urlCell = row.getCell(COL.deckUrl);
    const urlText = cellText(urlCell);
    if (!influencerName && !urlText.trim()) continue;

    const issues: string[] = [];
    const links = extractLinks(urlText, issues);
    for (const link of extractLinks(cellHyperlink(urlCell), [])) {
      if (!links.some((l) => l.provider === link.provider && l.id === link.id)) {
        links.push(link);
        issues.push(`el deck ${link.url} solo estaba en el hipervínculo de la celda, no en el texto`);
      }
    }
    const leftover = urlText
      .replace(/https?:\/+\S+/gi, '')
      .replace(/[\s+-]+/g, ' ')
      .trim();
    if (leftover && links.length > 0) issues.push(`texto extra en "Deck URL": "${leftover.slice(0, 80)}"`);
    if (!influencerName) issues.push('sin "IG Name Account"');

    rows.push({
      rowNum,
      influencerName,
      handle: cellText(row.getCell(COL.handle)),
      socialNetworks: [
        {
          instagram: normalizeSocial(cellText(row.getCell(COL.instagram))),
          tiktok: normalizeSocial(cellText(row.getCell(COL.tiktok))),
          youtube: normalizeSocial(cellText(row.getCell(COL.youtube))),
        },
      ],
      note: cellText(row.getCell(COL.note)).trim(),
      links,
      issues,
    });
  }
  return rows;
}

export const ALL_TABS: SheetTab[] = ['Moxfield', 'Archidekt', 'Others'];

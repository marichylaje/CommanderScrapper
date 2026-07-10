import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';

const TELEMETRY_PREFIX = process.env.SCANNER_TELEMETRY_PREFIX ?? 'scanner-telemetry';
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

type TelemetryEvent = {
  at?: string;
  confidence?: number;
  event: string;
  message?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectEvents(body: unknown): TelemetryEvent[] | null {
  if (Array.isArray(body)) {
    return body.filter((item): item is TelemetryEvent => isRecord(item) && typeof item.event === 'string');
  }

  if (!isRecord(body)) {
    return null;
  }

  if (Array.isArray(body.events)) {
    return body.events.filter((item): item is TelemetryEvent => isRecord(item) && typeof item.event === 'string');
  }

  if (typeof body.event === 'string') {
    return [body as TelemetryEvent];
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  if (!BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Telemetry storage unavailable' });
  }

  const events = collectEvents(req.body);
  if (!events || events.length === 0) {
    return res.status(400).json({ error: 'Invalid telemetry payload' });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${TELEMETRY_PREFIX}/${timestamp}-${randomUUID()}.json`;
  const payload = JSON.stringify(
    {
      events,
      receivedAt: new Date().toISOString(),
      requestId:
        (Array.isArray(req.headers['x-vercel-id']) ? req.headers['x-vercel-id'][0] : req.headers['x-vercel-id']) ??
        (Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id']) ??
        'unknown',
      userAgent: req.headers['user-agent'] ?? null,
    },
    null,
    2,
  );

  const blob = await put(fileName, payload, {
    access: 'public',
    contentType: 'application/json',
    token: BLOB_READ_WRITE_TOKEN,
  });

  return res.status(202).json({ ok: true, stored: events.length, url: blob.url });
}

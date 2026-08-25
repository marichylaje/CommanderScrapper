const ALLOWED_ORIGINS = new Set(['http://localhost:8090']);

type CorsRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type CorsResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { end: () => void };
};

function resolveOrigin(req: CorsRequest): string {
  const origin = req.headers.origin;
  const isDevelopment = process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV !== 'production';

  const originValue = Array.isArray(origin) ? origin[0] : origin;

  if (!originValue) return '*';
  if (ALLOWED_ORIGINS.has(originValue)) return originValue;
  if (isDevelopment) return '*';

  return originValue;
}

export function applyCors(req: CorsRequest, res: CorsResponse): void {
  const allowOrigin = resolveOrigin(req);

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-App-Secret, X-Requested-With, Accept, Origin',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleCorsPreflight(req: CorsRequest, res: CorsResponse): boolean {
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

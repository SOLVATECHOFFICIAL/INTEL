const FALLBACK_ORIGIN = 'https://lasuedintel.com.ng';

export function normalizeOriginCandidate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  while (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const trimmed = cleaned.replace(/\/+$/, '');
  if (!trimmed) return null;
  const withProtocol =
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getHeaderSingle(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(val)) return (val[0] ?? '').trim();
      return typeof val === 'string' ? val.trim() : '';
    }
  }
  return '';
}

export function resolveServerPublicOrigin(
  reqHeaders?: Record<string, string | string[] | undefined>
): string {
  const configured = normalizeOriginCandidate(process.env.VITE_PUBLIC_BASE_URL);
  if (configured) return configured;

  const vercelProd = normalizeOriginCandidate(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  );
  if (vercelProd) return vercelProd;

  const vercelUrl = normalizeOriginCandidate(process.env.VERCEL_URL);
  if (vercelUrl) return vercelUrl;

  const hostHeader =
    getHeaderSingle(reqHeaders, 'x-forwarded-host') ||
    getHeaderSingle(reqHeaders, 'host');
  if (hostHeader && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(hostHeader)) {
    const protoHeader = getHeaderSingle(reqHeaders, 'x-forwarded-proto');
    const proto =
      protoHeader === 'http' || hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1')
        ? 'http'
        : 'https';
    const fromHost = normalizeOriginCandidate(`${proto}://${hostHeader}`);
    if (fromHost) return fromHost;
  }

  return FALLBACK_ORIGIN;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SITEMAP_PATHS: ReadonlyArray<{
  path: string;
  changefreq: string;
  priority: string;
}> = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/?view=latest', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=updates', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=anonymous', changefreq: 'hourly', priority: '0.8' },
  { path: '/?view=marketplace', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=trusted-circle', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=opportunities', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=upcoming-events', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=search', changefreq: 'weekly', priority: '0.6' },
];

export function buildSitemapXml(origin: string): string {
  const safeOrigin = normalizeOriginCandidate(origin) ?? FALLBACK_ORIGIN;
  const urls = SITEMAP_PATHS.map(
    (entry) =>
      `  <url>\n` +
      `    <loc>${escapeXml(`${safeOrigin}${entry.path}`)}</loc>\n` +
      `    <changefreq>${entry.changefreq}</changefreq>\n` +
      `    <priority>${entry.priority}</priority>\n` +
      `  </url>`
  ).join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}

export function buildRobotsTxt(origin: string): string {
  const safeOrigin = normalizeOriginCandidate(origin) ?? FALLBACK_ORIGIN;
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /*?*view=admin*',
    'Disallow: /*?*view=account*',
    'Disallow: /*?*view=notifications*',
    'Disallow: /*?*view=login*',
    'Disallow: /*?*view=register*',
    'Disallow: /*?*view=following*',
    '',
    `Sitemap: ${safeOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

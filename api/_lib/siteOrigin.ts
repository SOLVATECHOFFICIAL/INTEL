const FALLBACK_ORIGIN = 'https://lasuedintel.com.ng';

export interface SitemapImageEntry {
  loc: string;
  title?: string;
  caption?: string;
}

export interface SitemapUrlEntry {
  path: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly';
  priority: string;
  lastmod?: string;
  images?: readonly SitemapImageEntry[];
}

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
      protoHeader === 'http' ||
      hostHeader.startsWith('localhost') ||
      hostHeader.startsWith('127.0.0.1')
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

function resolveImageLoc(loc: string, safeOrigin: string): string | null {
  const trimmed = loc.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) {
    return `${safeOrigin}${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

const CORE_SITEMAP_ROUTES: readonly SitemapUrlEntry[] = [
  {
    path: '/',
    changefreq: 'hourly',
    priority: '1.0',
    images: [
      {
        loc: '/og-share.png',
        title: 'LASUED Intel — Lagos State University of Education Student Hub',
        caption:
          'Official LASUED Intel platform preview featuring campus updates, marketplace, opportunities, events, trusted circle, and anonymous discussions.',
      },
      {
        loc: '/lasued-intel.webp',
        title: 'LASUED Intel Official Brand Emblem',
        caption: 'LASUED Intel LI monogram emblem.',
      },
      {
        loc: '/pwa-512x512.png',
        title: 'LASUED Intel App Icon',
        caption: 'LASUED Intel high-resolution app icon.',
      },
    ],
  },
  {
    path: '/?view=updates',
    changefreq: 'hourly',
    priority: '0.95',
    images: [
      {
        loc: '/og-share.png',
        title: 'Official Campus Updates — LASUED Intel',
        caption:
          'Verified administrative announcements, academic notices, and campus briefings for LASUED students.',
      },
    ],
  },
  {
    path: '/?view=latest',
    changefreq: 'hourly',
    priority: '0.9',
    images: [
      {
        loc: '/og-share.png',
        title: 'Latest Campus Posts — LASUED Intel',
        caption:
          'Real-time chronological campus updates and student discussions across Lagos State University of Education.',
      },
    ],
  },
  {
    path: '/?view=marketplace',
    changefreq: 'hourly',
    priority: '0.9',
    images: [
      {
        loc: '/og-share.png',
        title: 'LASUED Campus Marketplace — LASUED Intel',
        caption:
          'Verified student marketplace for textbooks, past questions, gadgets, hostel accommodation, and campus services.',
      },
    ],
  },
  {
    path: '/?view=marketplace&mktTab=updates',
    changefreq: 'daily',
    priority: '0.75',
    images: [
      {
        loc: '/og-share.png',
        title: 'Marketplace Notices & Updates — LASUED Intel',
        caption:
          'Official marketplace notices, buyer safety reminders, and listing updates at LASUED Intel.',
      },
    ],
  },
  {
    path: '/?view=opportunities',
    changefreq: 'daily',
    priority: '0.9',
    images: [
      {
        loc: '/og-share.png',
        title: 'LASUED Student Opportunities & Scholarships — LASUED Intel',
        caption:
          'Curated scholarships, grants, internships, fellowships, skill programmes, and job openings for LASUED students.',
      },
    ],
  },
  {
    path: '/?view=upcoming-events',
    changefreq: 'daily',
    priority: '0.85',
    images: [
      {
        loc: '/og-share.png',
        title: 'Upcoming LASUED Campus Events — LASUED Intel',
        caption:
          'Campus events, academic workshops, seminars, orientations, and faculty programmes at LASUED.',
      },
    ],
  },
  {
    path: '/?view=trusted-circle',
    changefreq: 'daily',
    priority: '0.85',
    images: [
      {
        loc: '/og-share.png',
        title: 'Trusted Circle Campus Directory — LASUED Intel',
        caption:
          'Verified campus contacts, lecturers, student representatives, and trusted student service providers at LASUED.',
      },
    ],
  },
  {
    path: '/?view=anonymous',
    changefreq: 'hourly',
    priority: '0.8',
    images: [
      {
        loc: '/og-share.png',
        title: 'The Unfiltered (Anonymous Campus Discussions) — LASUED Intel',
        caption:
          'Privacy-protected anonymous student discussions, questions, and candid campus perspectives on LASUED Intel.',
      },
    ],
  },
  {
    path: '/?view=search',
    changefreq: 'weekly',
    priority: '0.7',
    images: [
      {
        loc: '/og-share.png',
        title: 'Search LASUED Intel',
        caption:
          'Search public LASUED campus updates, members, marketplace listings, opportunities, and events.',
      },
    ],
  },
];

export function buildSitemapXml(
  origin: string,
  dynamicEntries: readonly SitemapUrlEntry[] = []
): string {
  const safeOrigin = normalizeOriginCandidate(origin) ?? FALLBACK_ORIGIN;
  const seenLocations = new Set<string>();
  const combined: SitemapUrlEntry[] = [];

  for (const entry of [...CORE_SITEMAP_ROUTES, ...dynamicEntries]) {
    const cleanPath = entry.path.startsWith('/') ? entry.path : `/${entry.path}`;
    const fullLoc = `${safeOrigin}${cleanPath}`;
    if (seenLocations.has(fullLoc)) continue;
    seenLocations.add(fullLoc);
    combined.push({ ...entry, path: cleanPath });
  }

  const urls = combined
    .map((entry) => {
      const fullLoc = `${safeOrigin}${entry.path}`;
      const lines = [
        '  <url>',
        `    <loc>${escapeXml(fullLoc)}</loc>`,
      ];
      if (entry.lastmod) {
        lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }
      lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      lines.push(`    <priority>${entry.priority}</priority>`);

      const images = entry.images ?? [
        {
          loc: '/og-share.png',
          title: 'LASUED Intel',
        },
      ];
      for (const img of images) {
        const resolvedImg = resolveImageLoc(img.loc, safeOrigin);
        if (!resolvedImg) continue;
        lines.push('    <image:image>');
        lines.push(`      <image:loc>${escapeXml(resolvedImg)}</image:loc>`);
        if (img.title) {
          lines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
        }
        if (img.caption) {
          lines.push(`      <image:caption>${escapeXml(img.caption)}</image:caption>`);
        }
        lines.push('    </image:image>');
      }

      lines.push('  </url>');
      return lines.join('\n');
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}

const PRIVATE_DISALLOW_LINES = [
  'Disallow: /api/',
  'Disallow: /*?*view=admin*',
  'Disallow: /*?*view=account*',
  'Disallow: /*?*view=notifications*',
  'Disallow: /*?*view=login*',
  'Disallow: /*?*view=register*',
  'Disallow: /*?*view=following*',
];

const PUBLIC_ALLOW_LINES = [
  'Allow: /',
  'Allow: /og-share.png',
  'Allow: /lasued-intel.webp',
  'Allow: /pwa-512x512.png',
  'Allow: /pwa-192x192.png',
  'Allow: /llms.txt',
];

export function buildRobotsTxt(origin: string): string {
  const safeOrigin = normalizeOriginCandidate(origin) ?? FALLBACK_ORIGIN;
  return [
    'User-agent: *',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: Googlebot',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: Googlebot-Image',
    'Allow: /',
    'Allow: /og-share.png',
    'Allow: /lasued-intel.webp',
    'Allow: /pwa-512x512.png',
    'Allow: /pwa-192x192.png',
    '',
    'User-agent: Google-Extended',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: OAI-SearchBot',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: GPTBot',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: ClaudeBot',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    'User-agent: PerplexityBot',
    ...PUBLIC_ALLOW_LINES,
    ...PRIVATE_DISALLOW_LINES,
    '',
    `Sitemap: ${safeOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function buildLlmsTxt(origin: string): string {
  const safeOrigin = normalizeOriginCandidate(origin) ?? FALLBACK_ORIGIN;
  return [
    '# LASUED Intel',
    '',
    '> LASUED Intel is the student information, verified campus news, marketplace, opportunities, events, and community platform for Lagos State University of Education (LASUED) students across the Oto/Ijanikin and Epe campuses in Lagos, Nigeria.',
    '',
    `- Website: ${safeOrigin}/`,
    `- Preview Image: ${safeOrigin}/og-share.png`,
    `- Brand Emblem: ${safeOrigin}/lasued-intel.webp`,
    `- Sitemap: ${safeOrigin}/sitemap.xml`,
    '',
    '## Core Public Pages',
    `- [Home / For You Campus Stream](${safeOrigin}/): Combined feed led by verified Official Campus Updates, student community posts, and discovery recommendations.`,
    `- [Official Campus Updates](${safeOrigin}/?view=updates): Official administrative briefings, academic calendar notices, and verified campus advisories.`,
    `- [Latest Campus Posts](${safeOrigin}/?view=latest): Chronological stream of verified campus news, student posts, and anonymous discussions.`,
    `- [Campus Marketplace](${safeOrigin}/?view=marketplace): Verified student-to-student marketplace for textbooks, past questions, gadgets, hostel accommodation, and campus services.`,
    `- [Marketplace Updates](${safeOrigin}/?view=marketplace&mktTab=updates): Campus marketplace advisories, listing guidelines, and community notices.`,
    `- [Student Opportunities & Scholarships](${safeOrigin}/?view=opportunities): Curated scholarships, grants, internships, fellowships, competitions, skill programmes, and career openings for LASUED students.`,
    `- [Upcoming Campus Events](${safeOrigin}/?view=upcoming-events): Campus calendar covering faculty seminars, orientations, workshops, deadlines, and student programmes.`,
    `- [Trusted Circle Directory](${safeOrigin}/?view=trusted-circle): Verified directory of student representatives, faculty/department contacts, and trusted campus service providers.`,
    `- [The Unfiltered (Anonymous Campus Discussions)](${safeOrigin}/?view=anonymous): Privacy-protected anonymous forum for candid LASUED student discussions, questions, and campus life perspectives.`,
    `- [Search LASUED Intel](${safeOrigin}/?view=search): Instant search across campus updates, members, marketplace listings, opportunities, events, and community discussions.`,
    '',
    '## Who LASUED Intel Serves',
    '- Undergraduate and postgraduate students of Lagos State University of Education (LASUED) at Ijanikin (Oto/Ijanikin) and Epe campuses.',
    '- Prospective LASUED applicants seeking verified campus information, events, student life insights, and academic opportunities.',
    '- LASUED student entrepreneurs, course representatives, and student organizations sharing verified campus notices and services.',
    '',
  ].join('\n');
}

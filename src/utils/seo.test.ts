import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getCanonicalProductionOrigin } from '../config/site';
import { normalizeRouteDestination } from './navigationHistory';
import {
  INDEX_ROBOTS_DIRECTIVE,
  isIndexableDestination,
  PUBLIC_SITEMAP_ROUTES,
  resolveCanonicalUrl,
  resolvePageSeoMetadata,
} from './seo';
import {
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  resolveServerPublicOrigin,
} from '../../api/_lib/siteOrigin';
import llmsHandler from '../../api/llms.js';
import type { VercelLikeRequest, VercelLikeResponse } from '../../api/_lib/pushConfig.js';

function createMockRes(): {
  res: VercelLikeResponse;
  getStatus: () => number;
  getHeader: (name: string) => string | undefined;
  getBody: () => string;
} {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};
  const res: VercelLikeResponse = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = JSON.stringify(payload);
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') {
        body = chunk;
      }
      statusCode = this.statusCode ?? statusCode;
    },
  };
  return {
    res,
    getStatus: () => statusCode,
    getHeader: (name: string) => headers[name.toLowerCase()],
    getBody: () => body,
  };
}

test('public routes use max-image-preview:large, build clean canonicals, and include rich Schema.org graphs', () => {
  const origin = 'https://lasuedintel.com.ng';
  const home = normalizeRouteDestination({ route: 'for-you' });
  const homeMeta = resolvePageSeoMetadata(home, origin);
  assert.equal(homeMeta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.match(homeMeta.robots, /max-image-preview:large/);
  assert.equal(homeMeta.canonicalUrl, `${origin}/`);
  assert.equal(homeMeta.ogUrl, `${origin}/`);
  assert.equal(homeMeta.twitterUrl, `${origin}/`);
  assert.equal(homeMeta.ogImage, `${origin}/og-share.png`);
  assert.equal(homeMeta.twitterImage, `${origin}/og-share.png`);
  assert.equal(homeMeta.twitterCard, 'summary_large_image');
  assert.equal(homeMeta.ogImageWidth, '1200');
  assert.equal(homeMeta.ogImageHeight, '630');
  assert.match(homeMeta.title, /LASUED Intel/);
  assert.match(homeMeta.description, /Lagos State University of Education/);

  const homeGraph = (homeMeta.jsonLd['@graph'] as { '@type': string }[]) ?? [];
  assert.deepEqual(
    homeGraph.map((item) => item['@type']),
    ['Organization', 'WebSite', 'WebPage', 'WebApplication', 'ItemList', 'FAQPage']
  );

  const marketplace = normalizeRouteDestination({ route: 'marketplace' });
  const mktMeta = resolvePageSeoMetadata(marketplace, origin);
  assert.equal(mktMeta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.equal(mktMeta.canonicalUrl, `${origin}/?view=marketplace`);
  assert.match(mktMeta.title, /Marketplace/i);
  const mktGraph = (mktMeta.jsonLd['@graph'] as { '@type': string }[]) ?? [];
  assert.deepEqual(
    mktGraph.map((item) => item['@type']),
    ['Organization', 'WebSite', 'WebPage', 'WebApplication', 'BreadcrumbList']
  );

  const mktUpdates = normalizeRouteDestination({
    route: 'marketplace',
    marketplaceTab: 'updates',
  });
  const mktUpdatesMeta = resolvePageSeoMetadata(mktUpdates, origin);
  assert.equal(mktUpdatesMeta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.equal(
    mktUpdatesMeta.canonicalUrl,
    `${origin}/?view=marketplace&mktTab=updates`
  );

  const anonymous = normalizeRouteDestination({ route: 'anonymous' });
  const anonMeta = resolvePageSeoMetadata(anonymous, origin);
  assert.equal(anonMeta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.equal(anonMeta.canonicalUrl, `${origin}/?view=anonymous`);
  assert.doesNotMatch(anonMeta.description, /gmail\.com/i);

  const updates = normalizeRouteDestination({ route: 'updates', postId: 'upd_7' });
  const updatesMeta = resolvePageSeoMetadata(updates, origin);
  assert.equal(updatesMeta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.equal(updatesMeta.canonicalUrl, `${origin}/?view=updates&postId=upd_7`);
  assert.match(updatesMeta.title, /Updates/i);
});

test('getCanonicalProductionOrigin defaults to https://lasuedintel.com.ng', () => {
  assert.equal(getCanonicalProductionOrigin(), 'https://lasuedintel.com.ng');
  assert.equal(
    getCanonicalProductionOrigin('https://lasuedintel.com.ng/'),
    'https://lasuedintel.com.ng'
  );
});

test('protected, auth, admin, personal tabs, and active search queries are marked noindex, nofollow', () => {
  const origin = 'https://lasuedintel.com.ng';
  const nonIndexableRoutes = [
    normalizeRouteDestination({ route: 'admin' }),
    normalizeRouteDestination({ route: 'account' }),
    normalizeRouteDestination({ route: 'notifications' }),
    normalizeRouteDestination({ route: 'login' }),
    normalizeRouteDestination({ route: 'register' }),
    normalizeRouteDestination({ route: 'following' }),
    normalizeRouteDestination({
      route: 'profile',
      username: 'adaobi',
      profileTab: 'saved',
    }),
    normalizeRouteDestination({
      route: 'profile',
      username: 'adaobi',
      profileTab: 'anonymous',
    }),
    normalizeRouteDestination({
      route: 'marketplace',
      marketplaceTab: 'pending_approvals',
    }),
    normalizeRouteDestination({
      route: 'search',
      searchQuery: 'past questions',
    }),
  ];

  for (const dest of nonIndexableRoutes) {
    assert.equal(
      isIndexableDestination(dest),
      false,
      `Expected ${dest.route} to be non-indexable`
    );
    const meta = resolvePageSeoMetadata(dest, origin);
    assert.equal(meta.robots, 'noindex, nofollow');
    const graphTypes = (
      (meta.jsonLd['@graph'] as { '@type': string }[]) ?? []
    ).map((item) => item['@type']);
    assert.equal(graphTypes.includes('BreadcrumbList'), false);
  }
});

test('public member profile route is indexable only on public tabs and normalizes username canonical', () => {
  const origin = 'https://lasuedintel.com.ng';
  const publicProfile = normalizeRouteDestination({
    route: 'profile',
    username: 'CampusRep',
    profileTab: 'posts',
  });
  const meta = resolvePageSeoMetadata(publicProfile, origin);
  assert.equal(meta.robots, INDEX_ROBOTS_DIRECTIVE);
  assert.equal(meta.ogType, 'profile');
  assert.equal(meta.canonicalUrl, `${origin}/?view=profile&username=campusrep`);

  const anonProfile = normalizeRouteDestination({
    route: 'profile',
    username: 'CampusRep',
    profileTab: 'anonymous',
  });
  assert.equal(resolvePageSeoMetadata(anonProfile, origin).robots, 'noindex, nofollow');
});

test('canonical URL strips noisy commentId and default tab parameters', () => {
  const origin = 'https://lasuedintel.com.ng';
  const listing = normalizeRouteDestination({
    route: 'marketplace',
    marketplaceTab: 'browse',
    listingId: 'lst_42',
    commentId: 'cmt_9',
  });
  assert.equal(
    resolveCanonicalUrl(listing, origin),
    `${origin}/?view=marketplace&listingId=lst_42`
  );
});

test('sitemap.xml includes Google Image annotations, dynamic entries, and robots.txt welcomes Google & AI crawlers', () => {
  const origin = 'https://lasuedintel.com.ng';
  const xml = buildSitemapXml(origin, [
    {
      path: '/?view=updates&postId=upd_123',
      changefreq: 'daily',
      priority: '0.8',
      lastmod: '2026-11-25',
      images: [
        {
          loc: '/og-share.png',
          title: 'Academic Calendar & Briefing <Test>',
          caption: 'Official notice from LASUED.',
        },
      ],
    },
  ]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'));
  assert.ok(xml.includes(`<image:loc>${origin}/og-share.png</image:loc>`));
  assert.ok(xml.includes(`<image:loc>${origin}/lasued-intel.webp</image:loc>`));
  assert.ok(xml.includes(`<loc>${origin}/?view=updates&amp;postId=upd_123</loc>`));
  assert.ok(xml.includes('<lastmod>2026-11-25</lastmod>'));
  assert.ok(xml.includes('&lt;Test&gt;'));

  for (const entry of PUBLIC_SITEMAP_ROUTES) {
    const escapedPath = entry.path.replace(/&/g, '&amp;');
    assert.ok(
      xml.includes(`<loc>${origin}${escapedPath}</loc>`),
      `Missing ${entry.path} in sitemap`
    );
  }
  assert.equal(xml.includes('view=admin'), false);
  assert.equal(xml.includes('view=account'), false);
  assert.equal(xml.includes('view=login'), false);
  assert.equal(xml.includes('view=notifications'), false);

  const robots = buildRobotsTxt(origin);
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /User-agent: Googlebot/);
  assert.match(robots, /User-agent: Googlebot-Image/);
  assert.match(robots, /User-agent: Google-Extended/);
  assert.match(robots, /User-agent: OAI-SearchBot/);
  assert.match(robots, /User-agent: GPTBot/);
  assert.match(robots, /User-agent: ClaudeBot/);
  assert.match(robots, /User-agent: PerplexityBot/);
  assert.match(robots, /Allow: \/og-share\.png/);
  assert.match(robots, /Allow: \/lasued-intel\.webp/);
  assert.match(robots, /Allow: \/llms\.txt/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/\*\?\*view=admin\*/);
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
});

test('static SEO files, llms.txt, index.html preview markup, and favicon assets match production origin', () => {
  const staticSitemap = fs.readFileSync(path.resolve('public/sitemap.xml'), 'utf8');
  const staticRobots = fs.readFileSync(path.resolve('public/robots.txt'), 'utf8');
  const staticLlms = fs.readFileSync(path.resolve('public/llms.txt'), 'utf8');
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const staticManifest = JSON.parse(
    fs.readFileSync(path.resolve('public/site.webmanifest'), 'utf8')
  ) as { name: string; icons: { src: string; sizes: string }[] };

  assert.equal(staticSitemap.trim(), buildSitemapXml('https://lasuedintel.com.ng').trim());
  assert.equal(staticRobots.trim(), buildRobotsTxt('https://lasuedintel.com.ng').trim());
  assert.equal(staticLlms.trim(), buildLlmsTxt('https://lasuedintel.com.ng').trim());
  assert.equal(staticManifest.name, 'LASUED Intel');
  assert.ok(staticManifest.icons.some((icon) => icon.src === '/pwa-192x192.png'));

  assert.match(indexHtml, /max-image-preview:large/);
  assert.match(indexHtml, /rel="image_src" href="https:\/\/lasuedintel\.com\.ng\/og-share\.png"/);
  assert.match(indexHtml, /title="LLMs\.txt" href="https:\/\/lasuedintel\.com\.ng\/llms\.txt"/);
  assert.match(indexHtml, /Lagos State University of Education \(LASUED\)/);
  assert.match(indexHtml, /src="\/og-share\.png"/);
  assert.match(indexHtml, /src="\/lasued-intel\.webp"/);

  for (const asset of [
    'public/favicon.ico',
    'public/favicon.svg',
    'public/favicon-16x16.png',
    'public/favicon-32x32.png',
    'public/favicon-48x48.png',
    'public/apple-touch-icon.png',
    'public/og-share.png',
    'public/pwa-192x192.png',
    'public/pwa-512x512.png',
    'public/pwa-maskable-512x512.png',
    'public/llms.txt',
    'lasued-intel.webp',
  ]) {
    assert.ok(fs.statSync(path.resolve(asset)).size > 0, `Empty or missing asset ${asset}`);
  }
});

test('/api/llms serves buildLlmsTxt and rejects non-GET/HEAD requests', async () => {
  const postMock = createMockRes();
  await llmsHandler(
    { method: 'POST', headers: {} } as VercelLikeRequest,
    postMock.res
  );
  assert.equal(postMock.getStatus(), 405);

  const getMock = createMockRes();
  await llmsHandler(
    { method: 'GET', headers: {} } as VercelLikeRequest,
    getMock.res
  );
  assert.equal(getMock.getStatus(), 200);
  assert.equal(getMock.getHeader('content-type'), 'text/plain; charset=utf-8');
  assert.equal(getMock.getBody().trim(), buildLlmsTxt('https://lasuedintel.com.ng').trim());
});

test('resolveServerPublicOrigin respects priority VITE_PUBLIC_BASE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > host', () => {
  const saved = {
    VITE_PUBLIC_BASE_URL: process.env.VITE_PUBLIC_BASE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  };

  try {
    process.env.VITE_PUBLIC_BASE_URL = 'https://custom.lasuedintel.example/';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'lasuedintel.com.ng';
    process.env.VERCEL_URL = 'lasued-intel-git-main.vercel.app';
    assert.equal(
      resolveServerPublicOrigin({ host: 'ignored.local' }),
      'https://custom.lasuedintel.example'
    );

    delete process.env.VITE_PUBLIC_BASE_URL;
    assert.equal(
      resolveServerPublicOrigin({ host: 'ignored.local' }),
      'https://lasuedintel.com.ng'
    );

    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    assert.equal(
      resolveServerPublicOrigin({ host: 'ignored.local' }),
      'https://lasued-intel-git-main.vercel.app'
    );

    delete process.env.VERCEL_URL;
    assert.equal(
      resolveServerPublicOrigin({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'lasued-staging.vercel.app',
      }),
      'https://lasued-staging.vercel.app'
    );
  } finally {
    if (saved.VITE_PUBLIC_BASE_URL !== undefined) {
      process.env.VITE_PUBLIC_BASE_URL = saved.VITE_PUBLIC_BASE_URL;
    } else {
      delete process.env.VITE_PUBLIC_BASE_URL;
    }
    if (saved.VERCEL_PROJECT_PRODUCTION_URL !== undefined) {
      process.env.VERCEL_PROJECT_PRODUCTION_URL = saved.VERCEL_PROJECT_PRODUCTION_URL;
    } else {
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    }
    if (saved.VERCEL_URL !== undefined) {
      process.env.VERCEL_URL = saved.VERCEL_URL;
    } else {
      delete process.env.VERCEL_URL;
    }
  }
});

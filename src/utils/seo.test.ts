import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRouteDestination } from './navigationHistory';
import {
  isIndexableDestination,
  PUBLIC_SITEMAP_ROUTES,
  resolveCanonicalUrl,
  resolvePageSeoMetadata,
} from './seo';
import {
  buildRobotsTxt,
  buildSitemapXml,
  resolveServerPublicOrigin,
} from '../../api/_lib/siteOrigin';

test('public routes are marked index, follow and build clean canonical URLs', () => {
  const origin = 'https://lasued-intel.vercel.app';
  const home = normalizeRouteDestination({ route: 'for-you' });
  const homeMeta = resolvePageSeoMetadata(home, origin);
  assert.equal(homeMeta.robots, 'index, follow');
  assert.equal(homeMeta.canonicalUrl, `${origin}/`);
  assert.equal(homeMeta.ogUrl, `${origin}/`);
  assert.equal(homeMeta.ogImage, `${origin}/og-share.png`);
  assert.equal(homeMeta.twitterCard, 'summary_large_image');
  assert.equal(homeMeta.ogImageWidth, '1200');
  assert.equal(homeMeta.ogImageHeight, '630');
  assert.match(homeMeta.title, /LASUED Intel/);

  const marketplace = normalizeRouteDestination({ route: 'marketplace' });
  const mktMeta = resolvePageSeoMetadata(marketplace, origin);
  assert.equal(mktMeta.robots, 'index, follow');
  assert.equal(mktMeta.canonicalUrl, `${origin}/?view=marketplace`);
  assert.match(mktMeta.title, /Marketplace/i);

  const anonymous = normalizeRouteDestination({ route: 'anonymous' });
  const anonMeta = resolvePageSeoMetadata(anonymous, origin);
  assert.equal(anonMeta.robots, 'index, follow');
  assert.equal(anonMeta.canonicalUrl, `${origin}/?view=anonymous`);
  assert.doesNotMatch(anonMeta.description, /gmail\.com/i);
});

test('protected, auth, admin, personal tabs, and active search queries are marked noindex, nofollow', () => {
  const origin = 'https://lasued-intel-demo.vercel.app';
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
  }
});

test('public member profile route is indexable only on public tabs and normalizes username canonical', () => {
  const origin = 'https://lasued-intel-demo.vercel.app';
  const publicProfile = normalizeRouteDestination({
    route: 'profile',
    username: 'CampusRep',
    profileTab: 'posts',
  });
  const meta = resolvePageSeoMetadata(publicProfile, origin);
  assert.equal(meta.robots, 'index, follow');
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
  const origin = 'https://lasued-intel-demo.vercel.app';
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

test('sitemap.xml and robots.txt use active origin and exclude private routes', () => {
  const origin = 'https://lasued-intel-preview.vercel.app';
  const xml = buildSitemapXml(origin);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
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
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/\*\?\*view=admin\*/);
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
});

test('resolveServerPublicOrigin respects priority VITE_PUBLIC_BASE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > host', () => {
  const saved = {
    VITE_PUBLIC_BASE_URL: process.env.VITE_PUBLIC_BASE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  };

  try {
    process.env.VITE_PUBLIC_BASE_URL = 'https://custom.lasuedintel.example/';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'lasued-intel.vercel.app';
    process.env.VERCEL_URL = 'lasued-intel-git-main.vercel.app';
    assert.equal(
      resolveServerPublicOrigin({ host: 'ignored.local' }),
      'https://custom.lasuedintel.example'
    );

    delete process.env.VITE_PUBLIC_BASE_URL;
    assert.equal(
      resolveServerPublicOrigin({ host: 'ignored.local' }),
      'https://lasued-intel.vercel.app'
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

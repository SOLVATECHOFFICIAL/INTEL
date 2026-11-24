import { BRAND } from '../config/brand';
import {
  buildPublicAppUrl,
  buildPublicImageUrl,
  normalizePublicOrigin,
} from '../config/site';
import type { NormalizedRouteDestination } from './navigationHistory';
import { buildSearchForRoute } from './urlRouting';

export type RobotsDirective = 'index, follow' | 'noindex, nofollow';

export interface PageSeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: RobotsDirective;
  ogType: 'website' | 'profile';
  ogSiteName: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogImage: string;
  ogImageWidth: string;
  ogImageHeight: string;
  ogImageType: string;
  ogImageAlt: string;
  twitterCard: 'summary' | 'summary_large_image';
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  jsonLd: Record<string, unknown>;
}

export interface SitemapRouteDefinition {
  path: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly';
  priority: string;
}

export const PUBLIC_SITEMAP_ROUTES: readonly SitemapRouteDefinition[] = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/?view=latest', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=anonymous', changefreq: 'hourly', priority: '0.8' },
  { path: '/?view=marketplace', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=trusted-circle', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=opportunities', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=upcoming-events', changefreq: 'daily', priority: '0.8' },
  { path: '/?view=search', changefreq: 'weekly', priority: '0.6' },
] as const;

export function isIndexableDestination(dest: NormalizedRouteDestination): boolean {
  if (
    dest.route === 'admin' ||
    dest.route === 'account' ||
    dest.route === 'notifications' ||
    dest.route === 'login' ||
    dest.route === 'register' ||
    dest.route === 'following'
  ) {
    return false;
  }

  if (dest.route === 'profile') {
    if (!dest.username) return false;
    if (dest.profileTab === 'saved' || dest.profileTab === 'anonymous') {
      return false;
    }
  }

  if (dest.route === 'marketplace') {
    if (
      dest.marketplaceTab === 'my_listings' ||
      dest.marketplaceTab === 'pending_approvals'
    ) {
      return false;
    }
  }

  if (dest.route === 'search' && Boolean(dest.searchQuery)) {
    return false;
  }

  return true;
}

export function resolveCanonicalUrl(
  dest: NormalizedRouteDestination,
  baseOrigin: string
): string {
  const safeOrigin = normalizePublicOrigin(baseOrigin) ?? 'https://lasued-intel.vercel.app';

  if (dest.route === 'for-you' && !dest.postId) {
    return buildPublicAppUrl('/', safeOrigin);
  }

  const rawRelative = buildSearchForRoute(dest.route, {
    username: dest.username,
    profileTab:
      dest.profileTab === 'saved' || dest.profileTab === 'anonymous'
        ? dest.profileTab
        : dest.profileTab && dest.profileTab !== 'posts'
          ? dest.profileTab
          : undefined,
    searchScope:
      dest.route === 'search' && dest.searchScope !== 'all'
        ? dest.searchScope
        : undefined,
    searchQuery: dest.route === 'search' ? dest.searchQuery : undefined,
    opportunityId: dest.route === 'opportunities' ? dest.opportunityId : undefined,
    eventId: dest.route === 'upcoming-events' ? dest.eventId : undefined,
    postId:
      dest.route === 'for-you' ||
      dest.route === 'following' ||
      dest.route === 'latest' ||
      dest.route === 'anonymous'
        ? dest.postId
        : undefined,
    listingId: dest.route === 'marketplace' ? dest.listingId : undefined,
    marketplaceTab:
      dest.route === 'marketplace' && dest.marketplaceTab !== 'browse'
        ? dest.marketplaceTab
        : undefined,
    accountSection:
      dest.route === 'account' && dest.accountSection !== 'profile'
        ? dest.accountSection
        : undefined,
  });

  // Always normalize pathname to '/' so canonical URLs stay consistent regardless of deep paths
  const queryStart = rawRelative.indexOf('?');
  const normalizedPathAndQuery =
    queryStart >= 0 ? `/${rawRelative.slice(queryStart)}` : '/';

  return buildPublicAppUrl(normalizedPathAndQuery, safeOrigin);
}

function resolveRouteCopy(dest: NormalizedRouteDestination): {
  title: string;
  description: string;
  ogType: 'website' | 'profile';
} {
  switch (dest.route) {
    case 'latest':
      return {
        title: `Latest Campus Posts — ${BRAND.name}`,
        description:
          'Read the latest verified campus updates, discussions, and announcements from students across LASUED Intel.',
        ogType: 'website',
      };
    case 'following':
      return {
        title: `Following Feed — ${BRAND.name}`,
        description:
          'Personal following feed for signed-in LASUED Intel members.',
        ogType: 'website',
      };
    case 'anonymous':
      return {
        title: `The Unfiltered (Anonymous Confessions & Polls) — ${BRAND.name}`,
        description:
          'Join candid, privacy-protected anonymous campus conversations, questions, and community discussions on LASUED Intel.',
        ogType: 'website',
      };
    case 'marketplace':
      if (dest.marketplaceTab === 'my_listings') {
        return {
          title: `My Marketplace Listings — ${BRAND.name}`,
          description:
            'Manage your active and submitted student marketplace listings on LASUED Intel.',
          ogType: 'website',
        };
      }
      if (dest.marketplaceTab === 'pending_approvals') {
        return {
          title: `Marketplace Approvals — ${BRAND.name}`,
          description: 'Moderation queue for LASUED Intel student marketplace listings.',
          ogType: 'website',
        };
      }
      if (dest.marketplaceTab === 'updates') {
        return {
          title: `Marketplace Updates — ${BRAND.name}`,
          description:
            'Stay updated on new campus marketplace activity, listing notices, and guidelines on LASUED Intel.',
          ogType: 'website',
        };
      }
      return {
        title: `Campus Marketplace — ${BRAND.name}`,
        description:
          'Browse verified student products, services, books, and campus marketplace listings on LASUED Intel.',
        ogType: 'website',
      };
    case 'trusted-circle':
      return {
        title: `Trusted Circle Directory — ${BRAND.name}`,
        description:
          'Discover trusted student contacts, campus representatives, and verified service providers on LASUED Intel.',
        ogType: 'website',
      };
    case 'opportunities':
      return {
        title: `Student Opportunities & Scholarships — ${BRAND.name}`,
        description:
          'Explore internships, grants, fellowships, competitions, and academic opportunities curated for students on LASUED Intel.',
        ogType: 'website',
      };
    case 'upcoming-events':
      return {
        title: `Upcoming Campus Events — ${BRAND.name}`,
        description:
          'Track upcoming student events, seminars, deadlines, and campus gatherings on LASUED Intel.',
        ogType: 'website',
      };
    case 'search':
      return {
        title: dest.searchQuery
          ? `Search: ${dest.searchQuery} — ${BRAND.name}`
          : `Search ${BRAND.name}`,
        description:
          'Search public posts, anonymous threads, student marketplace listings, opportunities, and campus events on LASUED Intel.',
        ogType: 'website',
      };
    case 'profile':
      return {
        title: dest.username
          ? `@${dest.username} — ${BRAND.name}`
          : `Member Profile — ${BRAND.name}`,
        description: dest.username
          ? `View public campus posts and community activity for @${dest.username} on LASUED Intel.`
          : 'View member profile details on LASUED Intel.',
        ogType: dest.username ? 'profile' : 'website',
      };
    case 'notifications':
      return {
        title: `Notifications — ${BRAND.name}`,
        description: 'Personal notification center for LASUED Intel members.',
        ogType: 'website',
      };
    case 'account':
      return {
        title: `Account Settings — ${BRAND.name}`,
        description: 'Manage your LASUED Intel account, security, and privacy settings.',
        ogType: 'website',
      };
    case 'admin':
      return {
        title: `Admin Guard — ${BRAND.name}`,
        description: 'Protected administration workspace for LASUED Intel.',
        ogType: 'website',
      };
    case 'login':
      return {
        title: `Sign In — ${BRAND.name}`,
        description: 'Sign in to your LASUED Intel student community account.',
        ogType: 'website',
      };
    case 'register':
      return {
        title: `Create Account — ${BRAND.name}`,
        description: 'Create your LASUED Intel student community account.',
        ogType: 'website',
      };
    case 'for-you':
    default:
      return {
        title: `${BRAND.name} — ${BRAND.tagline}`,
        description:
          'LASUED Intel is a student information and community platform featuring campus updates, The Unfiltered discussions, student marketplace, trusted circle, opportunities, and upcoming events.',
        ogType: 'website',
      };
  }
}

export function resolvePageSeoMetadata(
  dest: NormalizedRouteDestination,
  baseOrigin: string
): PageSeoMetadata {
  const safeOrigin = normalizePublicOrigin(baseOrigin) ?? 'https://lasued-intel.vercel.app';
  const canonicalUrl = resolveCanonicalUrl(dest, safeOrigin);
  const robots: RobotsDirective = isIndexableDestination(dest)
    ? 'index, follow'
    : 'noindex, nofollow';
  const copy = resolveRouteCopy(dest);
  const ogImage = buildPublicImageUrl('/og-share.png', safeOrigin);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: BRAND.name,
        url: buildPublicAppUrl('/', safeOrigin),
        description:
          'LASUED Intel — Your Campus. Your Information. Your Community. A student information and community platform.',
        potentialAction: {
          '@type': 'SearchAction',
          target: `${buildPublicAppUrl('/', safeOrigin)}?view=search&scope=all&q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'WebApplication',
        name: BRAND.name,
        url: canonicalUrl,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web, Android, iOS',
        description: copy.description,
        image: ogImage,
      },
    ],
  };

  return {
    title: copy.title,
    description: copy.description,
    canonicalUrl,
    robots,
    ogType: copy.ogType,
    ogSiteName: BRAND.name,
    ogTitle: copy.title,
    ogDescription: copy.description,
    ogUrl: canonicalUrl,
    ogImage,
    ogImageWidth: '1200',
    ogImageHeight: '630',
    ogImageType: 'image/png',
    ogImageAlt: `${BRAND.name} — ${BRAND.tagline}`,
    twitterCard: 'summary_large_image',
    twitterTitle: copy.title,
    twitterDescription: copy.description,
    twitterImage: ogImage,
    jsonLd,
  };
}

function upsertMetaByName(name: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertMetaByProperty(property: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(
    `meta[property="${property}"]`
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonicalLink(href: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function upsertJsonLdScript(payload: Record<string, unknown>): void {
  if (typeof document === 'undefined') return;
  let script = document.getElementById(
    'lasued-intel-jsonld'
  ) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'lasued-intel-jsonld';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

export function applyDocumentSeoMetadata(meta: PageSeoMetadata): void {
  if (typeof document === 'undefined') return;
  document.title = meta.title;
  upsertMetaByName('description', meta.description);
  upsertMetaByName('robots', meta.robots);
  upsertCanonicalLink(meta.canonicalUrl);
  upsertMetaByProperty('og:type', meta.ogType);
  upsertMetaByProperty('og:site_name', meta.ogSiteName);
  upsertMetaByProperty('og:title', meta.ogTitle);
  upsertMetaByProperty('og:description', meta.ogDescription);
  upsertMetaByProperty('og:url', meta.ogUrl);
  upsertMetaByProperty('og:image', meta.ogImage);
  upsertMetaByProperty('og:image:secure_url', meta.ogImage);
  upsertMetaByProperty('og:image:type', meta.ogImageType);
  upsertMetaByProperty('og:image:width', meta.ogImageWidth);
  upsertMetaByProperty('og:image:height', meta.ogImageHeight);
  upsertMetaByProperty('og:image:alt', meta.ogImageAlt);
  upsertMetaByName('twitter:card', meta.twitterCard);
  upsertMetaByName('twitter:title', meta.twitterTitle);
  upsertMetaByName('twitter:description', meta.twitterDescription);
  upsertMetaByName('twitter:image', meta.twitterImage);
  upsertJsonLdScript(meta.jsonLd);
}

import { BRAND } from '../config/brand';
import {
  buildCanonicalPublicAppUrl,
  buildPublicImageUrl,
  normalizePublicOrigin,
} from '../config/site';
import type { NormalizedRouteDestination } from './navigationHistory';
import { buildSearchForRoute } from './urlRouting';

export type RobotsDirective =
  | 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
  | 'noindex, nofollow';

export const INDEX_ROBOTS_DIRECTIVE: RobotsDirective =
  'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

export interface PageSeoMetadata {
  title: string;
  description: string;
  keywords: string;
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
  twitterUrl: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  twitterImageAlt: string;
  jsonLd: Record<string, unknown>;
}

export interface SitemapRouteDefinition {
  path: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly';
  priority: string;
}

export const PUBLIC_SITEMAP_ROUTES: readonly SitemapRouteDefinition[] = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/?view=updates', changefreq: 'hourly', priority: '0.95' },
  { path: '/?view=latest', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=marketplace', changefreq: 'hourly', priority: '0.9' },
  { path: '/?view=marketplace&mktTab=updates', changefreq: 'daily', priority: '0.75' },
  { path: '/?view=opportunities', changefreq: 'daily', priority: '0.9' },
  { path: '/?view=upcoming-events', changefreq: 'daily', priority: '0.85' },
  { path: '/?view=trusted-circle', changefreq: 'daily', priority: '0.85' },
  { path: '/?view=anonymous', changefreq: 'hourly', priority: '0.8' },
  { path: '/?view=search', changefreq: 'weekly', priority: '0.7' },
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
  const safeOrigin = normalizePublicOrigin(baseOrigin) ?? 'https://lasuedintel.com.ng';

  if (dest.route === 'for-you' && !dest.postId) {
    return buildCanonicalPublicAppUrl('/', safeOrigin);
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
      dest.route === 'updates' ||
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

  return buildCanonicalPublicAppUrl(normalizedPathAndQuery, safeOrigin);
}

const DEFAULT_KEYWORDS =
  'LASUED Intel, Lagos State University of Education, LASUED Ijanikin, LASUED Epe, LASUED campus news, LASUED updates, LASUED student marketplace, LASUED opportunities, LASUED scholarships, LASUED events, LASUED Trusted Circle, The Unfiltered LASUED';

function resolveRouteCopy(dest: NormalizedRouteDestination): {
  title: string;
  description: string;
  keywords: string;
  ogType: 'website' | 'profile';
} {
  switch (dest.route) {
    case 'latest':
      return {
        title: `Latest LASUED Campus Posts — ${BRAND.name}`,
        description:
          'Read real-time campus posts, verified student updates, and community discussions across Lagos State University of Education (LASUED) Oto/Ijanikin and Epe campuses.',
        keywords: `LASUED latest posts, LASUED student news, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'following':
      return {
        title: `Following Feed — ${BRAND.name}`,
        description:
          'Personal following feed for signed-in LASUED Intel members.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'updates':
      return {
        title: `Official LASUED Campus Updates & Notices — ${BRAND.name}`,
        description:
          'Read verified administrative briefings, academic calendar notices, examination schedules, and official campus advisories for Lagos State University of Education (LASUED) students.',
        keywords: `LASUED official updates, LASUED academic calendar, LASUED notices, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'anonymous':
      return {
        title: `The Unfiltered (Anonymous LASUED Discussions) — ${BRAND.name}`,
        description:
          'Join candid, privacy-protected anonymous campus conversations, questions, and student perspectives across Lagos State University of Education on LASUED Intel.',
        keywords: `The Unfiltered LASUED, LASUED anonymous discussions, LASUED student forum, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'marketplace':
      if (dest.marketplaceTab === 'my_listings') {
        return {
          title: `My Marketplace Listings — ${BRAND.name}`,
          description:
            'Manage your active and submitted student marketplace listings on LASUED Intel.',
          keywords: DEFAULT_KEYWORDS,
          ogType: 'website',
        };
      }
      if (dest.marketplaceTab === 'pending_approvals') {
        return {
          title: `Marketplace Approvals — ${BRAND.name}`,
          description: 'Moderation queue for LASUED Intel student marketplace listings.',
          keywords: DEFAULT_KEYWORDS,
          ogType: 'website',
        };
      }
      if (dest.marketplaceTab === 'updates') {
        return {
          title: `LASUED Marketplace Updates & Guidelines — ${BRAND.name}`,
          description:
            'Stay updated on verified student marketplace notices, buyer safety reminders, and listing guidelines at Lagos State University of Education (LASUED).',
          keywords: `LASUED marketplace updates, LASUED student market, ${DEFAULT_KEYWORDS}`,
          ogType: 'website',
        };
      }
      return {
        title: `LASUED Campus Marketplace — ${BRAND.name}`,
        description:
          'Buy and sell verified student textbooks, past questions, gadgets, hostel essentials, and campus services across LASUED Ijanikin and Epe on LASUED Intel.',
        keywords: `LASUED marketplace, LASUED textbooks, LASUED hostels, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'trusted-circle':
      return {
        title: `Trusted Circle LASUED Directory — ${BRAND.name}`,
        description:
          'Discover verified student contacts, faculty and course representatives, and trusted campus service providers at Lagos State University of Education (LASUED).',
        keywords: `LASUED Trusted Circle, LASUED directory, LASUED student reps, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'opportunities':
      return {
        title: `LASUED Student Opportunities & Scholarships — ${BRAND.name}`,
        description:
          'Explore curated scholarships, grants, internships, fellowships, skill programmes, and graduate openings for Lagos State University of Education (LASUED) students.',
        keywords: `LASUED scholarships, LASUED internships, Nigerian student opportunities, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'upcoming-events':
      return {
        title: `Upcoming LASUED Campus Events — ${BRAND.name}`,
        description:
          'Track upcoming academic seminars, orientations, student workshops, deadlines, and campus programmes across LASUED Oto/Ijanikin and Epe on LASUED Intel.',
        keywords: `LASUED events, LASUED calendar, LASUED programmes, ${DEFAULT_KEYWORDS}`,
        ogType: 'website',
      };
    case 'search':
      return {
        title: dest.searchQuery
          ? `Search: ${dest.searchQuery} — ${BRAND.name}`
          : `Search LASUED Intel — Campus News, Marketplace & Events`,
        description:
          'Search official LASUED campus updates, community posts, verified members, student marketplace listings, scholarships, and upcoming campus events.',
        keywords: `Search LASUED Intel, ${DEFAULT_KEYWORDS}`,
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
        keywords: DEFAULT_KEYWORDS,
        ogType: dest.username ? 'profile' : 'website',
      };
    case 'notifications':
      return {
        title: `Notifications — ${BRAND.name}`,
        description: 'Personal notification center for LASUED Intel members.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'account':
      return {
        title: `Account Settings — ${BRAND.name}`,
        description: 'Manage your LASUED Intel account, security, and privacy settings.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'admin':
      return {
        title: `Admin Guard — ${BRAND.name}`,
        description: 'Protected administration workspace for LASUED Intel.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'login':
      return {
        title: `Sign In — ${BRAND.name}`,
        description: 'Sign in to your LASUED Intel student community account.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'register':
      return {
        title: `Create Account — ${BRAND.name}`,
        description: 'Create your LASUED Intel student community account.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
    case 'for-you':
    default:
      return {
        title: `${BRAND.name} — ${BRAND.tagline} (Lagos State University of Education)`,
        description:
          'LASUED Intel is the student information and community hub for Lagos State University of Education (LASUED — Oto/Ijanikin & Epe), featuring Official Campus Updates, Latest Posts, Student Marketplace, Trusted Circle directory, Scholarships & Opportunities, Upcoming Events, and The Unfiltered discussions.',
        keywords: DEFAULT_KEYWORDS,
        ogType: 'website',
      };
  }
}

function resolveBreadcrumbName(dest: NormalizedRouteDestination): string | null {
  switch (dest.route) {
    case 'latest':
      return 'Latest Posts';
    case 'updates':
      return 'Official Updates';
    case 'anonymous':
      return 'The Unfiltered';
    case 'marketplace':
      return dest.marketplaceTab === 'updates'
        ? 'Marketplace Updates'
        : 'Campus Marketplace';
    case 'trusted-circle':
      return 'Trusted Circle';
    case 'opportunities':
      return 'Opportunities';
    case 'upcoming-events':
      return 'Upcoming Events';
    case 'search':
      return 'Search';
    case 'profile':
      return dest.username ? `@${dest.username}` : 'Member Profile';
    default:
      return null;
  }
}

function buildCoreSectionsItemList(rootUrl: string): Record<string, unknown> {
  const sections = [
    {
      name: 'Official Campus Updates',
      url: `${rootUrl}?view=updates`,
      description:
        'Verified administrative notices, academic calendar briefings, and campus advisories for LASUED students.',
    },
    {
      name: 'Latest Campus Posts',
      url: `${rootUrl}?view=latest`,
      description:
        'Real-time chronological feed of LASUED campus updates, student posts, and community alerts.',
    },
    {
      name: 'Campus Marketplace',
      url: `${rootUrl}?view=marketplace`,
      description:
        'Verified student-to-student marketplace for textbooks, past questions, gadgets, accommodation, and services.',
    },
    {
      name: 'Marketplace Updates & Notices',
      url: `${rootUrl}?view=marketplace&mktTab=updates`,
      description:
        'Buyer safety guidance and verified listing announcements for the LASUED Campus Marketplace.',
    },
    {
      name: 'Student Opportunities & Scholarships',
      url: `${rootUrl}?view=opportunities`,
      description:
        'Curated scholarships, grants, internships, fellowships, and skill programmes for LASUED students.',
    },
    {
      name: 'Upcoming Campus Events',
      url: `${rootUrl}?view=upcoming-events`,
      description:
        'Campus schedule of orientations, faculty seminars, workshops, deadlines, and student programmes.',
    },
    {
      name: 'Trusted Circle Directory',
      url: `${rootUrl}?view=trusted-circle`,
      description:
        'Verified directory of LASUED student representatives, campus contacts, and trusted service providers.',
    },
    {
      name: 'The Unfiltered (Anonymous Discussions)',
      url: `${rootUrl}?view=anonymous`,
      description:
        'Privacy-protected anonymous campus discussions and candid student Q&A at LASUED.',
    },
    {
      name: 'Search LASUED Intel',
      url: `${rootUrl}?view=search`,
      description:
        'Instant search across campus updates, members, marketplace listings, opportunities, and events.',
    },
  ];

  return {
    '@type': 'ItemList',
    '@id': `${rootUrl}#sections`,
    name: 'LASUED Intel Core Campus Sections',
    numberOfItems: sections.length,
    itemListElement: sections.map((section, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: section.name,
      description: section.description,
      url: section.url,
    })),
  };
}

function buildHomeFaqPage(rootUrl: string): Record<string, unknown> {
  const questions = [
    {
      question: 'What is LASUED Intel?',
      answer:
        'LASUED Intel (lasuedintel.com.ng) is a dedicated student information, campus news, marketplace, opportunities, events, and community platform built for Lagos State University of Education (LASUED) students across the Oto/Ijanikin and Epe campuses.',
    },
    {
      question: 'What information and features does LASUED Intel cover?',
      answer:
        'LASUED Intel provides verified Official Campus Updates, a real-time Latest Posts stream, a moderated Student Marketplace, curated Scholarships and Student Opportunities, Upcoming Campus Events, the Trusted Circle verified campus directory, and The Unfiltered anonymous student discussions.',
    },
    {
      question: 'Who can use LASUED Intel?',
      answer:
        'Public campus updates, marketplace listings, opportunities, upcoming events, and trusted campus directories are freely accessible to current LASUED undergraduate and postgraduate students, prospective applicants, and campus partners.',
    },
    {
      question: 'Where can students find official LASUED updates, scholarships, and marketplace items?',
      answer:
        'Visit Official Updates (?view=updates) for verified campus notices, Opportunities (?view=opportunities) for scholarships and internships, Marketplace (?view=marketplace) for books and student services, and Upcoming Events (?view=upcoming-events) for campus programmes.',
    },
  ];

  return {
    '@type': 'FAQPage',
    '@id': `${rootUrl}#faq`,
    mainEntity: questions.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function resolvePageSeoMetadata(
  dest: NormalizedRouteDestination,
  baseOrigin: string
): PageSeoMetadata {
  const safeOrigin = normalizePublicOrigin(baseOrigin) ?? 'https://lasuedintel.com.ng';
  const rootUrl = buildCanonicalPublicAppUrl('/', safeOrigin);
  const canonicalUrl = resolveCanonicalUrl(dest, safeOrigin);
  const indexable = isIndexableDestination(dest);
  const robots: RobotsDirective = indexable
    ? INDEX_ROBOTS_DIRECTIVE
    : 'noindex, nofollow';
  const copy = resolveRouteCopy(dest);
  const ogImage = buildPublicImageUrl('/og-share.png', safeOrigin);
  const emblemWebp = buildPublicImageUrl('/lasued-intel.webp', safeOrigin);
  const pwaIcon512 = buildPublicImageUrl('/pwa-512x512.png', safeOrigin);
  const ogImageAlt = `${BRAND.name} — Lagos State University of Education (LASUED) Student Hub Preview`;
  const breadcrumbName = indexable ? resolveBreadcrumbName(dest) : null;
  const isHomeRoute = dest.route === 'for-you' && !dest.postId;

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': `${rootUrl}#organization`,
      name: BRAND.name,
      alternateName: 'Lagos State University of Education Intel',
      url: rootUrl,
      logo: {
        '@type': 'ImageObject',
        url: pwaIcon512,
        contentUrl: pwaIcon512,
        width: 512,
        height: 512,
      },
      image: [ogImage, emblemWebp, pwaIcon512],
      areaServed: 'Lagos, Nigeria',
      knowsAbout: [
        'Lagos State University of Education',
        'LASUED Oto/Ijanikin Campus',
        'LASUED Epe Campus',
        'LASUED Official Campus Updates',
        'LASUED Student Marketplace',
        'LASUED Scholarships and Opportunities',
        'LASUED Upcoming Campus Events',
      ],
      description:
        'LASUED Intel — Your Campus. Your Information. Your Community. Student information, verified campus news, marketplace, opportunities, events, and community platform for Lagos State University of Education (LASUED).',
    },
    {
      '@type': 'WebSite',
      '@id': `${rootUrl}#website`,
      name: BRAND.name,
      url: rootUrl,
      inLanguage: 'en-NG',
      publisher: { '@id': `${rootUrl}#organization` },
      description:
        'LASUED Intel — Your Campus. Your Information. Your Community. Student information, verified campus news, marketplace, opportunities, events, and community platform for Lagos State University of Education (LASUED).',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${rootUrl}?view=search&scope=all&q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: copy.title,
      description: copy.description,
      inLanguage: 'en-NG',
      isPartOf: { '@id': `${rootUrl}#website` },
      about: { '@id': `${rootUrl}#organization` },
      thumbnailUrl: ogImage,
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: ogImage,
        contentUrl: ogImage,
        width: 1200,
        height: 630,
        caption: ogImageAlt,
      },
    },
    {
      '@type': 'WebApplication',
      '@id': `${rootUrl}#webapp`,
      name: BRAND.name,
      url: canonicalUrl,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web, Android, iOS',
      description: copy.description,
      image: ogImage,
      screenshot: {
        '@type': 'ImageObject',
        url: ogImage,
        contentUrl: ogImage,
        width: 1200,
        height: 630,
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'NGN',
      },
      publisher: { '@id': `${rootUrl}#organization` },
    },
  ];

  if (isHomeRoute) {
    graph.push(buildCoreSectionsItemList(rootUrl));
    graph.push(buildHomeFaqPage(rootUrl));
  } else if (breadcrumbName) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: BRAND.name,
          item: rootUrl,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: breadcrumbName,
          item: canonicalUrl,
        },
      ],
    });
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  return {
    title: copy.title,
    description: copy.description,
    keywords: copy.keywords,
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
    ogImageAlt,
    twitterCard: 'summary_large_image',
    twitterUrl: canonicalUrl,
    twitterTitle: copy.title,
    twitterDescription: copy.description,
    twitterImage: ogImage,
    twitterImageAlt: ogImageAlt,
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

function upsertMetaByItemprop(itemprop: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(
    `meta[itemprop="${itemprop}"]`
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('itemprop', itemprop);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLinkRel(rel: string, href: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', rel);
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
  upsertMetaByName('keywords', meta.keywords);
  upsertMetaByName('robots', meta.robots);
  upsertMetaByName('googlebot', meta.robots);
  upsertMetaByName('thumbnail', meta.ogImage);
  upsertMetaByItemprop('image', meta.ogImage);
  upsertLinkRel('canonical', meta.canonicalUrl);
  upsertLinkRel('image_src', meta.ogImage);
  upsertMetaByProperty('og:type', meta.ogType);
  upsertMetaByProperty('og:site_name', meta.ogSiteName);
  upsertMetaByProperty('og:title', meta.ogTitle);
  upsertMetaByProperty('og:description', meta.ogDescription);
  upsertMetaByProperty('og:url', meta.ogUrl);
  upsertMetaByProperty('og:image', meta.ogImage);
  upsertMetaByProperty('og:image:url', meta.ogImage);
  upsertMetaByProperty('og:image:secure_url', meta.ogImage);
  upsertMetaByProperty('og:image:type', meta.ogImageType);
  upsertMetaByProperty('og:image:width', meta.ogImageWidth);
  upsertMetaByProperty('og:image:height', meta.ogImageHeight);
  upsertMetaByProperty('og:image:alt', meta.ogImageAlt);
  upsertMetaByName('twitter:card', meta.twitterCard);
  upsertMetaByName('twitter:url', meta.twitterUrl);
  upsertMetaByName('twitter:title', meta.twitterTitle);
  upsertMetaByName('twitter:description', meta.twitterDescription);
  upsertMetaByName('twitter:image', meta.twitterImage);
  upsertMetaByName('twitter:image:src', meta.twitterImage);
  upsertMetaByName('twitter:image:alt', meta.twitterImageAlt);
  upsertJsonLdScript(meta.jsonLd);
}

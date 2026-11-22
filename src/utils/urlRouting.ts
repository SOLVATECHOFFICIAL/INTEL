import {
  AccountSettingsSection,
  ActiveRoute,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
} from '../types/platform';

const VALID_ROUTES: readonly ActiveRoute[] = [
  'for-you',
  'following',
  'latest',
  'anonymous',
  'marketplace',
  'trusted-circle',
  'opportunities',
  'upcoming-events',
  'notifications',
  'search',
  'account',
  'profile',
  'admin',
  'login',
  'register',
];

const VALID_SEARCH_SCOPES: readonly SearchScopeId[] = [
  'all',
  'posts',
  'people',
  'home',
  'anonymous',
  'marketplace',
  'trusted-circle',
  'opportunities',
  'upcoming-events',
];

const VALID_PROFILE_TABS: readonly ProfileTab[] = [
  'posts',
  'saved',
  'liked',
  'anonymous',
  'listings',
  'followers',
  'following',
];

const VALID_MARKETPLACE_TABS: readonly MarketplaceTab[] = [
  'browse',
  'my_listings',
  'updates',
  'pending_approvals',
];

const VALID_ACCOUNT_SECTIONS: readonly AccountSettingsSection[] = [
  'profile',
  'security',
  'privacy',
  'management',
];

export function isValidProfileTab(value: string | null): value is ProfileTab {
  return (
    value !== null &&
    (VALID_PROFILE_TABS as readonly string[]).includes(value)
  );
}

export function isValidMarketplaceTab(
  value: string | null
): value is MarketplaceTab {
  return (
    value !== null &&
    (VALID_MARKETPLACE_TABS as readonly string[]).includes(value)
  );
}

export function isValidAccountSection(
  value: string | null
): value is AccountSettingsSection {
  return (
    value !== null &&
    (VALID_ACCOUNT_SECTIONS as readonly string[]).includes(value)
  );
}

export function isValidRoute(value: string | null): value is ActiveRoute {
  return value !== null && (VALID_ROUTES as readonly string[]).includes(value);
}

export function isValidSearchScope(
  value: string | null
): value is SearchScopeId {
  return (
    value !== null &&
    (VALID_SEARCH_SCOPES as readonly string[]).includes(value)
  );
}

export function getSearchScopeFromRoute(route: ActiveRoute): SearchScopeId {
  switch (route) {
    case 'anonymous':
      return 'anonymous';
    case 'marketplace':
      return 'marketplace';
    case 'trusted-circle':
      return 'trusted-circle';
    case 'opportunities':
      return 'opportunities';
    case 'upcoming-events':
      return 'upcoming-events';
    default:
      return 'all';
  }
}

export interface ParsedRouteLocation {
  route: ActiveRoute;
  profileUsername: string | null;
  profileTab: ProfileTab | null;
  searchScope: SearchScopeId;
  searchQuery: string | null;
  opportunityId: string | null;
  eventId: string | null;
  postId: string | null;
  commentId: string | null;
  listingId: string | null;
  marketplaceTab: MarketplaceTab;
  accountSection: AccountSettingsSection;
}

function parseSafeIdParam(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
}

function parseSafeSearchQueryParam(params: URLSearchParams): string | null {
  const raw = params.get('q');
  if (!raw) return null;
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : null;
}

export function parseLocationSearch(search: string): ParsedRouteLocation {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const route = isValidRoute(view) ? view : 'for-you';
  const rawUsername = params.get('username');
  const profileUsername = rawUsername
    ? rawUsername.trim().toLowerCase()
    : null;
  const rawTab = params.get('tab');
  const profileTab = isValidProfileTab(rawTab) ? rawTab : null;
  const rawScope = params.get('scope');
  const searchScope = isValidSearchScope(rawScope)
    ? rawScope
    : route === 'search'
      ? 'all'
      : 'home';
  const searchQuery =
    route === 'search' ? parseSafeSearchQueryParam(params) : null;
  const opportunityId = parseSafeIdParam(params, 'opportunityId');
  const eventId = parseSafeIdParam(params, 'eventId');
  const postId = parseSafeIdParam(params, 'postId');
  const commentId = parseSafeIdParam(params, 'commentId');
  const listingId = parseSafeIdParam(params, 'listingId');
  const rawMktTab = params.get('mktTab');
  const marketplaceTab =
    route === 'marketplace' && isValidMarketplaceTab(rawMktTab)
      ? rawMktTab
      : 'browse';
  const rawSection = params.get('section');
  const accountSection =
    route === 'account' && isValidAccountSection(rawSection)
      ? rawSection
      : 'profile';

  return {
    route,
    profileUsername,
    profileTab,
    searchScope,
    searchQuery,
    opportunityId,
    eventId,
    postId,
    commentId,
    listingId,
    marketplaceTab,
    accountSection,
  };
}

export function getRouteFromSearch(search: string): ActiveRoute {
  return parseLocationSearch(search).route;
}

export function buildSearchForRoute(
  route: ActiveRoute,
  options?: {
    username?: string | null;
    profileTab?: ProfileTab | null;
    searchScope?: SearchScopeId | null;
    searchQuery?: string | null;
    opportunityId?: string | null;
    eventId?: string | null;
    postId?: string | null;
    commentId?: string | null;
    listingId?: string | null;
    marketplaceTab?: MarketplaceTab | null;
    accountSection?: AccountSettingsSection | null;
  }
): string {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '/';
  if (route === 'for-you' && !options?.postId) {
    return pathname;
  }
  const params = new URLSearchParams();
  params.set('view', route);

  if (route === 'profile') {
    if (options?.username) {
      params.set('username', options.username.trim().toLowerCase());
    }
    if (options?.profileTab && options.profileTab !== 'posts') {
      params.set('tab', options.profileTab);
    }
  }
  if (route === 'account') {
    if (options?.accountSection && options.accountSection !== 'profile') {
      params.set('section', options.accountSection);
    }
  }
  if (route === 'search') {
    if (options?.searchScope) {
      params.set('scope', options.searchScope);
    }
    const cleanQ = options?.searchQuery?.trim().slice(0, 100);
    if (cleanQ) {
      params.set('q', cleanQ);
    }
  }
  if (route === 'opportunities' && options?.opportunityId) {
    params.set('opportunityId', options.opportunityId);
  }
  if (route === 'upcoming-events' && options?.eventId) {
    params.set('eventId', options.eventId);
    if (options?.commentId) {
      params.set('commentId', options.commentId);
    }
  }
  if (
    (route === 'for-you' ||
      route === 'following' ||
      route === 'latest' ||
      route === 'anonymous') &&
    options?.postId
  ) {
    params.set('postId', options.postId);
    if (options?.commentId) {
      params.set('commentId', options.commentId);
    }
  }
  if (route === 'marketplace') {
    if (options?.marketplaceTab && options.marketplaceTab !== 'browse') {
      params.set('mktTab', options.marketplaceTab);
    }
    if (options?.listingId) {
      params.set('listingId', options.listingId);
      if (options?.commentId) {
        params.set('commentId', options.commentId);
      }
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function isFeedRoute(route: ActiveRoute): boolean {
  return route === 'for-you' || route === 'following' || route === 'latest';
}

export function isProtectedRouteOrTab(target: {
  route: ActiveRoute;
  profileTab?: ProfileTab | null;
  marketplaceTab?: MarketplaceTab | null;
}): boolean {
  if (
    target.route === 'account' ||
    target.route === 'notifications' ||
    target.route === 'admin' ||
    target.route === 'following'
  ) {
    return true;
  }
  if (
    target.route === 'profile' &&
    (target.profileTab === 'saved' || target.profileTab === 'anonymous')
  ) {
    return true;
  }
  if (
    target.route === 'marketplace' &&
    (target.marketplaceTab === 'my_listings' ||
      target.marketplaceTab === 'pending_approvals')
  ) {
    return true;
  }
  return false;
}

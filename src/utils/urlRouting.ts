import { ActiveRoute, ProfileTab, SearchScopeId } from '../types/platform';

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

export function isValidProfileTab(value: string | null): value is ProfileTab {
  return (
    value !== null &&
    (VALID_PROFILE_TABS as readonly string[]).includes(value)
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
      return 'home';
  }
}

export interface ParsedRouteLocation {
  route: ActiveRoute;
  profileUsername: string | null;
  profileTab: ProfileTab | null;
  searchScope: SearchScopeId;
  opportunityId: string | null;
  eventId: string | null;
  postId: string | null;
  commentId: string | null;
  listingId: string | null;
}

function parseSafeIdParam(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
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
  const searchScope = isValidSearchScope(rawScope) ? rawScope : 'home';
  const opportunityId = parseSafeIdParam(params, 'opportunityId');
  const eventId = parseSafeIdParam(params, 'eventId');
  const postId = parseSafeIdParam(params, 'postId');
  const commentId = parseSafeIdParam(params, 'commentId');
  const listingId = parseSafeIdParam(params, 'listingId');

  return {
    route,
    profileUsername,
    profileTab,
    searchScope,
    opportunityId,
    eventId,
    postId,
    commentId,
    listingId,
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
    opportunityId?: string | null;
    eventId?: string | null;
    postId?: string | null;
    commentId?: string | null;
    listingId?: string | null;
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
  if (route === 'search' && options?.searchScope) {
    params.set('scope', options.searchScope);
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
  if (route === 'marketplace' && options?.listingId) {
    params.set('listingId', options.listingId);
    if (options?.commentId) {
      params.set('commentId', options.commentId);
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function isFeedRoute(route: ActiveRoute): boolean {
  return route === 'for-you' || route === 'following' || route === 'latest';
}

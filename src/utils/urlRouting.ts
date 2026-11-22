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

  return {
    route,
    profileUsername,
    profileTab,
    searchScope,
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
  }
): string {
  if (route === 'for-you') {
    return window.location.pathname;
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

  return `${window.location.pathname}?${params.toString()}`;
}

export function isFeedRoute(route: ActiveRoute): boolean {
  return route === 'for-you' || route === 'following' || route === 'latest';
}

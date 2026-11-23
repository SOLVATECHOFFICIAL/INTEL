import {
  AccountSettingsSection,
  ActiveRoute,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
} from '../types/platform';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchFiltersState,
} from './contextualSearch';
import {
  isFeedRoute,
  isProtectedRouteOrTab,
  type ParsedRouteLocation,
} from './urlRouting';

export interface RouteDestination {
  route: ActiveRoute;
  username?: string | null;
  profileTab?: ProfileTab | null;
  searchScope?: SearchScopeId;
  searchQuery?: string | null;
  searchFilters?: SearchFiltersState;
  opportunityId?: string | null;
  eventId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  listingId?: string | null;
  marketplaceTab?: MarketplaceTab;
  accountSection?: AccountSettingsSection;
}

export interface NormalizedRouteDestination {
  route: ActiveRoute;
  username: string | null;
  profileTab: ProfileTab | null;
  searchScope: SearchScopeId;
  searchQuery: string | null;
  searchFilters: SearchFiltersState;
  opportunityId: string | null;
  eventId: string | null;
  postId: string | null;
  commentId: string | null;
  listingId: string | null;
  marketplaceTab: MarketplaceTab;
  accountSection: AccountSettingsSection;
}

export interface HistoryStackEntry {
  key: string;
  destination: NormalizedRouteDestination;
  scrollY: number;
}

export interface NavigationStackState {
  entries: HistoryStackEntry[];
  index: number;
}

const MAX_STACK_ENTRIES = 60;
let entrySequence = 0;

function nextEntryKey(): string {
  entrySequence += 1;
  return `nav_${entrySequence}_${Date.now().toString(36)}`;
}

export function normalizeRouteDestination(
  raw: RouteDestination
): NormalizedRouteDestination {
  const route = raw.route;
  const username =
    route === 'profile' && raw.username
      ? raw.username.trim().toLowerCase() || null
      : null;
  const profileTab =
    route === 'profile' && raw.profileTab && raw.profileTab !== 'posts'
      ? raw.profileTab
      : null;
  const searchScope: SearchScopeId =
    route === 'search' ? raw.searchScope ?? 'all' : 'home';
  const searchQuery =
    route === 'search' && raw.searchQuery
      ? raw.searchQuery.trim().slice(0, 100) || null
      : null;
  const searchFilters: SearchFiltersState =
    route === 'search' && raw.searchFilters
      ? { ...DEFAULT_SEARCH_FILTERS, ...raw.searchFilters }
      : { ...DEFAULT_SEARCH_FILTERS };
  const opportunityId =
    route === 'opportunities' ? raw.opportunityId?.trim() || null : null;
  const eventId =
    route === 'upcoming-events' ? raw.eventId?.trim() || null : null;
  const postId =
    isFeedRoute(route) || route === 'anonymous'
      ? raw.postId?.trim() || null
      : null;
  const listingId =
    route === 'marketplace' ? raw.listingId?.trim() || null : null;
  const commentId =
    (isFeedRoute(route) || route === 'anonymous') && postId
      ? raw.commentId?.trim() || null
      : route === 'upcoming-events' && eventId
        ? raw.commentId?.trim() || null
        : route === 'marketplace' && listingId
          ? raw.commentId?.trim() || null
          : null;
  const marketplaceTab: MarketplaceTab =
    route === 'marketplace' ? raw.marketplaceTab ?? 'browse' : 'browse';
  const accountSection: AccountSettingsSection =
    route === 'account' ? raw.accountSection ?? 'profile' : 'profile';

  return {
    route,
    username,
    profileTab,
    searchScope,
    searchQuery,
    searchFilters,
    opportunityId,
    eventId,
    postId,
    commentId,
    listingId,
    marketplaceTab,
    accountSection,
  };
}

export function destinationFromParsedLocation(
  parsed: ParsedRouteLocation,
  searchFilters?: SearchFiltersState
): NormalizedRouteDestination {
  return normalizeRouteDestination({
    route: parsed.route,
    username: parsed.profileUsername,
    profileTab: parsed.profileTab,
    searchScope: parsed.searchScope,
    searchQuery: parsed.searchQuery,
    searchFilters,
    opportunityId: parsed.opportunityId,
    eventId: parsed.eventId,
    postId: parsed.postId,
    commentId: parsed.commentId,
    listingId: parsed.listingId,
    marketplaceTab: parsed.marketplaceTab,
    accountSection: parsed.accountSection,
  });
}

export function areDestinationsEqual(
  a: RouteDestination,
  b: RouteDestination
): boolean {
  const normA = normalizeRouteDestination(a);
  const normB = normalizeRouteDestination(b);
  return (
    normA.route === normB.route &&
    normA.username === normB.username &&
    normA.profileTab === normB.profileTab &&
    normA.searchScope === normB.searchScope &&
    normA.searchQuery === normB.searchQuery &&
    normA.searchFilters.sortBy === normB.searchFilters.sortBy &&
    normA.searchFilters.category === normB.searchFilters.category &&
    normA.searchFilters.department === normB.searchFilters.department &&
    normA.searchFilters.availability === normB.searchFilters.availability &&
    normA.opportunityId === normB.opportunityId &&
    normA.eventId === normB.eventId &&
    normA.postId === normB.postId &&
    normA.commentId === normB.commentId &&
    normA.listingId === normB.listingId &&
    normA.marketplaceTab === normB.marketplaceTab &&
    normA.accountSection === normB.accountSection
  );
}

export function createInitialHistoryStack(
  destination: RouteDestination,
  scrollY = 0,
  entryKey?: string
): NavigationStackState {
  return {
    entries: [
      {
        key: entryKey ?? nextEntryKey(),
        destination: normalizeRouteDestination(destination),
        scrollY: Math.max(0, Math.round(scrollY)),
      },
    ],
    index: 0,
  };
}

export function updateHistoryEntryScroll(
  stack: NavigationStackState,
  scrollY: number,
  index = stack.index
): NavigationStackState {
  if (index < 0 || index >= stack.entries.length) {
    return stack;
  }
  const safeScroll = Math.max(0, Math.round(scrollY));
  if (stack.entries[index].scrollY === safeScroll) {
    return stack;
  }
  const nextEntries = [...stack.entries];
  nextEntries[index] = {
    ...nextEntries[index],
    scrollY: safeScroll,
  };
  return {
    ...stack,
    entries: nextEntries,
  };
}

export function pushHistoryStackEntry(
  stack: NavigationStackState,
  nextDestination: RouteDestination,
  departingScrollY: number,
  targetInitialScrollY = 0
): {
  stack: NavigationStackState;
  entry: HistoryStackEntry;
  pushed: boolean;
} {
  const normalizedNext = normalizeRouteDestination(nextDestination);
  const currentEntry = stack.entries[stack.index];

  const updatedEntries = [...stack.entries];
  if (currentEntry) {
    updatedEntries[stack.index] = {
      ...currentEntry,
      scrollY: Math.max(0, Math.round(departingScrollY)),
    };
  }

  if (
    currentEntry &&
    areDestinationsEqual(currentEntry.destination, normalizedNext)
  ) {
    const updatedCurrent = updatedEntries[stack.index];
    return {
      stack: {
        entries: updatedEntries,
        index: stack.index,
      },
      entry: updatedCurrent,
      pushed: false,
    };
  }

  const truncated = updatedEntries.slice(0, stack.index + 1);
  const newEntry: HistoryStackEntry = {
    key: nextEntryKey(),
    destination: normalizedNext,
    scrollY: Math.max(0, Math.round(targetInitialScrollY)),
  };
  truncated.push(newEntry);

  let finalEntries = truncated;
  if (finalEntries.length > MAX_STACK_ENTRIES) {
    finalEntries = finalEntries.slice(finalEntries.length - MAX_STACK_ENTRIES);
  }

  return {
    stack: {
      entries: finalEntries,
      index: finalEntries.length - 1,
    },
    entry: newEntry,
    pushed: true,
  };
}

export function replaceCurrentHistoryDestination(
  stack: NavigationStackState,
  nextDestination: RouteDestination,
  scrollY?: number
): {
  stack: NavigationStackState;
  entry: HistoryStackEntry;
} {
  const currentEntry = stack.entries[stack.index];
  if (!currentEntry) {
    const initial = createInitialHistoryStack(nextDestination, scrollY ?? 0);
    return { stack: initial, entry: initial.entries[0] };
  }
  const updatedEntry: HistoryStackEntry = {
    ...currentEntry,
    destination: normalizeRouteDestination(nextDestination),
    scrollY:
      scrollY !== undefined
        ? Math.max(0, Math.round(scrollY))
        : currentEntry.scrollY,
  };
  const nextEntries = [...stack.entries];
  nextEntries[stack.index] = updatedEntry;
  return {
    stack: {
      entries: nextEntries,
      index: stack.index,
    },
    entry: updatedEntry,
  };
}

export function moveToHistoryEntryKey(
  stack: NavigationStackState,
  entryKey: string | null | undefined,
  fallbackDestination: RouteDestination,
  fallbackScrollY = 0
): {
  stack: NavigationStackState;
  entry: HistoryStackEntry;
  found: boolean;
} {
  if (entryKey) {
    const targetIdx = stack.entries.findIndex((item) => item.key === entryKey);
    if (targetIdx !== -1) {
      return {
        stack: {
          entries: stack.entries,
          index: targetIdx,
        },
        entry: stack.entries[targetIdx],
        found: true,
      };
    }
  }

  const normalizedFallback = normalizeRouteDestination(fallbackDestination);
  const pushed = pushHistoryStackEntry(
    stack,
    normalizedFallback,
    stack.entries[stack.index]?.scrollY ?? 0,
    fallbackScrollY
  );
  return {
    stack: pushed.stack,
    entry: pushed.entry,
    found: false,
  };
}

export function getParentFallbackDestination(
  dest: RouteDestination
): NormalizedRouteDestination {
  const norm = normalizeRouteDestination(dest);
  if (norm.route === 'marketplace') {
    if (norm.listingId) {
      return normalizeRouteDestination({
        route: 'marketplace',
        marketplaceTab: norm.marketplaceTab,
      });
    }
    if (norm.marketplaceTab !== 'browse') {
      return normalizeRouteDestination({
        route: 'marketplace',
        marketplaceTab: 'browse',
      });
    }
  }
  if (norm.route === 'upcoming-events' && norm.eventId) {
    return normalizeRouteDestination({ route: 'upcoming-events' });
  }
  if (norm.route === 'opportunities' && norm.opportunityId) {
    return normalizeRouteDestination({ route: 'opportunities' });
  }
  if ((isFeedRoute(norm.route) || norm.route === 'anonymous') && norm.postId) {
    return normalizeRouteDestination({ route: norm.route });
  }
  return normalizeRouteDestination({ route: 'for-you' });
}

export type BackTargetResolution =
  | {
      kind: 'history_back';
      steps: number;
      targetEntry: HistoryStackEntry;
    }
  | {
      kind: 'fallback';
      destination: NormalizedRouteDestination;
    };

export function getBackTarget(
  stack: NavigationStackState,
  options?: { skipAuthEntries?: boolean }
): BackTargetResolution {
  const skipAuth = options?.skipAuthEntries ?? true;
  const currentEntry = stack.entries[stack.index];
  const currentlyOnAuth =
    currentEntry?.destination.route === 'login' ||
    currentEntry?.destination.route === 'register';

  for (let i = stack.index - 1; i >= 0; i -= 1) {
    const candidate = stack.entries[i];
    const isAuthCandidate =
      candidate.destination.route === 'login' ||
      candidate.destination.route === 'register';
    if (skipAuth && !currentlyOnAuth && isAuthCandidate) {
      continue;
    }
    return {
      kind: 'history_back',
      steps: stack.index - i,
      targetEntry: candidate,
    };
  }

  return {
    kind: 'fallback',
    destination: currentEntry
      ? getParentFallbackDestination(currentEntry.destination)
      : normalizeRouteDestination({ route: 'for-you' }),
  };
}

export function findMostRecentSearchEntry(
  stack: NavigationStackState
): HistoryStackEntry | null {
  for (let i = stack.index - 1; i >= 0; i -= 1) {
    if (stack.entries[i]?.destination.route === 'search') {
      return stack.entries[i];
    }
  }
  return null;
}

export function canGoBackHistory(
  stack: NavigationStackState,
  options?: { skipAuthEntries?: boolean }
): boolean {
  return getBackTarget(stack, options).kind === 'history_back';
}

export function getDestinationMemoryKey(dest: RouteDestination): string {
  const norm = normalizeRouteDestination(dest);
  switch (norm.route) {
    case 'search':
      return 'search';
    case 'profile':
      return `profile:${norm.username ?? 'self'}`;
    case 'marketplace':
      return `marketplace:${norm.marketplaceTab}:${norm.listingId ?? ''}`;
    case 'upcoming-events':
      return `upcoming-events:${norm.eventId ?? ''}`;
    case 'opportunities':
      return `opportunities:${norm.opportunityId ?? ''}`;
    case 'anonymous':
      return `anonymous:${norm.postId ?? ''}`;
    case 'for-you':
    case 'following':
    case 'latest':
      return norm.postId ? `${norm.route}:${norm.postId}` : norm.route;
    default:
      return norm.route;
  }
}

export function resolveGuestSafeDestination(
  dest: RouteDestination,
  isAuthenticated: boolean
): NormalizedRouteDestination {
  const norm = normalizeRouteDestination(dest);

  if (isAuthenticated) {
    if (norm.route === 'login' || norm.route === 'register') {
      return normalizeRouteDestination({ route: 'for-you' });
    }
    return norm;
  }

  if (!isProtectedRouteOrTab(norm)) {
    return norm;
  }

  if (norm.route === 'profile') {
    return normalizeRouteDestination({
      ...norm,
      profileTab: 'posts',
    });
  }

  if (norm.route === 'marketplace') {
    return normalizeRouteDestination({
      ...norm,
      marketplaceTab: 'browse',
    });
  }

  return normalizeRouteDestination({ route: 'for-you' });
}

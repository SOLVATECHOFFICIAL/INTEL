import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { PLATFORM_SECTIONS } from '../../config/sections';
import { useFirebase } from '../../context/firebaseContext';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import { toggleEventReaction } from '../../services/events';
import {
  getSearchPageSnapshot,
  saveSearchPageSnapshot,
} from '../../services/navigationStateCache';
import {
  executeScopedSearchDiscovery,
  fetchSearchSuggestionSeed,
  fetchSearchViewerInteractions,
  getCachedSearchBundle,
  getCachedSuggestionSeedSnapshot,
  getRequiredCollectionsForScope,
  hydrateCachedSearchBundle,
  hydrateSearchSuggestionSeed,
  loadMoreSearchSlice,
  mergeMembersIntoSuggestionSeed,
  refreshPeopleProjections,
  type SearchCollectionKey,
  type SearchDiscoveryBundle,
  type SearchSuggestionSeed,
  type SearchViewerInteractions,
} from '../../services/searchDiscovery';
import { toggleSavedPost } from '../../services/socialPosts';
import type {
  AdminUpdate,
  AnonymousPost,
  CampusEvent,
  CommunityPost,
} from '../../types/database';
import type { ActiveRoute, SearchScopeId } from '../../types/platform';
import {
  applyAdminUpdateSearchFilters,
  applyAnonymousSearchFilters,
  applyEventSearchFilters,
  applyMarketplaceSearchFilters,
  applyMemberSearchFilters,
  applyOpportunitySearchFilters,
  applyPostSearchFilters,
  applyTrustedContactSearchFilters,
  buildSearchSuggestions,
  clearRecentSearches,
  DEFAULT_SEARCH_FILTERS,
  FIRESTORE_SEARCH_SCOPE_NOTE,
  formatSearchUserError,
  loadRecentSearches,
  normalizeSearchInput,
  removeRecentSearch,
  saveRecentSearch,
  SEARCH_SCOPE_CONFIG,
  validateSearchQuery,
  type SearchFiltersState,
  type SearchSortOption,
  type SearchSuggestionItem,
} from '../../utils/contextualSearch';
import { EVENT_CATEGORIES } from '../../utils/events';
import { TRUSTED_CONTACT_CATEGORY_LABELS } from '../../utils/followRelations';
import { OPPORTUNITY_CATEGORIES } from '../../utils/opportunities';
import { computeOptimisticReactionToggle } from '../../utils/optimisticInteractions';
import { SectionIcon } from '../SectionIcon';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia } from '../media/FirestoreImage';
import { PostCard } from '../posts/PostCard';
import { EventCard } from '../sections/events/EventCard';
import { MarketplaceListingCard } from '../sections/marketplace/MarketplaceListingCard';
import { OpportunityCard } from '../sections/opportunities/OpportunityCard';
import {
  MemberDirectoryCard,
  TrustedDirectoryCard,
} from '../sections/shared/DirectoryProfileCards';
import { UpdateCard } from '../updates/UpdateCard';

interface SearchPageProps {
  initialScope: SearchScopeId;
  initialQuery?: string | null;
  initialFilters?: SearchFiltersState;
  onSyncSearchState?: (next: {
    scope: SearchScopeId;
    query: string;
    filters: SearchFiltersState;
  }) => void;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      searchScope?: SearchScopeId;
      searchQuery?: string | null;
      opportunityId?: string | null;
      eventId?: string | null;
      postId?: string | null;
      commentId?: string | null;
      listingId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack?: () => void;
}

const DISCOVERY_TABS: { id: SearchScopeId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'updates', label: 'Updates' },
  { id: 'posts', label: 'Posts' },
  { id: 'people', label: 'People' },
  { id: 'anonymous', label: 'Anonymous' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'upcoming-events', label: 'Events' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'trusted-circle', label: 'Trusted Circle' },
];

const QUICK_DISCOVERY_TERMS = [
  'Scholarship',
  'Academic',
  'Textbook',
  'Hostel',
  'Seminar',
  'Internship',
  'Campus News',
];

const MARKETPLACE_CATEGORIES = [
  'Electronics',
  'Phones and Accessories',
  'Fashion',
  'Books and Educational Materials',
  'Hostel and Accommodation',
  'Food and Groceries',
  'Beauty and Personal Care',
  'Home and Living',
  'Services',
  'Other',
];

const POST_CATEGORIES = [
  'Academic',
  'Campus News',
  'Gist',
  'General',
  'Events',
];

const ANON_CATEGORIES = [
  'Campus Life',
  'Academics',
  'Hostels',
  'Gist',
  'Advice',
  'General',
];

const UPDATE_CATEGORIES = [
  { id: 'announcement', label: 'Announcement' },
  { id: 'academic', label: 'Academic' },
  { id: 'campus_life', label: 'Campus Life' },
  { id: 'security', label: 'Security Notice' },
  { id: 'urgent', label: 'Urgent' },
];

function normalizeTabScope(scope: SearchScopeId): SearchScopeId {
  return scope === 'home' ? 'all' : scope;
}

function areSearchFiltersEqual(
  a: SearchFiltersState,
  b: SearchFiltersState
): boolean {
  return (
    a.sortBy === b.sortBy &&
    a.category === b.category &&
    a.department === b.department &&
    a.availability === b.availability
  );
}

function areSearchFiltersDefault(filters: SearchFiltersState): boolean {
  return areSearchFiltersEqual(filters, DEFAULT_SEARCH_FILTERS);
}

export const SearchPage: React.FC<SearchPageProps> = ({
  initialScope,
  initialQuery = null,
  initialFilters,
  onSyncSearchState,
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();
  const viewerKey = user?.uid ?? 'guest';
  const prevViewerKeyRef = useRef(viewerKey);
  const initialSnapshot = getSearchPageSnapshot(viewerKey);

  const normalizedInitialScope = normalizeTabScope(initialScope);
  const initialCleanQuery = initialQuery ? normalizeSearchInput(initialQuery) : '';
  const snapshotMatches = Boolean(
    initialSnapshot &&
      (!initialCleanQuery ||
        normalizeSearchInput(initialSnapshot.submittedQuery).toLowerCase() ===
          initialCleanQuery.toLowerCase())
  );

  const startingQuery =
    initialCleanQuery ||
    (snapshotMatches && initialSnapshot ? initialSnapshot.queryText : '');
  const startingSubmittedQuery =
    initialCleanQuery ||
    (snapshotMatches && initialSnapshot ? initialSnapshot.submittedQuery : '');
  const startingScope =
    normalizedInitialScope !== 'all' ||
    Boolean(initialCleanQuery) ||
    !snapshotMatches ||
    !initialSnapshot
      ? normalizedInitialScope
      : initialSnapshot.activeScope;
  const startingFilters =
    initialFilters && !areSearchFiltersDefault(initialFilters)
      ? initialFilters
      : snapshotMatches && initialSnapshot
        ? initialSnapshot.filters
        : initialFilters ?? DEFAULT_SEARCH_FILTERS;
  const startingBundle =
    (snapshotMatches && initialSnapshot?.bundle
      ? initialSnapshot.bundle
      : null) ??
    (startingSubmittedQuery ? getCachedSearchBundle(startingSubmittedQuery) : null);

  const [activeScope, setActiveScope] = useState<SearchScopeId>(startingScope);
  const [queryText, setQueryText] = useState(startingQuery);
  const [submittedQuery, setSubmittedQuery] = useState(startingSubmittedQuery);
  const [filters, setFilters] = useState<SearchFiltersState>(startingFilters);

  const [bundle, setBundle] = useState<SearchDiscoveryBundle | null>(startingBundle);
  const [status, setStatus] = useState<
    'idle' | 'short' | 'loading' | 'ready' | 'error'
  >(() => {
    if (!startingSubmittedQuery) {
      return snapshotMatches && initialSnapshot ? initialSnapshot.status : 'idle';
    }
    const check = validateSearchQuery(startingSubmittedQuery);
    if (!check.valid) return 'short';
    if (
      startingBundle &&
      getRequiredCollectionsForScope(startingScope).every(
        (col) => startingBundle[col].loaded && !startingBundle[col].error
      )
    ) {
      return 'ready';
    }
    return 'loading';
  });
  const [validationMessage, setValidationMessage] = useState<string | null>(
    () => {
      if (!startingSubmittedQuery) return null;
      const check = validateSearchQuery(startingSubmittedQuery);
      return check.valid ? null : check.message ?? null;
    }
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMoreSlice, setLoadingMoreSlice] =
    useState<SearchCollectionKey | null>(null);

  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadRecentSearches()
  );
  const [suggestionSeed, setSuggestionSeed] =
    useState<SearchSuggestionSeed | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [hydratingPeopleStats, setHydratingPeopleStats] = useState(false);

  const [interactions, setInteractions] = useState<SearchViewerInteractions>({
    viewerUid: null,
    likedPostIds: new Set(),
    savedPostIds: new Set(),
    likedUpdateIds: new Set(),
    savedUpdateIds: new Set(),
    likedAnonIds: new Set(),
    savedAnonIds: new Set(),
    ownedAnonPostIds: new Set(),
    ownedAnonCommentIds: new Set(),
    likedEventIds: new Set(),
    savedEventIds: new Set(),
    savedOpportunityIds: new Set(),
    loadedForUid: null,
  });
  const [guestPromptTitle, setGuestPromptTitle] = useState<string | null>(null);
  const [savingOppId, setSavingOppId] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef(0);
  const skipNextDebounceRef = useRef(Boolean(startingQuery));
  const lastExternalPropsRef = useRef<{
    scope: SearchScopeId;
    query: string;
    filters: SearchFiltersState;
  }>({
    scope: normalizedInitialScope,
    query: initialCleanQuery,
    filters: initialFilters ?? DEFAULT_SEARCH_FILTERS,
  });
  const lastSyncedRef = useRef<{
    scope: SearchScopeId;
    query: string;
    filters: SearchFiltersState;
  }>({
    scope: startingScope,
    query: startingQuery,
    filters: startingFilters,
  });

  // Reset/rehydrate if authenticated viewer changes while mounted
  useEffect(() => {
    if (prevViewerKeyRef.current === viewerKey) return;
    prevViewerKeyRef.current = viewerKey;
    const snap = getSearchPageSnapshot(viewerKey);
    const timer = window.setTimeout(() => {
      if (snap) {
        if (snap.queryText) skipNextDebounceRef.current = true;
        setActiveScope(snap.activeScope);
        setQueryText(snap.queryText);
        setSubmittedQuery(snap.submittedQuery);
        setFilters(snap.filters);
        setBundle(snap.bundle);
        setStatus(snap.status);
      } else {
        setActiveScope('all');
        setQueryText('');
        setSubmittedQuery('');
        setFilters(DEFAULT_SEARCH_FILTERS);
        setBundle(null);
        setStatus('idle');
      }
      setValidationMessage(null);
      setErrorMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewerKey]);

  // Persist SearchPage snapshot per viewer
  useEffect(() => {
    saveSearchPageSnapshot({
      viewerKey,
      activeScope,
      queryText,
      submittedQuery,
      filters,
      showFilters: false,
      bundle,
      status,
      cachedAt: Date.now(),
    });
  }, [viewerKey, activeScope, queryText, submittedQuery, filters, bundle, status]);

  // Sync external initialScope / initialQuery / initialFilters changes (e.g. Browser Back/Forward or Header trigger)
  useEffect(() => {
    const nextScope = normalizeTabScope(initialScope);
    const nextQ = initialQuery ? normalizeSearchInput(initialQuery) : '';
    const nextFilters = initialFilters ?? DEFAULT_SEARCH_FILTERS;
    const prevProps = lastExternalPropsRef.current;

    if (
      nextScope === prevProps.scope &&
      nextQ === prevProps.query &&
      areSearchFiltersEqual(nextFilters, prevProps.filters)
    ) {
      return;
    }

    lastExternalPropsRef.current = {
      scope: nextScope,
      query: nextQ,
      filters: nextFilters,
    };

    const synced = lastSyncedRef.current;
    if (
      nextScope === synced.scope &&
      nextQ === synced.query &&
      areSearchFiltersEqual(nextFilters, synced.filters)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (nextScope !== lastSyncedRef.current.scope) {
        lastSyncedRef.current.scope = nextScope;
        setActiveScope(nextScope);
      }
      if (nextQ !== lastSyncedRef.current.query) {
        lastSyncedRef.current.query = nextQ;
        setQueryText(nextQ);
        if (!nextQ) {
          setSubmittedQuery('');
          setBundle(null);
          setStatus('idle');
        }
      }
      if (!areSearchFiltersEqual(nextFilters, lastSyncedRef.current.filters)) {
        lastSyncedRef.current.filters = nextFilters;
        setFilters(nextFilters);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialScope, initialQuery, initialFilters]);

  // Keep App route state & URL synced whenever scope/query/filters change
  useEffect(() => {
    const cleanQ = normalizeSearchInput(queryText);
    const prev = lastSyncedRef.current;
    if (
      prev.scope === activeScope &&
      prev.query === cleanQ &&
      areSearchFiltersEqual(prev.filters, filters)
    ) {
      return;
    }
    lastSyncedRef.current = {
      scope: activeScope,
      query: cleanQ,
      filters,
    };
    onSyncSearchState?.({
      scope: activeScope,
      query: cleanQ,
      filters,
    });
  }, [activeScope, queryText, filters, onSyncSearchState]);

  useEffect(() => {
    let active = true;
    fetchSearchViewerInteractions(user?.uid ?? null)
      .then((res) => {
        if (active) setInteractions(res);
      })
      .catch(() => {
        // Non-blocking
      });
    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCacheMutations((event) => {
      if (event.type === 'follow_toggled') {
        const lower = event.targetUsername.trim().toLowerCase();
        const delta = event.following ? 1 : -1;
        setBundle((prev) => {
          if (!prev) return prev;
          let changed = false;
          const nextPeople = prev.people.items.map((member) => {
            if (member.username.toLowerCase() !== lower) return member;
            changed = true;
            return {
              ...member,
              followersCount: Math.max(0, (member.followersCount ?? 0) + delta),
            };
          });
          const nextPosts = prev.posts.items.map((entry) => {
            if (!entry.author || entry.author.username.toLowerCase() !== lower) {
              return entry;
            }
            changed = true;
            return {
              ...entry,
              author: {
                ...entry.author,
                followersCount: Math.max(
                  0,
                  (entry.author.followersCount ?? 0) + delta
                ),
              },
            };
          });
          const nextSellers = new Map(prev.marketplaceSellers);
          nextSellers.forEach((seller, sellerUid) => {
            if (seller.username.toLowerCase() === lower) {
              changed = true;
              nextSellers.set(sellerUid, {
                ...seller,
                followersCount: Math.max(0, (seller.followersCount ?? 0) + delta),
              });
            }
          });
          if (!changed) return prev;
          return {
            ...prev,
            people: { ...prev.people, items: nextPeople },
            posts: { ...prev.posts, items: nextPosts },
            marketplaceSellers: nextSellers,
          };
        });
        const latestSeed = getCachedSuggestionSeedSnapshot();
        if (latestSeed) {
          setSuggestionSeed(latestSeed);
        } else {
          setSuggestionSeed((prev) =>
            prev
              ? {
                  ...prev,
                  members: prev.members.map((m) =>
                    m.username.toLowerCase() === lower
                      ? {
                          ...m,
                          followersCount: Math.max(
                            0,
                            (m.followersCount ?? 0) + delta
                          ),
                        }
                      : m
                  ),
                }
              : prev
          );
        }
      } else if (event.type === 'profile_updated') {
        setBundle((prev) => {
          if (!prev) return prev;
          const refreshed = getCachedSearchBundle(prev.normalizedQuery);
          return refreshed ?? prev;
        });
        const latestSeed = getCachedSuggestionSeedSnapshot();
        if (latestSeed) {
          setSuggestionSeed(latestSeed);
        }
      }
    });
    return unsubscribe;
  }, []);

  const refreshCachedPeopleInPlace = useCallback(
    async (targetBundle: SearchDiscoveryBundle, requestId: number) => {
      if (
        targetBundle.people.items.length === 0 ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      ) {
        return;
      }
      setHydratingPeopleStats(true);
      try {
        const refreshed = await refreshPeopleProjections(targetBundle.people.items);
        if (requestId !== activeRequestIdRef.current) return;
        mergeMembersIntoSuggestionSeed(refreshed.items);
        const latestSeed = getCachedSuggestionSeedSnapshot();
        if (latestSeed) {
          setSuggestionSeed(latestSeed);
        }
        if (refreshed.updatedAny) {
          setBundle((prev) => {
            if (
              !prev ||
              prev.normalizedQuery.toLowerCase() !==
                targetBundle.normalizedQuery.toLowerCase()
            ) {
              return prev;
            }
            const nextSellers = new Map(prev.marketplaceSellers);
            if (refreshed.removedUsernames.size > 0) {
              nextSellers.forEach((seller, uid) => {
                if (refreshed.removedUsernames.has(seller.username.toLowerCase())) {
                  nextSellers.delete(uid);
                }
              });
            }
            return {
              ...prev,
              people: {
                ...prev.people,
                items: refreshed.items,
              },
              posts:
                refreshed.removedUsernames.size > 0
                  ? {
                      ...prev.posts,
                      items: prev.posts.items.filter(
                        (entry) =>
                          !entry.author ||
                          !refreshed.removedUsernames.has(
                            entry.author.username.toLowerCase()
                          )
                      ),
                    }
                  : prev.posts,
              marketplaceSellers: nextSellers,
            };
          });
        }
      } catch {
        // Non-blocking stats refresh
      } finally {
        if (requestId === activeRequestIdRef.current) {
          setHydratingPeopleStats(false);
        }
      }
    },
    []
  );

  const ensureSuggestionSeed = useCallback(() => {
    if (suggestionSeed) return;
    void hydrateSearchSuggestionSeed()
      .then((persisted) => {
        if (persisted) {
          setSuggestionSeed(persisted);
          if (
            Date.now() - persisted.fetchedAt > 5_000 &&
            persisted.members.length > 0 &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)
          ) {
            void refreshPeopleProjections(persisted.members)
              .then((res) => {
                if (!res.updatedAny) return;
                setSuggestionSeed((prev) =>
                  prev ? { ...prev, members: res.items } : prev
                );
              })
              .catch(() => undefined);
          }
          if (Date.now() - persisted.fetchedAt <= 5 * 60 * 1000) {
            return;
          }
        }
        return fetchSearchSuggestionSeed().then((seed) => {
          setSuggestionSeed(seed);
        });
      })
      .catch(() => {
        // Non-blocking
      });
  }, [suggestionSeed]);

  const runSearch = useCallback(
    async (
      rawTerm: string,
      targetScope: SearchScopeId,
      options?: { recordRecent?: boolean; forceRefresh?: boolean }
    ) => {
      const validation = validateSearchQuery(rawTerm);
      if (validation.reason === 'empty') {
        setSubmittedQuery('');
        setValidationMessage(null);
        setErrorMessage(null);
        setBundle(null);
        setStatus('idle');
        setHydratingPeopleStats(false);
        return;
      }

      if (!validation.valid) {
        setSubmittedQuery(validation.normalizedQuery);
        setValidationMessage(validation.message ?? null);
        setErrorMessage(null);
        setBundle(null);
        setStatus('short');
        setHydratingPeopleStats(false);
        return;
      }

      const cleanQuery = validation.normalizedQuery;
      const requestId = ++activeRequestIdRef.current;
      setSubmittedQuery(cleanQuery);
      setValidationMessage(null);
      setErrorMessage(null);
      setHydratingPeopleStats(false);

      if (options?.recordRecent) {
        setRecentSearches(saveRecentSearch(cleanQuery));
      }

      const ramCached = !options?.forceRefresh
        ? getCachedSearchBundle(cleanQuery)
        : null;
      let cached = ramCached;
      if (!cached && !options?.forceRefresh) {
        cached = await hydrateCachedSearchBundle(cleanQuery).catch(() => null);
        if (requestId !== activeRequestIdRef.current) return;
      }

      if (cached) {
        const allSlicesReady = getRequiredCollectionsForScope(targetScope).every(
          (col) => cached[col].loaded && !cached[col].error
        );
        setBundle(cached);
        if (allSlicesReady) {
          setStatus('ready');
          const needsPeopleStatsSync =
            cached.people.items.length > 0 &&
            (!ramCached || Date.now() - cached.updatedAt > 5_000);
          if (
            Date.now() - cached.updatedAt > 30_000 &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)
          ) {
            if (needsPeopleStatsSync) {
              void refreshCachedPeopleInPlace(cached, requestId);
            }
            void executeScopedSearchDiscovery({
              rawQuery: cleanQuery,
              scope: targetScope,
            })
              .then((freshBundle) => {
                if (requestId === activeRequestIdRef.current) {
                  mergeMembersIntoSuggestionSeed(freshBundle.people.items);
                  setBundle(freshBundle);
                  setHydratingPeopleStats(false);
                }
              })
              .catch(() => undefined);
          } else if (needsPeopleStatsSync) {
            void refreshCachedPeopleInPlace(cached, requestId);
          }
          return;
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setErrorMessage(
          'You are offline and these search results are not cached yet. Reconnect to search campus records.'
        );
        setStatus('error');
        return;
      }

      setStatus('loading');

      try {
        const resultBundle = await executeScopedSearchDiscovery({
          rawQuery: cleanQuery,
          scope: targetScope,
          forceRefresh: options?.forceRefresh,
        });
        if (requestId !== activeRequestIdRef.current) return;
        mergeMembersIntoSuggestionSeed(resultBundle.people.items);
        setBundle(resultBundle);
        setStatus('ready');
      } catch (err) {
        if (requestId !== activeRequestIdRef.current) return;
        setErrorMessage(formatSearchUserError(err));
        setStatus('error');
      }
    },
    [refreshCachedPeopleInPlace]
  );

  // Run initial query if opened with ?view=search&q=... and slices aren't already cached
  useEffect(() => {
    if (!startingSubmittedQuery) return;
    const existing = startingBundle ?? getCachedSearchBundle(startingSubmittedQuery);
    const alreadyReady =
      existing !== null &&
      getRequiredCollectionsForScope(startingScope).every(
        (col) => existing[col].loaded && !existing[col].error
      );
    if (alreadyReady) {
      if (
        existing &&
        existing.people.items.length > 0 &&
        Date.now() - existing.updatedAt > 5_000
      ) {
        const reqId = activeRequestIdRef.current;
        const timer = window.setTimeout(() => {
          void refreshCachedPeopleInPlace(existing, reqId);
        }, 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(startingSubmittedQuery, startingScope);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live search when typing or changing category tab
  useEffect(() => {
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    const trimmed = normalizeSearchInput(queryText);
    if (!trimmed) {
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(trimmed, activeScope);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [queryText, activeScope, runSearch]);

  const handleQueryInputChange = (value: string) => {
    setQueryText(value);
    ensureSuggestionSeed();
    if (!value.trim()) {
      activeRequestIdRef.current += 1;
      setSubmittedQuery('');
      setValidationMessage(null);
      setErrorMessage(null);
      setBundle(null);
      setStatus('idle');
      return;
    }
    setSuggestionsOpen(true);
  };

  const handleTabChange = (nextTab: SearchScopeId) => {
    setActiveScope(nextTab);
    // Reset category/availability filters that do not apply across different tabs
    setFilters((prev) => ({
      ...prev,
      category: 'all',
      availability: 'all',
    }));
    const trimmed = normalizeSearchInput(queryText);
    if (trimmed) {
      skipNextDebounceRef.current = true;
      void runSearch(trimmed, nextTab);
    }
  };

  const suggestions = useMemo(
    () =>
      buildSearchSuggestions({
        rawQuery: queryText,
        recentSearches,
        members: suggestionSeed?.members ?? [],
        dynamicTerms: suggestionSeed?.dynamicTerms ?? [],
        scope: activeScope,
        maxItems: 7,
      }),
    [queryText, recentSearches, suggestionSeed, activeScope]
  );

  const handleSelectSuggestion = (item: SearchSuggestionItem) => {
    setSuggestionsOpen(false);
    if (item.kind === 'person' && item.username) {
      setRecentSearches(saveRecentSearch(item.query));
      onNavigate('profile', { username: item.username });
      return;
    }
    const nextScope = item.targetScope ?? activeScope;
    setActiveScope(nextScope);
    skipNextDebounceRef.current = true;
    setQueryText(item.query);
    void runSearch(item.query, nextScope, { recordRecent: true });
  };

  const handleQuickTopicClick = (term: string) => {
    setSuggestionsOpen(false);
    skipNextDebounceRef.current = true;
    setQueryText(term);
    void runSearch(term, activeScope, { recordRecent: true });
  };

  const handleLoadMoreSlice = async (sliceKey: SearchCollectionKey) => {
    if (!bundle || loadingMoreSlice) return;
    setLoadingMoreSlice(sliceKey);
    try {
      const updated = await loadMoreSearchSlice({ bundle, sliceKey });
      if (sliceKey === 'people') {
        mergeMembersIntoSuggestionSeed(updated.people.items);
      }
      setBundle(updated);
    } catch (err) {
      setErrorMessage(formatSearchUserError(err));
    } finally {
      setLoadingMoreSlice(null);
    }
  };

  const handleToggleEventLike = async (targetEvent: CampusEvent) => {
    if (!user?.uid) {
      setGuestPromptTitle('Sign in to like campus events');
      return;
    }
    if (isSuspended) return;

    const prevLiked = interactions.likedEventIds.has(targetEvent.id);
    const prevCount = Number(targetEvent.likesCount ?? 0);
    const { nextLiked, nextCount } = computeOptimisticReactionToggle({
      currentlyLiked: prevLiked,
      currentCount: prevCount,
    });

    setInteractions((prev) => {
      const next = new Set(prev.likedEventIds);
      if (nextLiked) next.add(targetEvent.id);
      else next.delete(targetEvent.id);
      return { ...prev, likedEventIds: next };
    });
    setBundle((prev) =>
      prev
        ? {
            ...prev,
            events: {
              ...prev.events,
              items: prev.events.items.map((ev) =>
                ev.id === targetEvent.id ? { ...ev, likesCount: nextCount } : ev
              ),
            },
          }
        : prev
    );

    try {
      const res = await toggleEventReaction({
        eventId: targetEvent.id,
        actorUid: user.uid,
      });
      setBundle((prev) =>
        prev
          ? {
              ...prev,
              events: {
                ...prev.events,
                items: prev.events.items.map((ev) =>
                  ev.id === targetEvent.id
                    ? { ...ev, likesCount: res.likesCount }
                    : ev
                ),
              },
            }
          : prev
      );
    } catch {
      setInteractions((prev) => {
        const next = new Set(prev.likedEventIds);
        if (prevLiked) next.add(targetEvent.id);
        else next.delete(targetEvent.id);
        return { ...prev, likedEventIds: next };
      });
    }
  };

  const handleToggleEventSave = async (targetEvent: CampusEvent) => {
    if (!user?.uid) {
      setGuestPromptTitle('Sign in to save campus events');
      return;
    }
    if (isSuspended) return;
    const prevSaved = interactions.savedEventIds.has(targetEvent.id);
    setInteractions((prev) => {
      const next = new Set(prev.savedEventIds);
      if (!prevSaved) next.add(targetEvent.id);
      else next.delete(targetEvent.id);
      return { ...prev, savedEventIds: next };
    });
    try {
      await toggleSavedPost({
        actorUid: user.uid,
        targetCollection: 'events',
        targetId: targetEvent.id,
        currentlySaved: prevSaved,
      });
    } catch {
      setInteractions((prev) => {
        const next = new Set(prev.savedEventIds);
        if (prevSaved) next.add(targetEvent.id);
        else next.delete(targetEvent.id);
        return { ...prev, savedEventIds: next };
      });
    }
  };

  const handleToggleOpportunitySave = async (oppId: string) => {
    if (!user?.uid) {
      setGuestPromptTitle('Sign in to save opportunities');
      return;
    }
    if (isSuspended || savingOppId === oppId) return;
    setSavingOppId(oppId);
    const prevSaved = interactions.savedOpportunityIds.has(oppId);
    try {
      const res = await toggleSavedPost({
        actorUid: user.uid,
        targetCollection: 'opportunities',
        targetId: oppId,
        currentlySaved: prevSaved,
      });
      setInteractions((prev) => {
        const next = new Set(prev.savedOpportunityIds);
        if (res.saved) next.add(oppId);
        else next.delete(oppId);
        return { ...prev, savedOpportunityIds: next };
      });
    } finally {
      setSavingOppId(null);
    }
  };

  // Filtered + Sorted Views derived from cached bundle
  const filteredPeople = useMemo(
    () => (bundle ? applyMemberSearchFilters(bundle.people.items, filters) : []),
    [bundle, filters]
  );
  const filteredPosts = useMemo(
    () => (bundle ? applyPostSearchFilters(bundle.posts.items, filters) : []),
    [bundle, filters]
  );
  const filteredAnon = useMemo(
    () =>
      bundle
        ? applyAnonymousSearchFilters(bundle.anonymous.items, filters)
        : [],
    [bundle, filters]
  );
  const filteredMarketplace = useMemo(
    () =>
      bundle
        ? applyMarketplaceSearchFilters(bundle.marketplace.items, filters)
        : [],
    [bundle, filters]
  );
  const filteredEvents = useMemo(
    () =>
      bundle
        ? applyEventSearchFilters(bundle.events.items, filters, nowMs)
        : [],
    [bundle, filters, nowMs]
  );
  const filteredOpportunities = useMemo(
    () =>
      bundle
        ? applyOpportunitySearchFilters(
            bundle.opportunities.items,
            filters,
            nowMs
          )
        : [],
    [bundle, filters, nowMs]
  );
  const filteredUpdates = useMemo(
    () =>
      bundle
        ? applyAdminUpdateSearchFilters(bundle.updates?.items ?? [], filters)
        : [],
    [bundle, filters]
  );
  const filteredTrusted = useMemo(
    () =>
      bundle
        ? applyTrustedContactSearchFilters(bundle.trustedCircle.items, filters)
        : [],
    [bundle, filters]
  );

  // Raw per-tab counts (for badge display on tabs)
  const tabCounts: Record<SearchScopeId, number> = useMemo(() => {
    if (!bundle) {
      return {
        all: 0,
        updates: 0,
        posts: 0,
        people: 0,
        home: 0,
        anonymous: 0,
        marketplace: 0,
        'upcoming-events': 0,
        opportunities: 0,
        'trusted-circle': 0,
      };
    }
    const updatesCount = filteredUpdates.length;
    const postsCount = filteredPosts.length;
    const peopleCount = filteredPeople.length;
    const anonCount = filteredAnon.length;
    const mktCount = filteredMarketplace.length;
    const evtCount = filteredEvents.length;
    const oppCount = filteredOpportunities.length;
    const tcCount = filteredTrusted.length;
    return {
      all:
        updatesCount +
        postsCount +
        peopleCount +
        anonCount +
        mktCount +
        evtCount +
        oppCount +
        tcCount,
      updates: updatesCount,
      posts: postsCount,
      people: peopleCount,
      home: updatesCount + postsCount + peopleCount,
      anonymous: anonCount,
      marketplace: mktCount,
      'upcoming-events': evtCount,
      opportunities: oppCount,
      'trusted-circle': tcCount,
    };
  }, [
    bundle,
    filteredUpdates.length,
    filteredPosts.length,
    filteredPeople.length,
    filteredAnon.length,
    filteredMarketplace.length,
    filteredEvents.length,
    filteredOpportunities.length,
    filteredTrusted.length,
  ]);

  // Dynamic Department/Faculty options extracted from actual loaded People / Posts / Trusted contacts
  const availableDepartments = useMemo(() => {
    if (!bundle) return [];
    const set = new Set<string>();
    for (const m of bundle.people.items) {
      if (m.department?.trim()) set.add(m.department.trim());
      if (m.faculty?.trim()) set.add(m.faculty.trim());
    }
    for (const p of bundle.posts.items) {
      if (p.author?.department?.trim()) set.add(p.author.department.trim());
      if (p.author?.faculty?.trim()) set.add(p.author.faculty.trim());
    }
    for (const c of bundle.trustedCircle.items) {
      if (c.department?.trim()) set.add(c.department.trim());
      if (c.faculty?.trim()) set.add(c.faculty.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [bundle]);

  const showCategoryFilter =
    activeScope === 'updates' ||
    activeScope === 'posts' ||
    activeScope === 'anonymous' ||
    activeScope === 'marketplace' ||
    activeScope === 'upcoming-events' ||
    activeScope === 'opportunities' ||
    activeScope === 'trusted-circle';

  const showDepartmentFilter =
    (activeScope === 'all' ||
      activeScope === 'people' ||
      activeScope === 'posts' ||
      activeScope === 'trusted-circle') &&
    availableDepartments.length > 0;

  const showAvailabilityFilter =
    activeScope === 'marketplace' ||
    activeScope === 'upcoming-events' ||
    activeScope === 'opportunities';

  const hasNonDefaultFilters =
    filters.sortBy !== 'relevant' ||
    filters.category !== 'all' ||
    filters.department !== 'all' ||
    filters.availability !== 'all';

  const activeScopeMeta = SEARCH_SCOPE_CONFIG[activeScope];
  const visibleCountForTab = tabCounts[activeScope] ?? 0;

  return (
    <section
      ref={containerRef}
      aria-labelledby="search-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Stable Top Search & Category Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mb-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
            )}
            <h1
              id="search-heading"
              className="font-display text-xl font-bold text-[#0B1A2E] sm:text-2xl"
            >
              Search &amp; Discovery
            </h1>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">
              {activeScopeMeta.description}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSuggestionsOpen(false);
            void runSearch(queryText, activeScope, { recordRecent: true });
          }}
          className="relative mt-4 flex gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              inputMode="search"
              value={queryText}
              onFocus={() => {
                ensureSuggestionSeed();
                setSuggestionsOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setSuggestionsOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSuggestionsOpen(false);
                }
              }}
              onChange={(e) => handleQueryInputChange(e.target.value)}
              aria-label={`Search ${activeScopeMeta.label}`}
              placeholder={activeScopeMeta.placeholder}
              className="block min-h-[46px] w-full rounded-xl border border-slate-300 bg-white py-2 pr-16 pl-10 text-sm text-[#0B1A2E] outline-none transition-colors focus:border-[#1E88E5] focus:ring-2 focus:ring-[#1E88E5]/20"
            />

            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
              {status === 'loading' && (
                <Loader2
                  className="h-4 w-4 animate-spin text-[#1E88E5]"
                  aria-label="Searching"
                />
              )}
              {queryText && (
                <button
                  type="button"
                  onClick={() => handleQueryInputChange('')}
                  aria-label="Clear search query"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex min-h-[46px] shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] sm:px-5 sm:text-sm"
          >
            Search
          </button>

          {suggestionsOpen && suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Search suggestions"
              className="absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            >
              {suggestions.map((sug) => {
                const compactPersonFollowers =
                  sug.kind === 'person' && typeof sug.followersCount === 'number'
                    ? sug.followersCount === 1
                      ? '1 follower'
                      : `${sug.followersCount} followers`
                    : null;
                return (
                  <button
                    key={sug.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectSuggestion(sug)}
                    className="flex w-full items-center justify-between gap-2.5 border-b border-slate-100 px-3.5 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      {sug.kind === 'recent' ? (
                        <Clock
                          className="h-3.5 w-3.5 shrink-0 text-slate-400"
                          aria-hidden="true"
                        />
                      ) : sug.kind === 'person' ? (
                        <AvatarMedia
                          fullName={sug.fullName || sug.label}
                          photoImageId={sug.photoImageId}
                          photoUrl={sug.photoUrl}
                          sizeClass="h-8 w-8"
                          roundedClass="rounded-lg"
                          textClass="text-[10px]"
                        />
                      ) : sug.kind === 'category' ? (
                        <Tag
                          className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                      ) : (
                        <Sparkles
                          className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-[#0B1A2E]">
                          {sug.kind === 'person'
                            ? sug.fullName || sug.label
                            : sug.label}
                        </span>
                        {sug.kind === 'person' && sug.username && (
                          <span className="block truncate text-[11px] text-slate-500">
                            @{sug.username}
                          </span>
                        )}
                      </span>
                    </span>
                    {sug.subtitle && (
                      <span className="shrink-0 text-[11px] font-medium text-slate-500 tabular-nums">
                        {compactPersonFollowers ? (
                          <>
                            <span className="sm:hidden">{compactPersonFollowers}</span>
                            <span className="hidden sm:inline">{sug.subtitle}</span>
                          </>
                        ) : (
                          sug.subtitle
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </form>

        {/* Organized Search Category Tabs */}
        <div
          role="tablist"
          aria-label="Search categories"
          className="mt-4 flex flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0"
        >
          {DISCOVERY_TABS.map((tab) => {
            const isSelected = activeScope === tab.id;
            const count = tabCounts[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => handleTabChange(tab.id)}
                className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-[#0B1A2E] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                }`}
              >
                <span>{tab.label}</span>
                {bundle && submittedQuery && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dynamic Category-Appropriate Filter Bar */}
        {(status === 'ready' || bundle) && (
          <div className="mt-3.5 border-t border-slate-100 pt-3.5">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
              <span className="col-span-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 sm:col-span-1">
                <SlidersHorizontal
                  className="h-3.5 w-3.5 text-[#1E88E5]"
                  aria-hidden="true"
                />
                Refine:
              </span>

              <select
                aria-label="Sort search results"
                value={filters.sortBy}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    sortBy: e.target.value as SearchSortOption,
                  }))
                }
                className="min-h-[36px] min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
              >
                <option value="relevant">Most relevant</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>

              {showCategoryFilter && (
                <select
                  aria-label="Filter by category"
                  value={filters.category}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, category: e.target.value }))
                  }
                  className="min-h-[36px] min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                >
                  <option value="all">All Categories</option>
                  {activeScope === 'updates' &&
                    UPDATE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  {activeScope === 'posts' &&
                    POST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  {activeScope === 'anonymous' &&
                    ANON_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  {activeScope === 'marketplace' && (
                    <>
                      <optgroup label="Listing Types">
                        <option value="kind:product">Products</option>
                        <option value="kind:service">Services</option>
                        <option value="kind:accommodation">Accommodation</option>
                      </optgroup>
                      <optgroup label="Marketplace Categories">
                        {MARKETPLACE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  )}
                  {activeScope === 'upcoming-events' &&
                    EVENT_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  {activeScope === 'opportunities' &&
                    OPPORTUNITY_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  {activeScope === 'trusted-circle' &&
                    Object.entries(TRUSTED_CONTACT_CATEGORY_LABELS).map(
                      ([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      )
                    )}
                </select>
              )}

              {showDepartmentFilter && (
                <select
                  aria-label="Filter by department or faculty"
                  value={filters.department}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      department: e.target.value,
                    }))
                  }
                  className="min-h-[36px] min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                >
                  <option value="all">All Departments &amp; Faculties</option>
                  {availableDepartments.map((dep) => (
                    <option key={dep} value={dep}>
                      {dep}
                    </option>
                  ))}
                </select>
              )}

              {showAvailabilityFilter && (
                <select
                  aria-label="Filter by availability or status"
                  value={filters.availability}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      availability: e.target.value,
                    }))
                  }
                  className="min-h-[36px] min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                >
                  <option value="all">Any Status</option>
                  {activeScope === 'marketplace' && (
                    <>
                      <option value="available">Available / In stock</option>
                      <option value="low_stock">Low stock (1–2 left)</option>
                    </>
                  )}
                  {activeScope === 'upcoming-events' && (
                    <>
                      <option value="upcoming">Upcoming</option>
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                    </>
                  )}
                  {activeScope === 'opportunities' && (
                    <>
                      <option value="open">Open</option>
                      <option value="closing_soon">Closing Soon</option>
                      <option value="closed">Closed</option>
                    </>
                  )}
                </select>
              )}

              {hasNonDefaultFilters && (
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_SEARCH_FILTERS)}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#1E88E5] hover:bg-slate-50"
                >
                  <Filter className="h-3 w-3" aria-hidden="true" />
                  Reset filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {guestPromptTitle && (
        <GuestPromptCard
          title={guestPromptTitle}
          description="Sign in or create a free LASUED Intel account to save items, react, or follow campus members."
          returnRoute="search"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setGuestPromptTitle(null)}
        />
      )}

      {/* State Views: Validation, Loading, Error */}
      {status === 'short' && validationMessage && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {validationMessage}
        </div>
      )}

      {status === 'loading' && !bundle && (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-600">
          <Loader2
            className="h-5 w-5 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          <span>Searching {activeScopeMeta.label.toLowerCase()}...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center">
          <AlertCircle
            className="mx-auto mb-2 h-6 w-6 text-red-700"
            aria-hidden="true"
          />
          <p className="font-display text-sm font-bold text-[#0B1A2E]">
            Search unavailable right now
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            {errorMessage ||
              'We could not complete your search right now. Please try again.'}
          </p>
          <button
            type="button"
            onClick={() =>
              void runSearch(queryText, activeScope, { forceRefresh: true })
            }
            className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry Search
          </button>
        </div>
      )}

      {/* Results View */}
      {bundle && submittedQuery && status !== 'short' && (
        <div className="space-y-5">
          {visibleCountForTab === 0 && status !== 'loading' ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
              <Search
                className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
                aria-hidden="true"
              />
              <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                No matches for &ldquo;{submittedQuery}&rdquo;
              </h2>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
                {hasNonDefaultFilters
                  ? 'Try adjusting or resetting your active category, department, or status filters.'
                  : `Nothing matched in ${activeScopeMeta.label}. Try another keyword or switch search categories.`}
              </p>
              {hasNonDefaultFilters && (
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_SEARCH_FILTERS)}
                  className="mt-4 inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Official Updates Results */}
              {(activeScope === 'all' || activeScope === 'updates') &&
                filteredUpdates.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Official Updates ({filteredUpdates.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('updates')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Updates
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {(activeScope === 'all'
                        ? filteredUpdates.slice(0, 4)
                        : filteredUpdates
                      ).map((updateItem: AdminUpdate) => (
                        <UpdateCard
                          key={updateItem.id}
                          update={updateItem}
                          author={
                            updateItem.authorMode === 'public_admin' &&
                            updateItem.ownerUID
                              ? bundle.updateAuthors?.get(updateItem.ownerUID) ??
                                null
                              : null
                          }
                          viewerUid={user?.uid ?? null}
                          viewerTier={effectiveTier}
                          viewerSuspended={isSuspended}
                          isLiked={interactions.likedUpdateIds.has(updateItem.id)}
                          isSaved={interactions.savedUpdateIds.has(updateItem.id)}
                          onUpdateMutated={(updated) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    updates: {
                                      ...prev.updates,
                                      items: prev.updates.items.map((u) =>
                                        u.id === updated.id ? updated : u
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                          onUpdateDeleted={(deletedId) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    updates: {
                                      ...prev.updates,
                                      items: prev.updates.items.filter(
                                        (u) => u.id !== deletedId
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                          onSaveChanged={(updateId, saved) =>
                            setInteractions((prev) => {
                              const next = new Set(prev.savedUpdateIds);
                              if (saved) next.add(updateId);
                              else next.delete(updateId);
                              return { ...prev, savedUpdateIds: next };
                            })
                          }
                          onNavigateProfile={(uname) =>
                            onNavigate('profile', { username: uname })
                          }
                          onRequireAuth={onRequireAuth}
                          returnRoute="search"
                        />
                      ))}
                    </div>
                    {bundle.updates?.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'updates'}
                          onClick={() => void handleLoadMoreSlice('updates')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'updates' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more official updates
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* People Results */}
              {(activeScope === 'all' || activeScope === 'people') &&
                filteredPeople.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        People ({filteredPeople.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('people')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus People
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(activeScope === 'all'
                        ? filteredPeople.slice(0, 6)
                        : filteredPeople
                      ).map((member) => (
                        <MemberDirectoryCard
                          key={member.username}
                          member={member}
                          viewerUsername={profile?.username}
                          hydratingStats={hydratingPeopleStats}
                          onOpenProfile={(uname) =>
                            onNavigate('profile', { username: uname })
                          }
                          onRequireAuth={() =>
                            setGuestPromptTitle(
                              `Sign in to follow @${member.username}`
                            )
                          }
                        />
                      ))}
                    </div>
                    {bundle.people.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'people'}
                          onClick={() => void handleLoadMoreSlice('people')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'people' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more members
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Community Posts Results */}
              {(activeScope === 'all' || activeScope === 'posts') &&
                filteredPosts.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Community Posts ({filteredPosts.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('posts')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Posts
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {(activeScope === 'all'
                        ? filteredPosts.slice(0, 5)
                        : filteredPosts
                      ).map(({ post, author }) => (
                        <PostCard
                          key={post.id}
                          kind="ordinary"
                          post={post}
                          author={author}
                          viewerUid={user?.uid ?? null}
                          viewerTier={effectiveTier}
                          viewerSuspended={isSuspended}
                          isLiked={interactions.likedPostIds.has(post.id)}
                          isSaved={interactions.savedPostIds.has(post.id)}
                          onOpenPost={(pid) =>
                            onNavigate('for-you', { postId: pid })
                          }
                          onSaveChanged={(postId, saved) =>
                            setInteractions((prev) => {
                              const next = new Set(prev.savedPostIds);
                              if (saved) next.add(postId);
                              else next.delete(postId);
                              return { ...prev, savedPostIds: next };
                            })
                          }
                          onNavigateProfile={(uname) =>
                            onNavigate('profile', { username: uname })
                          }
                          onRequireAuth={onRequireAuth}
                          returnRoute="search"
                          onPostUpdated={(updated) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    posts: {
                                      ...prev.posts,
                                      items: prev.posts.items.map((item) =>
                                        item.post.id === updated.id
                                          ? {
                                              ...item,
                                              post: updated as CommunityPost,
                                            }
                                          : item
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                          onPostDeleted={(deletedId) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    posts: {
                                      ...prev.posts,
                                      items: prev.posts.items.filter(
                                        (item) => item.post.id !== deletedId
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                        />
                      ))}
                    </div>
                    {bundle.posts.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'posts'}
                          onClick={() => void handleLoadMoreSlice('posts')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'posts' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more posts
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Marketplace Results */}
              {(activeScope === 'all' || activeScope === 'marketplace') &&
                filteredMarketplace.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Marketplace ({filteredMarketplace.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('marketplace')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Marketplace
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 md:grid-cols-3">
                      {(activeScope === 'all'
                        ? filteredMarketplace.slice(0, 6)
                        : filteredMarketplace
                      ).map((item) => (
                        <MarketplaceListingCard
                          key={item.id}
                          listing={item}
                          seller={
                            bundle.marketplaceSellers.get(item.ownerUID) ?? null
                          }
                          onOpenListing={(lid) =>
                            onNavigate('marketplace', { listingId: lid })
                          }
                          onNavigateProfile={(uname) =>
                            onNavigate('profile', { username: uname })
                          }
                          onRequireAuth={() =>
                            setGuestPromptTitle('Sign in to follow sellers')
                          }
                        />
                      ))}
                    </div>
                    {bundle.marketplace.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'marketplace'}
                          onClick={() => void handleLoadMoreSlice('marketplace')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'marketplace' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more listings
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Events Results */}
              {(activeScope === 'all' || activeScope === 'upcoming-events') &&
                filteredEvents.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Campus Events ({filteredEvents.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('upcoming-events')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Events
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {(activeScope === 'all'
                        ? filteredEvents.slice(0, 4)
                        : filteredEvents
                      ).map((ev) => (
                        <EventCard
                          key={ev.id}
                          event={ev}
                          nowMs={nowMs}
                          isLiked={interactions.likedEventIds.has(ev.id)}
                          isSaved={interactions.savedEventIds.has(ev.id)}
                          onOpenDetails={(id) =>
                            onNavigate('upcoming-events', { eventId: id })
                          }
                          onToggleLike={(item) =>
                            void handleToggleEventLike(item)
                          }
                          onToggleSave={(item) =>
                            void handleToggleEventSave(item)
                          }
                        />
                      ))}
                    </div>
                    {bundle.events.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'events'}
                          onClick={() => void handleLoadMoreSlice('events')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'events' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more events
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Opportunities Results */}
              {(activeScope === 'all' || activeScope === 'opportunities') &&
                filteredOpportunities.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Opportunities ({filteredOpportunities.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('opportunities')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Opportunities
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {(activeScope === 'all'
                        ? filteredOpportunities.slice(0, 4)
                        : filteredOpportunities
                      ).map((opp) => (
                        <OpportunityCard
                          key={opp.id}
                          opportunity={opp}
                          nowMs={nowMs}
                          isSaved={interactions.savedOpportunityIds.has(opp.id)}
                          saving={savingOppId === opp.id}
                          onToggleSave={(id) =>
                            void handleToggleOpportunitySave(id)
                          }
                          onOpenDetails={(id) =>
                            onNavigate('opportunities', { opportunityId: id })
                          }
                        />
                      ))}
                    </div>
                    {bundle.opportunities.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'opportunities'}
                          onClick={() =>
                            void handleLoadMoreSlice('opportunities')
                          }
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'opportunities' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more opportunities
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Anonymous Posts Results (strict zero identity, zero Report button) */}
              {(activeScope === 'all' || activeScope === 'anonymous') &&
                filteredAnon.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Anonymous ({filteredAnon.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('anonymous')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Anonymous
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {(activeScope === 'all'
                        ? filteredAnon.slice(0, 5)
                        : filteredAnon
                      ).map((post) => (
                        <PostCard
                          key={post.id}
                          kind="anonymous"
                          post={post}
                          viewerUid={user?.uid ?? null}
                          viewerTier={effectiveTier}
                          viewerSuspended={isSuspended}
                          isLiked={interactions.likedAnonIds.has(post.id)}
                          isSaved={interactions.savedAnonIds.has(post.id)}
                          isOwnedAnonymous={interactions.ownedAnonPostIds.has(
                            post.id
                          )}
                          ownedAnonymousCommentIds={
                            interactions.ownedAnonCommentIds
                          }
                          onOpenPost={(pid) =>
                            onNavigate('anonymous', { postId: pid })
                          }
                          onSaveChanged={(postId, saved) =>
                            setInteractions((prev) => {
                              const next = new Set(prev.savedAnonIds);
                              if (saved) next.add(postId);
                              else next.delete(postId);
                              return { ...prev, savedAnonIds: next };
                            })
                          }
                          onRequireAuth={onRequireAuth}
                          returnRoute="search"
                          onPostUpdated={(updated) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    anonymous: {
                                      ...prev.anonymous,
                                      items: prev.anonymous.items.map(
                                        (existing) =>
                                          existing.id === updated.id
                                            ? (updated as AnonymousPost)
                                            : existing
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                          onPostDeleted={(deletedId) =>
                            setBundle((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    anonymous: {
                                      ...prev.anonymous,
                                      items: prev.anonymous.items.filter(
                                        (existing) => existing.id !== deletedId
                                      ),
                                    },
                                  }
                                : prev
                            )
                          }
                        />
                      ))}
                    </div>
                    {bundle.anonymous.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'anonymous'}
                          onClick={() => void handleLoadMoreSlice('anonymous')}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'anonymous' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more anonymous posts
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Trusted Circle Results */}
              {(activeScope === 'all' || activeScope === 'trusted-circle') &&
                filteredTrusted.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                        Trusted Circle ({filteredTrusted.length})
                      </h2>
                      {activeScope === 'all' && (
                        <button
                          type="button"
                          onClick={() => handleTabChange('trusted-circle')}
                          className="text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Focus Trusted Circle
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {(activeScope === 'all'
                        ? filteredTrusted.slice(0, 6)
                        : filteredTrusted
                      ).map((contact) => (
                        <TrustedDirectoryCard
                          key={contact.id}
                          contact={contact}
                        />
                      ))}
                    </div>
                    {bundle.trustedCircle.hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingMoreSlice === 'trustedCircle'}
                          onClick={() =>
                            void handleLoadMoreSlice('trustedCircle')
                          }
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          {loadingMoreSlice === 'trustedCircle' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                              aria-hidden="true"
                            />
                          )}
                          Load more contacts
                        </button>
                      </div>
                    )}
                  </div>
                )}

              <p className="px-1 text-[11px] text-slate-500">
                {FIRESTORE_SEARCH_SCOPE_NOTE}
              </p>
            </>
          )}
        </div>
      )}

      {/* Initial Discovery State (Recent searches, Popular Campus Topics, and Hubs) */}
      {status === 'idle' && (
        <div className="space-y-5">
          {recentSearches.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                  Recent Searches
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearches();
                    setRecentSearches([]);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-[#0B1A2E]"
                >
                  Clear history
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recentSearches.map((term) => (
                  <div
                    key={term}
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-[#0B1A2E]"
                  >
                    <button
                      type="button"
                      onClick={() => handleQuickTopicClick(term)}
                      className="inline-flex min-h-[34px] items-center gap-1.5 px-3 py-1 font-medium hover:text-[#1E88E5]"
                    >
                      <Clock
                        className="h-3 w-3 text-slate-400"
                        aria-hidden="true"
                      />
                      <span>{term}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${term} from recent searches`}
                      onClick={() =>
                        setRecentSearches(removeRecentSearch(term))
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-r-lg text-slate-400 hover:bg-slate-200/70 hover:text-[#0B1A2E]"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Popular Campus Topics
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Jump directly to active posts, textbooks, scholarships, or campus
              events.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_DISCOVERY_TERMS.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleQuickTopicClick(term)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:border-[#1E88E5] hover:bg-[#1E88E5]/5 hover:text-[#1E88E5]"
                >
                  <Sparkles
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Browse LASUED Intel Hubs
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PLATFORM_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onNavigate(section.id)}
                  className="flex min-h-[68px] items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-[#1E88E5] hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <SectionIcon
                      sectionId={section.id}
                      className="mt-0.5 h-5 w-5 shrink-0 text-[#1E88E5]"
                    />
                    <div>
                      <p className="font-display text-sm font-bold text-[#0B1A2E]">
                        {section.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                        {section.summary}
                      </p>
                    </div>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

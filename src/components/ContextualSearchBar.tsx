import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Loader2,
  Search,
  Sparkles,
  Tag,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  getContextualSearchSnapshot,
  saveContextualSearchSnapshot,
} from '../services/navigationStateCache';
import {
  executeScopedSearchDiscovery,
  fetchSearchSuggestionSeed,
  fetchSearchViewerInteractions,
  getCachedSearchBundle,
  getRequiredCollectionsForScope,
  hydrateCachedSearchBundle,
  hydrateSearchSuggestionSeed,
  loadMoreSearchSlice,
  type SearchCollectionKey,
  type SearchDiscoveryBundle,
  type SearchSuggestionSeed,
  type SearchViewerInteractions,
} from '../services/searchDiscovery';
import { toggleEventReaction } from '../services/events';
import { toggleSavedPost } from '../services/socialPosts';
import type {
  AnonymousPost,
  CampusEvent,
  CommunityPost,
} from '../types/database';
import type { ActiveRoute, SearchScopeId } from '../types/platform';
import {
  buildSearchSuggestions,
  FIRESTORE_SEARCH_SCOPE_NOTE,
  formatSearchUserError,
  loadRecentSearches,
  normalizeSearchInput,
  saveRecentSearch,
  SEARCH_SCOPE_CONFIG,
  validateSearchQuery,
  type SearchSuggestionItem,
} from '../utils/contextualSearch';
import { computeOptimisticReactionToggle } from '../utils/optimisticInteractions';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { PostCard } from './posts/PostCard';
import { EventCard } from './sections/events/EventCard';
import { MarketplaceListingCard } from './sections/marketplace/MarketplaceListingCard';
import { OpportunityCard } from './sections/opportunities/OpportunityCard';
import {
  MemberDirectoryCard,
  TrustedDirectoryCard,
} from './sections/shared/DirectoryProfileCards';

interface ContextualSearchBarProps {
  scope: SearchScopeId;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      searchScope?: SearchScopeId;
      searchQuery?: string | null;
      opportunityId?: string | null;
      eventId?: string | null;
      postId?: string | null;
      listingId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  returnRoute: ActiveRoute;
  embedded?: boolean;
}

export const ContextualSearchBar: React.FC<ContextualSearchBarProps> = ({
  scope,
  onNavigate,
  onRequireAuth,
  returnRoute,
  embedded = false,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();
  const viewerKey = user?.uid ?? 'guest';
  const initialSnapshot = getContextualSearchSnapshot(viewerKey, scope);

  const scopeMeta = SEARCH_SCOPE_CONFIG[scope];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef(0);
  const skipNextDebounceRef = useRef(Boolean(initialSnapshot?.submittedQuery));
  const prevViewerKeyRef = useRef(viewerKey);

  const [queryText, setQueryText] = useState(
    () => initialSnapshot?.queryText ?? ''
  );
  const [submittedQuery, setSubmittedQuery] = useState(
    () => initialSnapshot?.submittedQuery ?? ''
  );
  const [status, setStatus] = useState<
    'idle' | 'short' | 'loading' | 'ready' | 'error'
  >(() => initialSnapshot?.status ?? 'idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bundle, setBundle] = useState<SearchDiscoveryBundle | null>(
    () => initialSnapshot?.bundle ?? null
  );
  const [loadingMoreSlice, setLoadingMoreSlice] =
    useState<SearchCollectionKey | null>(
      () => initialSnapshot?.loadingMoreSlice ?? null
    );

  const [suggestionSeed, setSuggestionSeed] =
    useState<SearchSuggestionSeed | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadRecentSearches()
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  useEffect(() => {
    if (prevViewerKeyRef.current === viewerKey) return;
    prevViewerKeyRef.current = viewerKey;
    const snap = getContextualSearchSnapshot(viewerKey, scope);
    if (snap?.submittedQuery) {
      skipNextDebounceRef.current = true;
    }
    const timer = window.setTimeout(() => {
      setQueryText(snap?.queryText ?? '');
      setSubmittedQuery(snap?.submittedQuery ?? '');
      setStatus(snap?.status ?? 'idle');
      setBundle(snap?.bundle ?? null);
      setLoadingMoreSlice(snap?.loadingMoreSlice ?? null);
      setValidationMessage(null);
      setErrorMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewerKey, scope]);

  useEffect(() => {
    saveContextualSearchSnapshot({
      viewerKey,
      scope,
      queryText,
      submittedQuery,
      bundle,
      status,
      loadingMoreSlice,
      cachedAt: Date.now(),
    });
  }, [
    viewerKey,
    scope,
    queryText,
    submittedQuery,
    bundle,
    status,
    loadingMoreSlice,
  ]);

  const [interactions, setInteractions] = useState<SearchViewerInteractions>({
    viewerUid: null,
    likedPostIds: new Set(),
    savedPostIds: new Set(),
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

  const ensureSuggestionSeed = useCallback(() => {
    if (suggestionSeed) return;
    void hydrateSearchSuggestionSeed()
      .then((persisted) => {
        if (persisted) {
          setSuggestionSeed(persisted);
          if (Date.now() - persisted.fetchedAt <= 5 * 60 * 1000) {
            return;
          }
        }
        return fetchSearchSuggestionSeed().then((seed) => {
          setSuggestionSeed(seed);
        });
      })
      .catch(() => {
        // Non-blocking suggestion seed
      });
  }, [suggestionSeed]);

  const executeSearch = useCallback(
    async (rawTerm: string, options?: { recordRecent?: boolean }) => {
      const validation = validateSearchQuery(rawTerm);
      if (validation.reason === 'empty') {
        setSubmittedQuery('');
        setValidationMessage(null);
        setErrorMessage(null);
        setStatus('idle');
        setBundle(null);
        return;
      }

      if (!validation.valid) {
        setSubmittedQuery(validation.normalizedQuery);
        setValidationMessage(validation.message ?? null);
        setErrorMessage(null);
        setStatus('short');
        setBundle(null);
        return;
      }

      const requestId = ++activeRequestIdRef.current;
      const cleanQuery = validation.normalizedQuery;
      setSubmittedQuery(cleanQuery);
      setValidationMessage(null);
      setErrorMessage(null);

      if (options?.recordRecent) {
        setRecentSearches(saveRecentSearch(cleanQuery));
      }

      let cached = getCachedSearchBundle(cleanQuery);
      if (!cached) {
        cached = await hydrateCachedSearchBundle(cleanQuery).catch(() => null);
        if (requestId !== activeRequestIdRef.current) return;
      }

      if (cached) {
        const allLoaded = getRequiredCollectionsForScope(scope).every(
          (col) => cached[col].loaded && !cached[col].error
        );
        setBundle(cached);
        if (allLoaded) {
          setStatus('ready');
          if (
            Date.now() - cached.updatedAt > 30_000 &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)
          ) {
            void executeScopedSearchDiscovery({
              rawQuery: cleanQuery,
              scope,
            })
              .then((freshBundle) => {
                if (requestId === activeRequestIdRef.current) {
                  setBundle(freshBundle);
                }
              })
              .catch(() => undefined);
          }
          return;
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setErrorMessage(
          'You are offline and this search is not cached yet. Reconnect to search live campus updates.'
        );
        setStatus('error');
        return;
      }

      setStatus('loading');

      try {
        const nextBundle = await executeScopedSearchDiscovery({
          rawQuery: cleanQuery,
          scope,
        });
        if (requestId !== activeRequestIdRef.current) return;
        setBundle(nextBundle);
        setStatus('ready');
      } catch (err) {
        if (requestId !== activeRequestIdRef.current) return;
        setErrorMessage(formatSearchUserError(err));
        setStatus('error');
      }
    },
    [scope]
  );

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
      void executeSearch(trimmed);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [queryText, executeSearch]);

  const handleQueryChange = (value: string) => {
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

  const suggestions = useMemo(
    () =>
      buildSearchSuggestions({
        rawQuery: queryText,
        recentSearches,
        members: suggestionSeed?.members ?? [],
        dynamicTerms: suggestionSeed?.dynamicTerms ?? [],
        scope,
        maxItems: 6,
      }),
    [queryText, recentSearches, suggestionSeed, scope]
  );

  const handleSelectSuggestion = (item: SearchSuggestionItem) => {
    setSuggestionsOpen(false);
    if (item.kind === 'person' && item.username) {
      setRecentSearches(saveRecentSearch(item.query));
      onNavigate('profile', { username: item.username });
      return;
    }
    setQueryText(item.query);
    void executeSearch(item.query, { recordRecent: true });
  };

  const handleLoadMoreSlice = async (sliceKey: SearchCollectionKey) => {
    if (!bundle || loadingMoreSlice) return;
    setLoadingMoreSlice(sliceKey);
    try {
      const updated = await loadMoreSearchSlice({ bundle, sliceKey });
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

  const members = bundle?.people.items ?? [];
  const posts = bundle?.posts.items ?? [];
  const anonymousPosts = bundle?.anonymous.items ?? [];
  const marketplaceListings = bundle?.marketplace.items ?? [];
  const marketplaceSellers = bundle?.marketplaceSellers ?? new Map();
  const trustedContacts = bundle?.trustedCircle.items ?? [];
  const opportunities = bundle?.opportunities.items ?? [];
  const events = bundle?.events.items ?? [];

  const hasResults =
    ((scope === 'home' || scope === 'all') &&
      (members.length > 0 || posts.length > 0)) ||
    (scope === 'all' &&
      (anonymousPosts.length > 0 ||
        marketplaceListings.length > 0 ||
        trustedContacts.length > 0 ||
        opportunities.length > 0 ||
        events.length > 0)) ||
    (scope === 'people' && members.length > 0) ||
    (scope === 'posts' && posts.length > 0) ||
    (scope === 'anonymous' && anonymousPosts.length > 0) ||
    (scope === 'marketplace' && marketplaceListings.length > 0) ||
    (scope === 'trusted-circle' && trustedContacts.length > 0) ||
    (scope === 'opportunities' && opportunities.length > 0) ||
    (scope === 'upcoming-events' && events.length > 0);

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-sm font-bold text-[#0B1A2E]">
            Search {scopeMeta.label}
          </p>
          <p className="text-xs text-slate-600">{scopeMeta.description}</p>
        </div>
        {embedded && (
          <button
            type="button"
            onClick={() =>
              onNavigate('search', {
                searchScope: scope === 'home' ? 'all' : scope,
                searchQuery: queryText.trim() || null,
              })
            }
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            <span>Open Full Search</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSuggestionsOpen(false);
          void executeSearch(queryText, { recordRecent: true });
        }}
        className="relative mt-3 flex gap-2"
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
            onChange={(e) => handleQueryChange(e.target.value)}
            aria-label={`Search ${scopeMeta.label}`}
            placeholder={scopeMeta.placeholder}
            className="block min-h-[44px] w-full rounded-xl border border-slate-300 bg-white py-2 pr-10 pl-10 text-sm text-[#0B1A2E] outline-none transition-colors focus:border-[#1E88E5] focus:ring-2 focus:ring-[#1E88E5]/20"
          />
          {queryText && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              aria-label="Clear search query"
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {suggestionsOpen && suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Search suggestions"
              className="absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            >
              {suggestions.map((sug) => (
                <button
                  key={sug.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSuggestion(sug)}
                  className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {sug.kind === 'recent' ? (
                      <Clock
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                    ) : sug.kind === 'person' ? (
                      <UserIcon
                        className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]"
                        aria-hidden="true"
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
                    <span className="truncate font-semibold text-[#0B1A2E]">
                      {sug.label}
                    </span>
                  </span>
                  {sug.subtitle && (
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {sug.subtitle}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] sm:text-sm"
        >
          Search
        </button>
      </form>

      {guestPromptTitle && (
        <div className="mt-4">
          <GuestPromptCard
            title={guestPromptTitle}
            description="Sign in or create a free LASUED Intel account to interact, bookmark, or follow campus members."
            returnRoute={returnRoute}
            onRequireAuth={onRequireAuth}
            onDismiss={() => setGuestPromptTitle(null)}
          />
        </div>
      )}

      {status === 'short' && validationMessage && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {validationMessage}
        </div>
      )}

      {status === 'loading' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <Loader2
            className="h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          <span>Searching {scopeMeta.label.toLowerCase()}...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span>{errorMessage || 'Unable to run search right now.'}</span>
          <button
            type="button"
            onClick={() => void executeSearch(queryText)}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && !hasResults && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center">
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No matches for &ldquo;{submittedQuery}&rdquo;
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Nothing matched inside {scopeMeta.label}. {FIRESTORE_SEARCH_SCOPE_NOTE}
          </p>
        </div>
      )}

      {status === 'ready' && hasResults && bundle && (
        <div className="mt-4 space-y-5">
          {(scope === 'home' || scope === 'all' || scope === 'people') &&
            members.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Campus Members ({members.length})
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {members.slice(0, 8).map((member) => (
                    <MemberDirectoryCard
                      key={member.username}
                      member={member}
                      viewerUsername={profile?.username}
                      onOpenProfile={(uname) =>
                        onNavigate('profile', { username: uname })
                      }
                      onRequireAuth={() =>
                        setGuestPromptTitle(`Sign in to follow @${member.username}`)
                      }
                    />
                  ))}
                </div>
                {bundle.people.hasMore && (
                  <button
                    type="button"
                    disabled={loadingMoreSlice === 'people'}
                    onClick={() => void handleLoadMoreSlice('people')}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline disabled:opacity-60"
                  >
                    {loadingMoreSlice === 'people'
                      ? 'Loading more members...'
                      : 'Check more members'}
                  </button>
                )}
              </div>
            )}

          {(scope === 'home' || scope === 'all' || scope === 'posts') &&
            posts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Community Posts ({posts.length})
              </p>
              <div className="space-y-3">
                {posts.slice(0, 8).map(({ post, author }) => (
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
                    returnRoute={returnRoute}
                    onPostUpdated={(updated) =>
                      setBundle((prev) =>
                        prev
                          ? {
                              ...prev,
                              posts: {
                                ...prev.posts,
                                items: prev.posts.items.map((item) =>
                                  item.post.id === updated.id
                                    ? { ...item, post: updated as CommunityPost }
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
                <button
                  type="button"
                  disabled={loadingMoreSlice === 'posts'}
                  onClick={() => void handleLoadMoreSlice('posts')}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline disabled:opacity-60"
                >
                  {loadingMoreSlice === 'posts'
                    ? 'Loading more posts...'
                    : 'Check more community posts'}
                </button>
              )}
            </div>
          )}

          {(scope === 'anonymous' || scope === 'all') &&
            anonymousPosts.length > 0 && (
            <div className="space-y-3">
              {anonymousPosts.slice(0, 10).map((post) => (
                <PostCard
                  key={post.id}
                  kind="anonymous"
                  post={post}
                  viewerUid={user?.uid ?? null}
                  viewerTier={effectiveTier}
                  viewerSuspended={isSuspended}
                  isLiked={interactions.likedAnonIds.has(post.id)}
                  isSaved={interactions.savedAnonIds.has(post.id)}
                  isOwnedAnonymous={interactions.ownedAnonPostIds.has(post.id)}
                  ownedAnonymousCommentIds={interactions.ownedAnonCommentIds}
                  onOpenPost={(pid) => onNavigate('anonymous', { postId: pid })}
                  onSaveChanged={(postId, saved) =>
                    setInteractions((prev) => {
                      const next = new Set(prev.savedAnonIds);
                      if (saved) next.add(postId);
                      else next.delete(postId);
                      return { ...prev, savedAnonIds: next };
                    })
                  }
                  onRequireAuth={onRequireAuth}
                  returnRoute={returnRoute}
                  onPostUpdated={(updated) =>
                    setBundle((prev) =>
                      prev
                        ? {
                            ...prev,
                            anonymous: {
                              ...prev.anonymous,
                              items: prev.anonymous.items.map((existing) =>
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
              {bundle.anonymous.hasMore && (
                <button
                  type="button"
                  disabled={loadingMoreSlice === 'anonymous'}
                  onClick={() => void handleLoadMoreSlice('anonymous')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline disabled:opacity-60"
                >
                  {loadingMoreSlice === 'anonymous'
                    ? 'Loading more anonymous posts...'
                    : 'Check more anonymous posts'}
                </button>
              )}
            </div>
          )}

          {(scope === 'marketplace' || scope === 'all') &&
            marketplaceListings.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 md:grid-cols-3">
                {marketplaceListings.slice(0, 9).map((item) => (
                  <MarketplaceListingCard
                    key={item.id}
                    listing={item}
                    seller={marketplaceSellers.get(item.ownerUID) ?? null}
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
                <button
                  type="button"
                  disabled={loadingMoreSlice === 'marketplace'}
                  onClick={() => void handleLoadMoreSlice('marketplace')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline disabled:opacity-60"
                >
                  {loadingMoreSlice === 'marketplace'
                    ? 'Loading more listings...'
                    : 'Check more Marketplace listings'}
                </button>
              )}
            </div>
          )}

          {(scope === 'trusted-circle' || scope === 'all') &&
            trustedContacts.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {trustedContacts.slice(0, 8).map((contact) => (
                <TrustedDirectoryCard key={contact.id} contact={contact} />
              ))}
            </div>
          )}

          {(scope === 'opportunities' || scope === 'all') &&
            opportunities.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {opportunities.slice(0, 8).map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opportunity={opp}
                  nowMs={nowMs}
                  isSaved={interactions.savedOpportunityIds.has(opp.id)}
                  saving={savingOppId === opp.id}
                  onToggleSave={(id) => void handleToggleOpportunitySave(id)}
                  onOpenDetails={(id) =>
                    onNavigate('opportunities', { opportunityId: id })
                  }
                />
              ))}
            </div>
          )}

          {(scope === 'upcoming-events' || scope === 'all') &&
            events.length > 0 && (
            <div className="space-y-4">
              {events.slice(0, 8).map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  nowMs={nowMs}
                  isLiked={interactions.likedEventIds.has(ev.id)}
                  isSaved={interactions.savedEventIds.has(ev.id)}
                  onOpenDetails={(id) =>
                    onNavigate('upcoming-events', { eventId: id })
                  }
                  onToggleLike={(item) => void handleToggleEventLike(item)}
                  onToggleSave={(item) => void handleToggleEventSave(item)}
                />
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            {FIRESTORE_SEARCH_SCOPE_NOTE}
          </p>
        </div>
      )}
    </div>
  );
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Wifi, WifiOff, X } from 'lucide-react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HomeFeedWorkspace } from './components/HomeFeedWorkspace';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileSectionDrawer } from './components/MobileSectionDrawer';
import { SectionSidebar } from './components/SectionSidebar';
import { SectionWorkspace } from './components/SectionWorkspace';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { AccountPage } from './components/pages/AccountPage';
import { AdminGuardPage } from './components/pages/AdminGuardPage';
import { MemberProfilePage } from './components/pages/MemberProfilePage';
import { NotificationsPage } from './components/pages/NotificationsPage';
import { SearchPage } from './components/pages/SearchPage';
import { useFirebase } from './context/firebaseContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import {
  AccountSettingsSection,
  ActiveRoute,
  FeedTabId,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
  SectionId,
  ViewState,
} from './types/platform';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchFiltersState,
} from './utils/contextualSearch';
import {
  areDestinationsEqual,
  createInitialHistoryStack,
  destinationFromParsedLocation,
  findMostRecentSearchEntry,
  getBackTarget,
  moveToHistoryEntryKey,
  normalizeRouteDestination,
  pushHistoryStackEntry,
  replaceCurrentHistoryDestination,
  resolveGuestSafeDestination,
  updateHistoryEntryScroll,
  type HistoryStackEntry,
  type NavigationStackState,
  type NormalizedRouteDestination,
  type RouteDestination,
} from './utils/navigationHistory';
import {
  createInitialSectionStates,
  transitionViewState,
} from './utils/sectionState';
import {
  buildSearchForRoute,
  isFeedRoute,
  isProtectedRouteOrTab,
  parseLocationSearch,
} from './utils/urlRouting';

export interface NavigateOptions extends Partial<Omit<RouteDestination, 'route'>> {
  replace?: boolean;
  restoreScrollY?: number;
}

interface StoredBrowserHistoryState {
  entryKey?: string;
  scrollY?: number;
  searchFilters?: SearchFiltersState;
}

function readBrowserHistoryState(state: unknown): StoredBrowserHistoryState {
  if (!state || typeof state !== 'object') {
    return {};
  }
  const obj = state as Record<string, unknown>;
  return {
    entryKey: typeof obj.entryKey === 'string' ? obj.entryKey : undefined,
    scrollY:
      typeof obj.scrollY === 'number' && Number.isFinite(obj.scrollY)
        ? Math.max(0, obj.scrollY)
        : undefined,
    searchFilters:
      obj.searchFilters && typeof obj.searchFilters === 'object'
        ? (obj.searchFilters as SearchFiltersState)
        : undefined,
  };
}

export function App() {
  const { authReady, user, refreshAccountState } = useFirebase();
  const { isOnline, justReconnected, syncErrorMessage, clearSyncError } =
    useNetworkStatus();

  const initialParsed = parseLocationSearch(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const initialStoredState =
    typeof window !== 'undefined'
      ? readBrowserHistoryState(window.history.state)
      : {};
  const initialDest = destinationFromParsedLocation(
    initialParsed,
    initialStoredState.searchFilters
  );

  const [navDest, setNavDest] =
    useState<NormalizedRouteDestination>(initialDest);
  const {
    route: activeRoute,
    username: profileUsername,
    profileTab,
    searchScope,
    searchQuery,
    searchFilters,
    opportunityId: selectedOpportunityId,
    eventId: selectedEventId,
    postId: selectedPostId,
    commentId: selectedCommentId,
    listingId: selectedListingId,
    marketplaceTab,
    accountSection,
  } = navDest;

  const [pendingAuthDestination, setPendingAuthDestination] =
    useState<NormalizedRouteDestination | null>(null);
  const [recentSearchEntry, setRecentSearchEntry] =
    useState<HistoryStackEntry | null>(null);
  const [dismissedSearchBannerKey, setDismissedSearchBannerKey] = useState<
    string | null
  >(null);

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [sectionStates, setSectionStates] = useState<
    Record<SectionId, ViewState>
  >(() => createInitialSectionStates('empty'));

  const retryTimerRef = useRef<number | null>(null);
  const historyStackRef = useRef<NavigationStackState>(
    createInitialHistoryStack(
      initialDest,
      initialStoredState.scrollY ?? 0,
      initialStoredState.entryKey
    )
  );
  const entryScrollMapRef = useRef<Map<string, number>>(new Map());
  const pendingAuthDestinationRef = useRef<NormalizedRouteDestination | null>(
    null
  );
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);

  const scheduleScrollRestore = useCallback((targetScrollY: number) => {
    if (cancelScrollRestoreRef.current) {
      cancelScrollRestoreRef.current();
      cancelScrollRestoreRef.current = null;
    }
    if (typeof window === 'undefined') return;

    const clampedTarget = Math.max(0, Math.round(targetScrollY));
    if (clampedTarget === 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const deadline = performance.now() + 950;

    const cleanup = () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener('wheel', cleanup);
      window.removeEventListener('touchstart', cleanup);
      window.removeEventListener('keydown', onUserKey);
      if (cancelScrollRestoreRef.current === cleanup) {
        cancelScrollRestoreRef.current = null;
      }
    };

    const onUserKey = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageDown' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        cleanup();
      }
    };

    const attemptScroll = () => {
      if (cancelled) return;
      const maxScrollable = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const goal = Math.min(clampedTarget, maxScrollable);
      if (Math.abs(window.scrollY - goal) > 2) {
        window.scrollTo({ top: goal, behavior: 'auto' });
      }
      if (
        maxScrollable >= clampedTarget - 2 &&
        Math.abs(window.scrollY - clampedTarget) <= 2
      ) {
        cleanup();
        return;
      }
      if (performance.now() < deadline) {
        rafId = window.requestAnimationFrame(attemptScroll);
      } else {
        cleanup();
      }
    };

    const timeoutId = window.setTimeout(cleanup, 1000);
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) {
          attemptScroll();
        }
      });
      resizeObserver.observe(document.body);
    }

    window.addEventListener('wheel', cleanup, { passive: true, once: true });
    window.addEventListener('touchstart', cleanup, {
      passive: true,
      once: true,
    });
    window.addEventListener('keydown', onUserKey);
    cancelScrollRestoreRef.current = cleanup;
    rafId = window.requestAnimationFrame(attemptScroll);
  }, []);

  const syncSearchBannerFromStack = useCallback(
    (stack: NavigationStackState) => {
      setRecentSearchEntry(findMostRecentSearchEntry(stack));
    },
    [setRecentSearchEntry]
  );

  const buildUrlForDestination = useCallback(
    (dest: NormalizedRouteDestination): string => {
      return buildSearchForRoute(dest.route, {
        username: dest.username,
        profileTab: dest.profileTab,
        searchScope: dest.route === 'search' ? dest.searchScope : undefined,
        searchQuery: dest.route === 'search' ? dest.searchQuery : undefined,
        opportunityId:
          dest.route === 'opportunities' ? dest.opportunityId : undefined,
        eventId: dest.route === 'upcoming-events' ? dest.eventId : undefined,
        postId: dest.postId,
        commentId: dest.commentId,
        listingId: dest.route === 'marketplace' ? dest.listingId : undefined,
        marketplaceTab:
          dest.route === 'marketplace' ? dest.marketplaceTab : undefined,
        accountSection:
          dest.route === 'account' ? dest.accountSection : undefined,
      });
    },
    []
  );

  const persistCurrentBrowserState = useCallback(
    (entry: HistoryStackEntry, scrollY: number) => {
      if (typeof window === 'undefined') return;
      const existing =
        window.history.state && typeof window.history.state === 'object'
          ? (window.history.state as Record<string, unknown>)
          : {};
      window.history.replaceState(
        {
          ...existing,
          entryKey: entry.key,
          scrollY: Math.max(0, Math.round(scrollY)),
          ...(entry.destination.route === 'search'
            ? { searchFilters: entry.destination.searchFilters }
            : {}),
        },
        '',
        buildUrlForDestination(entry.destination)
      );
    },
    [buildUrlForDestination]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prevScrollRestoration = window.history.scrollRestoration;
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const initialEntry =
      historyStackRef.current.entries[historyStackRef.current.index];
    if (initialEntry) {
      entryScrollMapRef.current.set(initialEntry.key, initialEntry.scrollY);
      persistCurrentBrowserState(initialEntry, initialEntry.scrollY);
      if (initialEntry.scrollY > 0) {
        scheduleScrollRestore(initialEntry.scrollY);
      }
    }

    let scrollRaf: number | null = null;
    const captureScrollPosition = () => {
      const activeEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!activeEntry) return;
      const currentScroll = Math.max(0, Math.round(window.scrollY));
      entryScrollMapRef.current.set(activeEntry.key, currentScroll);
      historyStackRef.current = updateHistoryEntryScroll(
        historyStackRef.current,
        currentScroll
      );
    };

    const handleScroll = () => {
      if (scrollRaf !== null) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = null;
        captureScrollPosition();
      });
    };

    const flushHistoryScrollState = () => {
      captureScrollPosition();
      const activeEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (activeEntry) {
        persistCurrentBrowserState(activeEntry, activeEntry.scrollY);
      }
    };

    const onPopState = (event: PopStateEvent) => {
      const parsed = parseLocationSearch(window.location.search);
      const historyObj = readBrowserHistoryState(event.state);
      const fallbackDest = destinationFromParsedLocation(
        parsed,
        historyObj.searchFilters
      );

      const moved = moveToHistoryEntryKey(
        historyStackRef.current,
        historyObj.entryKey,
        fallbackDest,
        historyObj.scrollY ?? 0
      );
      historyStackRef.current = moved.stack;

      const targetEntry = moved.entry;
      const recordedScroll =
        historyObj.scrollY ??
        entryScrollMapRef.current.get(targetEntry.key) ??
        targetEntry.scrollY ??
        0;

      if (!historyObj.entryKey) {
        persistCurrentBrowserState(targetEntry, recordedScroll);
      }

      setNavDest(targetEntry.destination);
      syncSearchBannerFromStack(historyStackRef.current);
      scheduleScrollRestore(recordedScroll);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', flushHistoryScrollState);
    window.addEventListener('popstate', onPopState);

    return () => {
      if (scrollRaf !== null) {
        window.cancelAnimationFrame(scrollRaf);
      }
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = prevScrollRestoration;
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pagehide', flushHistoryScrollState);
      window.removeEventListener('popstate', onPopState);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      if (cancelScrollRestoreRef.current) {
        cancelScrollRestoreRef.current();
      }
    };
  }, [
    persistCurrentBrowserState,
    scheduleScrollRestore,
    setNavDest,
    syncSearchBannerFromStack,
  ]);

  const handleNavigate = useCallback(
    (route: ActiveRoute, options?: NavigateOptions) => {
      const departingScrollY =
        typeof window !== 'undefined' ? Math.max(0, Math.round(window.scrollY)) : 0;

      const nextDest = normalizeRouteDestination({
        route,
        username: options?.username,
        profileTab: options?.profileTab,
        searchScope: options?.searchScope,
        searchQuery: options?.searchQuery,
        searchFilters: options?.searchFilters,
        opportunityId: options?.opportunityId,
        eventId: options?.eventId,
        postId: options?.postId,
        commentId: options?.commentId,
        listingId: options?.listingId,
        marketplaceTab: options?.marketplaceTab,
        accountSection: options?.accountSection,
      });

      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (currentEntry) {
        entryScrollMapRef.current.set(currentEntry.key, departingScrollY);
        historyStackRef.current = updateHistoryEntryScroll(
          historyStackRef.current,
          departingScrollY
        );
        persistCurrentBrowserState(currentEntry, departingScrollY);
      }

      if (options?.replace) {
        const replaced = replaceCurrentHistoryDestination(
          historyStackRef.current,
          nextDest,
          options.restoreScrollY ?? 0
        );
        historyStackRef.current = replaced.stack;
        entryScrollMapRef.current.set(
          replaced.entry.key,
          options.restoreScrollY ?? 0
        );
        setNavDest(replaced.entry.destination);
        syncSearchBannerFromStack(historyStackRef.current);
        persistCurrentBrowserState(replaced.entry, options.restoreScrollY ?? 0);

        if (options.restoreScrollY !== undefined) {
          scheduleScrollRestore(options.restoreScrollY);
        } else if (!nextDest.postId && !nextDest.commentId) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
        return;
      }

      const targetInitialScroll = options?.restoreScrollY ?? 0;
      const pushed = pushHistoryStackEntry(
        historyStackRef.current,
        nextDest,
        departingScrollY,
        targetInitialScroll
      );
      historyStackRef.current = pushed.stack;
      entryScrollMapRef.current.set(pushed.entry.key, pushed.entry.scrollY);
      setNavDest(pushed.entry.destination);
      syncSearchBannerFromStack(historyStackRef.current);

      if (!pushed.pushed) {
        if (options?.restoreScrollY !== undefined) {
          scheduleScrollRestore(options.restoreScrollY);
        } else if (!nextDest.postId && !nextDest.commentId) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      const nextUrl = buildUrlForDestination(pushed.entry.destination);
      if (typeof window !== 'undefined') {
        window.history.pushState(
          {
            entryKey: pushed.entry.key,
            scrollY: targetInitialScroll,
            ...(pushed.entry.destination.route === 'search'
              ? { searchFilters: pushed.entry.destination.searchFilters }
              : {}),
          },
          '',
          nextUrl
        );
      }

      if (options?.restoreScrollY !== undefined) {
        scheduleScrollRestore(targetInitialScroll);
      } else if (!nextDest.postId && !nextDest.commentId) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    [
      buildUrlForDestination,
      persistCurrentBrowserState,
      scheduleScrollRestore,
      setNavDest,
      syncSearchBannerFromStack,
    ]
  );

  // Enforce guest-safe views when auth resolves as signed out (e.g. after sign-out)
  useEffect(() => {
    if (!authReady || user) return;
    const currentEntry =
      historyStackRef.current.entries[historyStackRef.current.index];
    if (!currentEntry) return;
    if (!isProtectedRouteOrTab(currentEntry.destination)) return;

    const safeDest = resolveGuestSafeDestination(
      currentEntry.destination,
      false
    );
    handleNavigate(safeDest.route, {
      ...safeDest,
      replace: true,
      restoreScrollY: 0,
    });
  }, [authReady, user, handleNavigate]);

  const handleReplaceCurrentDestination = useCallback(
    (patch: Partial<Omit<RouteDestination, 'route'>>) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!currentEntry) return;
      const currentScroll =
        typeof window !== 'undefined' ? Math.max(0, Math.round(window.scrollY)) : 0;
      const nextDest = normalizeRouteDestination({
        ...currentEntry.destination,
        ...patch,
        route: currentEntry.destination.route,
      });
      if (areDestinationsEqual(currentEntry.destination, nextDest)) {
        return;
      }
      const replaced = replaceCurrentHistoryDestination(
        historyStackRef.current,
        nextDest,
        currentScroll
      );
      historyStackRef.current = replaced.stack;
      entryScrollMapRef.current.set(replaced.entry.key, currentScroll);
      setNavDest(replaced.entry.destination);
      syncSearchBannerFromStack(historyStackRef.current);
      persistCurrentBrowserState(replaced.entry, currentScroll);
    },
    [persistCurrentBrowserState, setNavDest, syncSearchBannerFromStack]
  );

  const handleSyncSearchState = useCallback(
    (next: {
      scope: SearchScopeId;
      query: string;
      filters: SearchFiltersState;
    }) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!currentEntry || currentEntry.destination.route !== 'search') return;
      const cleanQuery = next.query.trim() || null;
      handleReplaceCurrentDestination({
        searchScope: next.scope,
        searchQuery: cleanQuery,
        searchFilters: next.filters,
      });
    },
    [handleReplaceCurrentDestination]
  );

  const handleSyncProfileTab = useCallback(
    (nextTab: ProfileTab) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!currentEntry || currentEntry.destination.route !== 'profile') return;
      handleReplaceCurrentDestination({ profileTab: nextTab });
    },
    [handleReplaceCurrentDestination]
  );

  const handleSyncMarketplaceTab = useCallback(
    (nextTab: MarketplaceTab) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!currentEntry || currentEntry.destination.route !== 'marketplace') {
        return;
      }
      handleReplaceCurrentDestination({ marketplaceTab: nextTab });
    },
    [handleReplaceCurrentDestination]
  );

  const handleSyncAccountSection = useCallback(
    (nextSection: AccountSettingsSection) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!currentEntry || currentEntry.destination.route !== 'account') return;
      handleReplaceCurrentDestination({ accountSection: nextSection });
    },
    [handleReplaceCurrentDestination]
  );

  const handleNavigateBack = useCallback(() => {
    const resolution = getBackTarget(historyStackRef.current);
    if (resolution.kind === 'history_back' && typeof window !== 'undefined') {
      if (resolution.steps === 1) {
        window.history.back();
      } else {
        window.history.go(-resolution.steps);
      }
      return;
    }

    const fallback =
      resolution.kind === 'fallback'
        ? resolution.destination
        : normalizeRouteDestination({ route: 'for-you' });
    handleNavigate(fallback.route, {
      ...fallback,
      replace: true,
      restoreScrollY: 0,
    });
  }, [handleNavigate]);

  const handleBackToSearch = useCallback(() => {
    const stack = historyStackRef.current;
    const immediatePrev = stack.entries[stack.index - 1];
    if (
      immediatePrev?.destination.route === 'search' &&
      typeof window !== 'undefined'
    ) {
      window.history.back();
      return;
    }

    const searchEntry = recentSearchEntry ?? findMostRecentSearchEntry(stack);
    if (searchEntry) {
      const targetIndex = stack.entries.findIndex(
        (item) => item.key === searchEntry.key
      );
      if (targetIndex !== -1 && targetIndex < stack.index) {
        window.history.go(-(stack.index - targetIndex));
        return;
      }
      handleNavigate('search', {
        searchScope: searchEntry.destination.searchScope,
        searchQuery: searchEntry.destination.searchQuery,
        searchFilters: searchEntry.destination.searchFilters,
        restoreScrollY: searchEntry.scrollY,
      });
      return;
    }

    handleNavigate('search', {
      searchScope: 'all',
      searchQuery: null,
      searchFilters: DEFAULT_SEARCH_FILTERS,
    });
  }, [handleNavigate, recentSearchEntry]);

  const handleRequireAuth = useCallback(
    (authRoute: 'login' | 'register', returnTo: ActiveRoute) => {
      const currentEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      let savedDest: NormalizedRouteDestination;

      if (
        currentEntry &&
        currentEntry.destination.route !== 'login' &&
        currentEntry.destination.route !== 'register' &&
        currentEntry.destination.route === returnTo
      ) {
        savedDest = currentEntry.destination;
      } else if (returnTo === 'login' || returnTo === 'register') {
        savedDest = normalizeRouteDestination({ route: 'for-you' });
      } else {
        savedDest = normalizeRouteDestination({ route: returnTo });
      }

      pendingAuthDestinationRef.current = savedDest;
      setPendingAuthDestination(savedDest);
      handleNavigate(authRoute);
    },
    [handleNavigate, setPendingAuthDestination]
  );

  const handleAuthSuccess = useCallback(
    (destination: ActiveRoute) => {
      const pending = pendingAuthDestinationRef.current;
      pendingAuthDestinationRef.current = null;
      setPendingAuthDestination(null);

      if (pending) {
        handleNavigate(pending.route, {
          ...pending,
          replace: true,
          restoreScrollY: 0,
        });
        return;
      }

      const target =
        destination === 'login' || destination === 'register'
          ? 'for-you'
          : destination;
      handleNavigate(target, { replace: true });
    },
    [handleNavigate, setPendingAuthDestination]
  );

  const handleRetry = (sectionId: SectionId) => {
    setSectionStates((prev) => ({
      ...prev,
      [sectionId]: transitionViewState(prev[sectionId], 'RETRY'),
    }));

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }

    retryTimerRef.current = window.setTimeout(() => {
      setSectionStates((prev) => ({
        ...prev,
        [sectionId]: transitionViewState(prev[sectionId], 'SET_EMPTY'),
      }));
      retryTimerRef.current = null;
    }, 650);
  };

  const authReturnRoute = pendingAuthDestination?.route ?? 'for-you';

  const renderMainContent = () => {
    if (activeRoute === 'login') {
      return (
        <LoginPage
          returnRoute={authReturnRoute}
          onSuccess={handleAuthSuccess}
          onNavigate={handleNavigate}
          onBack={handleNavigateBack}
          onRefreshAccount={refreshAccountState}
        />
      );
    }

    if (activeRoute === 'register') {
      return (
        <RegisterPage
          returnRoute={authReturnRoute}
          onSuccess={handleAuthSuccess}
          onNavigate={handleNavigate}
          onBack={handleNavigateBack}
          onRefreshAccount={refreshAccountState}
        />
      );
    }

    if (activeRoute === 'notifications') {
      return (
        <NotificationsPage
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (activeRoute === 'account') {
      return (
        <AccountPage
          key={user?.uid ?? 'guest'}
          initialSection={accountSection}
          onSectionChange={handleSyncAccountSection}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (activeRoute === 'profile') {
      return (
        <MemberProfilePage
          key={profileUsername ?? 'self'}
          username={profileUsername}
          initialTab={profileTab}
          onTabChange={handleSyncProfileTab}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
          onBack={handleNavigateBack}
        />
      );
    }

    if (activeRoute === 'admin') {
      return (
        <AdminGuardPage
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (activeRoute === 'search') {
      return (
        <SearchPage
          initialScope={searchScope}
          initialQuery={searchQuery}
          initialFilters={searchFilters}
          onSyncSearchState={handleSyncSearchState}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (isFeedRoute(activeRoute)) {
      return (
        <HomeFeedWorkspace
          key={activeRoute}
          activeFeedTab={activeRoute as FeedTabId}
          selectedPostId={selectedPostId}
          selectedCommentId={selectedCommentId}
          onSelectFeedTab={(tab) => handleNavigate(tab)}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    return (
      <SectionWorkspace
        key={activeRoute}
        sectionId={
          activeRoute as Exclude<SectionId, 'for-you' | 'following' | 'latest'>
        }
        selectedOpportunityId={
          activeRoute === 'opportunities' ? selectedOpportunityId : null
        }
        selectedEventId={
          activeRoute === 'upcoming-events' ? selectedEventId : null
        }
        selectedPostId={activeRoute === 'anonymous' ? selectedPostId : null}
        selectedCommentId={selectedCommentId}
        selectedListingId={
          activeRoute === 'marketplace' ? selectedListingId : null
        }
        marketplaceTab={
          activeRoute === 'marketplace' ? marketplaceTab : undefined
        }
        onSelectMarketplaceTab={
          activeRoute === 'marketplace' ? handleSyncMarketplaceTab : undefined
        }
        sectionStates={sectionStates}
        onNavigate={handleNavigate}
        onRetry={handleRetry}
        onRequireAuth={handleRequireAuth}
      />
    );
  };

  const showSidebar =
    activeRoute !== 'login' && activeRoute !== 'register';

  const showBackToSearchBanner =
    Boolean(recentSearchEntry) &&
    dismissedSearchBannerKey !== recentSearchEntry?.key &&
    activeRoute !== 'search' &&
    activeRoute !== 'profile' &&
    activeRoute !== 'login' &&
    activeRoute !== 'register';

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50 text-[#0B1A2E]">
      <Header
        activeRoute={activeRoute}
        isMobileDrawerOpen={isMobileDrawerOpen}
        onNavigate={handleNavigate}
        onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        onRequireAuth={handleRequireAuth}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-5 sm:px-6 lg:py-7">
        {showSidebar && (
          <SectionSidebar
            activeRoute={activeRoute}
            marketplaceTab={
              activeRoute === 'marketplace' ? marketplaceTab : undefined
            }
            onNavigate={handleNavigate}
          />
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {!isOnline ? (
            <div
              role="status"
              data-testid="network-offline-banner"
              className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-950 sm:text-sm"
            >
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>
                You&apos;re offline — browsing cached campus content. New posts and
                edits require an internet connection.
              </span>
            </div>
          ) : justReconnected ? (
            <div
              role="status"
              data-testid="network-reconnected-banner"
              className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 sm:text-sm"
            >
              <Wifi className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>Back online — syncing latest updates...</span>
            </div>
          ) : syncErrorMessage ? (
            <div
              role="alert"
              data-testid="network-sync-error-banner"
              className="flex items-center justify-between gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 sm:text-sm"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                <span>{syncErrorMessage}</span>
              </div>
              <button
                type="button"
                onClick={clearSyncError}
                aria-label="Dismiss sync notice"
                className="rounded p-1 text-red-700 hover:bg-red-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {showBackToSearchBanner && recentSearchEntry && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
              <button
                type="button"
                onClick={handleBackToSearch}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-lg text-xs font-semibold text-[#1E88E5] hover:underline sm:text-sm"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>
                  Back to Search Results
                  {recentSearchEntry.destination.searchQuery
                    ? ` for “${recentSearchEntry.destination.searchQuery}”`
                    : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setDismissedSearchBannerKey(recentSearchEntry.key)
                }
                className="text-xs font-medium text-slate-500 hover:text-[#0B1A2E]"
              >
                Dismiss
              </button>
            </div>
          )}

          {renderMainContent()}
        </div>
      </main>

      <Footer onNavigate={handleNavigate} />

      <MobileBottomNav
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
      />

      <MobileSectionDrawer
        isOpen={isMobileDrawerOpen}
        activeRoute={activeRoute}
        marketplaceTab={
          activeRoute === 'marketplace' ? marketplaceTab : undefined
        }
        onSelectRoute={handleNavigate}
        onRequireAuth={handleRequireAuth}
        onClose={() => setIsMobileDrawerOpen(false)}
      />
    </div>
  );
}

export default App;

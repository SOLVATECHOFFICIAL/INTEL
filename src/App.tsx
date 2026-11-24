import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bell, Wifi, WifiOff, X } from 'lucide-react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HomeFeedWorkspace } from './components/HomeFeedWorkspace';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileSectionDrawer } from './components/MobileSectionDrawer';
import { PWAInstallControl } from './components/pwa/PWAInstallControl';
import { SectionSidebar } from './components/SectionSidebar';
import { SectionWorkspace } from './components/SectionWorkspace';
import { useFirebase } from './context/firebaseContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { verifyStoredPushSubscriptionForUser } from './services/webPush';
import { getPublicSiteBaseUrl } from './config/site';
import { resolveNotificationDestination } from './utils/notifications';
import { parseNotificationTargetUrl } from './utils/pwa';
import {
  applyDocumentSeoMetadata,
  resolvePageSeoMetadata,
} from './utils/seo';
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
  canGoBackHistory,
  createInitialHistoryStack,
  destinationFromParsedLocation,
  findMostRecentSearchEntry,
  getBackTarget,
  getDestinationMemoryKey,
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

const LoginPage = lazy(() =>
  import('./components/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = lazy(() =>
  import('./components/auth/RegisterPage').then((m) => ({
    default: m.RegisterPage,
  }))
);
const AccountPage = lazy(() =>
  import('./components/pages/AccountPage').then((m) => ({
    default: m.AccountPage,
  }))
);
const AdminGuardPage = lazy(() =>
  import('./components/pages/AdminGuardPage').then((m) => ({
    default: m.AdminGuardPage,
  }))
);
const MemberProfilePage = lazy(() =>
  import('./components/pages/MemberProfilePage').then((m) => ({
    default: m.MemberProfilePage,
  }))
);
const NotificationsPage = lazy(() =>
  import('./components/pages/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  }))
);
const SearchPage = lazy(() =>
  import('./components/pages/SearchPage').then((m) => ({
    default: m.SearchPage,
  }))
);

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
  const {
    authReady,
    user,
    isSuspended,
    foregroundNotificationToast,
    dismissForegroundNotificationToast,
    markNotificationReadOptimistic,
    refreshAccountState,
  } = useFirebase();
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
  const routeScrollMemoryRef = useRef<Map<string, number>>(new Map());
  const pendingAuthDestinationRef = useRef<NormalizedRouteDestination | null>(
    null
  );
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);
  const cancelPendingScrollRafRef = useRef<(() => void) | null>(null);
  const isRestoringScrollRef = useRef(false);
  const lastSearchQueryRef = useRef<string | null>(initialDest.searchQuery);
  const [canGoBack, setCanGoBack] = useState(false);

  const syncCanGoBack = useCallback((stack: NavigationStackState) => {
    setCanGoBack(canGoBackHistory(stack));
  }, []);

  useEffect(() => {
    const metadata = resolvePageSeoMetadata(navDest, getPublicSiteBaseUrl());
    applyDocumentSeoMetadata(metadata);
  }, [navDest]);

  const scheduleScrollRestore = useCallback((targetScrollY: number) => {
    if (cancelScrollRestoreRef.current) {
      cancelScrollRestoreRef.current();
      cancelScrollRestoreRef.current = null;
    }
    if (typeof window === 'undefined') return;

    const clampedTarget = Math.max(0, Math.round(targetScrollY));
    if (clampedTarget === 0) {
      isRestoringScrollRef.current = true;
      window.scrollTo({ top: 0, behavior: 'auto' });
      const clearRaf = window.requestAnimationFrame(() => {
        isRestoringScrollRef.current = false;
      });
      cancelScrollRestoreRef.current = () => {
        window.cancelAnimationFrame(clearRaf);
        isRestoringScrollRef.current = false;
      };
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const deadline = performance.now() + 2500;
    isRestoringScrollRef.current = true;

    const cleanup = () => {
      cancelled = true;
      isRestoringScrollRef.current = false;
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

    const timeoutId = window.setTimeout(cleanup, 2550);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) {
          attemptScroll();
        }
      });
      if (document.documentElement) {
        resizeObserver.observe(document.documentElement);
      }
      if (document.body) {
        resizeObserver.observe(document.body);
      }
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
      routeScrollMemoryRef.current.set(
        getDestinationMemoryKey(initialEntry.destination),
        initialEntry.scrollY
      );
      persistCurrentBrowserState(initialEntry, initialEntry.scrollY);
      if (initialEntry.scrollY > 0) {
        scheduleScrollRestore(initialEntry.scrollY);
      }
    }

    let scrollRaf: number | null = null;
    const cancelQueuedScrollRaf = () => {
      if (scrollRaf !== null) {
        window.cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
    };
    cancelPendingScrollRafRef.current = cancelQueuedScrollRaf;

    const captureScrollPosition = () => {
      if (isRestoringScrollRef.current) return;
      const activeEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (!activeEntry) return;
      const currentScroll = Math.max(0, Math.round(window.scrollY));
      entryScrollMapRef.current.set(activeEntry.key, currentScroll);
      routeScrollMemoryRef.current.set(
        getDestinationMemoryKey(activeEntry.destination),
        currentScroll
      );
      historyStackRef.current = updateHistoryEntryScroll(
        historyStackRef.current,
        currentScroll
      );
    };

    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      if (scrollRaf !== null) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = null;
        captureScrollPosition();
      });
    };

    const flushHistoryScrollState = () => {
      cancelQueuedScrollRaf();
      captureScrollPosition();
      const activeEntry =
        historyStackRef.current.entries[historyStackRef.current.index];
      if (activeEntry) {
        persistCurrentBrowserState(activeEntry, activeEntry.scrollY);
      }
    };

    const onPopState = (event: PopStateEvent) => {
      cancelQueuedScrollRaf();
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

      entryScrollMapRef.current.set(targetEntry.key, recordedScroll);
      routeScrollMemoryRef.current.set(
        getDestinationMemoryKey(targetEntry.destination),
        recordedScroll
      );
      if (targetEntry.destination.route === 'search') {
        lastSearchQueryRef.current = targetEntry.destination.searchQuery;
      }

      if (!historyObj.entryKey) {
        persistCurrentBrowserState(targetEntry, recordedScroll);
      }

      syncCanGoBack(historyStackRef.current);
      setNavDest(targetEntry.destination);
      syncSearchBannerFromStack(historyStackRef.current);
      scheduleScrollRestore(recordedScroll);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', flushHistoryScrollState);
    window.addEventListener('popstate', onPopState);

    return () => {
      cancelQueuedScrollRaf();
      if (cancelPendingScrollRafRef.current === cancelQueuedScrollRaf) {
        cancelPendingScrollRafRef.current = null;
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
    syncCanGoBack,
    syncSearchBannerFromStack,
  ]);

  const handleNavigate = useCallback(
    (route: ActiveRoute, options?: NavigateOptions) => {
      cancelPendingScrollRafRef.current?.();
      const wasRestoring = isRestoringScrollRef.current;
      if (cancelScrollRestoreRef.current) {
        cancelScrollRestoreRef.current();
        cancelScrollRestoreRef.current = null;
      }

      const rawWindowScrollY =
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
      const departingScrollY =
        wasRestoring && currentEntry
          ? Math.max(rawWindowScrollY, currentEntry.scrollY)
          : rawWindowScrollY;

      if (currentEntry) {
        entryScrollMapRef.current.set(currentEntry.key, departingScrollY);
        routeScrollMemoryRef.current.set(
          getDestinationMemoryKey(currentEntry.destination),
          departingScrollY
        );
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
        const targetScroll = options.restoreScrollY ?? 0;
        entryScrollMapRef.current.set(replaced.entry.key, targetScroll);
        routeScrollMemoryRef.current.set(
          getDestinationMemoryKey(replaced.entry.destination),
          targetScroll
        );
        if (replaced.entry.destination.route === 'search') {
          lastSearchQueryRef.current = replaced.entry.destination.searchQuery;
        }
        syncCanGoBack(historyStackRef.current);
        setNavDest(replaced.entry.destination);
        syncSearchBannerFromStack(historyStackRef.current);
        persistCurrentBrowserState(replaced.entry, targetScroll);

        if (options.restoreScrollY !== undefined) {
          scheduleScrollRestore(options.restoreScrollY);
        } else if (!nextDest.postId && !nextDest.commentId) {
          scheduleScrollRestore(0);
        }
        return;
      }

      const nextMemoryKey = getDestinationMemoryKey(nextDest);
      const isExplicitNewSearchQuery =
        nextDest.route === 'search' &&
        Boolean(nextDest.searchQuery) &&
        nextDest.searchQuery !== lastSearchQueryRef.current;
      const rememberedScroll =
        !nextDest.postId && !nextDest.commentId && !isExplicitNewSearchQuery
          ? routeScrollMemoryRef.current.get(nextMemoryKey) ?? 0
          : 0;
      const targetInitialScroll = options?.restoreScrollY ?? rememberedScroll;

      const pushed = pushHistoryStackEntry(
        historyStackRef.current,
        nextDest,
        departingScrollY,
        targetInitialScroll
      );
      historyStackRef.current = pushed.stack;

      if (!pushed.pushed) {
        syncCanGoBack(historyStackRef.current);
        setNavDest(pushed.entry.destination);
        syncSearchBannerFromStack(historyStackRef.current);
        if (options?.restoreScrollY !== undefined) {
          entryScrollMapRef.current.set(
            pushed.entry.key,
            options.restoreScrollY
          );
          routeScrollMemoryRef.current.set(
            nextMemoryKey,
            options.restoreScrollY
          );
          scheduleScrollRestore(options.restoreScrollY);
        } else if (!nextDest.postId && !nextDest.commentId) {
          entryScrollMapRef.current.set(pushed.entry.key, 0);
          routeScrollMemoryRef.current.set(nextMemoryKey, 0);
          historyStackRef.current = updateHistoryEntryScroll(
            historyStackRef.current,
            0
          );
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      entryScrollMapRef.current.set(pushed.entry.key, pushed.entry.scrollY);
      if (pushed.entry.destination.route === 'search' && nextDest.searchQuery) {
        lastSearchQueryRef.current = nextDest.searchQuery;
      }
      syncCanGoBack(historyStackRef.current);
      setNavDest(pushed.entry.destination);
      syncSearchBannerFromStack(historyStackRef.current);

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
        scheduleScrollRestore(targetInitialScroll);
      }
    },
    [
      buildUrlForDestination,
      persistCurrentBrowserState,
      scheduleScrollRestore,
      setNavDest,
      syncCanGoBack,
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

  // Listen for Service Worker notification click deep links and rotated push subscriptions
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'LASUED_NAVIGATE_NOTIFICATION') {
        const parsed = parseNotificationTargetUrl(
          typeof data.targetPath === 'string' ? data.targetPath : null,
          typeof window !== 'undefined' ? window.location.origin : undefined
        );
        if (parsed) {
          handleNavigate(parsed.route, parsed.destination);
        } else {
          handleNavigate('notifications');
        }
        return;
      }

      if (data.type === 'LASUED_PUSH_SUBSCRIPTION_CHANGED' && user?.uid) {
        void verifyStoredPushSubscriptionForUser(user.uid);
      }
    };

    navigator.serviceWorker.addEventListener(
      'message',
      handleServiceWorkerMessage
    );
    return () => {
      navigator.serviceWorker.removeEventListener(
        'message',
        handleServiceWorkerMessage
      );
    };
  }, [handleNavigate, user?.uid]);

  useEffect(() => {
    if (!foregroundNotificationToast) return;
    const timer = window.setTimeout(() => {
      dismissForegroundNotificationToast();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [foregroundNotificationToast, dismissForegroundNotificationToast]);

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
      lastSearchQueryRef.current = cleanQuery;
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
          onBack={handleNavigateBack}
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
          onBack={handleNavigateBack}
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
          onBack={handleNavigateBack}
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
          onBack={handleNavigateBack}
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
          canGoBack={canGoBack}
          onBack={handleNavigateBack}
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
        selectedPostId={
          activeRoute === 'anonymous' || activeRoute === 'updates'
            ? selectedPostId
            : null
        }
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
        onBack={handleNavigateBack}
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

          {showSidebar && <PWAInstallControl variant="banner" />}

          <Suspense
            fallback={
              <div
                role="status"
                aria-label="Loading view"
                className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8"
              >
                <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1E88E5] border-t-transparent" />
                  <span>Loading campus view...</span>
                </div>
              </div>
            }
          >
            {renderMainContent()}
          </Suspense>
        </div>
      </main>

      <Footer onNavigate={handleNavigate} />

      {foregroundNotificationToast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="foreground-notification-toast"
          className="fixed right-4 bottom-20 z-50 w-[min(calc(100vw-2rem),24rem)] rounded-2xl border border-[#1E88E5]/30 bg-white p-3.5 shadow-2xl sm:right-6 sm:bottom-6"
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => {
                const item = foregroundNotificationToast;
                if (!item.isRead && !isSuspended) {
                  void markNotificationReadOptimistic(item.id);
                }
                const dest = resolveNotificationDestination(item);
                dismissForegroundNotificationToast();
                if (dest) {
                  handleNavigate(dest.route, dest.options);
                } else {
                  handleNavigate('notifications');
                }
              }}
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] text-white">
                <Bell className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-[#0B1A2E] sm:text-sm">
                  {foregroundNotificationToast.title}
                </span>
                {foregroundNotificationToast.body && (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">
                    {foregroundNotificationToast.body}
                  </span>
                )}
                <span className="mt-1 block text-[11px] font-semibold text-[#1E88E5]">
                  Open alert
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Dismiss notification toast"
              onClick={dismissForegroundNotificationToast}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

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

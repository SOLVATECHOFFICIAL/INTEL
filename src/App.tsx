import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HomeFeedWorkspace } from './components/HomeFeedWorkspace';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileSectionDrawer } from './components/MobileSectionDrawer';
import { SectionSidebar } from './components/SectionSidebar';
import { SectionWorkspace } from './components/SectionWorkspace';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import {
  AccountPage,
  type AccountSettingsSection,
} from './components/pages/AccountPage';
import { AdminGuardPage } from './components/pages/AdminGuardPage';
import { MemberProfilePage } from './components/pages/MemberProfilePage';
import { NotificationsPage } from './components/pages/NotificationsPage';
import { SearchPage } from './components/pages/SearchPage';
import { useFirebase } from './context/firebaseContext';
import {
  ActiveRoute,
  FeedTabId,
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
  createInitialSectionStates,
  transitionViewState,
} from './utils/sectionState';
import {
  buildSearchForRoute,
  isFeedRoute,
  parseLocationSearch,
} from './utils/urlRouting';

interface RouteHistoryEntry {
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
  scrollY?: number;
}

export function App() {
  const { refreshAccountState } = useFirebase();

  const initialParsed = parseLocationSearch(window.location.search);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>(
    initialParsed.route
  );
  const [profileUsername, setProfileUsername] = useState<string | null>(
    initialParsed.profileUsername
  );
  const [profileTab, setProfileTab] = useState<ProfileTab | null>(
    initialParsed.profileTab
  );
  const [searchScope, setSearchScope] = useState<SearchScopeId>(
    initialParsed.searchScope
  );
  const [searchQuery, setSearchQuery] = useState<string | null>(
    initialParsed.searchQuery
  );
  const [searchFilters, setSearchFilters] = useState<SearchFiltersState>(
    DEFAULT_SEARCH_FILTERS
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(initialParsed.opportunityId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialParsed.eventId
  );
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    initialParsed.postId
  );
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    initialParsed.commentId
  );
  const [selectedListingId, setSelectedListingId] = useState<string | null>(
    initialParsed.listingId
  );
  const [accountSection, setAccountSection] =
    useState<AccountSettingsSection>('profile');
  const [previousEntry, setPreviousEntry] = useState<RouteHistoryEntry>({
    route: 'for-you',
  });
  const [returnRoute, setReturnRoute] = useState<ActiveRoute>('for-you');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [sectionStates, setSectionStates] = useState<
    Record<SectionId, ViewState>
  >(() => createInitialSectionStates('empty'));

  const retryTimerRef = useRef<number | null>(null);
  const currentEntryRef = useRef<RouteHistoryEntry>({
    route: initialParsed.route,
    username: initialParsed.profileUsername,
    profileTab: initialParsed.profileTab,
    searchScope: initialParsed.searchScope,
    searchQuery: initialParsed.searchQuery,
    searchFilters: DEFAULT_SEARCH_FILTERS,
    opportunityId: initialParsed.opportunityId,
    eventId: initialParsed.eventId,
    postId: initialParsed.postId,
    commentId: initialParsed.commentId,
    listingId: initialParsed.listingId,
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const parsed = parseLocationSearch(window.location.search);
      const historyObj =
        event.state && typeof event.state === 'object'
          ? (event.state as {
              scrollY?: unknown;
              searchFilters?: SearchFiltersState;
            })
          : null;
      const restoredFilters =
        historyObj?.searchFilters ?? DEFAULT_SEARCH_FILTERS;

      setActiveRoute(parsed.route);
      setProfileUsername(parsed.profileUsername);
      setProfileTab(parsed.profileTab);
      setSearchScope(parsed.searchScope);
      setSearchQuery(parsed.searchQuery);
      setSearchFilters(restoredFilters);
      setSelectedOpportunityId(parsed.opportunityId);
      setSelectedEventId(parsed.eventId);
      setSelectedPostId(parsed.postId);
      setSelectedCommentId(parsed.commentId);
      setSelectedListingId(parsed.listingId);
      const stateScrollY =
        typeof historyObj?.scrollY === 'number'
          ? historyObj.scrollY
          : undefined;
      currentEntryRef.current = {
        route: parsed.route,
        username: parsed.profileUsername,
        profileTab: parsed.profileTab,
        searchScope: parsed.searchScope,
        searchQuery: parsed.searchQuery,
        searchFilters: restoredFilters,
        opportunityId: parsed.opportunityId,
        eventId: parsed.eventId,
        postId: parsed.postId,
        commentId: parsed.commentId,
        listingId: parsed.listingId,
        scrollY: stateScrollY,
      };
      if (stateScrollY !== undefined) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: stateScrollY, behavior: 'auto' });
        });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const handleNavigate = useCallback(
    (
      route: ActiveRoute,
      options?: {
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
        accountSection?: AccountSettingsSection;
        restoreScrollY?: number;
      }
    ) => {
      const current = currentEntryRef.current;
      const departingScrollY =
        typeof window !== 'undefined' ? window.scrollY : 0;
      const nextUsername =
        route === 'profile'
          ? options?.username?.trim().toLowerCase() ?? null
          : null;
      const nextProfileTab =
        route === 'profile' ? options?.profileTab ?? null : null;
      const nextSearchScope =
        route === 'search' ? options?.searchScope ?? 'all' : 'home';
      const nextSearchQuery =
        route === 'search' ? options?.searchQuery ?? null : null;
      const nextSearchFilters =
        route === 'search'
          ? options?.searchFilters ?? DEFAULT_SEARCH_FILTERS
          : DEFAULT_SEARCH_FILTERS;
      const nextOpportunityId =
        route === 'opportunities' ? options?.opportunityId ?? null : null;
      const nextEventId =
        route === 'upcoming-events' ? options?.eventId ?? null : null;
      const nextPostId =
        isFeedRoute(route) || route === 'anonymous'
          ? options?.postId ?? null
          : null;
      const nextListingId =
        route === 'marketplace' ? options?.listingId ?? null : null;
      const nextCommentId =
        isFeedRoute(route) ||
        route === 'anonymous' ||
        route === 'upcoming-events' ||
        route === 'marketplace'
          ? options?.commentId ?? null
          : null;

      const isRouteChange =
        current.route !== route ||
        (route === 'profile' && current.username !== nextUsername);

      if (
        current.route !== 'login' &&
        current.route !== 'register' &&
        isRouteChange &&
        route === 'profile' &&
        current.route !== 'profile'
      ) {
        setPreviousEntry({
          ...current,
          scrollY: departingScrollY,
        });
      } else if (
        current.route !== 'login' &&
        current.route !== 'register' &&
        current.route !== route &&
        route !== 'profile'
      ) {
        setPreviousEntry({
          ...current,
          scrollY: departingScrollY,
        });
      }

      if (typeof window !== 'undefined') {
        const currentHistoryState =
          window.history.state && typeof window.history.state === 'object'
            ? (window.history.state as Record<string, unknown>)
            : {};
        window.history.replaceState(
          {
            ...currentHistoryState,
            scrollY: departingScrollY,
            ...(current.route === 'search' && current.searchFilters
              ? { searchFilters: current.searchFilters }
              : {}),
          },
          ''
        );
      }

      setActiveRoute(route);
      setProfileUsername(nextUsername);
      setProfileTab(nextProfileTab);
      setSearchScope(nextSearchScope);
      setSearchQuery(nextSearchQuery);
      setSearchFilters(nextSearchFilters);
      setSelectedOpportunityId(nextOpportunityId);
      setSelectedEventId(nextEventId);
      setSelectedPostId(nextPostId);
      setSelectedCommentId(nextCommentId);
      setSelectedListingId(nextListingId);
      setAccountSection(
        route === 'account' ? options?.accountSection ?? 'profile' : 'profile'
      );

      const targetScrollY = options?.restoreScrollY ?? 0;

      currentEntryRef.current = {
        route,
        username: nextUsername,
        profileTab: nextProfileTab,
        searchScope: nextSearchScope,
        searchQuery: nextSearchQuery,
        searchFilters: nextSearchFilters,
        opportunityId: nextOpportunityId,
        eventId: nextEventId,
        postId: nextPostId,
        commentId: nextCommentId,
        listingId: nextListingId,
        scrollY: targetScrollY,
      };

      const nextUrl = buildSearchForRoute(route, {
        username: nextUsername,
        profileTab: nextProfileTab,
        searchScope: route === 'search' ? nextSearchScope : undefined,
        searchQuery: route === 'search' ? nextSearchQuery : undefined,
        opportunityId:
          route === 'opportunities' ? nextOpportunityId : undefined,
        eventId: route === 'upcoming-events' ? nextEventId : undefined,
        postId: nextPostId,
        commentId: nextCommentId,
        listingId: route === 'marketplace' ? nextListingId : undefined,
      });
      window.history.pushState(
        {
          scrollY: targetScrollY,
          ...(route === 'search' ? { searchFilters: nextSearchFilters } : {}),
        },
        '',
        nextUrl
      );
      if (options?.restoreScrollY !== undefined) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: targetScrollY, behavior: 'auto' });
        });
      } else if (!nextPostId && !nextCommentId) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    []
  );

  const handleSyncSearchState = useCallback(
    (next: {
      scope: SearchScopeId;
      query: string;
      filters: SearchFiltersState;
    }) => {
      if (currentEntryRef.current.route !== 'search') return;
      const cleanQuery = next.query.trim() || null;
      currentEntryRef.current = {
        ...currentEntryRef.current,
        searchScope: next.scope,
        searchQuery: cleanQuery,
        searchFilters: next.filters,
      };
      setSearchScope(next.scope);
      setSearchQuery(cleanQuery);
      setSearchFilters(next.filters);

      if (typeof window !== 'undefined') {
        const nextUrl = buildSearchForRoute('search', {
          searchScope: next.scope,
          searchQuery: cleanQuery,
        });
        const currentHistoryState =
          window.history.state && typeof window.history.state === 'object'
            ? (window.history.state as Record<string, unknown>)
            : {};
        window.history.replaceState(
          { ...currentHistoryState, searchFilters: next.filters },
          '',
          nextUrl
        );
      }
    },
    []
  );

  const handleBackToSearch = useCallback(() => {
    handleNavigate('search', {
      searchScope: previousEntry.searchScope ?? 'all',
      searchQuery: previousEntry.searchQuery ?? null,
      searchFilters: previousEntry.searchFilters ?? DEFAULT_SEARCH_FILTERS,
      restoreScrollY: previousEntry.scrollY ?? 0,
    });
  }, [handleNavigate, previousEntry]);

  const handleBackFromProfile = useCallback(() => {
    if (previousEntry.route && previousEntry.route !== 'profile') {
      handleNavigate(previousEntry.route, {
        username: previousEntry.username,
        profileTab: previousEntry.profileTab,
        searchScope: previousEntry.searchScope,
        searchQuery: previousEntry.searchQuery,
        searchFilters: previousEntry.searchFilters,
        opportunityId: previousEntry.opportunityId,
        eventId: previousEntry.eventId,
        postId: previousEntry.postId,
        commentId: previousEntry.commentId,
        listingId: previousEntry.listingId,
        restoreScrollY: previousEntry.scrollY ?? 0,
      });
      return;
    }
    handleNavigate('for-you', { restoreScrollY: previousEntry.scrollY ?? 0 });
  }, [handleNavigate, previousEntry]);

  const handleRequireAuth = useCallback(
    (authRoute: 'login' | 'register', returnTo: ActiveRoute) => {
      const safeReturn =
        returnTo === 'login' || returnTo === 'register' || returnTo === 'profile'
          ? 'for-you'
          : returnTo;
      setReturnRoute(safeReturn);
      handleNavigate(authRoute);
    },
    [handleNavigate]
  );

  const handleAuthSuccess = useCallback(
    (destination: ActiveRoute) => {
      const target =
        destination === 'login' || destination === 'register'
          ? 'for-you'
          : destination;
      handleNavigate(target);
    },
    [handleNavigate]
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

  const renderMainContent = () => {
    if (activeRoute === 'login') {
      return (
        <LoginPage
          returnRoute={returnRoute}
          onSuccess={handleAuthSuccess}
          onNavigate={handleNavigate}
          onRefreshAccount={refreshAccountState}
        />
      );
    }

    if (activeRoute === 'register') {
      return (
        <RegisterPage
          returnRoute={returnRoute}
          onSuccess={handleAuthSuccess}
          onNavigate={handleNavigate}
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
          key={accountSection}
          initialSection={accountSection}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (activeRoute === 'profile') {
      return (
        <MemberProfilePage
          key={`${profileUsername ?? 'none'}:${profileTab ?? 'posts'}`}
          username={profileUsername}
          initialTab={profileTab}
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
          onBack={handleBackFromProfile}
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
    previousEntry.route === 'search' &&
    activeRoute !== 'search' &&
    activeRoute !== 'profile' &&
    activeRoute !== 'login' &&
    activeRoute !== 'register';

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50 text-[#0B1A2E]">
      <Header
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        onRequireAuth={handleRequireAuth}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-5 sm:px-6 lg:py-7">
        {showSidebar && (
          <SectionSidebar
            activeRoute={activeRoute}
            onNavigate={handleNavigate}
          />
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {showBackToSearchBanner && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
              <button
                type="button"
                onClick={handleBackToSearch}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-lg text-xs font-semibold text-[#1E88E5] hover:underline sm:text-sm"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>
                  Back to Search Results
                  {previousEntry.searchQuery
                    ? ` for “${previousEntry.searchQuery}”`
                    : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPreviousEntry({ route: 'for-you' })}
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
        onSelectRoute={handleNavigate}
        onRequireAuth={handleRequireAuth}
        onClose={() => setIsMobileDrawerOpen(false)}
      />
    </div>
  );
}

export default App;

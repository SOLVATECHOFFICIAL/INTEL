import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  ActiveRoute,
  FeedTabId,
  ProfileTab,
  SearchScopeId,
  SectionId,
  ViewState,
} from './types/platform';
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
  opportunityId?: string | null;
  eventId?: string | null;
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
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(initialParsed.opportunityId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialParsed.eventId
  );
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
    opportunityId: initialParsed.opportunityId,
    eventId: initialParsed.eventId,
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const parsed = parseLocationSearch(window.location.search);
      setActiveRoute(parsed.route);
      setProfileUsername(parsed.profileUsername);
      setProfileTab(parsed.profileTab);
      setSearchScope(parsed.searchScope);
      setSelectedOpportunityId(parsed.opportunityId);
      setSelectedEventId(parsed.eventId);
      const stateScrollY =
        event.state &&
        typeof event.state === 'object' &&
        typeof (event.state as { scrollY?: unknown }).scrollY === 'number'
          ? (event.state as { scrollY: number }).scrollY
          : undefined;
      currentEntryRef.current = {
        route: parsed.route,
        username: parsed.profileUsername,
        profileTab: parsed.profileTab,
        searchScope: parsed.searchScope,
        opportunityId: parsed.opportunityId,
        eventId: parsed.eventId,
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
        opportunityId?: string | null;
        eventId?: string | null;
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
        route === 'search' ? options?.searchScope ?? 'home' : 'home';
      const nextOpportunityId =
        route === 'opportunities' ? options?.opportunityId ?? null : null;
      const nextEventId =
        route === 'upcoming-events' ? options?.eventId ?? null : null;

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
          { ...currentHistoryState, scrollY: departingScrollY },
          ''
        );
      }

      setActiveRoute(route);
      setProfileUsername(nextUsername);
      setProfileTab(nextProfileTab);
      setSearchScope(nextSearchScope);
      setSelectedOpportunityId(nextOpportunityId);
      setSelectedEventId(nextEventId);

      const targetScrollY = options?.restoreScrollY ?? 0;

      currentEntryRef.current = {
        route,
        username: nextUsername,
        profileTab: nextProfileTab,
        searchScope: nextSearchScope,
        opportunityId: nextOpportunityId,
        eventId: nextEventId,
        scrollY: targetScrollY,
      };

      const nextUrl = buildSearchForRoute(route, {
        username: nextUsername,
        profileTab: nextProfileTab,
        searchScope: route === 'search' ? nextSearchScope : undefined,
        opportunityId:
          route === 'opportunities' ? nextOpportunityId : undefined,
        eventId: route === 'upcoming-events' ? nextEventId : undefined,
      });
      window.history.pushState({ scrollY: targetScrollY }, '', nextUrl);
      if (options?.restoreScrollY !== undefined) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: targetScrollY, behavior: 'auto' });
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    []
  );

  const handleBackFromProfile = useCallback(() => {
    if (previousEntry.route && previousEntry.route !== 'profile') {
      handleNavigate(previousEntry.route, {
        username: previousEntry.username,
        profileTab: previousEntry.profileTab,
        searchScope: previousEntry.searchScope,
        opportunityId: previousEntry.opportunityId,
        eventId: previousEntry.eventId,
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
          onNavigate={handleNavigate}
          onRequireAuth={handleRequireAuth}
        />
      );
    }

    if (isFeedRoute(activeRoute)) {
      return (
        <HomeFeedWorkspace
          activeFeedTab={activeRoute as FeedTabId}
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
        sectionStates={sectionStates}
        onNavigate={handleNavigate}
        onRetry={handleRetry}
        onRequireAuth={handleRequireAuth}
      />
    );
  };

  const showSidebar =
    activeRoute !== 'login' && activeRoute !== 'register';

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

        {renderMainContent()}
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

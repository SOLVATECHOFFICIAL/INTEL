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
  searchScope?: SearchScopeId;
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
  const [searchScope, setSearchScope] = useState<SearchScopeId>(
    initialParsed.searchScope
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
    searchScope: initialParsed.searchScope,
  });

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseLocationSearch(window.location.search);
      setActiveRoute(parsed.route);
      setProfileUsername(parsed.profileUsername);
      setSearchScope(parsed.searchScope);
      currentEntryRef.current = {
        route: parsed.route,
        username: parsed.profileUsername,
        searchScope: parsed.searchScope,
      };
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
      options?: { username?: string | null; searchScope?: SearchScopeId }
    ) => {
      const current = currentEntryRef.current;
      if (
        current.route !== 'login' &&
        current.route !== 'register' &&
        current.route !== route
      ) {
        setPreviousEntry(current);
      }

      const nextUsername =
        route === 'profile'
          ? options?.username?.trim().toLowerCase() ?? null
          : null;
      const nextSearchScope =
        route === 'search' ? options?.searchScope ?? 'home' : 'home';

      setActiveRoute(route);
      setProfileUsername(nextUsername);
      setSearchScope(nextSearchScope);

      currentEntryRef.current = {
        route,
        username: nextUsername,
        searchScope: nextSearchScope,
      };

      const nextUrl = buildSearchForRoute(route, {
        username: nextUsername,
        searchScope: route === 'search' ? nextSearchScope : undefined,
      });
      window.history.pushState(null, '', nextUrl);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    []
  );

  const handleBackFromProfile = useCallback(() => {
    if (previousEntry.route && previousEntry.route !== 'profile') {
      handleNavigate(previousEntry.route, {
        username: previousEntry.username,
        searchScope: previousEntry.searchScope,
      });
      return;
    }
    handleNavigate('for-you');
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
      return <NotificationsPage onRequireAuth={handleRequireAuth} />;
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
          key={`${profileUsername ?? 'none'}:${profileUsername ? 'set' : 'empty'}`}
          username={profileUsername}
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

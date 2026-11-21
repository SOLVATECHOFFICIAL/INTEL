import { useEffect, useRef, useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileSectionDrawer } from './components/MobileSectionDrawer';
import { SectionSidebar } from './components/SectionSidebar';
import { SectionWorkspace } from './components/SectionWorkspace';
import { ActiveRoute, SectionId, ViewState } from './types/platform';
import {
  createInitialSectionStates,
  transitionViewState,
} from './utils/sectionState';

export function App() {
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>('overview');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [sectionStates, setSectionStates] = useState<
    Record<SectionId, ViewState>
  >(() => createInitialSectionStates('empty'));

  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const handleNavigate = (route: ActiveRoute) => {
    setActiveRoute(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeState = (sectionId: SectionId, nextState: ViewState) => {
    setSectionStates((prev) => ({
      ...prev,
      [sectionId]: nextState,
    }));
  };

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

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50 text-[#0B1A2E]">
      <Header
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
      />

      {activeRoute === 'overview' && (
        <HeroBanner onNavigate={handleNavigate} />
      )}

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-6 sm:px-6 lg:py-8">
        <SectionSidebar
          activeRoute={activeRoute}
          onNavigate={handleNavigate}
        />

        <SectionWorkspace
          activeRoute={activeRoute}
          sectionStates={sectionStates}
          onNavigate={handleNavigate}
          onChangeState={handleChangeState}
          onRetry={handleRetry}
        />
      </main>

      <Footer onNavigate={handleNavigate} />

      <MobileBottomNav
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onOpenDrawer={() => setIsMobileDrawerOpen(true)}
      />

      <MobileSectionDrawer
        isOpen={isMobileDrawerOpen}
        activeRoute={activeRoute}
        onSelectRoute={handleNavigate}
        onClose={() => setIsMobileDrawerOpen(false)}
      />
    </div>
  );
}

export default App;

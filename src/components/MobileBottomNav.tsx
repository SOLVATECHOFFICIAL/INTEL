import React from 'react';
import { Clock, Compass, LayoutGrid, ShoppingBag } from 'lucide-react';
import { ActiveRoute } from '../types/platform';

interface MobileBottomNavProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  onOpenDrawer: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeRoute,
  onNavigate,
  onOpenDrawer,
}) => {
  return (
    <nav
      aria-label="Mobile quick navigation"
      className="fixed right-0 bottom-0 left-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden"
    >
      <div className="grid h-16 grid-cols-4 items-center">
        <button
          type="button"
          onClick={() => onNavigate('for-you')}
          aria-current={activeRoute === 'for-you' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            activeRoute === 'for-you'
              ? 'text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <Compass className="h-5 w-5" aria-hidden="true" />
          <span>For You</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('latest')}
          aria-current={activeRoute === 'latest' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            activeRoute === 'latest'
              ? 'text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <Clock className="h-5 w-5" aria-hidden="true" />
          <span>Latest</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('marketplace')}
          aria-current={activeRoute === 'marketplace' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            activeRoute === 'marketplace'
              ? 'text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          <span>Market</span>
        </button>

        <button
          type="button"
          onClick={onOpenDrawer}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            activeRoute === 'overview'
              ? 'text-[#0B1A2E]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          <span>All 8</span>
        </button>
      </div>
    </nav>
  );
};

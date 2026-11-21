import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { ActiveRoute, SectionId } from '../types/platform';
import { BrandLogo } from './BrandLogo';

interface HeaderProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  onOpenMobileDrawer: () => void;
}

const TOP_NAV_LINKS: { id: SectionId; label: string }[] = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'latest', label: 'Latest' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'opportunities', label: 'Opportunities' },
];

export const Header: React.FC<HeaderProps> = ({
  activeRoute,
  onNavigate,
  onOpenMobileDrawer,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 md:h-16">
        {/* Zone 1: Brand Lockup */}
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          aria-label="LASUED Intel home"
          className="inline-flex min-h-[44px] items-center rounded-lg focus-visible:outline-[#1E88E5]"
        >
          <BrandLogo size="sm" showWordmark />
        </button>

        {/* Zone 2: Concise single-line desktop nav */}
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-6 md:flex"
        >
          {TOP_NAV_LINKS.map((item) => {
            const isActive = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  isActive
                    ? 'text-[#1E88E5]'
                    : 'text-slate-600 hover:text-[#0B1A2E]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-[#1E88E5]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className={`hidden min-h-[40px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 md:inline-flex ${
              activeRoute === 'overview'
                ? 'bg-[#0B1A2E] text-white'
                : 'bg-[#1E88E5] text-white hover:bg-[#1565C0]'
            }`}
          >
            All Sections
          </button>

          <button
            type="button"
            onClick={onOpenMobileDrawer}
            aria-label="Open all sections menu"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-[#0B1A2E] whitespace-nowrap shrink-0 transition-colors hover:bg-slate-50 md:hidden"
          >
            <LayoutGrid className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            <span>Sections</span>
          </button>
        </div>
      </div>
    </header>
  );
};

import React from 'react';
import { BRAND } from '../config/brand';
import { PLATFORM_SECTIONS } from '../config/sections';
import { ActiveRoute } from '../types/platform';
import { buildSearchForRoute } from '../utils/urlRouting';
import { BrandLogo } from './BrandLogo';

interface FooterProps {
  onNavigate: (route: ActiveRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const handleAnchorClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    route: ActiveRoute
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigate(route);
  };

  return (
    <footer className="mt-12 max-w-full border-t border-slate-200 bg-gradient-to-b from-white/90 via-sky-50/50 to-blue-50/70 pb-24 dark:border-slate-800 dark:bg-gradient-to-b dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 lg:pb-0">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div className="max-w-sm">
            <a
              href={buildSearchForRoute('for-you')}
              onClick={(e) => handleAnchorClick(e, 'for-you')}
              className="inline-block text-left focus-visible:outline-[#1E88E5]"
            >
              <BrandLogo size="sm" showWordmark />
            </a>
            <p className="mt-3 text-sm font-medium text-[#0B1A2E] dark:text-slate-100">
              {BRAND.tagline}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Campus updates, student marketplace, opportunities, and events.
            </p>
          </div>

          <nav
            aria-label="Footer sections"
            className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-4"
          >
            {PLATFORM_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={buildSearchForRoute(section.id)}
                onClick={(e) => handleAnchorClick(e, section.id)}
                className="inline-flex min-h-[36px] items-center text-left text-xs font-medium text-slate-600 transition-colors hover:text-[#1E88E5] dark:text-slate-400 dark:hover:text-sky-400"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <p>{BRAND.name}</p>
        </div>
      </div>
    </footer>
  );
};

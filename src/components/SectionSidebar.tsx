import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { getSectionsByGroup } from '../utils/sectionState';
import { ActiveRoute } from '../types/platform';
import { SectionIcon } from './SectionIcon';

interface SectionSidebarProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
}

export const SectionSidebar: React.FC<SectionSidebarProps> = ({
  activeRoute,
  onNavigate,
}) => {
  const feeds = getSectionsByGroup('Feeds');
  const hub = getSectionsByGroup('Campus Hub');

  return (
    <aside
      aria-label="Platform sections"
      className="hidden lg:block lg:w-64 lg:shrink-0"
    >
      <div className="sticky top-24 space-y-6 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            aria-current={activeRoute === 'overview' ? 'page' : undefined}
            className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 ${
              activeRoute === 'overview'
                ? 'bg-[#0B1A2E] text-white'
                : 'text-[#0B1A2E] hover:bg-slate-100'
            }`}
          >
            <LayoutGrid
              className={`h-4 w-4 shrink-0 ${
                activeRoute === 'overview' ? 'text-[#1E88E5]' : 'text-slate-500'
              }`}
              aria-hidden="true"
            />
            <span>Platform Overview</span>
          </button>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">
            Feeds
          </p>
          <ul className="mt-2 space-y-1">
            {feeds.map((section) => {
              const isActive = activeRoute === section.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                    }`}
                  >
                    <SectionIcon
                      sectionId={section.id}
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#1E88E5]' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{section.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">
            Campus Hub
          </p>
          <ul className="mt-2 space-y-1">
            {hub.map((section) => {
              const isActive = activeRoute === section.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                    }`}
                  >
                    <SectionIcon
                      sectionId={section.id}
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#1E88E5]' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{section.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
};

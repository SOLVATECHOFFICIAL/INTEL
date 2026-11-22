import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PLATFORM_SECTIONS } from '../../config/sections';
import type { ActiveRoute, SearchScopeId } from '../../types/platform';
import { ContextualSearchBar } from '../ContextualSearchBar';
import { SectionIcon } from '../SectionIcon';

interface SearchPageProps {
  initialScope: SearchScopeId;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      searchScope?: SearchScopeId;
      opportunityId?: string | null;
      eventId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const SCOPE_TABS: { id: SearchScopeId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'anonymous', label: 'Anonymous' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'trusted-circle', label: 'Trusted Circle' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'upcoming-events', label: 'Events' },
];

export const SearchPage: React.FC<SearchPageProps> = ({
  initialScope,
  onNavigate,
  onRequireAuth,
}) => {
  return (
    <section
      aria-labelledby="search-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h1
          id="search-heading"
          className="font-display text-2xl font-bold text-[#0B1A2E]"
        >
          Contextual Campus Search
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Choose a LASUED Intel section to search strictly within that
          section&apos;s data and privacy rules.
        </p>

        <div
          role="tablist"
          aria-label="Search context scopes"
          className="mt-4 flex flex-wrap gap-2"
        >
          {SCOPE_TABS.map((tab) => {
            const isSelected = initialScope === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onNavigate('search', { searchScope: tab.id })}
                className={`inline-flex min-h-[38px] items-center rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-[#0B1A2E] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <ContextualSearchBar
        key={initialScope}
        scope={initialScope}
        onNavigate={onNavigate}
        onRequireAuth={onRequireAuth}
        returnRoute="search"
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="font-display text-base font-bold text-[#0B1A2E]">
          Browse LASUED Intel Hubs
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLATFORM_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onNavigate(section.id)}
              className="flex min-h-[68px] items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-[#1E88E5] hover:bg-slate-50"
            >
              <div className="flex items-start gap-3">
                <SectionIcon
                  sectionId={section.id}
                  className="mt-0.5 h-5 w-5 shrink-0 text-[#1E88E5]"
                />
                <div>
                  <p className="font-display text-sm font-bold text-[#0B1A2E]">
                    {section.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                    {section.summary}
                  </p>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-slate-400"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

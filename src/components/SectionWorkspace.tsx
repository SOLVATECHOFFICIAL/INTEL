import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PLATFORM_SECTIONS } from '../config/sections';
import {
  ActiveRoute,
  SectionId,
  ViewState,
} from '../types/platform';
import { getSectionById } from '../utils/sectionState';
import { SectionIcon } from './SectionIcon';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

interface SectionWorkspaceProps {
  activeRoute: ActiveRoute;
  sectionStates: Record<SectionId, ViewState>;
  onNavigate: (route: ActiveRoute) => void;
  onChangeState: (sectionId: SectionId, nextState: ViewState) => void;
  onRetry: (sectionId: SectionId) => void;
}

const STATE_OPTIONS: { id: ViewState; label: string }[] = [
  { id: 'empty', label: 'Empty' },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Error' },
];

export const SectionWorkspace: React.FC<SectionWorkspaceProps> = ({
  activeRoute,
  sectionStates,
  onNavigate,
  onChangeState,
  onRetry,
}) => {
  if (activeRoute === 'overview') {
    return (
      <div id="platform-sections" className="min-w-0 flex-1">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#0B1A2E]">
              Platform Structure
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              All eight LASUED Intel placeholder sections are organized below
              with empty, loading, and error state foundations.
            </p>
          </div>
          <p className="text-xs font-medium text-slate-500 tabular-nums">
            {PLATFORM_SECTIONS.length} sections ready
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          {PLATFORM_SECTIONS.map((section, index) => {
            const currentState = sectionStates[section.id];
            const sectionNumber = String(index + 1).padStart(2, '0');

            return (
              <article
                key={section.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">
                      <span>{sectionNumber}</span>
                      <span aria-hidden="true" className="mx-1.5">
                        ·
                      </span>
                      <span>{section.group}</span>
                    </p>
                    <h3 className="mt-1 flex items-center gap-2 font-display text-lg font-bold text-[#0B1A2E]">
                      <SectionIcon
                        sectionId={section.id}
                        className="h-4 w-4 shrink-0 text-[#1E88E5]"
                      />
                      <span className="truncate">{section.title}</span>
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate(section.id)}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#1E88E5] whitespace-nowrap transition-colors hover:bg-[#1E88E5]/10"
                  >
                    Open
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {section.summary}
                </p>

                <div className="mt-4 flex-1">
                  {currentState === 'loading' && (
                    <LoadingState sectionTitle={section.title} compact />
                  )}
                  {currentState === 'empty' && (
                    <EmptyState section={section} compact />
                  )}
                  {currentState === 'error' && (
                    <ErrorState
                      section={section}
                      onRetry={() => onRetry(section.id)}
                      compact
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  const activeSection = getSectionById(activeRoute);
  const currentState = sectionStates[activeSection.id];

  return (
    <section
      aria-labelledby="active-section-heading"
      className="min-w-0 flex-1"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <button
                type="button"
                onClick={() => onNavigate('overview')}
                className="text-[#1E88E5] hover:underline"
              >
                Overview
              </button>
              <span aria-hidden="true">/</span>
              <span>{activeSection.group}</span>
            </div>

            <h1
              id="active-section-heading"
              className="mt-2 flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-[#0B1A2E] sm:text-3xl"
            >
              <SectionIcon
                sectionId={activeSection.id}
                className="h-6 w-6 shrink-0 text-[#1E88E5]"
              />
              <span>{activeSection.title}</span>
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              {activeSection.summary}
            </p>
          </div>

          {/* Honest UI State Inspector */}
          <div className="shrink-0">
            <p className="mb-1.5 text-xs font-medium text-slate-500">
              View state
            </p>
            <div
              role="group"
              aria-label={`Preview states for ${activeSection.title}`}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
            >
              {STATE_OPTIONS.map((option) => {
                const isSelected = currentState === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onChangeState(activeSection.id, option.id)}
                    aria-pressed={isSelected}
                    className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-white text-[#0B1A2E] shadow-2xs'
                        : 'text-slate-600 hover:text-[#0B1A2E]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6">
          {currentState === 'loading' && (
            <LoadingState sectionTitle={activeSection.title} />
          )}
          {currentState === 'empty' && (
            <EmptyState section={activeSection} />
          )}
          {currentState === 'error' && (
            <ErrorState
              section={activeSection}
              onRetry={() => onRetry(activeSection.id)}
            />
          )}
        </div>
      </div>
    </section>
  );
};

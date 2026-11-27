import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { SectionDefinition } from '../types/platform';
import { SectionIcon } from './SectionIcon';

interface LoadingStateProps {
  sectionTitle: string;
  compact?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  sectionTitle,
  compact = false,
}) => {
  const rowCount = compact ? 2 : 3;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading ${sectionTitle}`}
      className="space-y-3"
    >
      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={index}
          className={
            compact
              ? 'border-t border-slate-100 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800'
              : 'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900'
          }
        >
          <div className="flex items-center gap-3">
            <div className="h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-14 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          </div>
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
      <span className="sr-only">Loading {sectionTitle}</span>
    </div>
  );
};

interface EmptyStateProps {
  section: SectionDefinition;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  section,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <h4 className="font-display text-sm font-semibold text-[#0B1A2E] dark:text-white">
          {section.emptyTitle}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {section.emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/60">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1A2E]/5 text-[#0B1A2E] dark:bg-sky-500/10 dark:text-sky-400">
        <SectionIcon sectionId={section.id} className="h-5 w-5" />
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-[#0B1A2E] dark:text-white">
        {section.emptyTitle}
      </h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {section.emptyDescription}
      </p>
    </div>
  );
};

interface ErrorStateProps {
  section: SectionDefinition;
  onRetry: () => void;
  compact?: boolean;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  section,
  onRetry,
  compact = false,
}) => {
  return (
    <div
      role="alert"
      className={
        compact
          ? 'border-t border-red-200 pt-4 dark:border-red-900/60'
          : 'rounded-xl border border-red-200 bg-red-50/60 px-6 py-10 text-center dark:border-red-900/60 dark:bg-red-950/30'
      }
    >
      {!compact && (
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <h3
        className={`font-display font-semibold text-[#0B1A2E] dark:text-white ${
          compact ? 'text-sm' : 'mt-3 text-base'
        }`}
      >
        {section.errorTitle}
      </h3>
      <p
        className={`leading-relaxed text-slate-700 dark:text-slate-300 ${
          compact ? 'mt-1 text-xs' : 'mx-auto mt-1.5 max-w-md text-sm'
        }`}
      >
        {section.errorDescription}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#132844] dark:bg-sky-600 dark:hover:bg-sky-500"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
};

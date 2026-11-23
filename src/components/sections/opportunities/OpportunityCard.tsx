import React from 'react';
import { Bookmark, Clock, ShieldCheck } from 'lucide-react';
import type { Opportunity } from '../../../types/database';
import {
  formatOpportunityDate,
  formatOpportunityDeadlineSummary,
  getOpportunityCategoryLabel,
  resolveOpportunityLifecycle,
} from '../../../utils/opportunities';

interface OpportunityCardProps {
  opportunity: Opportunity;
  nowMs: number;
  isSaved: boolean;
  saving?: boolean;
  onToggleSave: (opportunityId: string) => void;
  onOpenDetails: (opportunityId: string) => void;
}

export const OpportunityCard = React.memo(function OpportunityCard({
  opportunity,
  nowMs,
  isSaved,
  saving = false,
  onToggleSave,
  onOpenDetails,
}: OpportunityCardProps) {
  const lifecycle = resolveOpportunityLifecycle(opportunity, nowMs);

  return (
    <article className="flex min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-[#1E88E5]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-[#1E88E5]">
              {getOpportunityCategoryLabel(opportunity.category)}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span
              className={`font-semibold ${
                lifecycle.state === 'closing_soon'
                  ? 'text-amber-700'
                  : lifecycle.state === 'closed'
                    ? 'text-slate-500'
                    : lifecycle.state === 'upcoming'
                      ? 'text-[#1E88E5]'
                      : 'text-emerald-700'
              }`}
            >
              {lifecycle.label}
            </span>
            {opportunity.isVerified === true && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-[#0B1A2E]">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Verified
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => onToggleSave(opportunity.id)}
            aria-label={
              isSaved
                ? `Remove ${opportunity.title} from saved opportunities`
                : `Save ${opportunity.title}`
            }
            className={`-mt-1 -mr-1 flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg transition-colors ${
              isSaved
                ? 'bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]'
            }`}
          >
            <Bookmark
              className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
              aria-hidden="true"
            />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onOpenDetails(opportunity.id)}
          className="mt-2 text-left"
        >
          <h3 className="font-display text-base font-bold text-[#0B1A2E] hover:text-[#1E88E5]">
            {opportunity.title}
          </h3>
        </button>
        <p className="mt-0.5 text-xs font-semibold text-[#1E88E5]">
          {opportunity.organisation}
        </p>
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600">
          {opportunity.description}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="space-y-0.5 text-[11px] text-slate-500">
          <p>Posted {formatOpportunityDate(opportunity.createdAt)}</p>
          <p
            className={`inline-flex items-center gap-1 font-medium ${
              lifecycle.state === 'closing_soon'
                ? 'text-amber-700'
                : 'text-slate-600'
            }`}
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            Deadline: {formatOpportunityDeadlineSummary(lifecycle)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenDetails(opportunity.id)}
          className="inline-flex min-h-[36px] items-center rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#132844]"
        >
          View Details
        </button>
      </div>
    </article>
  );
});

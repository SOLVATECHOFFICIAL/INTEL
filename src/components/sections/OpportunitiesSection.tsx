import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Briefcase,
  Clock,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { fetchAllOpportunities } from '../../services/adminDashboard';
import {
  fetchViewerSavedPostIds,
  toggleSavedPost,
} from '../../services/socialPosts';
import {
  resolveOpportunityEffectiveStatus,
  type Opportunity,
  type OpportunityCategory,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface OpportunitiesSectionProps {
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const CATEGORY_OPTIONS: { id: 'all' | OpportunityCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'scholarship', label: 'Scholarship' },
  { id: 'internship', label: 'Internship' },
  { id: 'job', label: 'Job' },
  { id: 'grant', label: 'Grant' },
  { id: 'competition', label: 'Competition' },
  { id: 'training', label: 'Training' },
  { id: 'programme', label: 'Programme' },
];

export const OpportunitiesSection: React.FC<OpportunitiesSectionProps> = ({
  onRequireAuth,
}) => {
  const { user, isSuspended } = useFirebase();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | OpportunityCategory
  >('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'expired'>(
    'active'
  );
  const [selectedOpportunity, setSelectedOpportunity] =
    useState<Opportunity | null>(null);
  const [guestPromptOpen, setGuestPromptOpen] = useState(false);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    const savedPromise = user?.uid
      ? fetchViewerSavedPostIds('opportunities', user.uid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    Promise.all([fetchAllOpportunities(), savedPromise])
      .then(([items, viewerSaved]) => {
        if (!active) return;
        setOpportunities(items);
        setSavedIds(viewerSaved);
        setErrorMessage(null);
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load campus opportunities right now.'
          )
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((opp) => {
      const effectiveStatus = resolveOpportunityEffectiveStatus(
        opp,
        extractTimestampMs(opp.expiresAt),
        nowMs
      );
      if (effectiveStatus !== statusFilter) return false;
      if (categoryFilter !== 'all' && opp.category !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [opportunities, statusFilter, categoryFilter, nowMs]);

  const handleToggleSave = async (oppId: string) => {
    if (!user) {
      setGuestPromptOpen(true);
      return;
    }
    if (isSuspended) return;

    const currentlySaved = savedIds.has(oppId);
    try {
      const res = await toggleSavedPost({
        actorUid: user.uid,
        targetCollection: 'opportunities',
        targetId: oppId,
        currentlySaved,
      });
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (res.saved) next.add(oppId);
        else next.delete(oppId);
        return next;
      });
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not save bookmark.')
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading verified opportunities...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {guestPromptOpen && (
        <GuestPromptCard
          title="Sign in to bookmark opportunities"
          description="Guests can view all verified campus opportunities and application links. Sign in to save opportunities to your profile."
          returnRoute="opportunities"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setGuestPromptOpen(false)}
        />
      )}

      {/* Status + Category Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setCategoryFilter(opt.id)}
              className={`min-h-[36px] rounded-xl border px-3 py-1 text-xs font-semibold transition-colors ${
                categoryFilter === opt.id
                  ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(
            [
              { id: 'active', label: 'Active' },
              { id: 'expired', label: 'Expired' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold transition-colors ${
                statusFilter === tab.id
                  ? 'bg-white text-[#0B1A2E] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A2E]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filteredOpportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Briefcase
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            No {statusFilter} opportunities available
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            Verified scholarships, internships, grants, and graduate roles
            published by LASUED Intel administrators appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredOpportunities.map((opp) => {
            const expMs = extractTimestampMs(opp.expiresAt);
            const isSaved = savedIds.has(opp.id);

            return (
              <article
                key={opp.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-[#1E88E5]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded-md bg-[#1E88E5]/10 px-2 py-0.5 font-semibold uppercase text-[#1E88E5]">
                        {opp.category}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 font-bold uppercase ${
                          statusFilter === 'active'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {statusFilter}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleToggleSave(opp.id)}
                      aria-label={
                        isSaved
                          ? `Remove ${opp.title} from saved`
                          : `Save ${opp.title}`
                      }
                      className={`rounded-lg p-1.5 transition-colors ${
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

                  <h3 className="mt-2 font-display text-base font-bold text-[#0B1A2E]">
                    {opp.title}
                  </h3>
                  <p className="text-xs font-semibold text-[#1E88E5]">
                    {opp.organisation}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600">
                    {opp.description}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    Deadline:{' '}
                    {expMs
                      ? new Date(expMs).toLocaleDateString('en-NG', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : 'See details'}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedOpportunity(opp)}
                      className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                    >
                      View Details
                    </button>
                    {opp.applicationUrl && statusFilter === 'active' && (
                      <a
                        href={opp.applicationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#0B1A2E] px-3 py-1 text-xs font-semibold text-white hover:bg-[#132844]"
                      >
                        Apply
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Details Modal */}
      {selectedOpportunity && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="opp-detail-title"
          onClick={() => setSelectedOpportunity(null)}
        >
          <div
            className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <span className="rounded-md bg-[#1E88E5]/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-[#1E88E5]">
                  {selectedOpportunity.category}
                </span>
                <h3
                  id="opp-detail-title"
                  className="mt-1.5 font-display text-lg font-bold text-[#0B1A2E]"
                >
                  {selectedOpportunity.title}
                </h3>
                <p className="text-xs font-semibold text-[#1E88E5]">
                  {selectedOpportunity.organisation}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOpportunity(null)}
                aria-label="Close opportunity details"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-700">
              <p className="whitespace-pre-line">
                {selectedOpportunity.description}
              </p>

              {selectedOpportunity.eligibility && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="font-bold text-[#0B1A2E]">Eligibility</p>
                  <p className="mt-1 whitespace-pre-line">
                    {selectedOpportunity.eligibility}
                  </p>
                </div>
              )}

              {selectedOpportunity.requiredDocuments && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="font-bold text-[#0B1A2E]">Required Documents</p>
                  <p className="mt-1 whitespace-pre-line">
                    {selectedOpportunity.requiredDocuments}
                  </p>
                </div>
              )}

              {selectedOpportunity.benefits && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="font-bold text-[#0B1A2E]">Benefits</p>
                  <p className="mt-1">{selectedOpportunity.benefits}</p>
                </div>
              )}

              {selectedOpportunity.applicationInstructions && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="font-bold text-[#0B1A2E]">How to Apply</p>
                  <p className="mt-1 whitespace-pre-line">
                    {selectedOpportunity.applicationInstructions}
                  </p>
                </div>
              )}

              {selectedOpportunity.contactInfo && (
                <p className="text-slate-600">
                  <strong>Contact:</strong> {selectedOpportunity.contactInfo}
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              {selectedOpportunity.applicationUrl && (
                <a
                  href={selectedOpportunity.applicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
                >
                  Open Application Portal
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

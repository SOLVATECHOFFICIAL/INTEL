import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Gift,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { fetchPublishedOpportunities } from '../../services/adminDashboard';
import {
  fetchViewerSavedPostIds,
  toggleSavedPost,
} from '../../services/socialPosts';
import type { Opportunity, OpportunityCategory } from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  extractUniqueOrganisations,
  filterAndSortOpportunities,
  formatOpportunityDate,
  formatOpportunityDeadlineSummary,
  getOpportunityCategoryLabel,
  getSafeApplicationUrl,
  OPPORTUNITY_CATEGORIES,
  resolveOpportunityLifecycle,
  type OpportunityDeadlineFilter,
  type OpportunityStatusFilter,
} from '../../utils/opportunities';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface OpportunitiesSectionProps {
  selectedOpportunityId?: string | null;
  onSelectOpportunity?: (opportunityId: string | null) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

type OpportunitiesTab = 'all' | 'saved';

export const OpportunitiesSection: React.FC<OpportunitiesSectionProps> = ({
  selectedOpportunityId = null,
  onSelectOpportunity,
  onRequireAuth,
}) => {
  const { user, isSuspended } = useFirebase();

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeTab, setActiveTab] = useState<OpportunitiesTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | OpportunityCategory
  >('all');
  const [statusFilter, setStatusFilter] =
    useState<OpportunityStatusFilter>('all');
  const [deadlineFilter, setDeadlineFilter] =
    useState<OpportunityDeadlineFilter>('all');
  const [organisationFilter, setOrganisationFilter] = useState('all');

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(
    selectedOpportunityId
  );
  const [guestPromptOpen, setGuestPromptOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;

    const savedPromise = user?.uid
      ? fetchViewerSavedPostIds('opportunities', user.uid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    Promise.all([fetchPublishedOpportunities(), savedPromise])
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
  }, [user?.uid, reloadNonce]);

  const effectiveSelectedId = onSelectOpportunity
    ? selectedOpportunityId
    : localSelectedId;

  const openDetails = (oppId: string | null) => {
    if (onSelectOpportunity) {
      onSelectOpportunity(oppId);
    } else {
      setLocalSelectedId(oppId);
    }
  };

  const selectedOpportunity = useMemo(() => {
    if (!effectiveSelectedId) return null;
    return (
      opportunities.find((item) => item.id === effectiveSelectedId) ?? null
    );
  }, [opportunities, effectiveSelectedId]);

  const availableOrganisations = useMemo(
    () => extractUniqueOrganisations(opportunities),
    [opportunities]
  );

  const savedOpportunities = useMemo(
    () =>
      filterAndSortOpportunities(
        opportunities,
        { savedOnly: true },
        savedIds,
        nowMs
      ),
    [opportunities, savedIds, nowMs]
  );

  const savedClosingSoonCount = useMemo(
    () =>
      savedOpportunities.filter(
        (opp) => resolveOpportunityLifecycle(opp, nowMs).state === 'closing_soon'
      ).length,
    [savedOpportunities, nowMs]
  );

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      categoryFilter !== 'all' ||
      statusFilter !== 'all' ||
      deadlineFilter !== 'all' ||
      organisationFilter !== 'all'
  );

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setDeadlineFilter('all');
    setOrganisationFilter('all');
  };

  const filteredOpportunities = useMemo(
    () =>
      filterAndSortOpportunities(
        opportunities,
        {
          query: searchQuery,
          category: categoryFilter,
          status: statusFilter,
          deadline: deadlineFilter,
          organisation: organisationFilter,
          savedOnly: activeTab === 'saved',
        },
        savedIds,
        nowMs
      ),
    [
      opportunities,
      searchQuery,
      categoryFilter,
      statusFilter,
      deadlineFilter,
      organisationFilter,
      activeTab,
      savedIds,
      nowMs,
    ]
  );

  const handleToggleSave = async (oppId: string) => {
    if (!user) {
      setGuestPromptOpen(true);
      return;
    }
    if (isSuspended || savingId === oppId) return;

    const currentlySaved = savedIds.has(oppId);
    setSavingId(oppId);
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
        formatFirestoreOrAppError(
          error,
          'Could not update your saved opportunities.'
        )
      );
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading opportunities...
      </div>
    );
  }

  if (errorMessage && opportunities.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/70 p-6 text-center">
        <AlertCircle
          className="mx-auto mb-2 h-6 w-6 text-red-700"
          aria-hidden="true"
        />
        <p className="font-display text-sm font-bold text-[#0B1A2E]">
          Unable to load opportunities
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setErrorMessage(null);
            setReloadNonce((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  // Dedicated Opportunity Details View (replaces cramped modal)
  if (effectiveSelectedId) {
    if (!selectedOpportunity) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => openDetails(null)}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Opportunities
          </button>
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
            <Briefcase
              className="mx-auto mb-2 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Opportunity not available
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
              This opportunity may have been removed or unpublished. Browse all
              currently available campus opportunities below.
            </p>
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              Browse Opportunities
            </button>
          </div>
        </div>
      );
    }

    const lifecycle = resolveOpportunityLifecycle(selectedOpportunity, nowMs);
    const isSaved = savedIds.has(selectedOpportunity.id);
    const safeUrl = getSafeApplicationUrl(selectedOpportunity.applicationUrl);

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => openDetails(null)}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Opportunities
          </button>

          <button
            type="button"
            disabled={savingId === selectedOpportunity.id}
            onClick={() => void handleToggleSave(selectedOpportunity.id)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSaved
                ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50'
            }`}
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${isSaved ? 'fill-current' : ''}`}
              aria-hidden="true"
            />
            {isSaved ? 'Saved Opportunity' : 'Save Opportunity'}
          </button>
        </div>

        {guestPromptOpen && (
          <GuestPromptCard
            title="Sign in to save this opportunity"
            description="Sign in or create a free LASUED Intel account to bookmark opportunities and track upcoming deadlines."
            returnRoute="opportunities"
            onRequireAuth={onRequireAuth}
            onDismiss={() => setGuestPromptOpen(false)}
          />
        )}

        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {errorMessage}
          </div>
        )}

        <article className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <header className="border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-[#1E88E5]">
                {getOpportunityCategoryLabel(selectedOpportunity.category)}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span
                className={`font-semibold ${
                  lifecycle.state === 'closing_soon'
                    ? 'text-amber-700'
                    : lifecycle.state === 'closed'
                      ? 'text-slate-600'
                      : lifecycle.state === 'upcoming'
                        ? 'text-[#1E88E5]'
                        : 'text-emerald-700'
                }`}
              >
                {lifecycle.label}
              </span>
              {selectedOpportunity.isVerified === true && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#0B1A2E]">
                    <ShieldCheck
                      className="h-3.5 w-3.5 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    Verified Listing
                  </span>
                </>
              )}
            </div>

            <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-[#0B1A2E] sm:text-2xl">
              {selectedOpportunity.title}
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#1E88E5]">
              {selectedOpportunity.organisation}
            </p>
          </header>

          {/* Key Application Dates */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <Calendar className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                Applications Open
              </p>
              <p className="mt-1 text-xs font-bold text-[#0B1A2E]">
                {selectedOpportunity.opensAt
                  ? formatOpportunityDate(selectedOpportunity.opensAt)
                  : formatOpportunityDate(selectedOpportunity.createdAt)}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <Clock className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                Application Deadline
              </p>
              <p
                className={`mt-1 text-xs font-bold ${
                  lifecycle.state === 'closing_soon'
                    ? 'text-amber-700'
                    : lifecycle.state === 'closed'
                      ? 'text-slate-600'
                      : 'text-[#0B1A2E]'
                }`}
              >
                {formatOpportunityDate(selectedOpportunity.expiresAt)} (
                {formatOpportunityDeadlineSummary(lifecycle)})
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Date Posted
              </p>
              <p className="mt-1 text-xs font-bold text-[#0B1A2E]">
                {formatOpportunityDate(selectedOpportunity.createdAt)}
              </p>
            </div>
          </div>

          {/* Full Description */}
          <div>
            <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
              Overview
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-slate-700">
              {selectedOpportunity.description}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {selectedOpportunity.whoCanApply && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase">
                  <Users className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Who Can Apply
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                  {selectedOpportunity.whoCanApply}
                </p>
              </div>
            )}

            {selectedOpportunity.eligibility && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase">
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Eligibility Requirements
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                  {selectedOpportunity.eligibility}
                </p>
              </div>
            )}

            {selectedOpportunity.benefits && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase">
                  <Gift className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Benefits
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                  {selectedOpportunity.benefits}
                </p>
              </div>
            )}

            {selectedOpportunity.requiredDocuments && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase">
                  <FileText
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Required Documents
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                  {selectedOpportunity.requiredDocuments}
                </p>
              </div>
            )}
          </div>

          {selectedOpportunity.applicationInstructions && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <h3 className="font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase">
                Application Instructions
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                {selectedOpportunity.applicationInstructions}
              </p>
            </div>
          )}

          {selectedOpportunity.contactInfo && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-700">
              <Mail
                className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                aria-hidden="true"
              />
              <div>
                <span className="font-semibold text-[#0B1A2E]">
                  Contact Information:
                </span>{' '}
                <span>{selectedOpportunity.contactInfo}</span>
              </div>
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              Back to All Opportunities
            </button>

            {lifecycle.state === 'closed' ? (
              <span className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                Applications Closed
              </span>
            ) : lifecycle.state === 'upcoming' ? (
              <span className="inline-flex min-h-[40px] items-center rounded-lg bg-[#1E88E5]/10 px-4 py-2 text-xs font-semibold text-[#1E88E5]">
                Opens {formatOpportunityDate(selectedOpportunity.opensAt)}
              </span>
            ) : safeUrl ? (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
              >
                Apply via Official Link
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs font-medium text-slate-600">
                Follow the application instructions or contact details above to
                apply.
              </span>
            )}
          </footer>
        </article>
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
          title="Sign in to save opportunities"
          description="Guests can browse all published scholarships, grants, internships, and programmes. Sign in to save opportunities and track deadlines."
          returnRoute="opportunities"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setGuestPromptOpen(false)}
        />
      )}

      {/* Top View Tabs: All Opportunities vs Saved Opportunities */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Opportunities view tabs"
          className="inline-flex rounded-xl bg-slate-100 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'all'
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            All Opportunities ({opportunities.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'saved'}
            onClick={() => setActiveTab('saved')}
            className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'saved'
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            Saved Opportunities ({user ? savedIds.size : 0})
          </button>
        </div>

        <p className="text-xs font-medium text-slate-500">
          Showing {filteredOpportunities.length}{' '}
          {filteredOpportunities.length === 1 ? 'opportunity' : 'opportunities'}
        </p>
      </div>

      {/* Saved Closing Soon Notice */}
      {activeTab === 'saved' && user && savedClosingSoonCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900"
        >
          <span className="font-medium">
            {savedClosingSoonCount}{' '}
            {savedClosingSoonCount === 1
              ? 'saved opportunity is'
              : 'saved opportunities are'}{' '}
            closing within 7 days.
          </span>
          {statusFilter !== 'closing_soon' && (
            <button
              type="button"
              onClick={() => setStatusFilter('closing_soon')}
              className="font-semibold text-amber-900 underline"
            >
              Show closing soon
            </button>
          )}
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 sm:p-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter opportunities by keyword"
            placeholder="Filter by title, organisation, eligibility, benefit, or keyword..."
            className="block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-9 pl-10 text-xs text-[#0B1A2E] focus:border-[#1E88E5] sm:text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear filter text"
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="opp-filter-category"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Category
            </label>
            <select
              id="opp-filter-category"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(
                  e.target.value as 'all' | OpportunityCategory
                )
              }
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E]"
            >
              <option value="all">All Categories</option>
              {OPPORTUNITY_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="opp-filter-status"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Application Status
            </label>
            <select
              id="opp-filter-status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as OpportunityStatusFilter)
              }
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E]"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="closing_soon">Closing Soon</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="opp-filter-deadline"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Deadline
            </label>
            <select
              id="opp-filter-deadline"
              value={deadlineFilter}
              onChange={(e) =>
                setDeadlineFilter(e.target.value as OpportunityDeadlineFilter)
              }
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E]"
            >
              <option value="all">Any Deadline</option>
              <option value="7d">Closing within 7 days</option>
              <option value="30d">Closing within 30 days</option>
              <option value="later">More than 30 days left</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="opp-filter-organisation"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Organisation
            </label>
            <select
              id="opp-filter-organisation"
              value={organisationFilter}
              onChange={(e) => setOrganisationFilter(e.target.value)}
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E]"
            >
              <option value="all">All Organisations</option>
              {availableOrganisations.map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-[#1E88E5] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Empty States or Card Grid */}
      {activeTab === 'saved' && !user ? (
        <GuestPromptCard
          title="Sign in to view your saved opportunities"
          description="Create a free LASUED Intel account or sign in to save scholarships, internships, and fellowships for easy access before deadlines close."
          returnRoute="opportunities"
          onRequireAuth={onRequireAuth}
        />
      ) : filteredOpportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Briefcase
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            {activeTab === 'saved' && savedIds.size === 0
              ? 'No saved opportunities yet'
              : hasActiveFilters
                ? 'No opportunities match these filters'
                : 'No opportunities published yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            {activeTab === 'saved' && savedIds.size === 0
              ? 'Use the bookmark icon on any opportunity card to save it here for quick deadline tracking.'
              : hasActiveFilters
                ? 'Try adjusting or clearing your search keywords, category, deadline, or status filters.'
                : 'Scholarships, grants, internships, trainings, and career opportunities published for LASUED students will appear here.'}
          </p>
          {activeTab === 'saved' && savedIds.size === 0 ? (
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              Browse All Opportunities
            </button>
          ) : hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredOpportunities.map((opp) => {
            const lifecycle = resolveOpportunityLifecycle(opp, nowMs);
            const isSaved = savedIds.has(opp.id);

            return (
              <article
                key={opp.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-[#1E88E5]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold text-[#1E88E5]">
                        {getOpportunityCategoryLabel(opp.category)}
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
                      {opp.isVerified === true && (
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
                      disabled={savingId === opp.id}
                      onClick={() => void handleToggleSave(opp.id)}
                      aria-label={
                        isSaved
                          ? `Remove ${opp.title} from saved opportunities`
                          : `Save ${opp.title}`
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

                  <h3 className="mt-2 font-display text-base font-bold text-[#0B1A2E]">
                    {opp.title}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-[#1E88E5]">
                    {opp.organisation}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600">
                    {opp.description}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div className="space-y-0.5 text-[11px] text-slate-500">
                    <p>Posted {formatOpportunityDate(opp.createdAt)}</p>
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
                    onClick={() => openDetails(opp.id)}
                    className="inline-flex min-h-[36px] items-center rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#132844]"
                  >
                    View Details
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

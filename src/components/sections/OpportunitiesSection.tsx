import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildOpportunityShareUrl } from '../../config/site';
import { useFirebase } from '../../context/firebaseContext';
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  fetchOpportunityById,
  fetchPublishedOpportunities,
} from '../../services/adminDashboard';
import {
  getOpportunitiesSessionSnapshot,
  hydrateOpportunitiesSnapshot,
  saveOpportunitiesSessionSnapshot,
} from '../../services/navigationStateCache';
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
import {
  mergeOrderedRecords,
  reuseSetIfUnchanged,
} from '../../utils/cacheSync';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { LinkifiedText } from '../shared/LinkifiedText';
import { SectionRibbon } from '../shared/SectionRibbon';
import { ShareActionMenu } from '../shared/ShareActionMenu';
import { OpportunityCard } from './opportunities/OpportunityCard';

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
  const viewerUid = user?.uid ?? null;
  const viewerKey = viewerUid ?? 'guest';
  const initialCache = getOpportunitiesSessionSnapshot(viewerKey);

  const [opportunities, setOpportunities] = useState<Opportunity[]>(
    () => initialCache?.opportunities ?? []
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => initialCache?.savedIds ?? new Set()
  );
  const [loading, setLoading] = useState(() => !initialCache);
  const [hydratedViewerKey, setHydratedViewerKey] = useState<string>(() =>
    initialCache ? viewerKey : ''
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeTab, setActiveTab] = useState<OpportunitiesTab>(
    () => initialCache?.activeTab ?? 'all'
  );
  const [searchQuery, setSearchQuery] = useState(
    () => initialCache?.searchQuery ?? ''
  );
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | OpportunityCategory
  >(() => initialCache?.categoryFilter ?? 'all');
  const [statusFilter, setStatusFilter] = useState<OpportunityStatusFilter>(
    () => initialCache?.statusFilter ?? 'all'
  );
  const [deadlineFilter, setDeadlineFilter] =
    useState<OpportunityDeadlineFilter>(
      () => initialCache?.deadlineFilter ?? 'all'
    );
  const [organisationFilter, setOrganisationFilter] = useState(
    () => initialCache?.organisationFilter ?? 'all'
  );

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(
    selectedOpportunityId
  );
  const [directLookupResult, setDirectLookupResult] = useState<{
    targetId: string;
    opportunity: Opportunity | null;
  } | null>(() => initialCache?.directLookupResult ?? null);
  const [guestPromptOpen, setGuestPromptOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastHandledReloadRef = useRef(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const opportunitiesRef = useRef(opportunities);
  const viewerUidRef = useRef(viewerUid);
  const hydratedViewerKeyRef = useRef(hydratedViewerKey);
  useEffect(() => {
    opportunitiesRef.current = opportunities;
    viewerUidRef.current = viewerUid;
    hydratedViewerKeyRef.current = hydratedViewerKey;
  }, [opportunities, viewerUid, hydratedViewerKey]);

  const syncOpportunitiesFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      if (
        mode === 'background' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }

      const uid = viewerUidRef.current;
      const expectedViewerKey = uid ?? 'guest';
      const savedPromise = uid
        ? fetchViewerSavedPostIds('opportunities', uid).catch(() => null)
        : Promise.resolve(new Set<string>());

      const [items, viewerSaved] = await Promise.all([
        fetchPublishedOpportunities(),
        savedPromise,
      ]);

      if (isCancelled?.() || viewerUidRef.current !== uid) return;

      const alreadyHydrated = hydratedViewerKeyRef.current === expectedViewerKey;

      setOpportunities((prev) =>
        mode === 'background' && prev.length > 0
          ? mergeOrderedRecords({
              existing: prev,
              incoming: items,
              preferIncomingOrder: false,
              preserveTail: false,
            })
          : items
      );
      if (viewerSaved !== null) {
        setSavedIds((prev) => reuseSetIfUnchanged(prev, viewerSaved));
      } else if (mode === 'initial' || !alreadyHydrated) {
        setSavedIds(new Set());
      }
      hydratedViewerKeyRef.current = expectedViewerKey;
      setHydratedViewerKey(expectedViewerKey);
      setErrorMessage(null);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let active = true;
    let networkSettled = false;
    let timer: number | null = null;

    const cached = getOpportunitiesSessionSnapshot(viewerKey);
    if (cached && reloadNonce === lastHandledReloadRef.current) {
      if (hydratedViewerKeyRef.current !== viewerKey) {
        hydratedViewerKeyRef.current = viewerKey;
        timer = window.setTimeout(() => {
          if (!active) return;
          setOpportunities(cached.opportunities);
          setSavedIds(cached.savedIds);
          setActiveTab(cached.activeTab);
          setSearchQuery(cached.searchQuery);
          setCategoryFilter(cached.categoryFilter);
          setStatusFilter(cached.statusFilter);
          setDeadlineFilter(cached.deadlineFilter);
          setOrganisationFilter(cached.organisationFilter);
          setHydratedViewerKey(viewerKey);
          setLoading(false);
        }, 0);
      }
      if (Date.now() - cached.cachedAt > 2_000) {
        void syncOpportunitiesFromNetwork('background', () => !active).catch(
          () => undefined
        );
      }
      return () => {
        active = false;
        if (timer !== null) window.clearTimeout(timer);
      };
    }
    lastHandledReloadRef.current = reloadNonce;
    if (hydratedViewerKeyRef.current !== viewerKey) {
      timer = window.setTimeout(() => {
        if (!active || networkSettled) return;
        setSavedIds(new Set());
      }, 0);
    }

    const run = async () => {
      if (reloadNonce === 0) {
        const persisted = await hydrateOpportunitiesSnapshot(viewerKey);
        if (active && !networkSettled && persisted) {
          hydratedViewerKeyRef.current = viewerKey;
          setOpportunities(persisted.opportunities);
          setSavedIds(persisted.savedIds);
          setActiveTab(persisted.activeTab);
          setSearchQuery(persisted.searchQuery);
          setCategoryFilter(persisted.categoryFilter);
          setStatusFilter(persisted.statusFilter);
          setDeadlineFilter(persisted.deadlineFilter);
          setOrganisationFilter(persisted.organisationFilter);
          setHydratedViewerKey(viewerKey);
          setLoading(false);

          await syncOpportunitiesFromNetwork('background', () => !active).catch(
            () => undefined
          );
          return;
        }
      }

      await syncOpportunitiesFromNetwork('initial', () => !active);
      networkSettled = true;
    };

    void run()
      .catch((error) => {
        if (!active) return;
        if (opportunitiesRef.current.length === 0) {
          setErrorMessage(
            formatFirestoreOrAppError(
              error,
              'Unable to load campus opportunities right now.'
            )
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [viewerKey, viewerUid, reloadNonce, syncOpportunitiesFromNetwork]);

  useActiveBackgroundRefresh({
    enabled: !loading && hydratedViewerKey === viewerKey,
    onRefresh: () => syncOpportunitiesFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  const effectiveSelectedId = onSelectOpportunity
    ? selectedOpportunityId
    : localSelectedId;

  const needsDirectLookup = Boolean(
    effectiveSelectedId &&
      !loading &&
      !opportunities.some((item) => item.id === effectiveSelectedId)
  );
  const directLookupLoading =
    needsDirectLookup &&
    directLookupResult?.targetId !== effectiveSelectedId;

  useEffect(() => {
    if (!needsDirectLookup || !effectiveSelectedId) return;
    const targetId = effectiveSelectedId;
    let active = true;
    fetchOpportunityById(targetId)
      .then((found) => {
        if (!active) return;
        setDirectLookupResult({ targetId, opportunity: found });
        if (found) {
          setOpportunities((prev) =>
            prev.some((o) => o.id === found.id) ? prev : [...prev, found]
          );
        }
      })
      .catch(() => {
        if (active) {
          setDirectLookupResult({ targetId, opportunity: null });
        }
      });
    return () => {
      active = false;
    };
  }, [needsDirectLookup, effectiveSelectedId]);

  useEffect(() => {
    if (loading || hydratedViewerKey !== viewerKey) return;
    saveOpportunitiesSessionSnapshot({
      viewerKey,
      opportunities,
      savedIds,
      activeTab,
      searchQuery,
      categoryFilter,
      statusFilter,
      deadlineFilter,
      organisationFilter,
      directLookupResult,
      cachedAt: Date.now(),
    });
  }, [
    loading,
    hydratedViewerKey,
    viewerKey,
    opportunities,
    savedIds,
    activeTab,
    searchQuery,
    categoryFilter,
    statusFilter,
    deadlineFilter,
    organisationFilter,
    directLookupResult,
  ]);

  const openDetails = (oppId: string | null) => {
    if (onSelectOpportunity) {
      onSelectOpportunity(oppId);
    } else {
      setLocalSelectedId(oppId);
    }
  };

  const selectedOpportunity = useMemo(() => {
    if (!effectiveSelectedId) return null;
    const directMatched =
      directLookupResult?.targetId === effectiveSelectedId
        ? directLookupResult.opportunity
        : null;
    return (
      opportunities.find((item) => item.id === effectiveSelectedId) ??
      directMatched
    );
  }, [opportunities, effectiveSelectedId, directLookupResult]);

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
      <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-300">
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
      <div className="rounded-xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/60 dark:bg-red-950/40">
        <AlertCircle
          className="mx-auto mb-2 h-6 w-6 text-red-700 dark:text-red-400"
          aria-hidden="true"
        />
        <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
          Unable to load opportunities
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-300">
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setErrorMessage(null);
            setReloadNonce((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  // Dedicated Opportunity Details View
  if (effectiveSelectedId) {
    if (directLookupLoading) {
      return (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-300">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Opening opportunity...
        </div>
      );
    }

    if (!selectedOpportunity) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => openDetails(null)}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Opportunities
          </button>
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
            <Briefcase
              className="mx-auto mb-2 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
              Opportunity not available
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400">
              This opportunity may have been removed or unpublished.
            </p>
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
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
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Opportunities
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <ShareActionMenu
              shareUrl={buildOpportunityShareUrl(selectedOpportunity.id)}
              title={selectedOpportunity.title}
              text={`${selectedOpportunity.title} (${selectedOpportunity.organisation})`}
              variant="button"
              label="Share"
              align="right"
              testId={`opportunity-share-btn-${selectedOpportunity.id}`}
            />

            <button
              type="button"
              disabled={savingId === selectedOpportunity.id}
              onClick={() => void handleToggleSave(selectedOpportunity.id)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isSaved
                  ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5] dark:text-sky-400'
                  : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Bookmark
                className={`h-3.5 w-3.5 ${isSaved ? 'fill-current' : ''}`}
                aria-hidden="true"
              />
              {isSaved ? 'Saved Opportunity' : 'Save Opportunity'}
            </button>
          </div>
        </div>

        {guestPromptOpen && (
          <GuestPromptCard
            title="Sign in to save this opportunity"
            description="Sign in or create a free account to bookmark opportunities and track deadlines."
            returnRoute="opportunities"
            onRequireAuth={onRequireAuth}
            onDismiss={() => setGuestPromptOpen(false)}
          />
        )}

        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {errorMessage}
          </div>
        )}

        <article className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
          <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-[#1E88E5] dark:text-sky-400">
                {getOpportunityCategoryLabel(selectedOpportunity.category)}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                ·
              </span>
              <span
                className={`font-semibold ${
                  lifecycle.state === 'closing_soon'
                    ? 'text-amber-700 dark:text-amber-400'
                    : lifecycle.state === 'closed'
                      ? 'text-slate-600 dark:text-slate-400'
                      : lifecycle.state === 'upcoming'
                        ? 'text-[#1E88E5] dark:text-sky-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {lifecycle.label}
              </span>
              {selectedOpportunity.isVerified === true && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#0B1A2E] dark:text-white">
                    <ShieldCheck
                      className="h-3.5 w-3.5 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    Verified Listing
                  </span>
                </>
              )}
            </div>

            <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-[#0B1A2E] sm:text-2xl dark:text-white">
              {selectedOpportunity.title}
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#1E88E5] dark:text-sky-400">
              {selectedOpportunity.organisation}
            </p>
          </header>

          {/* Key Application Dates */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <Calendar className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                Applications Open
              </p>
              <p className="mt-1 text-xs font-bold text-[#0B1A2E] dark:text-white">
                {selectedOpportunity.opensAt
                  ? formatOpportunityDate(selectedOpportunity.opensAt)
                  : formatOpportunityDate(selectedOpportunity.createdAt)}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <Clock className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                Application Deadline
              </p>
              <p
                className={`mt-1 text-xs font-bold ${
                  lifecycle.state === 'closing_soon'
                    ? 'text-amber-700 dark:text-amber-400'
                    : lifecycle.state === 'closed'
                      ? 'text-slate-600 dark:text-slate-400'
                      : 'text-[#0B1A2E] dark:text-white'
                }`}
              >
                {formatOpportunityDate(selectedOpportunity.expiresAt)} (
                {formatOpportunityDeadlineSummary(lifecycle)})
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Date Posted
              </p>
              <p className="mt-1 text-xs font-bold text-[#0B1A2E] dark:text-white">
                {formatOpportunityDate(selectedOpportunity.createdAt)}
              </p>
            </div>
          </div>

          {/* Full Description */}
          <div>
            <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
              Overview
            </h3>
            <LinkifiedText
              text={selectedOpportunity.description}
              className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-slate-700 dark:text-slate-300"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {selectedOpportunity.whoCanApply && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase dark:text-white">
                  <Users className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Who Can Apply
                </h3>
                <LinkifiedText
                  text={selectedOpportunity.whoCanApply}
                  className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm dark:text-slate-300"
                />
              </div>
            )}

            {selectedOpportunity.eligibility && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase dark:text-white">
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Eligibility Requirements
                </h3>
                <LinkifiedText
                  text={selectedOpportunity.eligibility}
                  className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm dark:text-slate-300"
                />
              </div>
            )}

            {selectedOpportunity.benefits && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase dark:text-white">
                  <Gift className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Benefits
                </h3>
                <LinkifiedText
                  text={selectedOpportunity.benefits}
                  className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm dark:text-slate-300"
                />
              </div>
            )}

            {selectedOpportunity.requiredDocuments && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <h3 className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase dark:text-white">
                  <FileText
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Required Documents
                </h3>
                <LinkifiedText
                  text={selectedOpportunity.requiredDocuments}
                  className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm dark:text-slate-300"
                />
              </div>
            )}
          </div>

          {selectedOpportunity.applicationInstructions && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <h3 className="font-display text-xs font-bold tracking-wide text-[#0B1A2E] uppercase dark:text-white">
                Application Instructions
              </h3>
              <LinkifiedText
                text={selectedOpportunity.applicationInstructions}
                className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm dark:text-slate-300"
              />
            </div>
          )}

          {selectedOpportunity.contactInfo && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
              <Mail
                className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                aria-hidden="true"
              />
              <div>
                <span className="font-semibold text-[#0B1A2E] dark:text-white">
                  Contact Information:
                </span>{' '}
                <LinkifiedText
                  as="span"
                  text={selectedOpportunity.contactInfo}
                />
              </div>
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
            >
              Back to All Opportunities
            </button>

            {lifecycle.state === 'closed' ? (
              <span className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Applications Closed
              </span>
            ) : lifecycle.state === 'upcoming' ? (
              <span className="inline-flex min-h-[40px] items-center rounded-lg bg-[#1E88E5]/10 px-4 py-2 text-xs font-semibold text-[#1E88E5] dark:text-sky-400">
                Opens {formatOpportunityDate(selectedOpportunity.opensAt)}
              </span>
            ) : safeUrl ? (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
              >
                Apply via Official Link
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Follow the instructions above to apply.
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
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {guestPromptOpen && (
        <GuestPromptCard
          title="Sign in to save opportunities"
          description="Sign in to save scholarships, internships, and track deadlines."
          returnRoute="opportunities"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setGuestPromptOpen(false)}
        />
      )}

      {/* Top View Tabs: All Opportunities vs Saved Opportunities */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionRibbon
          variant="sublist"
          ariaLabel="Opportunities view tabs"
          items={[
            { id: 'all', label: 'All Opportunities', count: opportunities.length },
            { id: 'saved', label: 'Saved', count: user ? savedIds.size : 0 },
          ]}
          activeId={activeTab}
          onChange={setActiveTab}
          className="sm:w-fit"
        />

        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Showing {filteredOpportunities.length}{' '}
          {filteredOpportunities.length === 1 ? 'opportunity' : 'opportunities'}
        </p>
      </div>

      {/* Category Ribbon */}
      <SectionRibbon
        variant="primary"
        ariaLabel="Opportunity categories"
        items={[
          { id: 'all', label: 'All Categories' },
          ...OPPORTUNITY_CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label })),
        ]}
        activeId={categoryFilter}
        onChange={(catId) =>
          setCategoryFilter(catId as 'all' | OpportunityCategory)
        }
      />

      {/* Saved Closing Soon Notice */}
      {activeTab === 'saved' && user && savedClosingSoonCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
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
              className="font-semibold text-amber-900 underline dark:text-amber-200"
            >
              Show closing soon
            </button>
          )}
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter opportunities by keyword"
            placeholder="Search by title, organisation, or keyword..."
            className="block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-9 pl-10 text-xs text-[#0B1A2E] focus:border-[#1E88E5] sm:text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear filter text"
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div>
            <label
              htmlFor="opp-filter-status"
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
            >
              Application Status
            </label>
            <select
              id="opp-filter-status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as OpportunityStatusFilter)
              }
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
            >
              Deadline
            </label>
            <select
              id="opp-filter-deadline"
              value={deadlineFilter}
              onChange={(e) =>
                setDeadlineFilter(e.target.value as OpportunityDeadlineFilter)
              }
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
            >
              Organisation
            </label>
            <select
              id="opp-filter-organisation"
              value={organisationFilter}
              onChange={(e) => setOrganisationFilter(e.target.value)}
              className="mt-1 block min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Empty States or Card Grid */}
      {activeTab === 'saved' && !user ? (
        <GuestPromptCard
          title="Sign in to view saved opportunities"
          description="Sign in to save scholarships and internships before deadlines close."
          returnRoute="opportunities"
          onRequireAuth={onRequireAuth}
        />
      ) : filteredOpportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <Briefcase
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
            {activeTab === 'saved' && savedIds.size === 0
              ? 'No saved opportunities yet'
              : hasActiveFilters
                ? 'No opportunities match these filters'
                : 'No opportunities published yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400">
            {activeTab === 'saved' && savedIds.size === 0
              ? 'Tap the bookmark icon on any opportunity to save it here.'
              : hasActiveFilters
                ? 'Try changing or clearing your filters.'
                : 'New scholarships, internships, and programs will appear here.'}
          </p>
          {activeTab === 'saved' && savedIds.size === 0 ? (
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
            >
              Browse All Opportunities
            </button>
          ) : hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredOpportunities.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              nowMs={nowMs}
              isSaved={savedIds.has(opp.id)}
              saving={savingId === opp.id}
              onToggleSave={(id) => void handleToggleSave(id)}
              onOpenDetails={openDetails}
            />
          ))}
        </div>
      )}
    </div>
  );
};

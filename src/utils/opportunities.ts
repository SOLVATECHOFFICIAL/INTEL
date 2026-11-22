import {
  isSafeMediaUrl,
  resolveOpportunityEffectiveStatus,
  type Opportunity,
  type OpportunityCategory,
} from '../types/database';
import { extractTimestampMs } from './contextualSearch';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CLOSING_SOON_WINDOW_MS = 7 * DAY_MS;

export interface OpportunityCategoryOption {
  id: OpportunityCategory;
  label: string;
  shortLabel: string;
}

export const OPPORTUNITY_CATEGORIES: readonly OpportunityCategoryOption[] = [
  { id: 'scholarship', label: 'Scholarships', shortLabel: 'Scholarship' },
  {
    id: 'grant',
    label: 'Grants & Financial Support',
    shortLabel: 'Grant',
  },
  { id: 'internship', label: 'Internships', shortLabel: 'Internship' },
  { id: 'job', label: 'Job Opportunities', shortLabel: 'Job' },
  {
    id: 'competition',
    label: 'Student Competitions',
    shortLabel: 'Competition',
  },
  {
    id: 'programme',
    label: 'Skill Development Programmes',
    shortLabel: 'Skill Programme',
  },
  {
    id: 'training',
    label: 'Training Programmes',
    shortLabel: 'Training',
  },
  {
    id: 'conference',
    label: 'Conferences & Educational',
    shortLabel: 'Conference',
  },
  { id: 'other', label: 'Other Opportunities', shortLabel: 'Other' },
] as const;

const CATEGORY_MAP = new Map<OpportunityCategory, OpportunityCategoryOption>(
  OPPORTUNITY_CATEGORIES.map((opt) => [opt.id, opt])
);

export function getOpportunityCategoryLabel(
  category: OpportunityCategory
): string {
  return CATEGORY_MAP.get(category)?.label ?? 'Other Opportunities';
}

export function getOpportunityCategoryShortLabel(
  category: OpportunityCategory
): string {
  return CATEGORY_MAP.get(category)?.shortLabel ?? 'Other';
}

export type OpportunityLifecycleState =
  | 'unpublished'
  | 'upcoming'
  | 'open'
  | 'closing_soon'
  | 'closed';

export interface OpportunityLifecycleInfo {
  state: OpportunityLifecycleState;
  label: string;
  isPastDeadline: boolean;
  isOpenForApplications: boolean;
  opensAtMs: number | null;
  expiresAtMs: number | null;
  daysRemaining: number | null;
}

export function resolveOpportunityLifecycle(
  opp: Pick<Opportunity, 'status' | 'expiresAt' | 'opensAt'>,
  nowMs: number = Date.now()
): OpportunityLifecycleInfo {
  const opensAtMs = extractTimestampMs(opp.opensAt);
  const expiresAtMs = extractTimestampMs(opp.expiresAt);
  const isPastDeadline = expiresAtMs !== null && expiresAtMs <= nowMs;

  if (opp.status === 'unpublished') {
    return {
      state: 'unpublished',
      label: 'Unpublished',
      isPastDeadline,
      isOpenForApplications: false,
      opensAtMs,
      expiresAtMs,
      daysRemaining:
        expiresAtMs !== null && expiresAtMs > nowMs
          ? Math.ceil((expiresAtMs - nowMs) / DAY_MS)
          : 0,
    };
  }

  const effective = resolveOpportunityEffectiveStatus(opp, expiresAtMs, nowMs);
  if (effective === 'expired' || isPastDeadline) {
    return {
      state: 'closed',
      label: 'Closed',
      isPastDeadline: true,
      isOpenForApplications: false,
      opensAtMs,
      expiresAtMs,
      daysRemaining: 0,
    };
  }

  if (opensAtMs !== null && opensAtMs > nowMs) {
    return {
      state: 'upcoming',
      label: 'Opening Soon',
      isPastDeadline: false,
      isOpenForApplications: false,
      opensAtMs,
      expiresAtMs,
      daysRemaining:
        expiresAtMs !== null ? Math.ceil((expiresAtMs - nowMs) / DAY_MS) : null,
    };
  }

  const remainingMs = expiresAtMs !== null ? expiresAtMs - nowMs : null;
  const daysRemaining =
    remainingMs !== null ? Math.max(1, Math.ceil(remainingMs / DAY_MS)) : null;

  if (remainingMs !== null && remainingMs <= CLOSING_SOON_WINDOW_MS) {
    return {
      state: 'closing_soon',
      label: 'Closing Soon',
      isPastDeadline: false,
      isOpenForApplications: true,
      opensAtMs,
      expiresAtMs,
      daysRemaining,
    };
  }

  return {
    state: 'open',
    label: 'Open',
    isPastDeadline: false,
    isOpenForApplications: true,
    opensAtMs,
    expiresAtMs,
    daysRemaining,
  };
}

export type OpportunityStatusFilter = 'all' | 'open' | 'closing_soon' | 'closed';
export type OpportunityDeadlineFilter = 'all' | '7d' | '30d' | 'later';

export interface OpportunityFilterOptions {
  query?: string;
  category?: 'all' | OpportunityCategory;
  status?: OpportunityStatusFilter;
  deadline?: OpportunityDeadlineFilter;
  organisation?: string;
  savedOnly?: boolean;
  includeUnpublished?: boolean;
}

export function matchesStatusFilter(
  lifecycle: OpportunityLifecycleInfo,
  statusFilter: OpportunityStatusFilter = 'all'
): boolean {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'open') {
    return (
      lifecycle.state === 'open' ||
      lifecycle.state === 'closing_soon' ||
      lifecycle.state === 'upcoming'
    );
  }
  if (statusFilter === 'closing_soon') {
    return lifecycle.state === 'closing_soon';
  }
  return lifecycle.state === 'closed';
}

export function matchesDeadlineFilter(
  opp: Pick<Opportunity, 'status' | 'expiresAt' | 'opensAt'>,
  deadlineFilter: OpportunityDeadlineFilter = 'all',
  nowMs: number = Date.now()
): boolean {
  if (deadlineFilter === 'all') return true;
  const lifecycle = resolveOpportunityLifecycle(opp, nowMs);
  if (
    lifecycle.state === 'closed' ||
    lifecycle.state === 'unpublished' ||
    lifecycle.expiresAtMs === null
  ) {
    return false;
  }
  const remaining = lifecycle.expiresAtMs - nowMs;
  if (remaining <= 0) return false;
  if (deadlineFilter === '7d') {
    return remaining <= 7 * DAY_MS;
  }
  if (deadlineFilter === '30d') {
    return remaining <= 30 * DAY_MS;
  }
  return remaining > 30 * DAY_MS;
}

export function extractUniqueOrganisations(
  items: readonly Opportunity[]
): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const clean = item.organisation.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, clean);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function matchesOpportunitySearchQuery(
  opp: Opportunity,
  rawQuery: string
): boolean {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [
    opp.title,
    opp.organisation,
    opp.description,
    opp.eligibility ?? '',
    opp.whoCanApply ?? '',
    opp.benefits ?? '',
    opp.requiredDocuments ?? '',
    opp.applicationInstructions ?? '',
    opp.category,
    getOpportunityCategoryLabel(opp.category),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
}

export function filterAndSortOpportunities(
  items: readonly Opportunity[],
  filters: OpportunityFilterOptions,
  savedIds: ReadonlySet<string> = new Set(),
  nowMs: number = Date.now()
): Opportunity[] {
  const {
    query = '',
    category = 'all',
    status = 'all',
    deadline = 'all',
    organisation = 'all',
    savedOnly = false,
    includeUnpublished = false,
  } = filters;

  const orgNormalized = organisation.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (!includeUnpublished && item.status === 'unpublished') {
      return false;
    }
    if (savedOnly && !savedIds.has(item.id)) {
      return false;
    }
    if (category !== 'all' && item.category !== category) {
      return false;
    }
    if (
      orgNormalized &&
      orgNormalized !== 'all' &&
      item.organisation.trim().toLowerCase() !== orgNormalized
    ) {
      return false;
    }
    const lifecycle = resolveOpportunityLifecycle(item, nowMs);
    if (!matchesStatusFilter(lifecycle, status)) {
      return false;
    }
    if (!matchesDeadlineFilter(item, deadline, nowMs)) {
      return false;
    }
    return matchesOpportunitySearchQuery(item, query);
  });

  return filtered.sort((a, b) => {
    const lifeA = resolveOpportunityLifecycle(a, nowMs);
    const lifeB = resolveOpportunityLifecycle(b, nowMs);

    const aClosed = lifeA.state === 'closed' || lifeA.state === 'unpublished';
    const bClosed = lifeB.state === 'closed' || lifeB.state === 'unpublished';

    if (aClosed !== bClosed) {
      return aClosed ? 1 : -1;
    }

    if (!aClosed && !bClosed) {
      const aExp = lifeA.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
      const bExp = lifeB.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
      if (aExp !== bExp) return aExp - bExp;
    }

    const aCreated = extractTimestampMs(a.createdAt) ?? 0;
    const bCreated = extractTimestampMs(b.createdAt) ?? 0;
    return bCreated - aCreated;
  });
}

export function getSafeApplicationUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || !isSafeMediaUrl(trimmed)) return null;
  return trimmed;
}

export function sanitizeOpportunityIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildOpportunityNotificationDocId(
  kind: 'new' | 'deadline',
  opportunityId: string,
  recipientUid: string,
  deadlineMs?: number
): string {
  const safeOpp = sanitizeOpportunityIdSegment(opportunityId).slice(0, 40);
  const safeUid = sanitizeOpportunityIdSegment(recipientUid).slice(0, 48);
  if (kind === 'new') {
    return `opp_new_${safeOpp}_${safeUid}`.slice(0, 128);
  }
  const dayBucket = Math.floor((deadlineMs ?? Date.now()) / DAY_MS);
  return `opp_dl_${safeOpp}_${dayBucket}_${safeUid}`.slice(0, 128);
}

export function canSendNewOpportunityNotice(
  opp: Pick<Opportunity, 'status' | 'expiresAt' | 'notifiedNewAt'>,
  nowMs: number = Date.now()
): boolean {
  if (opp.status !== 'active') return false;
  const expiresMs = extractTimestampMs(opp.expiresAt);
  if (expiresMs !== null && expiresMs <= nowMs) return false;
  return !opp.notifiedNewAt;
}

export function canSendDeadlineUpdateNotice(
  opp: Pick<Opportunity, 'status' | 'lastDeadlineNotifiedMs'>,
  nextDeadlineMs: number,
  nowMs: number = Date.now()
): boolean {
  if (opp.status !== 'active') return false;
  if (!Number.isFinite(nextDeadlineMs) || nextDeadlineMs <= nowMs) return false;
  if (typeof opp.lastDeadlineNotifiedMs !== 'number') return true;
  return (
    Math.floor(opp.lastDeadlineNotifiedMs / DAY_MS) !==
    Math.floor(nextDeadlineMs / DAY_MS)
  );
}

export function formatOpportunityDate(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Not specified';
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatOpportunityDeadlineSummary(
  lifecycle: OpportunityLifecycleInfo
): string {
  if (lifecycle.state === 'closed') {
    return lifecycle.expiresAtMs
      ? `Closed ${formatOpportunityDate(lifecycle.expiresAtMs)}`
      : 'Closed';
  }
  if (lifecycle.state === 'closing_soon' && lifecycle.daysRemaining !== null) {
    return lifecycle.daysRemaining === 1
      ? 'Closes within 24 hours'
      : `Closes in ${lifecycle.daysRemaining} days`;
  }
  return lifecycle.expiresAtMs
    ? formatOpportunityDate(lifecycle.expiresAtMs)
    : 'See details';
}

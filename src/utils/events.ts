import {
  isSafeMediaUrl,
  type CampusEvent,
  type EventCategory,
} from '../types/database';
import { extractTimestampMs } from './contextualSearch';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export interface EventCategoryOption {
  id: EventCategory;
  label: string;
  shortLabel: string;
}

export const EVENT_CATEGORIES: readonly EventCategoryOption[] = [
  { id: 'departmental', label: 'Departmental Events', shortLabel: 'Departmental' },
  { id: 'faculty', label: 'Faculty Events', shortLabel: 'Faculty' },
  {
    id: 'student_association',
    label: 'Student Association Events',
    shortLabel: 'Student Association',
  },
  {
    id: 'seminar_workshop',
    label: 'Seminars & Workshops',
    shortLabel: 'Seminar / Workshop',
  },
  { id: 'conference', label: 'Academic Conferences', shortLabel: 'Conference' },
  {
    id: 'orientation',
    label: 'Orientation Programmes',
    shortLabel: 'Orientation',
  },
  {
    id: 'public_lecture',
    label: 'Public Lectures',
    shortLabel: 'Public Lecture',
  },
  { id: 'competition', label: 'Competitions', shortLabel: 'Competition' },
  {
    id: 'social_cultural',
    label: 'Social & Cultural Activities',
    shortLabel: 'Social & Cultural',
  },
  { id: 'other', label: 'Other University Events', shortLabel: 'Other' },
] as const;

const CATEGORY_MAP = new Map<EventCategory, EventCategoryOption>(
  EVENT_CATEGORIES.map((item) => [item.id, item])
);

export function getEventCategoryLabel(category?: EventCategory): string {
  if (!category) return 'University Event';
  return CATEGORY_MAP.get(category)?.label ?? 'Other University Events';
}

export function getEventCategoryShortLabel(category?: EventCategory): string {
  if (!category) return 'Event';
  return CATEGORY_MAP.get(category)?.shortLabel ?? 'Other';
}

export type EventLifecycleState =
  | 'unpublished'
  | 'upcoming'
  | 'ongoing'
  | 'completed'
  | 'cancelled';

export interface EventLifecycleInfo {
  state: EventLifecycleState;
  label: string;
  isPublished: boolean;
  isUpcoming: boolean;
  isOngoing: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  startMs: number | null;
  endMs: number | null;
}

export function isCampusEventPublished(
  evt: Pick<CampusEvent, 'published'>
): boolean {
  return evt.published !== false;
}

export function resolveEventLifecycle(
  evt: Pick<CampusEvent, 'status' | 'eventDate' | 'endDate' | 'published'>,
  nowMs: number = Date.now()
): EventLifecycleInfo {
  const startMs = extractTimestampMs(evt.eventDate);
  const rawEndMs = extractTimestampMs(evt.endDate);
  const endMs =
    rawEndMs !== null && (startMs === null || rawEndMs > startMs)
      ? rawEndMs
      : startMs !== null
        ? startMs + DEFAULT_EVENT_DURATION_MS
        : null;

  if (evt.published === false) {
    return {
      state: 'unpublished',
      label: 'Draft',
      isPublished: false,
      isUpcoming: false,
      isOngoing: false,
      isCompleted: false,
      isCancelled: evt.status === 'cancelled',
      startMs,
      endMs,
    };
  }

  if (evt.status === 'cancelled') {
    return {
      state: 'cancelled',
      label: 'Cancelled',
      isPublished: true,
      isUpcoming: false,
      isOngoing: false,
      isCompleted: false,
      isCancelled: true,
      startMs,
      endMs,
    };
  }

  if (evt.status === 'completed' || evt.status === 'past') {
    return {
      state: 'completed',
      label: 'Completed',
      isPublished: true,
      isUpcoming: false,
      isOngoing: false,
      isCompleted: true,
      isCancelled: false,
      startMs,
      endMs,
    };
  }

  if (startMs !== null) {
    if (nowMs < startMs) {
      return {
        state: 'upcoming',
        label: 'Upcoming',
        isPublished: true,
        isUpcoming: true,
        isOngoing: false,
        isCompleted: false,
        isCancelled: false,
        startMs,
        endMs,
      };
    }
    if (endMs !== null && nowMs < endMs) {
      return {
        state: 'ongoing',
        label: 'Ongoing',
        isPublished: true,
        isUpcoming: false,
        isOngoing: true,
        isCompleted: false,
        isCancelled: false,
        startMs,
        endMs,
      };
    }
    if (endMs !== null && nowMs >= endMs) {
      return {
        state: 'completed',
        label: 'Completed',
        isPublished: true,
        isUpcoming: false,
        isOngoing: false,
        isCompleted: true,
        isCancelled: false,
        startMs,
        endMs,
      };
    }
  }

  return {
    state: 'upcoming',
    label: 'Upcoming',
    isPublished: true,
    isUpcoming: true,
    isOngoing: false,
    isCompleted: false,
    isCancelled: false,
    startMs,
    endMs,
  };
}

export type EventStatusFilter =
  | 'all'
  | 'upcoming'
  | 'ongoing'
  | 'completed'
  | 'cancelled';

export type EventDateWindowFilter = 'all' | 'today' | 'this_week' | 'this_month';

export interface EventFilterOptions {
  query?: string;
  category?: 'all' | EventCategory;
  status?: EventStatusFilter;
  dateWindow?: EventDateWindowFilter;
  venue?: string;
  savedOnly?: boolean;
  includeUnpublished?: boolean;
}

export function matchesEventStatusFilter(
  lifecycle: EventLifecycleInfo,
  statusFilter: EventStatusFilter = 'all'
): boolean {
  if (statusFilter === 'all') return true;
  return lifecycle.state === statusFilter;
}

export function matchesEventDateFilter(
  evt: Pick<CampusEvent, 'eventDate' | 'endDate' | 'status' | 'published'>,
  dateFilter: EventDateWindowFilter = 'all',
  nowMs: number = Date.now()
): boolean {
  if (dateFilter === 'all') return true;

  const lifecycle = resolveEventLifecycle(evt, nowMs);
  if (
    lifecycle.state === 'unpublished' ||
    lifecycle.state === 'cancelled' ||
    lifecycle.startMs === null
  ) {
    return false;
  }

  const startMs = lifecycle.startMs;
  const endMs = lifecycle.endMs ?? startMs;

  const nowDate = new Date(nowMs);
  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const endOfToday = startOfToday + DAY_MS;

  if (dateFilter === 'today') {
    return startMs < endOfToday && endMs >= startOfToday;
  }

  if (dateFilter === 'this_week') {
    const endOfWeek = startOfToday + 7 * DAY_MS;
    return startMs < endOfWeek && endMs >= startOfToday;
  }

  // this_month: local calendar month
  const startOfMonth = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    1,
    0,
    0,
    0,
    0
  ).getTime();
  const startOfNextMonth = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth() + 1,
    1,
    0,
    0,
    0,
    0
  ).getTime();
  return startMs < startOfNextMonth && endMs >= startOfMonth;
}

export function extractUniqueEventVenues(
  items: readonly CampusEvent[]
): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const clean = item.venue.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, clean);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function matchesEventSearchQuery(
  evt: CampusEvent,
  rawQuery: string
): boolean {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return true;

  const category = evt.category ?? 'other';
  const haystack = [
    evt.title,
    evt.organiser,
    evt.venue,
    evt.description,
    evt.instructions ?? '',
    evt.timeLabel ?? '',
    category,
    getEventCategoryLabel(evt.category),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
}

export function filterAndSortEvents(
  items: readonly CampusEvent[],
  filters: EventFilterOptions,
  savedIds: ReadonlySet<string> = new Set(),
  nowMs: number = Date.now()
): CampusEvent[] {
  const {
    query = '',
    category = 'all',
    status = 'all',
    dateWindow = 'all',
    venue = 'all',
    savedOnly = false,
    includeUnpublished = false,
  } = filters;

  const venueNormalized = venue.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (!includeUnpublished && !isCampusEventPublished(item)) {
      return false;
    }
    if (savedOnly && !savedIds.has(item.id)) {
      return false;
    }
    if (category !== 'all' && (item.category ?? 'other') !== category) {
      return false;
    }
    if (
      venueNormalized &&
      venueNormalized !== 'all' &&
      item.venue.trim().toLowerCase() !== venueNormalized
    ) {
      return false;
    }
    const lifecycle = resolveEventLifecycle(item, nowMs);
    if (!matchesEventStatusFilter(lifecycle, status)) {
      return false;
    }
    if (!matchesEventDateFilter(item, dateWindow, nowMs)) {
      return false;
    }
    return matchesEventSearchQuery(item, query);
  });

  const bucketRank = (state: EventLifecycleState): number => {
    switch (state) {
      case 'ongoing':
        return 0;
      case 'upcoming':
        return 1;
      case 'completed':
        return 2;
      case 'cancelled':
        return 3;
      case 'unpublished':
      default:
        return 4;
    }
  };

  return filtered.sort((a, b) => {
    const lifeA = resolveEventLifecycle(a, nowMs);
    const lifeB = resolveEventLifecycle(b, nowMs);

    const rankDiff = bucketRank(lifeA.state) - bucketRank(lifeB.state);
    if (rankDiff !== 0) return rankDiff;

    const aStart = lifeA.startMs ?? 0;
    const bStart = lifeB.startMs ?? 0;

    if (lifeA.state === 'ongoing' || lifeA.state === 'upcoming') {
      if (aStart !== bStart) return aStart - bStart;
    } else {
      if (aStart !== bStart) return bStart - aStart;
    }

    const aCreated = extractTimestampMs(a.createdAt) ?? 0;
    const bCreated = extractTimestampMs(b.createdAt) ?? 0;
    return bCreated - aCreated;
  });
}

export function getSafeEventUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || !isSafeMediaUrl(trimmed)) return null;
  return trimmed;
}

export function formatEventLocalDate(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Date TBA';
  return new Date(ms).toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatEventLocalTime(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatEventDateTimeRange(
  evt: Pick<CampusEvent, 'eventDate' | 'endDate' | 'timeLabel'>
): string {
  const startMs = extractTimestampMs(evt.eventDate);
  if (!startMs) return evt.timeLabel?.trim() || 'Schedule TBA';

  const startDateLabel = formatEventLocalDate(startMs);
  if (evt.timeLabel?.trim()) {
    return `${startDateLabel} · ${evt.timeLabel.trim()}`;
  }

  const startTimeLabel = formatEventLocalTime(startMs);
  const rawEndMs = extractTimestampMs(evt.endDate);
  if (!rawEndMs || rawEndMs <= startMs) {
    return `${startDateLabel} · ${startTimeLabel}`;
  }

  const startD = new Date(startMs);
  const endD = new Date(rawEndMs);
  const sameDay =
    startD.getFullYear() === endD.getFullYear() &&
    startD.getMonth() === endD.getMonth() &&
    startD.getDate() === endD.getDate();

  if (sameDay) {
    return `${startDateLabel} · ${startTimeLabel} – ${formatEventLocalTime(rawEndMs)}`;
  }

  return `${startDateLabel}, ${startTimeLabel} – ${formatEventLocalDate(rawEndMs)}, ${formatEventLocalTime(rawEndMs)}`;
}

export function buildEventShareUrl(
  eventId: string,
  origin?: string
): string {
  const safeId = encodeURIComponent(eventId.trim());
  const baseOrigin =
    origin ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://lasuedintel.app');
  return `${baseOrigin.replace(/\/+$/, '')}/?view=upcoming-events&eventId=${safeId}`;
}

export function sanitizeEventIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export type EventNotificationKind = 'new' | 'update' | 'cancelled' | 'announcement';

export function buildEventNotificationDocId(
  kind: EventNotificationKind,
  eventId: string,
  recipientUid: string,
  versionBucket?: number
): string {
  const safeEvt = sanitizeEventIdSegment(eventId).slice(0, 40);
  const safeUid = sanitizeEventIdSegment(recipientUid).slice(0, 48);
  if (kind === 'new') {
    return `evt_new_${safeEvt}_${safeUid}`.slice(0, 128);
  }
  const bucket = Math.floor(versionBucket ?? Date.now() / (60 * 1000));
  return `evt_${kind}_${safeEvt}_${bucket}_${safeUid}`.slice(0, 128);
}

export function canSendNewEventNotice(
  evt: Pick<
    CampusEvent,
    'published' | 'status' | 'eventDate' | 'endDate' | 'notifiedNewAt'
  >,
  nowMs: number = Date.now()
): boolean {
  if (!isCampusEventPublished(evt)) return false;
  if (evt.status === 'cancelled') return false;
  const life = resolveEventLifecycle(evt, nowMs);
  if (life.state === 'completed') return false;
  return !evt.notifiedNewAt;
}

export function getEventCoverDirectOrImageId(
  evt: Pick<CampusEvent, 'mediaItems' | 'bannerUrl'>
): { imageId: string | null; bannerUrl: string | null } {
  const firstMediaId =
    Array.isArray(evt.mediaItems) && evt.mediaItems.length > 0
      ? evt.mediaItems[0].imageId
      : null;
  const safeBanner = getSafeEventUrl(evt.bannerUrl);
  return {
    imageId: firstMediaId,
    bannerUrl: safeBanner,
  };
}

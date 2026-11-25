const SESSION_VIEW_CACHE = new Set<string>();
const VIEW_STORAGE_KEY_PREFIX = 'lasued_post_views_v1:';
const GUEST_VISITOR_ID_STORAGE_KEY = 'lasued_guest_visitor_id_v1';
const GUEST_VISITOR_ID_PATTERN = /^guest_[a-zA-Z0-9_-]{8,58}$/;
const VIEW_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const POST_VIEW_MIN_INTERSECTION_RATIO = 0.4;
export const POST_VIEW_MIN_DWELL_MS = 1200;
export const POST_VIEW_RATE_LIMIT_MAX_EVENTS = 15;
export const POST_VIEW_RATE_LIMIT_WINDOW_MS = 60_000;

export type PostViewTargetCollection = 'posts' | 'anonymousPosts' | 'updates';

let inMemoryGuestVisitorId: string | null = null;
const recentViewTimestampsMs: number[] = [];

export function isLikelyAutomatedBrowser(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean((navigator as { webdriver?: boolean }).webdriver)
  );
}

function pruneExpiredViewTimestamps(nowMs: number): void {
  const cutoff = nowMs - POST_VIEW_RATE_LIMIT_WINDOW_MS;
  while (recentViewTimestampsMs.length > 0 && recentViewTimestampsMs[0] <= cutoff) {
    recentViewTimestampsMs.shift();
  }
}

export function canRecordPostViewWithinRateLimit(
  nowMs: number = Date.now()
): boolean {
  pruneExpiredViewTimestamps(nowMs);
  return recentViewTimestampsMs.length < POST_VIEW_RATE_LIMIT_MAX_EVENTS;
}

export function recordPostViewTimestamp(nowMs: number = Date.now()): void {
  pruneExpiredViewTimestamps(nowMs);
  recentViewTimestampsMs.push(nowMs);
}

export function resetPostViewRateLimiter(): void {
  recentViewTimestampsMs.length = 0;
}

function generateGuestVisitorId(): string {
  try {
    if (
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      const compact = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      if (compact.length >= 12) {
        return `guest_${compact}`;
      }
    }
  } catch {
    // Fallback below
  }
  const timePart = Date.now().toString(36);
  const randA = Math.random().toString(36).slice(2, 12);
  const randB = Math.random().toString(36).slice(2, 12);
  return `guest_${timePart}${randA}${randB}`.slice(0, 48);
}

export function getOrCreateGuestVisitorId(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const existing = window.localStorage.getItem(GUEST_VISITOR_ID_STORAGE_KEY);
      if (existing && GUEST_VISITOR_ID_PATTERN.test(existing)) {
        inMemoryGuestVisitorId = existing;
        return existing;
      }
      const created =
        inMemoryGuestVisitorId &&
        GUEST_VISITOR_ID_PATTERN.test(inMemoryGuestVisitorId)
          ? inMemoryGuestVisitorId
          : generateGuestVisitorId();
      inMemoryGuestVisitorId = created;
      window.localStorage.setItem(GUEST_VISITOR_ID_STORAGE_KEY, created);
      return created;
    } catch {
      // Ignore storage failures in restricted browser modes
    }
  }

  if (
    !inMemoryGuestVisitorId ||
    !GUEST_VISITOR_ID_PATTERN.test(inMemoryGuestVisitorId)
  ) {
    inMemoryGuestVisitorId = generateGuestVisitorId();
  }
  return inMemoryGuestVisitorId;
}

export function resolveActiveViewActor(
  viewerUid: string | null | undefined
): {
  actorType: 'user' | 'guest';
  actorId: string;
  dedupKey: string;
} {
  const cleanUid = typeof viewerUid === 'string' ? viewerUid.trim() : '';
  if (cleanUid) {
    return {
      actorType: 'user',
      actorId: cleanUid,
      dedupKey: cleanUid,
    };
  }
  const guestId = getOrCreateGuestVisitorId();
  return {
    actorType: 'guest',
    actorId: guestId,
    dedupKey: guestId,
  };
}

export function formatCompactViewCount(count: number | null | undefined): string {
  const safe =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : 0;

  if (safe === 1) {
    return '1 view';
  }
  if (safe < 1000) {
    return `${safe} views`;
  }
  if (safe < 1_000_000) {
    const k = safe / 1000;
    const formatted = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '');
    return `${formatted}K views`;
  }
  const m = safe / 1_000_000;
  const formatted = m >= 100 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, '');
  return `${formatted}M views`;
}

export function buildPostViewDocId(
  targetCollection: PostViewTargetCollection,
  postId: string,
  viewerOrVisitorId: string
): string {
  return `${targetCollection}_${postId.trim()}_${viewerOrVisitorId.trim()}`;
}

export function buildLocalPostViewKey(
  targetCollection: PostViewTargetCollection,
  postId: string,
  viewerKey: string
): string {
  return `${viewerKey}:${targetCollection}:${postId.trim()}`;
}

function readStoredViewMap(viewerKey: string): Record<string, number> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(`${VIEW_STORAGE_KEY_PREFIX}${viewerKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, number> = {};
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && now - v < VIEW_DEDUP_WINDOW_MS) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function hasRecordedPostViewLocally(
  targetCollection: PostViewTargetCollection,
  postId: string,
  viewerKey: string,
  nowMs: number = Date.now()
): boolean {
  const key = buildLocalPostViewKey(targetCollection, postId, viewerKey);
  if (SESSION_VIEW_CACHE.has(key)) {
    return true;
  }
  const map = readStoredViewMap(viewerKey);
  const ts = map[`${targetCollection}:${postId.trim()}`];
  return typeof ts === 'number' && nowMs - ts < VIEW_DEDUP_WINDOW_MS;
}

export function markPostViewLocally(
  targetCollection: PostViewTargetCollection,
  postId: string,
  viewerKey: string,
  nowMs: number = Date.now()
): void {
  const key = buildLocalPostViewKey(targetCollection, postId, viewerKey);
  SESSION_VIEW_CACHE.add(key);

  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const map = readStoredViewMap(viewerKey);
    map[`${targetCollection}:${postId.trim()}`] = nowMs;
    // Keep storage bounded to recent 250 viewed posts
    const entries = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 250);
    window.localStorage.setItem(
      `${VIEW_STORAGE_KEY_PREFIX}${viewerKey}`,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // Ignore private mode / storage quota issues
  }
}

export function clearPostViewSessionCache(): void {
  SESSION_VIEW_CACHE.clear();
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(VIEW_STORAGE_KEY_PREFIX)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Non-blocking
  }
}

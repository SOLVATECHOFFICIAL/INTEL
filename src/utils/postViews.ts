const SESSION_VIEW_CACHE = new Set<string>();
const VIEW_STORAGE_KEY_PREFIX = 'lasued_post_views_v1:';
const VIEW_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  targetCollection: 'posts' | 'anonymousPosts',
  postId: string,
  viewerUid: string
): string {
  return `${targetCollection}_${postId.trim()}_${viewerUid.trim()}`;
}

export function buildLocalPostViewKey(
  targetCollection: 'posts' | 'anonymousPosts',
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
  targetCollection: 'posts' | 'anonymousPosts',
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
  targetCollection: 'posts' | 'anonymousPosts',
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

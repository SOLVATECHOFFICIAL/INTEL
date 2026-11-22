import { isValidFirestoreId } from '../types/database';

export type MediaCacheScope = 'public' | 'private';

export interface MediaCacheKeyOptions {
  scope?: MediaCacheScope;
  viewerUid?: string | null;
}

/**
 * Builds an isolated cache key so viewer-private media can never collide with
 * public cache entries or another signed-in user's cached assets.
 */
export function buildScopedMediaCacheKey(
  imageId: string,
  options: MediaCacheKeyOptions = {}
): string | null {
  if (!isValidFirestoreId(imageId)) return null;
  const scope = options.scope ?? 'public';
  if (scope === 'private') {
    const uid = options.viewerUid?.trim() ?? '';
    if (!uid || !isValidFirestoreId(uid)) {
      return null;
    }
    return `priv:v1:${uid}:${imageId}`;
  }
  return `pub:v1:${imageId}`;
}

interface LruEntry {
  value: string;
  byteWeight: number;
}

/**
 * Bounded in-memory LRU cache enforcing both entry count and decoded byte budget
 * so long feed/profile browsing stays snappy without exhausting mobile RAM.
 */
export class MediaMemoryLru {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly map = new Map<string, LruEntry>();
  private totalBytes = 0;

  constructor(maxEntries = 250, maxBytes = 24 * 1024 * 1024) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(1024, maxBytes);
  }

  get(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    // Refresh LRU recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: string): void {
    if (!key || !value) return;
    const byteWeight = value.length * 2;
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.byteWeight;
      this.map.delete(key);
    }

    // Never allow a single oversized item beyond total cache budget to wipe everything
    if (byteWeight > this.maxBytes) {
      return;
    }

    this.map.set(key, { value, byteWeight });
    this.totalBytes += byteWeight;

    while (
      this.map.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.map.entries().next().value as
        | [string, LruEntry]
        | undefined;
      if (!oldest) break;
      this.map.delete(oldest[0]);
      this.totalBytes = Math.max(0, this.totalBytes - oldest[1].byteWeight);
    }
  }

  delete(key: string): boolean {
    const existing = this.map.get(key);
    if (!existing) return false;
    this.totalBytes = Math.max(0, this.totalBytes - existing.byteWeight);
    return this.map.delete(key);
  }

  deleteMatching(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of Array.from(this.map.keys())) {
      if (predicate(key)) {
        if (this.delete(key)) removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  stats(): { entries: number; totalBytes: number } {
    return { entries: this.map.size, totalBytes: this.totalBytes };
  }
}

export function computeFileSelectionFingerprint(candidate: {
  name?: string;
  size?: number;
  lastModified?: number;
}): string {
  const safeName = (candidate.name ?? '').trim().toLowerCase();
  const safeSize = Math.max(0, Math.round(candidate.size ?? 0));
  const safeMod = Math.max(0, Math.round(candidate.lastModified ?? 0));
  return `${safeName}|${safeSize}|${safeMod}`;
}

export function partitionDuplicateSelectedFiles<
  T extends { name?: string; size?: number; lastModified?: number },
>(
  incoming: readonly T[],
  existingFingerprints: ReadonlySet<string>
): { unique: T[]; duplicateCount: number } {
  const seen = new Set(existingFingerprints);
  const unique: T[] = [];
  let duplicateCount = 0;

  for (const file of incoming) {
    const fp = computeFileSelectionFingerprint(file);
    if (seen.has(fp)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fp);
    unique.push(file);
  }

  return { unique, duplicateCount };
}

export function reorderArrayItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

interface NetworkInfoLike {
  saveData?: boolean;
  effectiveType?: string;
}

export function isDataSaverConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (
    navigator as Navigator & { connection?: NetworkInfoLike }
  ).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return (
    conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g'
  );
}

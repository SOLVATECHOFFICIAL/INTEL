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

export function estimateMediaEntryByteWeight(
  value: string,
  explicitByteWeight?: number
): number {
  if (
    typeof explicitByteWeight === 'number' &&
    Number.isFinite(explicitByteWeight) &&
    explicitByteWeight > 0
  ) {
    return Math.round(explicitByteWeight);
  }
  return value.length * 2;
}

/**
 * Decodes a compressed image data URL into raw binary bytes and MIME type so
 * Cache API and IndexedDB can store compact Blobs without UTF-16 string bloat.
 */
export function parseImageDataUrlToBinary(dataUrl: string): {
  mimeType: string;
  bytes: Uint8Array;
} | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return null;
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx <= 5) return null;
  const header = dataUrl.slice(5, commaIdx);
  if (!header.includes(';base64')) return null;
  const mimeType = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mimeType.startsWith('image/')) return null;
  const base64 = dataUrl.slice(commaIdx + 1).trim();
  if (!base64) return null;

  try {
    const cleanBase64 = base64.replace(/\s+/g, '');
    if (typeof atob === 'function') {
      const bin = atob(cleanBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
      }
      return { mimeType, bytes };
    }
    const maybeBuffer = (
      globalThis as unknown as {
        Buffer?: { from(input: string, enc: string): Uint8Array };
      }
    ).Buffer;
    if (maybeBuffer) {
      return { mimeType, bytes: new Uint8Array(maybeBuffer.from(cleanBase64, 'base64')) };
    }
  } catch {
    return null;
  }
  return null;
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
  private readonly onEvict?: (key: string, value: string) => void;
  private readonly map = new Map<string, LruEntry>();
  private totalBytes = 0;

  constructor(
    maxEntries = 250,
    maxBytes = 24 * 1024 * 1024,
    onEvict?: (key: string, value: string) => void
  ) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(1024, maxBytes);
    this.onEvict = onEvict;
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

  set(key: string, value: string, explicitByteWeight?: number): void {
    if (!key || !value) return;
    const byteWeight = estimateMediaEntryByteWeight(value, explicitByteWeight);
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.byteWeight;
      this.map.delete(key);
      if (existing.value !== value) {
        this.onEvict?.(key, existing.value);
      }
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
      this.onEvict?.(oldest[0], oldest[1].value);
    }
  }

  delete(key: string): boolean {
    const existing = this.map.get(key);
    if (!existing) return false;
    this.totalBytes = Math.max(0, this.totalBytes - existing.byteWeight);
    const removed = this.map.delete(key);
    if (removed) {
      this.onEvict?.(key, existing.value);
    }
    return removed;
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
    if (this.onEvict) {
      for (const [key, entry] of Array.from(this.map.entries())) {
        this.onEvict(key, entry.value);
      }
    }
    this.map.clear();
    this.totalBytes = 0;
  }

  stats(): { entries: number; totalBytes: number } {
    return { entries: this.map.size, totalBytes: this.totalBytes };
  }
}

export interface ProfilePreloadSelectionInput {
  coverImageId?: string | null;
  photoImageId?: string | null;
  posts?: ReadonlyArray<{
    mediaItems?: ReadonlyArray<{ imageId?: string | null; order?: number }>;
  }>;
  likedPosts?: ReadonlyArray<{
    post?: {
      mediaItems?: ReadonlyArray<{ imageId?: string | null; order?: number }>;
    };
  }>;
  listings?: ReadonlyArray<{
    mediaItems?: ReadonlyArray<{ imageId?: string | null; order?: number }>;
  }>;
  isDataSaver?: boolean;
  maxTotal?: number;
}

/**
 * Selects prioritized, deduplicated image IDs for background preloading when a
 * member profile opens:
 * - highPriority: cover banner, avatar, and first visible post thumbnails
 * - normalPriority: nearby post gallery frames and initial liked/listing photos
 */
export function selectProfilePreloadTargets(
  input: ProfilePreloadSelectionInput
): { highPriority: string[]; normalPriority: string[] } {
  const cap = input.isDataSaver
    ? Math.min(4, input.maxTotal ?? 4)
    : Math.max(1, input.maxTotal ?? 14);
  const seen = new Set<string>();
  const highPriority: string[] = [];
  const normalPriority: string[] = [];

  const pushUnique = (target: string[], rawId?: string | null): boolean => {
    if (highPriority.length + normalPriority.length >= cap) return false;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || !isValidFirestoreId(id) || seen.has(id)) return false;
    seen.add(id);
    target.push(id);
    return true;
  };

  pushUnique(highPriority, input.coverImageId);
  pushUnique(highPriority, input.photoImageId);

  const posts = input.posts ?? [];
  for (let i = 0; i < posts.length; i += 1) {
    const media = [...(posts[i].mediaItems ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    const lead = media[0]?.imageId;
    if (i < 3) {
      pushUnique(highPriority, lead);
    } else if (i < 8) {
      pushUnique(normalPriority, lead);
    }
  }

  // Preload secondary frames for top multi-photo posts so lightbox swipe is instant
  if (!input.isDataSaver) {
    for (const post of posts.slice(0, 3)) {
      const media = [...(post.mediaItems ?? [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      for (const frame of media.slice(1, 4)) {
        pushUnique(normalPriority, frame.imageId);
      }
    }

    for (const entry of (input.likedPosts ?? []).slice(0, 4)) {
      const lead = entry.post?.mediaItems?.[0]?.imageId;
      pushUnique(normalPriority, lead);
    }

    for (const listing of (input.listings ?? []).slice(0, 4)) {
      const lead = listing.mediaItems?.[0]?.imageId;
      pushUnique(normalPriority, lead);
    }
  }

  return { highPriority, normalPriority };
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

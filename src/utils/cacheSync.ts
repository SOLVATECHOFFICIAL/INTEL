import type {
  AnonymousPost,
  CommunityPost,
  PublicProfileProjection,
} from '../types/database';
import { extractTimestampMs } from './contextualSearch';

export interface PostWithAuthorLike {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export interface TimestampedRecordLike {
  updatedAt?: unknown;
  createdAt?: unknown;
}

/**
 * Security boundary: collections that contain moderation/identity/audit data
 * must NEVER be stored in shared or persistent browser caches.
 */
export const ADMIN_ONLY_CACHE_PREFIXES = [
  'adminAuditLogs',
  'badgeAuditLogs',
  'anonymousIdentityMappings',
  'anonymousReports',
  'admin:',
] as const;

export function isPersistableCacheKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) return false;
  return !ADMIN_ONLY_CACHE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function serializeSet(values: ReadonlySet<string>): string[] {
  return Array.from(values);
}

export function deserializeSet(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
  );
}

export function areSetsEqual(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function reuseSetIfUnchanged(
  prev: Set<string>,
  next: Set<string>
): Set<string> {
  return areSetsEqual(prev, next) ? prev : next;
}

export function serializeRecordMap<V>(
  map: ReadonlyMap<string, V>
): Array<[string, V]> {
  return Array.from(map.entries());
}

export function deserializeRecordMap<V>(raw: unknown): Map<string, V> {
  if (!Array.isArray(raw)) return new Map();
  const result = new Map<string, V>();
  for (const entry of raw) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      entry[0].length > 0
    ) {
      result.set(entry[0], entry[1] as V);
    }
  }
  return result;
}

/**
 * Strips non-serializable Firestore QueryDocumentSnapshot cursors before writing
 * persistent snapshots while preserving offset pagination cursors.
 */
export function stripFirestoreCursor<C extends { mode: string }>(
  cursor: C | null | undefined
): { mode: 'offset'; offset: number } | null {
  if (!cursor) return null;
  if (
    cursor.mode === 'offset' &&
    'offset' in cursor &&
    typeof (cursor as { offset?: unknown }).offset === 'number'
  ) {
    return { mode: 'offset', offset: (cursor as { offset: number }).offset };
  }
  return null;
}

const DISALLOWED_ANONYMOUS_FIELDS = new Set([
  'ownerUID',
  'ownerUid',
  'authorUid',
  'authorUID',
  'uid',
  'email',
  'authorEmail',
  'ownerEmail',
]);

/**
 * Guarantees anonymous feed posts cached in RAM or IndexedDB never carry
 * accidental author identity fields.
 */
export function sanitizeAnonymousPostForCache(
  post: AnonymousPost
): AnonymousPost {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    post as unknown as Record<string, unknown>
  )) {
    if (!DISALLOWED_ANONYMOUS_FIELDS.has(key)) {
      clean[key] = value;
    }
  }
  return clean as unknown as AnonymousPost;
}

export function sanitizeAnonymousPostsForCache(
  posts: readonly AnonymousPost[]
): AnonymousPost[] {
  return posts.map(sanitizeAnonymousPostForCache);
}

export function getRecordTimestampMs(
  record: TimestampedRecordLike | null | undefined
): number {
  if (!record) return 0;
  const updatedMs = extractTimestampMs(record.updatedAt);
  if (updatedMs !== null) return updatedMs;
  const createdMs = extractTimestampMs(record.createdAt);
  return createdMs ?? 0;
}

export function isNewerOrSameTimestamp(
  incoming: TimestampedRecordLike | null | undefined,
  existing: TimestampedRecordLike | null | undefined
): boolean {
  const existingMs = getRecordTimestampMs(existing);
  if (existingMs === 0) return true;
  const incomingMs = getRecordTimestampMs(incoming);
  if (incomingMs === 0) return true;
  return incomingMs >= existingMs;
}

function areShallowFieldsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    if (
      key === 'createdAt' ||
      key === 'updatedAt' ||
      key === 'expiresAt' ||
      key === 'eventDate' ||
      key === 'endDate' ||
      key === 'opensAt'
    ) {
      if (extractTimestampMs(av) === extractTimestampMs(bv)) continue;
      return false;
    }
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length) return false;
      if (JSON.stringify(av) === JSON.stringify(bv)) continue;
      return false;
    }
    return false;
  }
  return true;
}

export function pickFresherRecordPreservingRef<
  T extends TimestampedRecordLike,
>(existing: T, incoming: T): T {
  if (!isNewerOrSameTimestamp(incoming, existing)) {
    return existing;
  }
  if (
    areShallowFieldsEqual(
      existing as unknown as Record<string, unknown>,
      incoming as unknown as Record<string, unknown>
    )
  ) {
    return existing;
  }
  return incoming;
}

function areAuthorProjectionsEqual(
  a: PublicProfileProjection | null,
  b: PublicProfileProjection | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.username === b.username &&
    a.fullName === b.fullName &&
    a.badge === b.badge &&
    a.photoUrl === b.photoUrl &&
    a.photoImageId === b.photoImageId &&
    a.accountStatus === b.accountStatus
  );
}

/**
 * Merges incoming community feed posts with cached/loaded posts without
 * introducing duplicate IDs, discarding older paginated pages, or mutating
 * referential identity of unchanged items (keeping React.memo fast).
 */
export function mergeCommunityPostItems<T extends PostWithAuthorLike>(input: {
  existing: readonly T[];
  incoming: readonly T[];
  preferIncomingOrder?: boolean;
  preserveTail?: boolean;
}): T[] {
  const {
    existing,
    incoming,
    preferIncomingOrder = false,
    preserveTail = true,
  } = input;

  if (existing.length === 0) {
    const deduped: T[] = [];
    const seen = new Set<string>();
    for (const item of incoming) {
      if (seen.has(item.post.id)) continue;
      seen.add(item.post.id);
      deduped.push(item);
    }
    return deduped;
  }

  const existingById = new Map<string, T>();
  for (const item of existing) {
    if (!existingById.has(item.post.id)) {
      existingById.set(item.post.id, item);
    }
  }

  const incomingById = new Map<string, T>();
  let minIncomingCreatedAt = 0;
  for (const item of incoming) {
    if (!incomingById.has(item.post.id)) {
      incomingById.set(item.post.id, item);
      const ts =
        extractTimestampMs(item.post.createdAt) ??
        getRecordTimestampMs(item.post);
      if (ts > 0) {
        minIncomingCreatedAt =
          minIncomingCreatedAt === 0 ? ts : Math.min(minIncomingCreatedAt, ts);
      }
    }
  }

  let lastMatchedExistingIndex = -1;
  for (let i = 0; i < existing.length; i += 1) {
    if (incomingById.has(existing[i].post.id)) {
      lastMatchedExistingIndex = i;
    }
  }

  const shouldKeepMissingTailItem = (prev: T, prevIndex: number): boolean => {
    if (!preserveTail) return false;
    if (incoming.length === 0) return false;
    if (prevIndex < lastMatchedExistingIndex) return false;
    if (minIncomingCreatedAt > 0) {
      const prevCreatedAt =
        extractTimestampMs(prev.post.createdAt) ??
        getRecordTimestampMs(prev.post);
      if (prevCreatedAt > minIncomingCreatedAt) return false;
    }
    return true;
  };

  const resolveMergedEntry = (prev: T, next: T): T => {
    const fresherPost = pickFresherRecordPreservingRef(prev.post, next.post);
    const sameAuthor = areAuthorProjectionsEqual(prev.author, next.author);
    if (fresherPost === prev.post && sameAuthor) {
      return prev;
    }
    return {
      ...next,
      post: fresherPost,
      author: sameAuthor ? prev.author : next.author,
    };
  };

  const result: T[] = [];
  const emitted = new Set<string>();

  if (preferIncomingOrder) {
    for (const next of incoming) {
      if (emitted.has(next.post.id)) continue;
      emitted.add(next.post.id);
      const prev = existingById.get(next.post.id);
      result.push(prev ? resolveMergedEntry(prev, next) : next);
    }
    if (preserveTail) {
      for (let i = 0; i < existing.length; i += 1) {
        const prev = existing[i];
        if (emitted.has(prev.post.id)) continue;
        if (!shouldKeepMissingTailItem(prev, i)) continue;
        emitted.add(prev.post.id);
        result.push(prev);
      }
    }
    return result;
  }

  // Head-delta preservation mode: prepend truly new incoming posts at top,
  // update existing items in place without reordering items the user is viewing,
  // and prune items removed from the refreshed window.
  for (const next of incoming) {
    if (existingById.has(next.post.id) || emitted.has(next.post.id)) continue;
    emitted.add(next.post.id);
    result.push(next);
  }
  for (let i = 0; i < existing.length; i += 1) {
    const prev = existing[i];
    if (emitted.has(prev.post.id)) continue;
    const next = incomingById.get(prev.post.id);
    if (!next && !shouldKeepMissingTailItem(prev, i)) continue;
    emitted.add(prev.post.id);
    result.push(next ? resolveMergedEntry(prev, next) : prev);
  }
  return result;
}

/**
 * Merges timestamped ID records (AnonymousPost, MarketplaceListing, CampusEvent,
 * Opportunity, TrustedContact, comments) without duplicates while preserving
 * referential identity for unchanged items.
 */
export function mergeOrderedRecords<
  T extends { id: string } & TimestampedRecordLike,
>(input: {
  existing: readonly T[];
  incoming: readonly T[];
  preferIncomingOrder?: boolean;
  preserveTail?: boolean;
}): T[] {
  const {
    existing,
    incoming,
    preferIncomingOrder = false,
    preserveTail = true,
  } = input;

  if (existing.length === 0) {
    const deduped: T[] = [];
    const seen = new Set<string>();
    for (const item of incoming) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    return deduped;
  }

  const existingById = new Map<string, T>();
  for (const item of existing) {
    if (!existingById.has(item.id)) {
      existingById.set(item.id, item);
    }
  }

  const incomingById = new Map<string, T>();
  let minIncomingCreatedAt = 0;
  for (const item of incoming) {
    if (!incomingById.has(item.id)) {
      incomingById.set(item.id, item);
      const ts =
        extractTimestampMs(item.createdAt) ?? getRecordTimestampMs(item);
      if (ts > 0) {
        minIncomingCreatedAt =
          minIncomingCreatedAt === 0 ? ts : Math.min(minIncomingCreatedAt, ts);
      }
    }
  }

  let lastMatchedExistingIndex = -1;
  for (let i = 0; i < existing.length; i += 1) {
    if (incomingById.has(existing[i].id)) {
      lastMatchedExistingIndex = i;
    }
  }

  const shouldKeepMissingTailItem = (prev: T, prevIndex: number): boolean => {
    if (!preserveTail) return false;
    if (incoming.length === 0) return false;
    if (prevIndex < lastMatchedExistingIndex) return false;
    if (minIncomingCreatedAt > 0) {
      const prevCreatedAt =
        extractTimestampMs(prev.createdAt) ?? getRecordTimestampMs(prev);
      if (prevCreatedAt > minIncomingCreatedAt) return false;
    }
    return true;
  };

  const result: T[] = [];
  const emitted = new Set<string>();

  if (preferIncomingOrder) {
    for (const next of incoming) {
      if (emitted.has(next.id)) continue;
      emitted.add(next.id);
      const prev = existingById.get(next.id);
      result.push(prev ? pickFresherRecordPreservingRef(prev, next) : next);
    }
    if (preserveTail) {
      for (let i = 0; i < existing.length; i += 1) {
        const prev = existing[i];
        if (emitted.has(prev.id)) continue;
        if (!shouldKeepMissingTailItem(prev, i)) continue;
        emitted.add(prev.id);
        result.push(prev);
      }
    }
    return result;
  }

  for (const next of incoming) {
    if (existingById.has(next.id) || emitted.has(next.id)) continue;
    emitted.add(next.id);
    result.push(next);
  }
  for (let i = 0; i < existing.length; i += 1) {
    const prev = existing[i];
    if (emitted.has(prev.id)) continue;
    const next = incomingById.get(prev.id);
    if (!next && !shouldKeepMissingTailItem(prev, i)) continue;
    emitted.add(prev.id);
    result.push(next ? pickFresherRecordPreservingRef(prev, next) : prev);
  }
  return result;
}

export function upsertItemById<T extends { id: string }>(
  items: readonly T[],
  nextItem: T,
  prependIfMissing = true
): T[] {
  let found = false;
  const updated = items.map((item) => {
    if (item.id !== nextItem.id) return item;
    found = true;
    return nextItem;
  });
  if (found) return updated;
  return prependIfMissing ? [nextItem, ...updated] : [...updated, nextItem];
}

export function removeItemById<T extends { id: string }>(
  items: readonly T[],
  targetId: string
): T[] {
  return items.filter((item) => item.id !== targetId);
}

/**
 * Safely subtracts a deleted post's likes from an aggregate likes counter,
 * clamping to zero and guarding against NaN/negative inputs.
 */
export function subtractPostLikesSafe(
  currentTotal: number,
  deletedLikes: number
): number {
  const safeTotal =
    typeof currentTotal === 'number' && Number.isFinite(currentTotal)
      ? Math.max(0, Math.floor(currentTotal))
      : 0;
  const safeDeleted =
    typeof deletedLikes === 'number' && Number.isFinite(deletedLikes)
      ? Math.max(0, Math.floor(deletedLikes))
      : 0;
  return Math.max(0, safeTotal - safeDeleted);
}

export interface AnchoredFeedMergeResult<T> {
  items: T[];
  insertedCount: number;
  insertionIndex: number;
}

/**
 * Merges an incoming live feed stream against the currently rendered stream:
 * - Near top (`!isScrolledMidFeed` or missing anchor): deduplicates incoming stream cleanly
 *   (or prepends unseen items when `fallbackPrependUnseen` is true).
 * - While scrolled mid-feed (`isScrolledMidFeed === true` and `anchorId` present):
 *   locks items `0..anchorIndex` in exact slot order (updating mutable counts in-place),
 *   drops unseen incoming items strictly at `anchorIndex + 1` (the user's next post slot),
 *   and preserves tail ordering below `anchorIndex + 1` with zero duplicates or top jump.
 */
export function mergeAnchoredFeedStream<T extends { id: string }>(input: {
  existing: readonly T[];
  incoming: readonly T[];
  anchorId?: string | null;
  isScrolledMidFeed?: boolean;
  fallbackPrependUnseen?: boolean;
  pruneMissing?: boolean;
  preserveMissingIds?: ReadonlySet<string>;
  resolveUpdatedItem?: (prev: T, next: T) => T;
}): AnchoredFeedMergeResult<T> {
  const {
    existing,
    incoming,
    anchorId,
    isScrolledMidFeed = false,
    fallbackPrependUnseen = false,
    pruneMissing = false,
    preserveMissingIds,
    resolveUpdatedItem,
  } = input;

  const dedupedIncoming: T[] = [];
  const incomingById = new Map<string, T>();
  for (const item of incoming) {
    if (!item || !item.id || incomingById.has(item.id)) continue;
    incomingById.set(item.id, item);
    dedupedIncoming.push(item);
  }

  if (existing.length === 0) {
    return {
      items: dedupedIncoming,
      insertedCount: dedupedIncoming.length,
      insertionIndex: 0,
    };
  }

  const mergePair = (prev: T, next: T | undefined): T => {
    if (!next) return prev;
    return resolveUpdatedItem ? resolveUpdatedItem(prev, next) : next;
  };

  const shouldKeepExisting = (prev: T): boolean => {
    if (!pruneMissing) return true;
    if (incomingById.has(prev.id)) return true;
    return Boolean(preserveMissingIds?.has(prev.id));
  };

  const dedupedExisting: T[] = [];
  const existingIds = new Set<string>();
  for (const item of existing) {
    if (!item || !item.id || existingIds.has(item.id)) continue;
    existingIds.add(item.id);
    dedupedExisting.push(item);
  }

  const unseenIncoming = dedupedIncoming.filter(
    (item) => !existingIds.has(item.id)
  );

  const anchorIndex =
    isScrolledMidFeed && anchorId
      ? dedupedExisting.findIndex((item) => item.id === anchorId)
      : -1;

  if (anchorIndex === -1) {
    if (fallbackPrependUnseen) {
      const keptExisting = dedupedExisting
        .filter(shouldKeepExisting)
        .map((prev) => mergePair(prev, incomingById.get(prev.id)));
      const merged = [...unseenIncoming, ...keptExisting];
      return {
        items: merged,
        insertedCount: unseenIncoming.length,
        insertionIndex: 0,
      };
    }

    const existingById = new Map(dedupedExisting.map((item) => [item.id, item]));
    const reordered = dedupedIncoming.map((next) => {
      const prev = existingById.get(next.id);
      return prev ? mergePair(prev, next) : next;
    });
    return {
      items: reordered,
      insertedCount: unseenIncoming.length,
      insertionIndex: 0,
    };
  }

  const prefix: T[] = [];
  for (let i = 0; i <= anchorIndex; i += 1) {
    const prev = dedupedExisting[i];
    if (!shouldKeepExisting(prev)) continue;
    prefix.push(mergePair(prev, incomingById.get(prev.id)));
  }

  const tail: T[] = [];
  for (let i = anchorIndex + 1; i < dedupedExisting.length; i += 1) {
    const prev = dedupedExisting[i];
    if (!shouldKeepExisting(prev)) continue;
    tail.push(mergePair(prev, incomingById.get(prev.id)));
  }

  return {
    items: [...prefix, ...unseenIncoming, ...tail],
    insertedCount: unseenIncoming.length,
    insertionIndex: prefix.length,
  };
}

export function patchAuthorProjectionInPostItems<T extends PostWithAuthorLike>(
  items: readonly T[],
  updatedProfile: PublicProfileProjection,
  targetOwnerUid?: string
): T[] {
  let changed = false;
  const targetUsername = updatedProfile.username.toLowerCase();
  const next = items.map((entry) => {
    const matchesTarget = targetOwnerUid
      ? entry.post.ownerUID === targetOwnerUid
      : entry.author?.username.toLowerCase() === targetUsername;
    if (!matchesTarget) return entry;
    if (areAuthorProjectionsEqual(entry.author, updatedProfile)) return entry;
    changed = true;
    return {
      ...entry,
      author: updatedProfile,
    };
  });
  return changed ? next : [...items];
}

export function patchAuthorProjectionInMap(
  map: Map<string, PublicProfileProjection>,
  updatedProfile: PublicProfileProjection,
  targetUid: string
): Map<string, PublicProfileProjection> {
  const existing = map.get(targetUid);
  if (!existing || areAuthorProjectionsEqual(existing, updatedProfile)) {
    return map;
  }
  const next = new Map(map);
  next.set(targetUid, updatedProfile);
  return next;
}

const VOLATILE_SIGNATURE_KEYS = new Set([
  'cachedAt',
  'lastAccessedAt',
  'docSnap',
]);

function hashMix(h: number, code: number): number {
  let x = h ^ (code & 0xffff);
  x = Math.imul(x, 0x01000193) >>> 0;
  x ^= (code >>> 16) & 0xffff;
  return Math.imul(x, 0x01000193) >>> 0;
}

/**
 * Computes a deterministic structural signature for cache payloads while
 * ignoring volatile metadata (`cachedAt`, `lastAccessedAt`, `docSnap`).
 * Used to skip redundant IndexedDB write transactions on 5s background polls.
 */
export function computeSnapshotSignature(value: unknown): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let nodes = 0;
  const seen = new WeakSet<object>();

  const feedStr = (str: string) => {
    h1 = hashMix(h1, str.length);
    h2 = hashMix(h2, str.length ^ 0x5555);
    for (let i = 0; i < str.length; i += 1) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
    }
  };

  const feedNum = (num: number) => {
    feedStr(Number.isFinite(num) ? String(num) : 'NaN');
  };

  const visit = (val: unknown) => {
    nodes += 1;
    if (val === null) {
      feedStr('null');
      return;
    }
    const t = typeof val;
    if (t === 'undefined') {
      feedStr('undef');
      return;
    }
    if (t === 'boolean') {
      feedStr(val ? 'T' : 'F');
      return;
    }
    if (t === 'number') {
      feedNum(val as number);
      return;
    }
    if (t === 'string') {
      feedStr(`s:${val as string}`);
      return;
    }
    if (t === 'bigint') {
      feedStr(`bi:${String(val)}`);
      return;
    }
    if (t !== 'object') {
      return;
    }

    const obj = val as object;
    if (obj instanceof Date) {
      feedStr(`D:${obj.getTime()}`);
      return;
    }
    if (seen.has(obj)) {
      feedStr('Circular');
      return;
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      feedStr(`A[${obj.length}]`);
      for (let i = 0; i < obj.length; i += 1) {
        visit(obj[i]);
      }
      return;
    }

    if (obj instanceof Set) {
      const sorted = Array.from(obj).map((item) => String(item)).sort();
      feedStr(`Set[${sorted.length}]`);
      for (const item of sorted) {
        feedStr(item);
      }
      return;
    }

    if (obj instanceof Map) {
      const keys = Array.from(obj.keys()).sort((a, b) =>
        String(a).localeCompare(String(b))
      );
      feedStr(`Map[${keys.length}]`);
      for (const k of keys) {
        visit(k);
        visit(obj.get(k));
      }
      return;
    }

    const rec = obj as Record<string, unknown>;
    if (typeof rec.toMillis === 'function') {
      try {
        feedStr(`Ts:${(rec as { toMillis: () => number }).toMillis()}`);
        return;
      } catch {
        // Fall through to key inspection
      }
    }
    if (typeof rec.seconds === 'number' && typeof rec.nanoseconds === 'number') {
      feedStr(`Ts:${rec.seconds}.${rec.nanoseconds}`);
      return;
    }

    const keys = Object.keys(rec)
      .filter((k) => !VOLATILE_SIGNATURE_KEYS.has(k) && rec[k] !== undefined && typeof rec[k] !== 'function')
      .sort();
    feedStr(`O{${keys.length}}`);
    for (const key of keys) {
      feedStr(key);
      visit(rec[key]);
    }
  };

  visit(value);
  return `${h1.toString(36)}:${h2.toString(36)}:${nodes.toString(36)}`;
}

/**
 * Coalesces concurrent identical fetch calls into a single shared Promise
 * so navigating back/forth or switching tabs never fires duplicate network work.
 */
export class SingleFlightRegistry {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = Promise.resolve()
      .then(fetcher)
      .finally(() => {
        if (this.pending.get(key) === promise) {
          this.pending.delete(key);
        }
      });

    this.pending.set(key, promise);
    return promise;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  size(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}

/**
 * Bounded LRU map for in-memory author projections & metadata caches.
 */
export class BoundedLruMap<K, V> {
  private readonly maxEntries: number;
  private readonly map = new Map<K, V>();

  constructor(maxEntries = 250) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

export function isConstrainedDeviceOrNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };
  if (nav.connection?.saveData) return true;
  const eff = nav.connection?.effectiveType;
  if (eff === 'slow-2g' || eff === '2g') return true;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return true;
  if (
    typeof nav.hardwareConcurrency === 'number' &&
    nav.hardwareConcurrency > 0 &&
    nav.hardwareConcurrency <= 2
  ) {
    return true;
  }
  return false;
}

export interface ActivePollDelayInput {
  isVisible: boolean;
  isOnline: boolean;
  isDataSaver?: boolean;
  isConstrainedDevice?: boolean;
  consecutiveErrors?: number;
  baseIntervalMs?: number;
}

/**
 * Computes next background poll delay (~5s active polling).
 * Returns null when tab is hidden or browser is offline so polling pauses cleanly.
 */
export function computeActivePollDelayMs(
  input: ActivePollDelayInput
): number | null {
  if (!input.isVisible || !input.isOnline) {
    return null;
  }
  const base = Math.max(1000, input.baseIntervalMs ?? 5000);
  const effectiveBase = input.isDataSaver
    ? Math.max(base * 2, 12000)
    : input.isConstrainedDevice
      ? Math.max(base * 2, 10000)
      : base;
  const errors = Math.max(0, Math.floor(input.consecutiveErrors ?? 0));
  if (errors === 0) {
    return effectiveBase;
  }
  return Math.min(30000, effectiveBase * Math.pow(2, Math.min(errors, 3)));
}

export interface PerfMetricAreaStats {
  hits: number;
  misses: number;
  loads: number;
  avgMs: number;
  lastMs: number;
}

class InternalPerformanceMetrics {
  private readonly stats = new Map<
    string,
    { hits: number; misses: number; loads: number; totalMs: number; lastMs: number }
  >();

  private ensure(area: string) {
    let entry = this.stats.get(area);
    if (!entry) {
      entry = { hits: 0, misses: 0, loads: 0, totalMs: 0, lastMs: 0 };
      this.stats.set(area, entry);
      if (this.stats.size > 64) {
        const oldest = this.stats.keys().next().value as string | undefined;
        if (oldest) this.stats.delete(oldest);
      }
    }
    return entry;
  }

  recordHit(area: string): void {
    this.ensure(area).hits += 1;
  }

  recordMiss(area: string): void {
    this.ensure(area).misses += 1;
  }

  recordTiming(area: string, durationMs: number): void {
    const safeMs = Math.max(0, Math.round(durationMs));
    const entry = this.ensure(area);
    entry.loads += 1;
    entry.totalMs += safeMs;
    entry.lastMs = safeMs;
  }

  getSummary(): Record<string, PerfMetricAreaStats> {
    const summary: Record<string, PerfMetricAreaStats> = {};
    for (const [area, entry] of this.stats.entries()) {
      summary[area] = {
        hits: entry.hits,
        misses: entry.misses,
        loads: entry.loads,
        avgMs: entry.loads > 0 ? Math.round(entry.totalMs / entry.loads) : 0,
        lastMs: entry.lastMs,
      };
    }
    return summary;
  }

  reset(): void {
    this.stats.clear();
  }
}

export const perfMetrics = new InternalPerformanceMetrics();

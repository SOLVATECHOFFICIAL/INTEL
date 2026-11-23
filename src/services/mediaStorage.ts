import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type UpdateData,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  COLLECTION_NAMES,
  isValidFirestoreId,
  validateMediaImagePayload,
  type MediaImage,
  type MediaTargetCollection,
  type PublicUserProfile,
} from '../types/database';
import {
  deletePersistentMediaByPredicate,
  readPersistentMediaRecord,
  writePersistentMediaRecord,
} from './persistentCache';
import { notifyProfileUpdated } from './cacheInvalidation';
import { perfMetrics } from '../utils/cacheSync';
import { runWithFirestoreConnectionRetry } from '../utils/firestoreRetry';
import {
  buildMediaDataUrl,
  type CompressedImageResult,
} from '../utils/imageCompression';
import {
  MediaMemoryLru,
  buildScopedMediaCacheKey,
  isDataSaverConnection,
  type MediaCacheKeyOptions,
} from '../utils/mediaCache';

const PERSISTENT_CACHE_NAME = 'lasued-intel-media-v1';
const PERSISTENT_CACHE_ORIGIN = 'https://media-cache.lasuedintel.local/asset/';
const PERSISTENT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_CACHE_MAX_ENTRIES = 160;

const l1MediaCache = new MediaMemoryLru(250, 24 * 1024 * 1024);
const inFlightMediaRequests = new Map<string, Promise<string | null>>();
const recentlyDeletedImageIds = new Map<string, number>();

export interface UploadProgressState {
  percent: number;
  label: string;
}

export function generateFirestoreDocId(
  collectionName: string = COLLECTION_NAMES.mediaImages
): string {
  return doc(collection(db, collectionName)).id;
}

function makePersistentRequestUrl(cacheKey: string): string {
  return `${PERSISTENT_CACHE_ORIGIN}${encodeURIComponent(cacheKey)}`;
}

async function openPersistentMediaCache(): Promise<Cache | null> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') {
    return null;
  }
  try {
    return await caches.open(PERSISTENT_CACHE_NAME);
  } catch {
    return null;
  }
}

async function pruneCacheApiEntries(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= PERSISTENT_CACHE_MAX_ENTRIES) return;
    const excessCount = keys.length - PERSISTENT_CACHE_MAX_ENTRIES;
    for (let i = 0; i < excessCount; i += 1) {
      await cache.delete(keys[i]).catch(() => false);
    }
  } catch {
    // Non-blocking cleanup
  }
}

async function readPersistentMediaCache(
  cacheKey: string
): Promise<string | null> {
  const cache = await openPersistentMediaCache();
  if (cache) {
    const reqUrl = makePersistentRequestUrl(cacheKey);
    try {
      const response = await cache.match(reqUrl);
      if (response) {
        const cachedAt = Number(response.headers.get('X-Cached-At') ?? '0');
        if (
          cachedAt > 0 &&
          Date.now() - cachedAt > PERSISTENT_CACHE_MAX_AGE_MS
        ) {
          await cache.delete(reqUrl).catch(() => false);
        } else {
          const text = await response.text();
          if (text.startsWith('data:image/')) {
            perfMetrics.recordHit('media_l2_cache_api');
            return text;
          }
          await cache.delete(reqUrl).catch(() => false);
        }
      }
    } catch {
      // Fall through to IndexedDB fallback
    }
  }

  const idbHit = await readPersistentMediaRecord(cacheKey);
  if (idbHit) {
    perfMetrics.recordHit('media_l2_idb');
  } else {
    perfMetrics.recordMiss('media_l2');
  }
  return idbHit;
}

async function writePersistentMediaCache(
  cacheKey: string,
  dataUrl: string
): Promise<void> {
  const cache = await openPersistentMediaCache();
  if (cache) {
    const reqUrl = makePersistentRequestUrl(cacheKey);
    try {
      const response = new Response(dataUrl, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Cached-At': String(Date.now()),
        },
      });
      await cache.put(reqUrl, response);
      void pruneCacheApiEntries(cache);
      return;
    } catch {
      // Fallback to IndexedDB on Cache API quota/restriction error
    }
  }
  await writePersistentMediaRecord(cacheKey, dataUrl);
}

async function deletePersistentMediaEntriesByPredicate(
  predicate: (cacheKey: string) => boolean
): Promise<void> {
  void deletePersistentMediaByPredicate(predicate);
  const cache = await openPersistentMediaCache();
  if (!cache) return;
  try {
    const keys = await cache.keys();
    await Promise.all(
      keys.map(async (request) => {
        if (!request.url.startsWith(PERSISTENT_CACHE_ORIGIN)) return;
        const encodedKey = request.url.slice(PERSISTENT_CACHE_ORIGIN.length);
        const decodedKey = decodeURIComponent(encodedKey);
        if (predicate(decodedKey)) {
          await cache.delete(request).catch(() => false);
        }
      })
    );
  } catch {
    // Ignore persistent cache cleanup errors
  }
}

function isMarkedDeleted(imageId: string): boolean {
  const ts = recentlyDeletedImageIds.get(imageId);
  if (!ts) return false;
  if (Date.now() - ts > 60_000) {
    recentlyDeletedImageIds.delete(imageId);
    return false;
  }
  return true;
}

export function getCachedMediaImageDataUrl(
  imageId: string,
  options?: MediaCacheKeyOptions
): string | null {
  if (!isValidFirestoreId(imageId) || isMarkedDeleted(imageId)) return null;
  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) return null;
  const hit = l1MediaCache.get(scopedKey);
  if (hit) {
    perfMetrics.recordHit('media_l1');
  }
  return hit;
}

export function primeMediaImageCache(
  imageId: string,
  dataUrl: string,
  options?: MediaCacheKeyOptions
): void {
  if (!isValidFirestoreId(imageId) || !dataUrl) return;
  recentlyDeletedImageIds.delete(imageId);
  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) return;
  l1MediaCache.set(scopedKey, dataUrl);
  void writePersistentMediaCache(scopedKey, dataUrl);
}

export function evictMediaImageCache(imageId: string): void {
  if (!imageId) return;
  recentlyDeletedImageIds.set(imageId, Date.now());
  l1MediaCache.deleteMatching(
    (key) => key === `pub:v1:${imageId}` || key.endsWith(`:${imageId}`)
  );
  for (const key of Array.from(inFlightMediaRequests.keys())) {
    if (key === imageId || key.endsWith(`:${imageId}`)) {
      inFlightMediaRequests.delete(key);
    }
  }
  void deletePersistentMediaEntriesByPredicate(
    (key) => key === `pub:v1:${imageId}` || key.endsWith(`:${imageId}`)
  );
}

export function evictMediaImageCacheBatch(imageIds: readonly string[]): void {
  for (const id of imageIds) {
    if (id) evictMediaImageCache(id);
  }
}

/**
 * Purges any viewer-scoped private media entries from L1 and persistent caches
 * so signing out or switching accounts never leaks restricted media across sessions.
 */
export function clearViewerScopedMediaCache(uid?: string | null): void {
  const prefix = uid && isValidFirestoreId(uid) ? `priv:v1:${uid}:` : 'priv:v1:';
  l1MediaCache.deleteMatching((key) => key.startsWith(prefix));
  for (const key of Array.from(inFlightMediaRequests.keys())) {
    if (key.startsWith(prefix)) {
      inFlightMediaRequests.delete(key);
    }
  }
  void deletePersistentMediaEntriesByPredicate((key) => key.startsWith(prefix));
}

/**
 * Resolves a compressed MediaImage document through:
 * 1. L1 synchronous memory LRU
 * 2. L2 persistent Cache API / IndexedDB fallback (survives page reloads & revisits)
 * 3. Firestore with transient retry and automatic stale-cache eviction if deleted
 */
export async function fetchMediaImageDataUrl(
  imageId: string,
  options?: MediaCacheKeyOptions & { forceRefresh?: boolean }
): Promise<string | null> {
  if (!isValidFirestoreId(imageId)) {
    return null;
  }

  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) {
    return null;
  }

  if (options?.forceRefresh) {
    recentlyDeletedImageIds.delete(imageId);
    l1MediaCache.delete(scopedKey);
  } else {
    if (isMarkedDeleted(imageId)) {
      return null;
    }
    const cached = l1MediaCache.get(scopedKey);
    if (cached) {
      perfMetrics.recordHit('media_l1');
      return cached;
    }
  }

  const existingPromise = inFlightMediaRequests.get(scopedKey);
  if (existingPromise) {
    return existingPromise;
  }

  const path = `${COLLECTION_NAMES.mediaImages}/${imageId}`;
  const promise = (async () => {
    const startMs = Date.now();
    try {
      if (!options?.forceRefresh) {
        const persistentHit = await readPersistentMediaCache(scopedKey);
        if (persistentHit && !isMarkedDeleted(imageId)) {
          l1MediaCache.set(scopedKey, persistentHit);
          perfMetrics.recordTiming('media_l2', Date.now() - startMs);
          return persistentHit;
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return null;
      }

      const snapshot = await runWithFirestoreConnectionRetry(() =>
        getDoc(doc(db, COLLECTION_NAMES.mediaImages, imageId))
      );

      if (!snapshot.exists()) {
        // Auto-evict deleted image from both L1 and persistent caches
        evictMediaImageCache(imageId);
        return null;
      }

      if (isMarkedDeleted(imageId)) {
        return null;
      }

      const data = snapshot.data() as MediaImage;
      if (!data.base64Data || !data.mimeType) {
        return null;
      }
      const dataUrl = buildMediaDataUrl(data.mimeType, data.base64Data);
      primeMediaImageCache(imageId, dataUrl, options);
      perfMetrics.recordTiming('media_network', Date.now() - startMs);
      return dataUrl;
    } catch (error) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return null;
      }
      handleFirestoreError(error, OperationType.GET, path);
    } finally {
      inFlightMediaRequests.delete(scopedKey);
    }
  })();

  inFlightMediaRequests.set(scopedKey, promise);
  return promise;
}

/**
 * Lightly prewarms upcoming media (e.g. visible avatars or adjacent lightbox photos)
 * with low concurrency while skipping automatically on Data Saver / 2G networks.
 */
export async function prefetchMediaImages(
  imageIds: readonly (string | null | undefined)[],
  options?: MediaCacheKeyOptions
): Promise<void> {
  if (
    isDataSaverConnection() ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return;
  }
  const targets = Array.from(
    new Set(
      imageIds.filter(
        (id): id is string =>
          typeof id === 'string' &&
          isValidFirestoreId(id) &&
          !getCachedMediaImageDataUrl(id, options) &&
          !isMarkedDeleted(id)
      )
    )
  ).slice(0, 8);

  if (targets.length === 0) return;

  const CONCURRENCY = 2;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const idx = cursor;
      cursor += 1;
      const targetId = targets[idx];
      if (!targetId) continue;
      await fetchMediaImageDataUrl(targetId, options).catch(() => null);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker())
  );
}

export function buildMediaImageFirestoreRecord(input: {
  imageId: string;
  targetCollection: MediaTargetCollection;
  targetId: string;
  ownerUID?: string;
  compressed: CompressedImageResult;
  createdAtValue: unknown;
}): Record<string, unknown> {
  const docData: Record<string, unknown> = {
    id: input.imageId,
    targetCollection: input.targetCollection,
    targetId: input.targetId,
    mimeType: input.compressed.mimeType,
    width: input.compressed.width,
    height: input.compressed.height,
    byteSize: input.compressed.byteSize,
    base64Data: input.compressed.base64Data,
    createdAt: input.createdAtValue,
  };

  if (input.targetCollection !== 'anonymousPosts') {
    if (!input.ownerUID || !isValidFirestoreId(input.ownerUID)) {
      throw new Error('Authenticated ownerUID is required for non-anonymous images.');
    }
    docData.ownerUID = input.ownerUID;
  }

  validateMediaImagePayload(docData);
  return docData;
}

export async function saveProfileMediaImage(input: {
  uid: string;
  slot: 'avatar' | 'cover';
  compressed: CompressedImageResult;
  previousImageId?: string;
  username?: string;
  onProgress?: (state: UploadProgressState) => void;
}): Promise<{ imageId: string; dataUrl: string }> {
  if (!isValidFirestoreId(input.uid)) {
    throw new Error('Sign in with a valid account before saving photographs.');
  }

  input.onProgress?.({ percent: 25, label: 'Validating compressed image...' });

  const newImageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
  const targetCollection: MediaTargetCollection =
    input.slot === 'avatar' ? 'users_avatar' : 'users_cover';

  const mediaPayload = buildMediaImageFirestoreRecord({
    imageId: newImageId,
    targetCollection,
    targetId: input.uid,
    ownerUID: input.uid,
    compressed: input.compressed,
    createdAtValue: serverTimestamp(),
  });

  let previousDocExists = false;
  if (
    input.previousImageId &&
    isValidFirestoreId(input.previousImageId) &&
    input.previousImageId !== newImageId
  ) {
    try {
      const prevSnap = await getDoc(
        doc(db, COLLECTION_NAMES.mediaImages, input.previousImageId)
      );
      previousDocExists = prevSnap.exists();
    } catch {
      previousDocExists = false;
    }
  }

  input.onProgress?.({ percent: 65, label: 'Saving image...' });

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.mediaImages, newImageId), mediaPayload);

  const userUpdate: UpdateData<PublicUserProfile> = {
    updatedAt: serverTimestamp(),
  };
  if (input.slot === 'avatar') {
    userUpdate.photoImageId = newImageId;
    userUpdate.photoUrl = '';
  } else {
    userUpdate.coverImageId = newImageId;
    userUpdate.coverUrl = '';
  }
  batch.update(doc(db, COLLECTION_NAMES.users, input.uid), userUpdate);

  if (previousDocExists && input.previousImageId) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, input.previousImageId));
  }

  const writePath = `${COLLECTION_NAMES.mediaImages}/${newImageId}`;
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, writePath);
  }

  if (input.previousImageId) {
    evictMediaImageCache(input.previousImageId);
  }
  primeMediaImageCache(newImageId, input.compressed.dataUrl);
  notifyProfileUpdated({
    uid: input.uid,
    username: input.username,
    patch:
      input.slot === 'avatar'
        ? { photoImageId: newImageId, photoUrl: '' }
        : { coverImageId: newImageId, coverUrl: '' },
  });
  input.onProgress?.({ percent: 100, label: 'Saved to profile' });

  return {
    imageId: newImageId,
    dataUrl: input.compressed.dataUrl,
  };
}

export async function removeProfileMediaImage(input: {
  uid: string;
  slot: 'avatar' | 'cover';
  currentImageId?: string;
  username?: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.uid)) {
    throw new Error('Sign in with a valid account before removing photographs.');
  }

  let existingDocFound = false;
  if (input.currentImageId && isValidFirestoreId(input.currentImageId)) {
    try {
      const snap = await getDoc(
        doc(db, COLLECTION_NAMES.mediaImages, input.currentImageId)
      );
      existingDocFound = snap.exists();
    } catch {
      existingDocFound = false;
    }
  }

  const batch = writeBatch(db);
  const userUpdate: UpdateData<PublicUserProfile> = {
    updatedAt: serverTimestamp(),
  };

  if (input.slot === 'avatar') {
    userUpdate.photoImageId = deleteField();
    userUpdate.photoUrl = '';
  } else {
    userUpdate.coverImageId = deleteField();
    userUpdate.coverUrl = '';
  }

  batch.update(doc(db, COLLECTION_NAMES.users, input.uid), userUpdate);
  if (existingDocFound && input.currentImageId) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, input.currentImageId));
  }

  const path = `${COLLECTION_NAMES.users}/${input.uid}`;
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (input.currentImageId) {
    evictMediaImageCache(input.currentImageId);
  }
  notifyProfileUpdated({
    uid: input.uid,
    username: input.username,
    patch:
      input.slot === 'avatar'
        ? { photoImageId: '', photoUrl: '' }
        : { coverImageId: '', coverUrl: '' },
  });
}

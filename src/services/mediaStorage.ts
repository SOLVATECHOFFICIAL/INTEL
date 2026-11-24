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
  readPersistentMediaAsset,
  writePersistentMediaAsset,
} from './persistentCache';
import { notifyProfileUpdated } from './cacheInvalidation';
import { BoundedLruMap, perfMetrics } from '../utils/cacheSync';
import { runWithFirestoreConnectionRetry } from '../utils/firestoreRetry';
import {
  buildMediaDataUrl,
  type CompressedImageResult,
} from '../utils/imageCompression';
import {
  MediaMemoryLru,
  buildScopedMediaCacheKey,
  isDataSaverConnection,
  parseImageDataUrlToBinary,
  type MediaCacheKeyOptions,
} from '../utils/mediaCache';

const PERSISTENT_CACHE_NAME = 'lasued-intel-media-v1';
const PERSISTENT_CACHE_ORIGIN = 'https://media-cache.lasuedintel.local/asset/';
const PERSISTENT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_CACHE_MAX_ENTRIES = 180;

const managedObjectUrls = new Set<string>();
const pendingObjectUrlRevokes = new Map<string, number>();
const revokedObjectUrls = new Set<string>();

function rememberRevokedUrl(url: string): void {
  if (!url) return;
  revokedObjectUrls.add(url);
  if (revokedObjectUrls.size > 400) {
    const oldest = revokedObjectUrls.values().next().value;
    if (oldest) {
      revokedObjectUrls.delete(oldest);
    }
  }
}

export function isMediaUrlRevoked(url?: string | null): boolean {
  return Boolean(url && revokedObjectUrls.has(url));
}

function scheduleRevokeManagedUrl(url: string): void {
  if (
    !url ||
    !url.startsWith('blob:') ||
    !managedObjectUrls.has(url) ||
    typeof URL === 'undefined' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return;
  }
  if (pendingObjectUrlRevokes.has(url)) return;
  const revoke = () => {
    pendingObjectUrlRevokes.delete(url);
    managedObjectUrls.delete(url);
    rememberRevokedUrl(url);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore already-revoked URL
    }
  };
  if (typeof window !== 'undefined') {
    const timer = window.setTimeout(revoke, 5000);
    pendingObjectUrlRevokes.set(url, timer);
  } else {
    revoke();
  }
}

const l1MediaCache = new MediaMemoryLru(250, 24 * 1024 * 1024, (_key, val) => {
  scheduleRevokeManagedUrl(val);
});
const inFlightMediaRequests = new Map<string, Promise<string | null>>();
const inFlightL2Reads = new Map<string, Promise<string | null>>();
const inFlightPredecodes = new Map<string, Promise<void>>();
const predecodedSrcCache = new BoundedLruMap<string, true>(180);
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

function dataUrlToBlob(
  dataUrl: string
): { blob: Blob; mimeType: string; byteSize: number } | null {
  if (typeof Blob === 'undefined') return null;
  const parsed = parseImageDataUrlToBinary(dataUrl);
  if (!parsed) return null;
  const blob = new Blob([parsed.bytes.buffer as ArrayBuffer], {
    type: parsed.mimeType,
  });
  return { blob, mimeType: parsed.mimeType, byteSize: blob.size };
}

function blobToDataUrlFallback(blob: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function blobToRenderSrc(
  blob: Blob
): Promise<{ src: string; byteWeight: number } | null> {
  if (blob.size <= 0) return null;
  if (
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    try {
      const objectUrl = URL.createObjectURL(blob);
      managedObjectUrls.add(objectUrl);
      return { src: objectUrl, byteWeight: blob.size };
    } catch {
      // Fall back to Data URL if ObjectURL creation fails
    }
  }
  const dataUrl = await blobToDataUrlFallback(blob);
  if (!dataUrl) return null;
  return { src: dataUrl, byteWeight: blob.size };
}

async function readPersistentMediaCache(
  cacheKey: string
): Promise<{ src: string; byteWeight: number } | null> {
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
          const contentType = (
            response.headers.get('Content-Type') ?? ''
          ).toLowerCase();
          if (contentType.startsWith('image/')) {
            const blob = await response.blob();
            const rendered = await blobToRenderSrc(blob);
            if (rendered) {
              perfMetrics.recordHit('media_l2_cache_api');
              return rendered;
            }
          } else {
            // Backward compatibility with legacy text/plain data:image entries
            const text = await response.text();
            if (text.startsWith('data:image/')) {
              const converted = dataUrlToBlob(text);
              if (converted) {
                const rendered = await blobToRenderSrc(converted.blob);
                if (rendered) {
                  perfMetrics.recordHit('media_l2_cache_api');
                  return rendered;
                }
              }
              perfMetrics.recordHit('media_l2_cache_api');
              return { src: text, byteWeight: text.length * 2 };
            }
          }
          await cache.delete(reqUrl).catch(() => false);
        }
      }
    } catch {
      // Fall through to IndexedDB fallback
    }
  }

  const idbHit = await readPersistentMediaAsset(cacheKey);
  if (idbHit) {
    perfMetrics.recordHit('media_l2_idb');
    if (idbHit.blob) {
      const rendered = await blobToRenderSrc(idbHit.blob);
      if (rendered) return rendered;
    }
    if (idbHit.dataUrl) {
      const converted = dataUrlToBlob(idbHit.dataUrl);
      if (converted) {
        const rendered = await blobToRenderSrc(converted.blob);
        if (rendered) return rendered;
      }
      return { src: idbHit.dataUrl, byteWeight: idbHit.byteSize };
    }
  } else {
    perfMetrics.recordMiss('media_l2');
  }
  return null;
}

async function writePersistentMediaCache(
  cacheKey: string,
  payload: { dataUrl?: string; blob?: Blob; mimeType?: string }
): Promise<void> {
  const blobInfo = payload.blob
    ? {
        blob: payload.blob,
        mimeType: payload.mimeType || payload.blob.type || 'image/webp',
        byteSize: payload.blob.size,
      }
    : payload.dataUrl
      ? dataUrlToBlob(payload.dataUrl)
      : null;

  const cache = await openPersistentMediaCache();
  if (cache && blobInfo) {
    const reqUrl = makePersistentRequestUrl(cacheKey);
    try {
      const response = new Response(blobInfo.blob, {
        headers: {
          'Content-Type': blobInfo.mimeType,
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

  if (blobInfo) {
    await writePersistentMediaAsset(cacheKey, blobInfo);
  } else if (payload.dataUrl) {
    await writePersistentMediaAsset(cacheKey, {
      dataUrl: payload.dataUrl,
      byteSize: payload.dataUrl.length * 2,
    });
  }
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

export function isImageSrcPredecoded(src?: string | null): boolean {
  return Boolean(src && predecodedSrcCache.has(src));
}

export function predecodeImageSrc(src?: string | null): Promise<void> {
  if (!src || typeof Image === 'undefined') return Promise.resolve();
  if (predecodedSrcCache.has(src)) return Promise.resolve();
  const existing = inFlightPredecodes.get(src);
  if (existing) return existing;

  const task = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const done = () => {
      predecodedSrcCache.set(src, true);
      inFlightPredecodes.delete(src);
      resolve();
    };
    const fail = () => {
      inFlightPredecodes.delete(src);
      resolve();
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(done).catch(done);
      } else {
        done();
      }
    };
    img.onerror = fail;
    img.src = src;
  });

  inFlightPredecodes.set(src, task);
  return task;
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
    if (isMediaUrlRevoked(hit)) {
      l1MediaCache.delete(scopedKey);
      return null;
    }
    perfMetrics.recordHit('media_l1');
  }
  return hit;
}

export function invalidateStaleMediaUrl(
  imageId: string,
  staleSrc?: string | null,
  options?: MediaCacheKeyOptions
): void {
  if (staleSrc) {
    rememberRevokedUrl(staleSrc);
  }
  if (!isValidFirestoreId(imageId)) return;
  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) return;
  const cached = l1MediaCache.get(scopedKey);
  if (cached && (!staleSrc || cached === staleSrc || isMediaUrlRevoked(cached))) {
    l1MediaCache.delete(scopedKey);
  }
}

/**
 * Checks L1 + L2 (Cache API / IndexedDB) immediately without touching Firestore,
 * allowing off-screen or newly mounted cached images to paint instantly on revisit.
 */
export async function readCachedMediaL2Url(
  imageId: string,
  options?: MediaCacheKeyOptions
): Promise<string | null> {
  if (!isValidFirestoreId(imageId) || isMarkedDeleted(imageId)) return null;
  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) return null;

  const l1 = l1MediaCache.get(scopedKey);
  if (l1) {
    if (!isMediaUrlRevoked(l1)) {
      return l1;
    }
    l1MediaCache.delete(scopedKey);
  }

  const pendingL2 = inFlightL2Reads.get(scopedKey);
  if (pendingL2) return pendingL2;

  const task = readPersistentMediaCache(scopedKey)
    .then((hit) => {
      if (!hit || isMarkedDeleted(imageId)) return null;
      const already = l1MediaCache.get(scopedKey);
      if (already && !isMediaUrlRevoked(already)) {
        if (already !== hit.src) scheduleRevokeManagedUrl(hit.src);
        return already;
      }
      l1MediaCache.set(scopedKey, hit.src, hit.byteWeight);
      return hit.src;
    })
    .catch(() => null)
    .finally(() => {
      inFlightL2Reads.delete(scopedKey);
    });

  inFlightL2Reads.set(scopedKey, task);
  return task;
}

export function primeMediaImageCache(
  imageId: string,
  dataUrl: string,
  options?: MediaCacheKeyOptions
): string {
  if (!isValidFirestoreId(imageId) || !dataUrl) return dataUrl;
  recentlyDeletedImageIds.delete(imageId);
  const scopedKey = buildScopedMediaCacheKey(imageId, options);
  if (!scopedKey) return dataUrl;

  const converted = dataUrlToBlob(dataUrl);
  if (
    converted &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    try {
      const objectUrl = URL.createObjectURL(converted.blob);
      managedObjectUrls.add(objectUrl);
      l1MediaCache.set(scopedKey, objectUrl, converted.byteSize);
      void writePersistentMediaCache(scopedKey, {
        blob: converted.blob,
        mimeType: converted.mimeType,
      });
      return objectUrl;
    } catch {
      // Fallback to raw data URL below
    }
  }

  l1MediaCache.set(scopedKey, dataUrl);
  void writePersistentMediaCache(scopedKey, { dataUrl });
  return dataUrl;
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
  for (const key of Array.from(inFlightL2Reads.keys())) {
    if (key === imageId || key.endsWith(`:${imageId}`)) {
      inFlightL2Reads.delete(key);
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
  for (const key of Array.from(inFlightL2Reads.keys())) {
    if (key.startsWith(prefix)) {
      inFlightL2Reads.delete(key);
    }
  }
  void deletePersistentMediaEntriesByPredicate((key) => key.startsWith(prefix));
}

/**
 * Resolves a compressed MediaImage document through:
 * 1. L1 synchronous memory LRU (lightweight ObjectURLs or Data URL fallback)
 * 2. L2 persistent Cache API / IndexedDB Blob cache (survives page reloads & revisits)
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
      if (!isMediaUrlRevoked(cached)) {
        perfMetrics.recordHit('media_l1');
        return cached;
      }
      l1MediaCache.delete(scopedKey);
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
        const persistentHit = await readCachedMediaL2Url(imageId, options);
        if (persistentHit && !isMarkedDeleted(imageId)) {
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
      const cachedUrl = primeMediaImageCache(imageId, dataUrl, options);
      perfMetrics.recordTiming('media_network', Date.now() - startMs);
      return cachedUrl;
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

async function runImagePreloadBatch(
  targets: readonly string[],
  options: MediaCacheKeyOptions | undefined,
  concurrency: number,
  predecode: boolean
): Promise<void> {
  if (targets.length === 0) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const idx = cursor;
      cursor += 1;
      const targetId = targets[idx];
      if (!targetId) continue;
      const src = await fetchMediaImageDataUrl(targetId, options).catch(
        () => null
      );
      if (src && predecode) {
        await predecodeImageSrc(src);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
  );
}

/**
 * Prioritized media preloading: runs high-priority assets first (e.g. profile
 * cover, avatar, visible post images) then nearby gallery frames/thumbnails,
 * pre-decoding resolved URLs so opening them is immediate.
 */
export async function prefetchMediaImagesPriority(input: {
  highPriority?: readonly (string | null | undefined)[];
  normalPriority?: readonly (string | null | undefined)[];
  options?: MediaCacheKeyOptions;
  predecode?: boolean;
  maxTotal?: number;
}): Promise<void> {
  const dataSaver = isDataSaverConnection();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }

  const maxCap = dataSaver ? 4 : Math.max(1, input.maxTotal ?? 14);
  const seen = new Set<string>();
  const filterClean = (
    list: readonly (string | null | undefined)[] | undefined
  ): string[] => {
    const out: string[] = [];
    for (const raw of list ?? []) {
      if (seen.size >= maxCap) break;
      if (
        typeof raw !== 'string' ||
        !isValidFirestoreId(raw) ||
        seen.has(raw) ||
        isMarkedDeleted(raw)
      ) {
        continue;
      }
      seen.add(raw);
      out.push(raw);
    }
    return out;
  };

  const high = filterClean(input.highPriority);
  const normal = dataSaver ? [] : filterClean(input.normalPriority);
  const shouldPredecode = input.predecode ?? true;

  // Always warm L1/decoded state for already-cached URLs even if offline/DataSaver
  const alreadyCachedSrcs: string[] = [];
  const toFetchHigh: string[] = [];
  for (const id of high) {
    const hit = getCachedMediaImageDataUrl(id, input.options);
    if (hit) {
      alreadyCachedSrcs.push(hit);
    } else {
      toFetchHigh.push(id);
    }
  }
  const toFetchNormal: string[] = [];
  for (const id of normal) {
    const hit = getCachedMediaImageDataUrl(id, input.options);
    if (hit) {
      alreadyCachedSrcs.push(hit);
    } else {
      toFetchNormal.push(id);
    }
  }

  if (shouldPredecode && alreadyCachedSrcs.length > 0) {
    void Promise.all(alreadyCachedSrcs.map((s) => predecodeImageSrc(s)));
  }

  if (toFetchHigh.length > 0) {
    await runImagePreloadBatch(
      toFetchHigh,
      input.options,
      dataSaver ? 2 : 3,
      shouldPredecode
    );
  }
  if (toFetchNormal.length > 0 && !dataSaver) {
    await runImagePreloadBatch(toFetchNormal, input.options, 2, shouldPredecode);
  }
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
  await prefetchMediaImagesPriority({
    highPriority: imageIds,
    options,
    predecode: true,
    maxTotal: 12,
  });
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

  if (input.targetCollection === 'updates') {
    if (input.ownerUID && isValidFirestoreId(input.ownerUID)) {
      docData.ownerUID = input.ownerUID;
    }
  } else if (input.targetCollection !== 'anonymousPosts') {
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

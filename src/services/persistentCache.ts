import { isPersistableCacheKey, perfMetrics } from '../utils/cacheSync';

const DB_NAME = 'lasued-intel-cache-v1';
const DB_VERSION = 1;
const STORE_CONTENT = 'content';
const STORE_MEDIA = 'media';
const STORE_DRAFTS = 'drafts';

const MAX_CONTENT_ENTRIES = 180;
const MAX_MEDIA_ENTRIES = 140;
const MAX_MEDIA_BYTES = 26 * 1024 * 1024;
const DEFAULT_PUBLIC_CONTENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRIVATE_CONTENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

interface ContentRecord<T = unknown> {
  key: string;
  scope: 'public' | 'private';
  viewerKey: string;
  value: T;
  cachedAt: number;
  lastAccessedAt: number;
  byteEstimate: number;
}

interface MediaIdbRecord {
  key: string;
  dataUrl: string;
  byteSize: number;
  cachedAt: number;
  lastAccessedAt: number;
}

interface DraftIdbRecord<T = unknown> {
  key: string;
  viewerKey: string;
  draftId: string;
  data: T;
  updatedAt: number;
}

// Graceful RAM fallbacks when IndexedDB is unavailable or blocked
const memoryContentFallback = new Map<string, ContentRecord>();
const memoryMediaFallback = new Map<string, MediaIdbRecord>();
const memoryDraftFallback = new Map<string, DraftIdbRecord>();

let dbOpenPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDbSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined'
  );
}

function estimateJsonBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 1024;
  }
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) {
    return Promise.resolve(null);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_CONTENT)) {
          const store = database.createObjectStore(STORE_CONTENT, {
            keyPath: 'key',
          });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
          store.createIndex('viewerKey', 'viewerKey', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORE_MEDIA)) {
          const store = database.createObjectStore(STORE_MEDIA, {
            keyPath: 'key',
          });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORE_DRAFTS)) {
          const store = database.createObjectStore(STORE_DRAFTS, {
            keyPath: 'key',
          });
          store.createIndex('viewerKey', 'viewerKey', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          dbOpenPromise = null;
        };
        resolve(database);
      };

      request.onerror = () => {
        dbOpenPromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        resolve(null);
      };
    } catch {
      dbOpenPromise = null;
      resolve(null);
    }
  });

  return dbOpenPromise;
}

function idbRequestPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isQuotaExceededError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
  }
  return false;
}

async function pruneOldestContentEntries(
  database: IDBDatabase,
  removeFraction = 0.25
): Promise<void> {
  const tx = database.transaction(STORE_CONTENT, 'readwrite');
  const store = tx.objectStore(STORE_CONTENT);
  const all = (await idbRequestPromise(store.getAll())) as ContentRecord[];
  const now = Date.now();
  const valid: ContentRecord[] = [];

  for (const item of all) {
    const maxAge =
      item.scope === 'private'
        ? DEFAULT_PRIVATE_CONTENT_MAX_AGE_MS
        : DEFAULT_PUBLIC_CONTENT_MAX_AGE_MS;
    if (now - item.cachedAt > maxAge) {
      store.delete(item.key);
    } else {
      valid.push(item);
    }
  }

  if (valid.length > MAX_CONTENT_ENTRIES || removeFraction > 0) {
    valid.sort(
      (a, b) => (a.lastAccessedAt ?? a.cachedAt) - (b.lastAccessedAt ?? b.cachedAt)
    );
    const excess = Math.max(0, valid.length - MAX_CONTENT_ENTRIES);
    const quotaTrim = Math.ceil(valid.length * removeFraction);
    const toRemoveCount = Math.min(valid.length, Math.max(excess, quotaTrim));
    for (let i = 0; i < toRemoveCount; i += 1) {
      store.delete(valid[i].key);
    }
  }
}

async function pruneOldestMediaEntries(
  database: IDBDatabase,
  forceRemoveFraction = 0
): Promise<void> {
  const tx = database.transaction(STORE_MEDIA, 'readwrite');
  const store = tx.objectStore(STORE_MEDIA);
  const all = (await idbRequestPromise(store.getAll())) as MediaIdbRecord[];
  const now = Date.now();
  const valid: MediaIdbRecord[] = [];
  let totalBytes = 0;

  for (const item of all) {
    if (now - item.cachedAt > MEDIA_MAX_AGE_MS) {
      store.delete(item.key);
    } else {
      valid.push(item);
      totalBytes += item.byteSize || 0;
    }
  }

  valid.sort(
    (a, b) => (a.lastAccessedAt ?? a.cachedAt) - (b.lastAccessedAt ?? b.cachedAt)
  );

  let remainingCount = valid.length;
  let index = 0;
  const minRemove = forceRemoveFraction > 0
    ? Math.ceil(valid.length * forceRemoveFraction)
    : 0;

  while (
    index < valid.length &&
    (remainingCount > MAX_MEDIA_ENTRIES ||
      totalBytes > MAX_MEDIA_BYTES ||
      index < minRemove)
  ) {
    const victim = valid[index];
    store.delete(victim.key);
    totalBytes = Math.max(0, totalBytes - (victim.byteSize || 0));
    remainingCount -= 1;
    index += 1;
  }
}

export async function readPersistentContent<T>(
  key: string,
  options: { maxAgeMs?: number } = {}
): Promise<T | null> {
  if (!isPersistableCacheKey(key)) return null;

  const fallbackHit = memoryContentFallback.get(key);
  const database = await openCacheDb();
  if (!database) {
    if (!fallbackHit) {
      perfMetrics.recordMiss('idb_content');
      return null;
    }
    const maxAge =
      options.maxAgeMs ??
      (fallbackHit.scope === 'private'
        ? DEFAULT_PRIVATE_CONTENT_MAX_AGE_MS
        : DEFAULT_PUBLIC_CONTENT_MAX_AGE_MS);
    if (Date.now() - fallbackHit.cachedAt > maxAge) {
      memoryContentFallback.delete(key);
      perfMetrics.recordMiss('idb_content');
      return null;
    }
    perfMetrics.recordHit('idb_content');
    return fallbackHit.value as T;
  }

  try {
    const tx = database.transaction(STORE_CONTENT, 'readonly');
    const record = (await idbRequestPromise(
      tx.objectStore(STORE_CONTENT).get(key)
    )) as ContentRecord<T> | undefined;

    if (!record) {
      perfMetrics.recordMiss('idb_content');
      return null;
    }

    const maxAge =
      options.maxAgeMs ??
      (record.scope === 'private'
        ? DEFAULT_PRIVATE_CONTENT_MAX_AGE_MS
        : DEFAULT_PUBLIC_CONTENT_MAX_AGE_MS);

    if (Date.now() - record.cachedAt > maxAge) {
      void deletePersistentContent(key);
      perfMetrics.recordMiss('idb_content');
      return null;
    }

    perfMetrics.recordHit('idb_content');
    return record.value;
  } catch {
    perfMetrics.recordMiss('idb_content');
    return null;
  }
}

export async function writePersistentContent<T>(
  key: string,
  value: T,
  options: {
    viewerKey?: string | null;
    scope?: 'public' | 'private';
  } = {}
): Promise<void> {
  if (!isPersistableCacheKey(key)) return;

  const now = Date.now();
  const scope = options.scope ?? 'public';
  const viewerKey = options.viewerKey?.trim() || 'guest';
  const record: ContentRecord<T> = {
    key,
    scope,
    viewerKey,
    value,
    cachedAt: now,
    lastAccessedAt: now,
    byteEstimate: estimateJsonBytes(value),
  };

  if (memoryContentFallback.size >= 80 && !memoryContentFallback.has(key)) {
    const oldestKey = memoryContentFallback.keys().next().value;
    if (oldestKey) memoryContentFallback.delete(oldestKey);
  }
  memoryContentFallback.set(key, record);

  const database = await openCacheDb();
  if (!database) return;

  const attemptPut = async () => {
    const tx = database.transaction(STORE_CONTENT, 'readwrite');
    await idbRequestPromise(tx.objectStore(STORE_CONTENT).put(record));
  };

  try {
    await attemptPut();
    const countTx = database.transaction(STORE_CONTENT, 'readonly');
    const count = await idbRequestPromise(
      countTx.objectStore(STORE_CONTENT).count()
    );
    if (count > MAX_CONTENT_ENTRIES) {
      void pruneOldestContentEntries(database, 0);
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await pruneOldestContentEntries(database, 0.35).catch(() => undefined);
      await attemptPut().catch(() => undefined);
    }
  }
}

export async function deletePersistentContent(key: string): Promise<void> {
  memoryContentFallback.delete(key);
  const database = await openCacheDb();
  if (!database) return;
  try {
    const tx = database.transaction(STORE_CONTENT, 'readwrite');
    await idbRequestPromise(tx.objectStore(STORE_CONTENT).delete(key));
  } catch {
    // Non-blocking cleanup
  }
}

export async function purgePersistentContentByPrefix(
  prefix: string
): Promise<void> {
  for (const key of Array.from(memoryContentFallback.keys())) {
    if (key.startsWith(prefix)) {
      memoryContentFallback.delete(key);
    }
  }

  const database = await openCacheDb();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_CONTENT, 'readwrite');
    const store = tx.objectStore(STORE_CONTENT);
    const keys = (await idbRequestPromise(store.getAllKeys())) as string[];
    for (const k of keys) {
      if (typeof k === 'string' && k.startsWith(prefix)) {
        store.delete(k);
      }
    }
  } catch {
    // Non-blocking cleanup
  }
}

/**
 * Removes all viewer-private persistent records, drafts, and viewer-scoped
 * content on sign-out or account switch while preserving safe public caches.
 */
export async function clearViewerPersistentCaches(
  uid?: string | null
): Promise<void> {
  const targetViewer = uid?.trim() || null;

  for (const [key, rec] of Array.from(memoryContentFallback.entries())) {
    if (
      rec.scope === 'private' ||
      (targetViewer && rec.viewerKey === targetViewer) ||
      key.startsWith('priv:')
    ) {
      memoryContentFallback.delete(key);
    }
  }
  for (const [key, draft] of Array.from(memoryDraftFallback.entries())) {
    if (!targetViewer || draft.viewerKey === targetViewer) {
      memoryDraftFallback.delete(key);
    }
  }

  const database = await openCacheDb();
  if (!database) return;

  try {
    const contentTx = database.transaction(STORE_CONTENT, 'readwrite');
    const contentStore = contentTx.objectStore(STORE_CONTENT);
    const allContent = (await idbRequestPromise(
      contentStore.getAll()
    )) as ContentRecord[];
    for (const item of allContent) {
      if (
        item.scope === 'private' ||
        item.key.startsWith('priv:') ||
        (targetViewer && item.viewerKey === targetViewer)
      ) {
        contentStore.delete(item.key);
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const draftsTx = database.transaction(STORE_DRAFTS, 'readwrite');
    const draftsStore = draftsTx.objectStore(STORE_DRAFTS);
    const allDrafts = (await idbRequestPromise(
      draftsStore.getAll()
    )) as DraftIdbRecord[];
    for (const draft of allDrafts) {
      if (!targetViewer || draft.viewerKey === targetViewer) {
        draftsStore.delete(draft.key);
      }
    }
  } catch {
    // Non-blocking
  }
}

export async function readPersistentMediaRecord(
  cacheKey: string
): Promise<string | null> {
  const fallback = memoryMediaFallback.get(cacheKey);
  const database = await openCacheDb();
  if (!database) {
    if (!fallback) return null;
    if (Date.now() - fallback.cachedAt > MEDIA_MAX_AGE_MS) {
      memoryMediaFallback.delete(cacheKey);
      return null;
    }
    return fallback.dataUrl;
  }

  try {
    const tx = database.transaction(STORE_MEDIA, 'readonly');
    const record = (await idbRequestPromise(
      tx.objectStore(STORE_MEDIA).get(cacheKey)
    )) as MediaIdbRecord | undefined;
    if (!record) return null;
    if (
      Date.now() - record.cachedAt > MEDIA_MAX_AGE_MS ||
      !record.dataUrl.startsWith('data:image/')
    ) {
      void deletePersistentMediaByPredicate((k) => k === cacheKey);
      return null;
    }
    return record.dataUrl;
  } catch {
    return null;
  }
}

export async function writePersistentMediaRecord(
  cacheKey: string,
  dataUrl: string
): Promise<void> {
  if (!cacheKey || !dataUrl.startsWith('data:image/')) return;
  const now = Date.now();
  const record: MediaIdbRecord = {
    key: cacheKey,
    dataUrl,
    byteSize: dataUrl.length * 2,
    cachedAt: now,
    lastAccessedAt: now,
  };

  if (memoryMediaFallback.size >= 40 && !memoryMediaFallback.has(cacheKey)) {
    const oldest = memoryMediaFallback.keys().next().value;
    if (oldest) memoryMediaFallback.delete(oldest);
  }
  memoryMediaFallback.set(cacheKey, record);

  const database = await openCacheDb();
  if (!database) return;

  const attemptPut = async () => {
    const tx = database.transaction(STORE_MEDIA, 'readwrite');
    await idbRequestPromise(tx.objectStore(STORE_MEDIA).put(record));
  };

  try {
    await attemptPut();
    const countTx = database.transaction(STORE_MEDIA, 'readonly');
    const count = await idbRequestPromise(
      countTx.objectStore(STORE_MEDIA).count()
    );
    if (count > MAX_MEDIA_ENTRIES) {
      void pruneOldestMediaEntries(database, 0);
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      await pruneOldestMediaEntries(database, 0.35).catch(() => undefined);
      await attemptPut().catch(() => undefined);
    }
  }
}

export async function deletePersistentMediaByPredicate(
  predicate: (cacheKey: string) => boolean
): Promise<void> {
  for (const key of Array.from(memoryMediaFallback.keys())) {
    if (predicate(key)) {
      memoryMediaFallback.delete(key);
    }
  }

  const database = await openCacheDb();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_MEDIA, 'readwrite');
    const store = tx.objectStore(STORE_MEDIA);
    const keys = (await idbRequestPromise(store.getAllKeys())) as string[];
    for (const key of keys) {
      if (typeof key === 'string' && predicate(key)) {
        store.delete(key);
      }
    }
  } catch {
    // Non-blocking cleanup
  }
}

function makeDraftKey(viewerKey: string, draftId: string): string {
  return `${viewerKey.trim() || 'guest'}:${draftId}`;
}

export async function savePersistentDraft<T>(
  viewerKey: string,
  draftId: string,
  data: T
): Promise<void> {
  const safeViewer = viewerKey.trim() || 'guest';
  const key = makeDraftKey(safeViewer, draftId);
  const record: DraftIdbRecord<T> = {
    key,
    viewerKey: safeViewer,
    draftId,
    data,
    updatedAt: Date.now(),
  };

  memoryDraftFallback.set(key, record);

  const database = await openCacheDb();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_DRAFTS, 'readwrite');
    await idbRequestPromise(tx.objectStore(STORE_DRAFTS).put(record));
  } catch {
    // Ignore IDB quota errors cleanly for drafts
  }
}

export async function loadPersistentDraft<T>(
  viewerKey: string,
  draftId: string
): Promise<T | null> {
  const safeViewer = viewerKey.trim() || 'guest';
  const key = makeDraftKey(safeViewer, draftId);
  const fallback = memoryDraftFallback.get(key);

  const database = await openCacheDb();
  if (!database) {
    if (!fallback) return null;
    if (Date.now() - fallback.updatedAt > DRAFT_MAX_AGE_MS) {
      memoryDraftFallback.delete(key);
      return null;
    }
    return fallback.data as T;
  }

  try {
    const tx = database.transaction(STORE_DRAFTS, 'readonly');
    const record = (await idbRequestPromise(
      tx.objectStore(STORE_DRAFTS).get(key)
    )) as DraftIdbRecord<T> | undefined;
    if (!record) return null;
    if (Date.now() - record.updatedAt > DRAFT_MAX_AGE_MS) {
      void clearPersistentDraft(safeViewer, draftId);
      return null;
    }
    return record.data;
  } catch {
    return fallback ? (fallback.data as T) : null;
  }
}

export async function clearPersistentDraft(
  viewerKey: string,
  draftId: string
): Promise<void> {
  const safeViewer = viewerKey.trim() || 'guest';
  const key = makeDraftKey(safeViewer, draftId);
  memoryDraftFallback.delete(key);

  const database = await openCacheDb();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_DRAFTS, 'readwrite');
    await idbRequestPromise(tx.objectStore(STORE_DRAFTS).delete(key));
  } catch {
    // Non-blocking
  }
}

export async function prunePersistentCacheStores(): Promise<void> {
  const database = await openCacheDb();
  if (!database) return;
  await Promise.all([
    pruneOldestContentEntries(database, 0).catch(() => undefined),
    pruneOldestMediaEntries(database, 0).catch(() => undefined),
  ]);
}

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
  buildMediaDataUrl,
  type CompressedImageResult,
} from '../utils/imageCompression';

const MAX_CACHE_ENTRIES = 250;
const mediaDataUrlCache = new Map<string, string>();
const inFlightMediaRequests = new Map<string, Promise<string | null>>();

export interface UploadProgressState {
  percent: number;
  label: string;
}

export function generateFirestoreDocId(
  collectionName: string = COLLECTION_NAMES.mediaImages
): string {
  return doc(collection(db, collectionName)).id;
}

export function getCachedMediaImageDataUrl(imageId: string): string | null {
  return mediaDataUrlCache.get(imageId) ?? null;
}

export function primeMediaImageCache(imageId: string, dataUrl: string): void {
  if (!isValidFirestoreId(imageId) || !dataUrl) return;
  if (mediaDataUrlCache.has(imageId)) {
    mediaDataUrlCache.delete(imageId);
  }
  mediaDataUrlCache.set(imageId, dataUrl);

  while (mediaDataUrlCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = mediaDataUrlCache.keys().next().value;
    if (!oldestKey) break;
    mediaDataUrlCache.delete(oldestKey);
  }
}

export function evictMediaImageCache(imageId: string): void {
  mediaDataUrlCache.delete(imageId);
  inFlightMediaRequests.delete(imageId);
}

/**
 * Fetches an isolated Base64 MediaImage document with in-memory LRU caching
 * and in-flight request deduplication so feeds and grids never re-fetch on scroll.
 */
export async function fetchMediaImageDataUrl(
  imageId: string
): Promise<string | null> {
  if (!isValidFirestoreId(imageId)) {
    return null;
  }

  const cached = mediaDataUrlCache.get(imageId);
  if (cached) {
    return cached;
  }

  const existingPromise = inFlightMediaRequests.get(imageId);
  if (existingPromise) {
    return existingPromise;
  }

  const path = `${COLLECTION_NAMES.mediaImages}/${imageId}`;
  const promise = (async () => {
    try {
      const snapshot = await getDoc(
        doc(db, COLLECTION_NAMES.mediaImages, imageId)
      );
      if (!snapshot.exists()) {
        return null;
      }
      const data = snapshot.data() as MediaImage;
      if (!data.base64Data || !data.mimeType) {
        return null;
      }
      const dataUrl = buildMediaDataUrl(data.mimeType, data.base64Data);
      primeMediaImageCache(imageId, dataUrl);
      return dataUrl;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    } finally {
      inFlightMediaRequests.delete(imageId);
    }
  })();

  inFlightMediaRequests.set(imageId, promise);
  return promise;
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

  input.onProgress?.({ percent: 65, label: 'Saving image to Firebase...' });

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
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, writePath);
  }

  if (previousDocExists && input.previousImageId) {
    evictMediaImageCache(input.previousImageId);
  }
  primeMediaImageCache(newImageId, input.compressed.dataUrl);
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
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (input.currentImageId) {
    evictMediaImageCache(input.currentImageId);
  }
}

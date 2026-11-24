import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type FieldValue,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ALLOWED_TEXT_POST_BACKGROUND_IDS,
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  isValidFirestoreId,
  resolveAdminUpdateFormat,
  validateAdminUpdatePayload,
  type AdminAuditAction,
  type AdminUpdate,
  type AdminUpdateAuthorMode,
  type AdminUpdateFormat,
  type PostComment,
  type PostMediaMeta,
  type PublicProfileProjection,
  type PublicUserProfile,
  type ReactionType,
  type TextPostBackgroundId,
  type UserRole,
} from '../types/database';
import {
  isDesignatedSupremeAdminUser,
  isFirebaseErrorCode,
  isUndergroundSupremeAdminUser,
} from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import {
  computeNextReactionTransactionState,
  isFirestoreSdkError,
  runWithFirestoreConnectionRetry,
} from '../utils/firestoreRetry';
import {
  buildCommentNotificationId,
  buildMentionNotificationId,
  buildOfficialUpdateNotificationId,
  buildReactionNotificationId,
  buildReplyNotificationId,
  extractMentionedUsernames,
  shouldEmitActivityNotification,
  summarizeNotificationExcerpt,
} from '../utils/notifications';
import {
  notifyAdminUpdateCommentMutated,
  notifyAdminUpdateCreated,
  notifyAdminUpdateDeleted,
  notifyAdminUpdateReactionChanged,
  notifyAdminUpdateUpdated,
} from './cacheInvalidation';
import {
  createSafeMemberNotification,
  fetchPublicProfileProjectionsByUids,
  resolveUserUidsByUsernames,
} from './firestoreFoundation';
import {
  buildMediaImageFirestoreRecord,
  evictMediaImageCacheBatch,
  generateFirestoreDocId,
  primeMediaImageCache,
  type UploadProgressState,
} from './mediaStorage';
import type { CommentWithAuthor, ComposerImageAttachment } from './socialPosts';
import { triggerBestEffortPushBroadcast } from './webPush';

export interface OfficialUpdatesPageResult {
  items: AdminUpdate[];
  authorMap: Map<string, PublicProfileProjection>;
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

const OFFICIAL_DESK_NAME = 'LASUED Intel Official';
const OFFICIAL_DESK_AVATAR = '/pwa-192x192.png';

function attachUpdateAuditLogToBatch(
  batch: WriteBatch,
  input: {
    action: Extract<
      AdminAuditAction,
      'update_created' | 'update_updated' | 'update_deleted'
    >;
    updateId: string;
    targetLabel?: string;
    performedByUid: string;
    details?: string;
  }
): void {
  const logId = generateFirestoreDocId(COLLECTION_NAMES.adminAuditLogs);
  const cleanLabel = input.targetLabel?.trim().slice(0, 180);
  const cleanDetails = input.details
    ?.trim()
    .slice(0, BLUEPRINT_LIMITS.auditReasonMax);

  const payload: Record<string, unknown> = {
    id: logId,
    action: input.action,
    targetCollection: COLLECTION_NAMES.updates,
    targetId: input.updateId,
    performedByUid: input.performedByUid,
    performedByRole: 'supreme_admin',
    createdAt: serverTimestamp(),
  };
  if (cleanLabel) {
    payload.targetLabel = cleanLabel;
  }
  if (cleanDetails) {
    payload.details = cleanDetails;
  }

  batch.set(doc(db, COLLECTION_NAMES.adminAuditLogs, logId), payload);
}

function sortUpdatesPinnedThenNewest(items: AdminUpdate[]): AdminUpdate[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
      return a.isPinned ? -1 : 1;
    }
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

function buildOrderedMediaItems(
  attachments: ComposerImageAttachment[]
): PostMediaMeta[] {
  if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    throw new Error(
      `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per update.`
    );
  }
  return attachments.map((att, index) => {
    if (att.existingMeta) {
      return {
        imageId: att.existingMeta.imageId,
        width: att.existingMeta.width,
        height: att.existingMeta.height,
        byteSize: att.existingMeta.byteSize,
        mimeType: att.existingMeta.mimeType,
        order: index,
      };
    }
    if (!att.compressed) {
      throw new Error(`Missing compressed image data for photograph ${index + 1}.`);
    }
    return {
      imageId: att.imageId,
      width: att.compressed.width,
      height: att.compressed.height,
      byteSize: att.compressed.byteSize,
      mimeType: att.compressed.mimeType,
      order: index,
    };
  });
}

async function resolveExistingImageIds(imageIds: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(imageIds.filter(isValidFirestoreId)));
  if (uniqueIds.length === 0) return [];
  const settled = await Promise.allSettled(
    uniqueIds.map(async (imageId) => {
      const snap = await getDoc(doc(db, COLLECTION_NAMES.mediaImages, imageId));
      return snap.exists() ? imageId : null;
    })
  );
  const existing: string[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value) {
      existing.push(res.value);
    }
  }
  return existing;
}

export async function fetchOfficialUpdatesPage(
  options: {
    pageSize?: number;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
  } = {}
): Promise<OfficialUpdatesPageResult> {
  const pageSize = Math.max(1, Math.min(40, options.pageSize ?? 18));

  try {
    let pageDocs: QueryDocumentSnapshot<DocumentData>[] = [];
    let hasMore = false;

    try {
      const q = query(
        collection(db, COLLECTION_NAMES.updates),
        where('status', '==', 'published'),
        orderBy('createdAt', 'desc'),
        ...(options.cursor ? [startAfter(options.cursor)] : []),
        limit(pageSize + 1)
      );
      const snap = await getDocs(q);
      hasMore = snap.docs.length > pageSize;
      pageDocs = snap.docs.slice(0, pageSize);
    } catch (innerError) {
      if (!isFirebaseErrorCode(innerError, 'failed-precondition')) {
        throw innerError;
      }
      const fallbackSnap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.updates),
          where('status', '==', 'published'),
          limit(100)
        )
      );
      pageDocs = fallbackSnap.docs;
      hasMore = false;
    }

    const rawItems = pageDocs
      .map((d) => d.data() as AdminUpdate)
      .filter((u) => u.status === 'published');
    const items = sortUpdatesPinnedThenNewest(rawItems);
    const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

    const publicAuthorUids = Array.from(
      new Set(
        items
          .filter(
            (u) =>
              u.authorMode === 'public_admin' &&
              u.ownerUID &&
              isValidFirestoreId(u.ownerUID)
          )
          .map((u) => u.ownerUID!)
      )
    );
    const authorMap =
      publicAuthorUids.length > 0
        ? await fetchPublicProfileProjectionsByUids(publicAuthorUids)
        : new Map<string, PublicProfileProjection>();

    return {
      items,
      authorMap,
      nextCursor: hasMore ? lastDoc : null,
      hasMore,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.updates);
  }
}

export async function fetchSingleOfficialUpdate(updateId: string): Promise<{
  update: AdminUpdate;
  author: PublicProfileProjection | null;
} | null> {
  if (!isValidFirestoreId(updateId)) return null;
  const path = `${COLLECTION_NAMES.updates}/${updateId}`;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.updates, updateId));
    if (!snap.exists()) return null;
    const update = snap.data() as AdminUpdate;
    if (update.status !== 'published') return null;

    let author: PublicProfileProjection | null = null;
    if (
      update.authorMode === 'public_admin' &&
      update.ownerUID &&
      isValidFirestoreId(update.ownerUID)
    ) {
      const authorMap = await fetchPublicProfileProjectionsByUids([
        update.ownerUID,
      ]);
      author = authorMap.get(update.ownerUID) ?? null;
    }

    return { update, author };
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function notifyUsersOfOfficialUpdate(input: {
  update: AdminUpdate;
  actorUid: string;
}): Promise<void> {
  try {
    const usersSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.users),
        where('isHiddenFromDirectory', '==', false),
        limit(400)
      )
    );

    const isOfficialDesk = input.update.authorMode === 'official_desk';
    const recipientUids = usersSnap.docs
      .map((d) => d.data() as PublicUserProfile)
      .filter(
        (p) =>
          p.accountStatus === 'active' &&
          !p.isHiddenFromDirectory &&
          isValidFirestoreId(p.uid) &&
          (isOfficialDesk || p.uid !== input.actorUid)
      )
      .map((p) => p.uid);

    if (recipientUids.length === 0) return;

    const headline = summarizeNotificationExcerpt(
      input.update.title?.trim() || `Official Update · ${input.update.authorDisplayName}`,
      140
    );
    const bodyExcerpt = summarizeNotificationExcerpt(input.update.body, 220);
    const targetPath = `/?view=updates&postId=${input.update.id}`;
    const targetImageId = input.update.mediaItems?.[0]?.imageId;
    const CHUNK_SIZE = 380;
    const createdNotificationIds: string[] = [];

    for (let i = 0; i < recipientUids.length; i += CHUNK_SIZE) {
      const chunk = recipientUids.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const uid of chunk) {
        const notifId = buildOfficialUpdateNotificationId(input.update.id, uid);
        const notifDoc: Record<string, unknown> = {
          id: notifId,
          recipientUid: uid,
          eventType: 'official_update',
          title: headline,
          targetPath,
          isRead: false,
          createdAt: serverTimestamp(),
        };
        if (bodyExcerpt) {
          notifDoc.body = bodyExcerpt;
        }
        if (targetImageId && isValidFirestoreId(targetImageId)) {
          notifDoc.targetImageId = targetImageId;
        }
        // Only attach public actor metadata for the public admin; NEVER for official_desk/underground admin
        if (!isOfficialDesk) {
          notifDoc.actorUid = input.actorUid;
          notifDoc.actorName = input.update.authorDisplayName.slice(0, 100);
          if (
            input.update.authorPhotoImageId &&
            isValidFirestoreId(input.update.authorPhotoImageId)
          ) {
            notifDoc.actorPhotoImageId = input.update.authorPhotoImageId;
          } else if (input.update.authorPhotoUrl) {
            notifDoc.actorPhotoUrl = input.update.authorPhotoUrl;
          }
        }
        batch.set(doc(db, COLLECTION_NAMES.notifications, notifId), notifDoc);
        createdNotificationIds.push(notifId);
      }
      await batch.commit();
    }

    if (createdNotificationIds.length > 0) {
      void triggerBestEffortPushBroadcast({
        eventType: 'official_update',
        title: headline,
        body: bodyExcerpt || undefined,
        targetPath,
        recipientUids,
        notificationIds: createdNotificationIds,
      });
    }
  } catch {
    // Non-blocking fan-out: update publication succeeds even if notification fan-out partially throttles
  }
}

export async function createOfficialUpdateWithMedia(input: {
  actorUid: string;
  actorRole: UserRole;
  format: AdminUpdateFormat;
  category: string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  attachments: ComposerImageAttachment[];
  isPinned?: boolean;
  onProgress?: (state: UploadProgressState) => void;
}): Promise<{ update: AdminUpdate; author: PublicProfileProjection | null }> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    currentUser.uid !== input.actorUid ||
    !isDesignatedSupremeAdminUser(currentUser) ||
    input.actorRole !== 'supreme_admin'
  ) {
    throw new Error(
      'Only designated Supreme Administrators may publish official updates.'
    );
  }

  const updateId = generateFirestoreDocId(COLLECTION_NAMES.updates);
  const isUnderground = isUndergroundSupremeAdminUser(currentUser);
  const authorMode: AdminUpdateAuthorMode = isUnderground
    ? 'official_desk'
    : 'public_admin';

  let authorProjection: PublicProfileProjection | null = null;
  let authorDisplayName = OFFICIAL_DESK_NAME;
  let authorBadge: 'supreme_admin' | 'verified' = 'verified';
  let authorPhotoUrl: string | undefined = OFFICIAL_DESK_AVATAR;
  let authorPhotoImageId: string | undefined;

  if (authorMode === 'public_admin') {
    const map = await fetchPublicProfileProjectionsByUids([input.actorUid]);
    authorProjection = map.get(input.actorUid) ?? null;
    authorDisplayName =
      authorProjection?.fullName?.trim() || 'LASUED Intel Admin';
    authorBadge = 'supreme_admin';
    authorPhotoUrl = authorProjection?.photoUrl || undefined;
    authorPhotoImageId = authorProjection?.photoImageId || undefined;
  }

  const cleanCategory = input.category.trim();
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const isTextFormat = input.format === 'text';
  const effectiveAttachments = isTextFormat ? [] : input.attachments;
  const mediaItems = isTextFormat
    ? []
    : buildOrderedMediaItems(effectiveAttachments);

  const updateDoc: Record<string, unknown> = {
    id: updateId,
    format: input.format,
    authorMode,
    authorDisplayName,
    authorBadge,
    category: cleanCategory,
    body: cleanBody,
    isPinned: Boolean(input.isPinned),
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (authorMode === 'public_admin') {
    updateDoc.ownerUID = input.actorUid;
  }
  if (authorPhotoImageId && isValidFirestoreId(authorPhotoImageId)) {
    updateDoc.authorPhotoImageId = authorPhotoImageId;
  } else if (authorPhotoUrl) {
    updateDoc.authorPhotoUrl = authorPhotoUrl;
  }
  if (cleanTitle) {
    updateDoc.title = cleanTitle;
  }
  if (isTextFormat) {
    if (
      input.backgroundStyle &&
      ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(input.backgroundStyle)
    ) {
      updateDoc.backgroundStyle = input.backgroundStyle;
    }
  } else if (mediaItems.length > 0) {
    updateDoc.mediaItems = mediaItems;
  }

  validateAdminUpdatePayload(updateDoc);

  input.onProgress?.({
    percent: 32,
    label:
      mediaItems.length > 0
        ? `Uploading ${mediaItems.length} compressed photograph(s)...`
        : 'Publishing official update...',
  });

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.updates, updateId), updateDoc);
  batch.set(doc(db, COLLECTION_NAMES.adminUpdateMappings, updateId), {
    updateId,
    authorUid: input.actorUid,
    authorMode,
    createdAt: serverTimestamp(),
  });

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'updates',
      targetId: updateId,
      // Omit ownerUID for official_desk so underground admin UID never appears in mediaImages
      ownerUID: authorMode === 'public_admin' ? input.actorUid : undefined,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  attachUpdateAuditLogToBatch(batch, {
    action: 'update_created',
    updateId,
    targetLabel: cleanTitle || summarizeNotificationExcerpt(cleanBody, 120) || 'Official Update',
    performedByUid: input.actorUid,
    details: `Published ${input.format} official update (${authorMode}).`,
  });

  input.onProgress?.({ percent: 72, label: 'Confirming with Firebase...' });

  const path = `${COLLECTION_NAMES.updates}/${updateId}`;
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Published' });

  const createdUpdate: AdminUpdate = {
    ...(updateDoc as unknown as AdminUpdate),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  notifyAdminUpdateCreated(createdUpdate, authorProjection);
  void notifyUsersOfOfficialUpdate({
    update: createdUpdate,
    actorUid: input.actorUid,
  });

  return { update: createdUpdate, author: authorProjection };
}

export async function updateOfficialUpdateWithMedia(input: {
  update: AdminUpdate;
  actorUid: string;
  actorRole: UserRole;
  category: string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  attachments: ComposerImageAttachment[];
  isPinned?: boolean;
  onProgress?: (state: UploadProgressState) => void;
}): Promise<AdminUpdate> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    currentUser.uid !== input.actorUid ||
    !isDesignatedSupremeAdminUser(currentUser) ||
    input.actorRole !== 'supreme_admin'
  ) {
    throw new Error(
      'Only designated Supreme Administrators may edit official updates.'
    );
  }

  const lockedFormat = resolveAdminUpdateFormat(input.update);
  const isTextFormat = lockedFormat === 'text';
  const effectiveAttachments = isTextFormat ? [] : input.attachments;
  const mediaItems = isTextFormat
    ? []
    : buildOrderedMediaItems(effectiveAttachments);

  const cleanCategory = input.category.trim();
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const resolvedBg =
    isTextFormat &&
    input.backgroundStyle &&
    ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : isTextFormat
        ? input.update.backgroundStyle ?? ALLOWED_TEXT_POST_BACKGROUND_IDS[0]
        : undefined;

  const checkPayload: Record<string, unknown> = {
    id: input.update.id,
    format: lockedFormat,
    authorMode: input.update.authorMode,
    authorDisplayName: input.update.authorDisplayName,
    authorBadge: input.update.authorBadge,
    category: cleanCategory,
    title: cleanTitle,
    body: cleanBody,
  };
  if (input.update.authorMode === 'public_admin' && input.update.ownerUID) {
    checkPayload.ownerUID = input.update.ownerUID;
  }
  if (isTextFormat && resolvedBg) {
    checkPayload.backgroundStyle = resolvedBg;
  } else {
    checkPayload.mediaItems = mediaItems;
  }
  validateAdminUpdatePayload(checkPayload);

  const previousImageIds = (input.update.mediaItems ?? []).map((m) => m.imageId);
  const keptImageIds = new Set(mediaItems.map((m) => m.imageId));
  const removedImageIds = await resolveExistingImageIds(
    previousImageIds.filter((id) => !keptImageIds.has(id))
  );

  input.onProgress?.({ percent: 35, label: 'Saving official update changes...' });

  const batch = writeBatch(db);
  const updatePayload: Record<
    string,
    FieldValue | string | boolean | PostMediaMeta[]
  > = {
    category: cleanCategory,
    title: cleanTitle ? cleanTitle : deleteField(),
    body: cleanBody,
    isPinned:
      input.isPinned !== undefined
        ? Boolean(input.isPinned)
        : Boolean(input.update.isPinned),
    updatedAt: serverTimestamp(),
  };

  if (isTextFormat && resolvedBg) {
    updatePayload.backgroundStyle = resolvedBg;
    updatePayload.mediaItems = deleteField();
  } else {
    updatePayload.mediaItems = mediaItems;
    updatePayload.backgroundStyle = deleteField();
  }

  batch.update(doc(db, COLLECTION_NAMES.updates, input.update.id), updatePayload);

  const imageOwnerUid =
    input.update.authorMode === 'public_admin'
      ? input.update.ownerUID ?? input.actorUid
      : undefined;

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'updates',
      targetId: input.update.id,
      ownerUID: imageOwnerUid,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  for (const removedId of removedImageIds) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, removedId));
  }

  attachUpdateAuditLogToBatch(batch, {
    action: 'update_updated',
    updateId: input.update.id,
    targetLabel: cleanTitle || summarizeNotificationExcerpt(cleanBody, 120) || 'Official Update',
    performedByUid: input.actorUid,
    details: `Edited official ${lockedFormat} update.`,
  });

  const path = `${COLLECTION_NAMES.updates}/${input.update.id}`;
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  if (removedImageIds.length > 0) {
    evictMediaImageCacheBatch(removedImageIds);
  }

  input.onProgress?.({ percent: 100, label: 'Update saved' });

  const updated: AdminUpdate = {
    ...input.update,
    format: lockedFormat,
    category: cleanCategory,
    title: cleanTitle || undefined,
    body: cleanBody,
    isPinned:
      input.isPinned !== undefined
        ? Boolean(input.isPinned)
        : Boolean(input.update.isPinned),
    backgroundStyle: isTextFormat ? resolvedBg : undefined,
    mediaItems: isTextFormat ? undefined : mediaItems,
    updatedAt: Date.now(),
  };

  notifyAdminUpdateUpdated(updated);
  return updated;
}

export async function toggleOfficialUpdatePin(input: {
  update: AdminUpdate;
  actorUid: string;
  actorRole: UserRole;
}): Promise<AdminUpdate> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    currentUser.uid !== input.actorUid ||
    !isDesignatedSupremeAdminUser(currentUser) ||
    input.actorRole !== 'supreme_admin'
  ) {
    throw new Error('Only Supreme Administrators may pin official updates.');
  }

  const nextPinned = !input.update.isPinned;
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.updates, input.update.id), {
    isPinned: nextPinned,
    updatedAt: serverTimestamp(),
  });
  attachUpdateAuditLogToBatch(batch, {
    action: 'update_updated',
    updateId: input.update.id,
    targetLabel:
      input.update.title || summarizeNotificationExcerpt(input.update.body, 120),
    performedByUid: input.actorUid,
    details: nextPinned ? 'Pinned official update.' : 'Unpinned official update.',
  });

  const path = `${COLLECTION_NAMES.updates}/${input.update.id}`;
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  const nextUpdate: AdminUpdate = {
    ...input.update,
    isPinned: nextPinned,
    updatedAt: Date.now(),
  };
  notifyAdminUpdateUpdated(nextUpdate);
  return nextUpdate;
}

export async function deleteOfficialUpdateCascading(input: {
  updateId: string;
  mediaImageIds: string[];
  actorUid: string;
  actorRole: UserRole;
  targetLabel?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    currentUser.uid !== input.actorUid ||
    !isDesignatedSupremeAdminUser(currentUser) ||
    input.actorRole !== 'supreme_admin'
  ) {
    throw new Error(
      'Only designated Supreme Administrators may delete official updates.'
    );
  }
  if (!isValidFirestoreId(input.updateId)) return;

  const existingMediaIds = await resolveExistingImageIds(input.mediaImageIds);
  const [commentsSnap, reactionsSnap, savedSnap, mappingSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, COLLECTION_NAMES.postComments),
        where('postId', '==', input.updateId),
        where('status', '==', 'published'),
        limit(200)
      )
    ).catch(() => null),
    getDocs(
      query(
        collection(db, COLLECTION_NAMES.postReactions),
        where('targetCollection', '==', 'updates'),
        where('targetId', '==', input.updateId),
        limit(300)
      )
    ).catch(() => null),
    getDocs(
      query(
        collection(db, COLLECTION_NAMES.savedPosts),
        where('ownerUID', '==', input.actorUid),
        where('targetCollection', '==', 'updates'),
        where('targetId', '==', input.updateId),
        limit(200)
      )
    ).catch(() => null),
    getDoc(doc(db, COLLECTION_NAMES.adminUpdateMappings, input.updateId)).catch(
      () => null
    ),
  ]);

  const refsToDelete = [
    doc(db, COLLECTION_NAMES.updates, input.updateId),
    ...(mappingSnap?.exists()
      ? [doc(db, COLLECTION_NAMES.adminUpdateMappings, input.updateId)]
      : []),
    ...existingMediaIds.map((imgId) =>
      doc(db, COLLECTION_NAMES.mediaImages, imgId)
    ),
    ...(commentsSnap?.docs
      .filter((d) => (d.data() as PostComment).targetCollection === 'updates')
      .map((d) => d.ref) ?? []),
    ...(reactionsSnap?.docs.map((d) => d.ref) ?? []),
    ...(savedSnap?.docs.map((d) => d.ref) ?? []),
  ];

  const CHUNK_SIZE = 400;
  const path = `${COLLECTION_NAMES.updates}/${input.updateId}`;
  try {
    for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
      const chunk = refsToDelete.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const ref of chunk) {
        batch.delete(ref);
      }
      if (i === 0) {
        attachUpdateAuditLogToBatch(batch, {
          action: 'update_deleted',
          updateId: input.updateId,
          targetLabel: input.targetLabel || input.updateId,
          performedByUid: input.actorUid,
          details: 'Deleted official update and cleaned up attached records.',
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (existingMediaIds.length > 0) {
    evictMediaImageCacheBatch(existingMediaIds);
  }
  notifyAdminUpdateDeleted(input.updateId);
}

export async function toggleOfficialUpdateReaction(input: {
  updateId: string;
  actorUid: string;
  reactionType?: ReactionType;
}): Promise<{ liked: boolean; likesCount: number }> {
  if (
    !isValidFirestoreId(input.actorUid) ||
    !isValidFirestoreId(input.updateId)
  ) {
    throw new Error('Sign in to like official updates.');
  }

  const updateRef = doc(db, COLLECTION_NAMES.updates, input.updateId);
  const reactionId = `updates_${input.updateId}_${input.actorUid}`;
  const reactionRef = doc(db, COLLECTION_NAMES.postReactions, reactionId);
  const path = `${COLLECTION_NAMES.updates}/${input.updateId}`;

  try {
    const result = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [updateSnap, reactionSnap] = await Promise.all([
          tx.get(updateRef),
          tx.get(reactionRef),
        ]);
        if (!updateSnap.exists()) {
          throw new Error('This official update is no longer available.');
        }

        const data = updateSnap.data() as AdminUpdate;
        const nextState = computeNextReactionTransactionState({
          alreadyLiked: reactionSnap.exists(),
          currentLikesCount: data.likesCount,
        });

        const publicAuthorUid =
          data.authorMode === 'public_admin' ? data.ownerUID ?? null : null;
        const snippet = summarizeNotificationExcerpt(
          data.title || data.body,
          120
        );
        const imageId = data.mediaItems?.[0]?.imageId;

        if (!nextState.liked) {
          tx.delete(reactionRef);
          if (nextState.shouldUpdatePostLikesCount) {
            tx.update(updateRef, { likesCount: nextState.likesCount });
          }
          return {
            liked: false,
            likesCount: nextState.likesCount,
            publicAuthorUid,
            snippet,
            imageId,
          };
        }

        tx.set(reactionRef, {
          targetCollection: 'updates',
          targetId: input.updateId,
          ownerUID: input.actorUid,
          reactionType: input.reactionType ?? 'like',
          createdAt: serverTimestamp(),
        });
        tx.update(updateRef, { likesCount: nextState.likesCount });
        return {
          liked: true,
          likesCount: nextState.likesCount,
          publicAuthorUid,
          snippet,
          imageId,
        };
      })
    );

    // Notify ONLY public_admin owner; official_desk has no exposed ownerUID
    if (
      result.liked &&
      result.publicAuthorUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: result.publicAuthorUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildReactionNotificationId('updates', input.updateId, input.actorUid),
        recipientUid: result.publicAuthorUid,
        eventType: 'reaction',
        title: 'Someone liked your official update',
        body: result.snippet || undefined,
        targetPath: `/?view=updates&postId=${input.updateId}`,
        actorUid: input.actorUid,
        targetImageId: result.imageId,
      });
    }

    notifyAdminUpdateReactionChanged(
      input.updateId,
      result.liked,
      result.likesCount
    );

    return { liked: result.liked, likesCount: result.likesCount };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchOfficialUpdateComments(
  updateId: string
): Promise<CommentWithAuthor[]> {
  if (!isValidFirestoreId(updateId)) return [];

  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.postComments),
        where('postId', '==', updateId),
        where('status', '==', 'published'),
        limit(150)
      )
    );
    const items = snap.docs
      .map((d) => d.data() as PostComment)
      .filter((c) => c.targetCollection === 'updates')
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.createdAt) ?? 0;
        const bMs = extractTimestampMs(b.createdAt) ?? 0;
        return aMs - bMs;
      });

    const uids = Array.from(
      new Set(items.map((c) => c.ownerUID).filter(isValidFirestoreId))
    );
    const authorMap =
      uids.length > 0
        ? await fetchPublicProfileProjectionsByUids(uids)
        : new Map<string, PublicProfileProjection>();

    return items.map((comment) => ({
      comment,
      author: authorMap.get(comment.ownerUID) ?? null,
    }));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.postComments
    );
  }
}

export async function addOfficialUpdateComment(input: {
  updateId: string;
  body: string;
  parentCommentId?: string;
  actorUid: string;
}): Promise<{ comment: PostComment; commentsCount: number }> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.updateId)) {
    throw new Error('Sign in to comment on official updates.');
  }

  const cleanBody = input.body.trim();
  if (
    cleanBody.length < BLUEPRINT_LIMITS.commentBodyMin ||
    cleanBody.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be 1–${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }

  const updateRef = doc(db, COLLECTION_NAMES.updates, input.updateId);
  const commentId = generateFirestoreDocId(COLLECTION_NAMES.postComments);
  const commentRef = doc(db, COLLECTION_NAMES.postComments, commentId);
  const path = `${COLLECTION_NAMES.postComments}/${commentId}`;

  const payload: Record<string, unknown> = {
    id: commentId,
    postId: input.updateId,
    targetCollection: 'updates',
    ownerUID: input.actorUid,
    body: cleanBody,
    status: 'published',
    likesCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.parentCommentId && isValidFirestoreId(input.parentCommentId)) {
    payload.parentCommentId = input.parentCommentId;
  }

  let publicAuthorUid: string | null = null;
  let updateTitle = '';
  let updateImageId: string | undefined;

  try {
    const commentsCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const updateSnap = await tx.get(updateRef);
        if (!updateSnap.exists()) {
          throw new Error('This official update is no longer available.');
        }
        const data = updateSnap.data() as AdminUpdate;
        if (data.status !== 'published') {
          throw new Error('This official update is no longer available.');
        }
        publicAuthorUid =
          data.authorMode === 'public_admin' ? data.ownerUID ?? null : null;
        updateTitle = data.title || data.body;
        updateImageId = data.mediaItems?.[0]?.imageId;

        const nextCount = Math.max(0, Number(data.commentsCount ?? 0)) + 1;
        tx.set(commentRef, payload);
        tx.update(updateRef, { commentsCount: nextCount });
        return nextCount;
      })
    );

    const targetPath = `/?view=updates&postId=${input.updateId}&commentId=${commentId}`;
    const excerpt = summarizeNotificationExcerpt(cleanBody, 140);
    let parentOwnerUid: string | null = null;

    if (input.parentCommentId && isValidFirestoreId(input.parentCommentId)) {
      try {
        const parentSnap = await getDoc(
          doc(db, COLLECTION_NAMES.postComments, input.parentCommentId)
        );
        if (parentSnap.exists()) {
          parentOwnerUid = (parentSnap.data() as PostComment).ownerUID ?? null;
        }
      } catch {
        parentOwnerUid = null;
      }
    }

    if (
      parentOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: parentOwnerUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildReplyNotificationId(commentId),
        recipientUid: parentOwnerUid,
        eventType: 'reply',
        title: `Reply on "${summarizeNotificationExcerpt(updateTitle, 60)}"`,
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: updateImageId,
      });
    }

    if (
      publicAuthorUid &&
      publicAuthorUid !== parentOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: publicAuthorUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildCommentNotificationId(commentId),
        recipientUid: publicAuthorUid,
        eventType: 'comment',
        title: input.parentCommentId
          ? 'New reply on your official update'
          : 'Someone commented on your official update',
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: updateImageId,
      });
    }

    const mentionedUsernames = extractMentionedUsernames(cleanBody);
    if (mentionedUsernames.length > 0) {
      const excludeUids = new Set<string>([input.actorUid]);
      if (parentOwnerUid) excludeUids.add(parentOwnerUid);
      if (publicAuthorUid) excludeUids.add(publicAuthorUid);
      void resolveUserUidsByUsernames(mentionedUsernames, excludeUids).then(
        (recipients) =>
          Promise.allSettled(
            recipients.map((recipient) =>
              createSafeMemberNotification({
                id: buildMentionNotificationId(commentId, recipient.uid),
                recipientUid: recipient.uid,
                eventType: 'mention',
                title: 'Someone mentioned you in a comment',
                body: excerpt || undefined,
                targetPath,
                actorUid: input.actorUid,
                targetImageId: updateImageId,
              })
            )
          )
      );
    }

    if (!isUndergroundSupremeAdminUser(auth.currentUser)) {
      void updateDoc(doc(db, COLLECTION_NAMES.users, input.actorUid), {
        hasPublicActivity: true,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }

    notifyAdminUpdateCommentMutated(input.updateId, commentsCount);

    const nowMs = Date.now();
    return {
      comment: {
        id: commentId,
        postId: input.updateId,
        targetCollection: 'updates',
        parentCommentId: payload.parentCommentId as string | undefined,
        ownerUID: input.actorUid,
        body: cleanBody,
        status: 'published',
        likesCount: 0,
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      commentsCount,
    };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function editOfficialUpdateComment(input: {
  commentId: string;
  body: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.commentId)) {
    throw new Error('Invalid comment identifier.');
  }
  const cleanBody = input.body.trim();
  if (
    cleanBody.length < BLUEPRINT_LIMITS.commentBodyMin ||
    cleanBody.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be 1–${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }
  const path = `${COLLECTION_NAMES.postComments}/${input.commentId}`;
  try {
    await runWithFirestoreConnectionRetry(() =>
      updateDoc(doc(db, COLLECTION_NAMES.postComments, input.commentId), {
        body: cleanBody,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteOfficialUpdateComment(input: {
  updateId: string;
  commentId: string;
  replyIdsToRemove?: string[];
}): Promise<number> {
  if (
    !isValidFirestoreId(input.updateId) ||
    !isValidFirestoreId(input.commentId)
  ) {
    throw new Error('Invalid comment identifier.');
  }

  const idsToDelete = Array.from(
    new Set([input.commentId, ...(input.replyIdsToRemove ?? [])])
  ).filter(isValidFirestoreId);
  const updateRef = doc(db, COLLECTION_NAMES.updates, input.updateId);
  const path = `${COLLECTION_NAMES.postComments}/${input.commentId}`;

  try {
    const nextCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const updateSnap = await tx.get(updateRef);
        const currentCount = updateSnap.exists()
          ? Number((updateSnap.data() as AdminUpdate).commentsCount ?? 0)
          : 0;
        const computedNextCount = Math.max(0, currentCount - idsToDelete.length);

        for (const id of idsToDelete) {
          tx.delete(doc(db, COLLECTION_NAMES.postComments, id));
        }
        if (updateSnap.exists() && computedNextCount !== currentCount) {
          tx.update(updateRef, { commentsCount: computedNextCount });
        }
        return computedNextCount;
      })
    );

    notifyAdminUpdateCommentMutated(input.updateId, nextCount);
    return nextCount;
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

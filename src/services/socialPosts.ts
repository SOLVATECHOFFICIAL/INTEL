import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type UpdateData,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ALLOWED_ANONYMOUS_BACKGROUND_IDS,
  ALLOWED_TEXT_POST_BACKGROUND_IDS,
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  SUBCOLLECTION_NAMES,
  canRolePublishCommunityFeed,
  isValidFirestoreId,
  resolveAnonymousPostType,
  resolveOrdinaryPostType,
  validateAnonymousPostPayload,
  validateAnonymousReportPayload,
  validateCommunityPostPayload,
  validatePostMediaItems,
  type AnonymousBackgroundId,
  type AnonymousComment,
  type AnonymousIdentityMapping,
  type AnonymousPost,
  type AnonymousPostType,
  type AnonymousReport,
  type AnonymousReportReason,
  type AnonymousReportTargetType,
  type CampusEvent,
  type CommunityPost,
  type MarketplaceListing,
  type Opportunity,
  type OrdinaryPostType,
  type PostComment,
  type PostMediaMeta,
  type PostReaction,
  type PrivateAnonymousHistoryEntry,
  type PrivateUserData,
  type PublicProfileProjection,
  type PublicUserProfile,
  type ReactionType,
  type SavedPost,
  type TextPostBackgroundId,
  type UserRole,
  type UserRoleRecord,
} from '../types/database';
import {
  canRevealAnonymousAuthor,
  isFirebaseErrorCode,
  isUndergroundSupremeAdminUser,
  resolveAuthoritativeMappingRole,
  toPublicProfileProjection,
} from '../utils/authValidation';
import {
  buildPostViewDocId,
  hasRecordedPostViewLocally,
  markPostViewLocally,
} from '../utils/postViews';
import { extractTimestampMs } from '../utils/contextualSearch';
import {
  computeNextReactionTransactionState,
  isFirestoreSdkError,
  runWithFirestoreConnectionRetry,
} from '../utils/firestoreRetry';
import type { CompressedImageResult } from '../utils/imageCompression';
import {
  buildMediaImageFirestoreRecord,
  evictMediaImageCache,
  generateFirestoreDocId,
  primeMediaImageCache,
  type UploadProgressState,
} from './mediaStorage';
import {
  createSafeMemberNotification,
  fetchPublicProfileProjectionsByUids,
  resolveUserUidsByUsernames,
} from './firestoreFoundation';
import {
  buildCommentNotificationId,
  buildMentionNotificationId,
  buildReactionNotificationId,
  buildReplyNotificationId,
  extractMentionedUsernames,
  shouldEmitActivityNotification,
  summarizeNotificationExcerpt,
} from '../utils/notifications';
import {
  notifyAdminUpdateSavedChanged,
  notifyAnonymousPostCreated,
  notifyAnonymousPostDeleted,
  notifyAnonymousPostReactionChanged,
  notifyAnonymousPostSavedChanged,
  notifyCommunityPostCreated,
  notifyCommunityPostDeleted,
  notifyCommunityPostReactionChanged,
  notifyCommunityPostSavedChanged,
  notifyAnonymousPostUpdated,
  notifyCommunityPostUpdated,
  notifyEventSavedChanged,
  notifyMarketplaceListingCommentMutated,
  notifyOpportunitySavedChanged,
  notifyPostCommentMutated,
  notifyPostViewCountUpdated,
} from './cacheInvalidation';

export interface ComposerImageAttachment {
  clientId: string;
  imageId: string;
  caption: string;
  previewUrl: string;
  compressed?: CompressedImageResult;
  existingMeta?: PostMediaMeta;
}

export interface CommentWithAuthor {
  comment: PostComment | AnonymousComment;
  author: PublicProfileProjection | null;
}

export interface RevealedAuthorResult {
  entryId: string;
  authorUid: string;
  authorRole: UserRole;
  profile: PublicProfileProjection | null;
}

async function emitPublicMentionNotifications(input: {
  sourceId: string;
  text: string;
  actorUid: string;
  excludeUids?: readonly (string | null | undefined)[];
  title: string;
  targetPath: string;
  targetImageId?: string;
}): Promise<void> {
  try {
    const usernames = extractMentionedUsernames(input.text);
    if (usernames.length === 0) return;
    const excludeSet = new Set<string>([input.actorUid]);
    for (const uid of input.excludeUids ?? []) {
      if (uid && isValidFirestoreId(uid)) {
        excludeSet.add(uid);
      }
    }
    const recipients = await resolveUserUidsByUsernames(usernames, excludeSet);
    if (recipients.length === 0) return;

    const excerpt = summarizeNotificationExcerpt(input.text, 140);
    await Promise.allSettled(
      recipients.map((recipient) =>
        createSafeMemberNotification({
          id: buildMentionNotificationId(input.sourceId, recipient.uid),
          recipientUid: recipient.uid,
          eventType: 'mention',
          title: input.title,
          body: excerpt || undefined,
          targetPath: input.targetPath,
          actorUid: input.actorUid,
          targetImageId: input.targetImageId,
        })
      )
    );
  } catch {
    // Non-blocking mention notifications
  }
}

function buildOrderedMediaItems(
  attachments: ComposerImageAttachment[],
  options: { allowPerPhotoCaptions?: boolean } = {}
): PostMediaMeta[] {
  const allowPerPhotoCaptions = options.allowPerPhotoCaptions ?? true;
  if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    throw new Error(
      `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
    );
  }

  return attachments.map((att, index) => {
    const cleanCaption = allowPerPhotoCaptions
      ? att.caption.trim().slice(0, BLUEPRINT_LIMITS.imageCaptionMax)
      : '';
    if (att.existingMeta) {
      const meta: PostMediaMeta = {
        imageId: att.existingMeta.imageId,
        width: att.existingMeta.width,
        height: att.existingMeta.height,
        byteSize: att.existingMeta.byteSize,
        mimeType: att.existingMeta.mimeType,
        order: index,
      };
      if (cleanCaption) {
        meta.caption = cleanCaption;
      }
      return meta;
    }

    if (!att.compressed) {
      throw new Error(`Missing compressed image data for photograph ${index + 1}.`);
    }

    const meta: PostMediaMeta = {
      imageId: att.imageId,
      width: att.compressed.width,
      height: att.compressed.height,
      byteSize: att.compressed.byteSize,
      mimeType: att.compressed.mimeType,
      order: index,
    };
    if (cleanCaption) {
      meta.caption = cleanCaption;
    }
    return meta;
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
  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      existing.push(item.value);
    }
  }
  return existing;
}

async function commitWriteBatchWithRetry(
  batch: WriteBatch,
  opType: OperationType,
  path: string,
  actorUid?: string
): Promise<void> {
  try {
    await runWithFirestoreConnectionRetry(() => batch.commit());
  } catch (error) {
    const isPermDenied =
      isFirebaseErrorCode(error, 'permission-denied') ||
      isFirebaseErrorCode(error, 'firestore/permission-denied') ||
      (error instanceof Error && /insufficient permissions/i.test(error.message));

    if (isPermDenied && actorUid && auth.currentUser?.uid === actorUid) {
      try {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        await runWithFirestoreConnectionRetry(() => batch.commit());
        return;
      } catch (retryError) {
        handleFirestoreError(retryError, opType, path);
      }
    }
    handleFirestoreError(error, opType, path);
  }
}

async function readPrivateAnonymousOwnership(uid: string): Promise<{
  exists: boolean;
  postIds: string[];
  commentIds: string[];
}> {
  if (!isValidFirestoreId(uid)) {
    return { exists: false, postIds: [], commentIds: [] };
  }
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.privateUserData, uid));
    if (!snap.exists()) {
      return { exists: false, postIds: [], commentIds: [] };
    }
    const data = snap.data() as PrivateUserData;
    return {
      exists: true,
      postIds: Array.isArray(data.ownedAnonymousPostIds)
        ? data.ownedAnonymousPostIds
        : [],
      commentIds: Array.isArray(data.ownedAnonymousCommentIds)
        ? data.ownedAnonymousCommentIds
        : [],
    };
  } catch {
    return { exists: false, postIds: [], commentIds: [] };
  }
}

async function resolveAuthorRoleForAnonymousMapping(
  uid: string,
  fallbackRole: UserRole
): Promise<UserRole> {
  const currentUser = auth.currentUser?.uid === uid ? auth.currentUser : null;
  try {
    const roleSnap = await getDoc(doc(db, COLLECTION_NAMES.userRoles, uid));
    const rawRoleDoc = roleSnap.exists()
      ? (roleSnap.data() as Partial<UserRoleRecord>)
      : null;
    return resolveAuthoritativeMappingRole(currentUser, rawRoleDoc, fallbackRole);
  } catch {
    return resolveAuthoritativeMappingRole(currentUser, undefined, fallbackRole);
  }
}

export async function fetchOwnedAnonymousEntries(
  uid: string | null | undefined
): Promise<{ postIds: Set<string>; commentIds: Set<string> }> {
  if (!uid || !isValidFirestoreId(uid)) {
    return { postIds: new Set(), commentIds: new Set() };
  }
  const [historySnap, legacyOwnership] = await Promise.all([
    getDocs(
      query(
        collection(
          db,
          COLLECTION_NAMES.privateUserData,
          uid,
          SUBCOLLECTION_NAMES.anonymousHistory
        ),
        limit(100)
      )
    ).catch(() => null),
    readPrivateAnonymousOwnership(uid),
  ]);

  const postIds = new Set<string>(legacyOwnership.postIds);
  if (historySnap) {
    for (const item of historySnap.docs) {
      const data = item.data() as PrivateAnonymousHistoryEntry;
      const targetId = isValidFirestoreId(data.postId) ? data.postId : item.id;
      if (isValidFirestoreId(targetId)) {
        postIds.add(targetId);
      }
    }
  }

  return {
    postIds,
    commentIds: new Set(legacyOwnership.commentIds),
  };
}

export async function createCommunityPostWithMedia(input: {
  ownerUID: string;
  authorRole: UserRole;
  postType: OrdinaryPostType;
  category: string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  attachments: ComposerImageAttachment[];
  isOfficial?: boolean;
  onProgress?: (state: UploadProgressState) => void;
}): Promise<CommunityPost> {
  if (!canRolePublishCommunityFeed(input.authorRole)) {
    throw new Error(
      'Only Verified members, Moderators, and Administrators can publish ordinary updates.'
    );
  }
  if (!isValidFirestoreId(input.ownerUID)) {
    throw new Error('Sign in with a verified account to publish updates.');
  }

  const postId = generateFirestoreDocId(COLLECTION_NAMES.posts);
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const cleanCategory = input.category.trim();
  const isOfficial =
    input.authorRole === 'supreme_admin' && Boolean(input.isOfficial);

  const isTextPost = input.postType === 'text';
  const effectiveAttachments = isTextPost ? [] : input.attachments;
  const mediaItems = isTextPost
    ? []
    : buildOrderedMediaItems(effectiveAttachments, {
        allowPerPhotoCaptions: false,
      });

  const postDoc: Record<string, unknown> = {
    id: postId,
    ownerUID: input.ownerUID,
    authorRole: input.authorRole,
    postType: input.postType,
    category: cleanCategory,
    body: cleanBody,
    isOfficial,
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (cleanTitle) {
    postDoc.title = cleanTitle;
  }
  if (isTextPost) {
    if (
      input.backgroundStyle &&
      ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(input.backgroundStyle)
    ) {
      postDoc.backgroundStyle = input.backgroundStyle;
    }
  } else if (mediaItems.length > 0) {
    postDoc.mediaItems = mediaItems;
  }

  validateCommunityPostPayload(postDoc);

  input.onProgress?.({
    percent: 30,
    label:
      mediaItems.length > 0
        ? `Uploading ${mediaItems.length} compressed photograph(s)...`
        : 'Publishing campus update...',
  });

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.posts, postId), postDoc);

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'posts',
      targetId: postId,
      ownerUID: input.ownerUID,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  input.onProgress?.({ percent: 70, label: 'Confirming with Firebase...' });

  const path = `${COLLECTION_NAMES.posts}/${postId}`;
  await commitWriteBatchWithRetry(batch, OperationType.CREATE, path, input.ownerUID);

  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  if (!isUndergroundSupremeAdminUser(auth.currentUser)) {
    void updateDoc(doc(db, COLLECTION_NAMES.users, input.ownerUID), {
      hasPublicActivity: true,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }
  input.onProgress?.({ percent: 100, label: 'Published' });

  const createdPost: CommunityPost = {
    ...(postDoc as unknown as CommunityPost),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notifyCommunityPostCreated(createdPost);

  const mentionText = [cleanTitle, cleanBody].filter(Boolean).join(' ');
  if (mentionText) {
    void emitPublicMentionNotifications({
      sourceId: postId,
      text: mentionText,
      actorUid: input.ownerUID,
      title: 'You were mentioned in a campus post',
      targetPath: `/?view=for-you&postId=${postId}`,
      targetImageId: mediaItems[0]?.imageId,
    });
  }

  return createdPost;
}

export async function createAnonymousPostWithMedia(input: {
  authorUid: string;
  authorRole: UserRole;
  postType: AnonymousPostType;
  category: string;
  body: string;
  backgroundStyle?: AnonymousBackgroundId;
  attachments: ComposerImageAttachment[];
  onProgress?: (state: UploadProgressState) => void;
}): Promise<AnonymousPost> {
  if (!isValidFirestoreId(input.authorUid)) {
    throw new Error('Sign in before publishing an anonymous post.');
  }

  const postId = generateFirestoreDocId(COLLECTION_NAMES.anonymousPosts);
  const isTextPost = input.postType === 'text';
  const effectiveAttachments = isTextPost ? [] : input.attachments;
  const mediaItems = isTextPost
    ? []
    : buildOrderedMediaItems(effectiveAttachments, {
        allowPerPhotoCaptions: false,
      });
  const cleanCategory = input.category.trim();
  const cleanBody = input.body.trim();

  const effectiveBg: AnonymousBackgroundId | undefined =
    isTextPost &&
    input.backgroundStyle &&
    input.backgroundStyle !== 'plain' &&
    ALLOWED_ANONYMOUS_BACKGROUND_IDS.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : undefined;

  const publicDoc: Record<string, unknown> = {
    id: postId,
    postType: input.postType,
    category: cleanCategory,
    body: cleanBody,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (effectiveBg) {
    publicDoc.backgroundStyle = effectiveBg;
  }
  if (!isTextPost && mediaItems.length > 0) {
    publicDoc.mediaItems = mediaItems;
  }

  validateAnonymousPostPayload(publicDoc);

  input.onProgress?.({
    percent: 30,
    label:
      mediaItems.length > 0
        ? `Uploading ${mediaItems.length} anonymous photograph(s)...`
        : 'Publishing anonymous post...',
  });

  const mappingRole = await resolveAuthorRoleForAnonymousMapping(
    input.authorUid,
    input.authorRole
  );

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.anonymousPosts, postId), publicDoc);
  batch.set(
    doc(db, COLLECTION_NAMES.anonymousIdentityMappings, postId),
    {
      entryId: postId,
      entryType: 'anonymousPosts',
      authorUid: input.authorUid,
      authorRole: mappingRole,
      createdAt: serverTimestamp(),
    }
  );

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'anonymousPosts',
      targetId: postId,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  batch.set(
    doc(
      db,
      COLLECTION_NAMES.privateUserData,
      input.authorUid,
      SUBCOLLECTION_NAMES.anonymousHistory,
      postId
    ),
    {
      postId,
      createdAt: serverTimestamp(),
    }
  );

  input.onProgress?.({ percent: 72, label: 'Confirming with Firebase...' });

  const path = `${COLLECTION_NAMES.anonymousPosts}/${postId}`;
  await commitWriteBatchWithRetry(
    batch,
    OperationType.CREATE,
    path,
    input.authorUid
  );

  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Published anonymously' });

  const createdAnonPost: AnonymousPost = {
    ...(publicDoc as unknown as AnonymousPost),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notifyAnonymousPostCreated(createdAnonPost, input.authorUid);
  return createdAnonPost;
}

export async function updateCommunityPostWithMedia(input: {
  post: CommunityPost;
  actorUid: string;
  category: string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  attachments: ComposerImageAttachment[];
  onProgress?: (state: UploadProgressState) => void;
}): Promise<CommunityPost> {
  const lockedPostType = resolveOrdinaryPostType(input.post);
  const isTextPost = lockedPostType === 'text';
  const effectiveAttachments = isTextPost ? [] : input.attachments;
  const mediaItems = isTextPost
    ? []
    : buildOrderedMediaItems(effectiveAttachments, {
        allowPerPhotoCaptions: false,
      });
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const cleanCategory = input.category.trim();
  const resolvedBg =
    isTextPost &&
    input.backgroundStyle &&
    ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : isTextPost
      ? input.post.backgroundStyle ?? ALLOWED_TEXT_POST_BACKGROUND_IDS[0]
      : undefined;

  const checkPayload: Record<string, unknown> = {
    id: input.post.id,
    ownerUID: input.post.ownerUID,
    postType: lockedPostType,
    category: cleanCategory,
    title: cleanTitle,
    body: cleanBody,
  };
  if (isTextPost && resolvedBg) {
    checkPayload.backgroundStyle = resolvedBg;
  } else {
    checkPayload.mediaItems = mediaItems;
  }

  validateCommunityPostPayload(checkPayload);

  const previousImageIds = (input.post.mediaItems ?? []).map((m) => m.imageId);
  const keptImageIds = new Set(mediaItems.map((m) => m.imageId));
  const removedCandidates = previousImageIds.filter(
    (id) => !keptImageIds.has(id)
  );
  const removedExistingIds = await resolveExistingImageIds(removedCandidates);

  input.onProgress?.({ percent: 45, label: 'Saving post changes...' });

  const batch = writeBatch(db);
  const updateFields: UpdateData<CommunityPost> = {
    category: cleanCategory,
    title: cleanTitle || deleteField(),
    body: cleanBody,
    backgroundStyle: isTextPost && resolvedBg ? resolvedBg : deleteField(),
    mediaItems: !isTextPost && mediaItems.length > 0 ? mediaItems : deleteField(),
    updatedAt: serverTimestamp(),
  };

  batch.update(doc(db, COLLECTION_NAMES.posts, input.post.id), updateFields);

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'posts',
      targetId: input.post.id,
      ownerUID: input.actorUid,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  for (const removedId of removedExistingIds) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, removedId));
  }

  const path = `${COLLECTION_NAMES.posts}/${input.post.id}`;
  await commitWriteBatchWithRetry(batch, OperationType.UPDATE, path, input.actorUid);

  for (const removedId of removedCandidates) {
    evictMediaImageCache(removedId);
  }
  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Updated' });

  const updatedPost: CommunityPost = {
    ...input.post,
    postType: lockedPostType,
    category: cleanCategory,
    title: cleanTitle || undefined,
    body: cleanBody,
    backgroundStyle: isTextPost ? resolvedBg : undefined,
    mediaItems: !isTextPost && mediaItems.length > 0 ? mediaItems : undefined,
    updatedAt: Date.now(),
  };
  notifyCommunityPostUpdated(updatedPost);
  return updatedPost;
}

export async function updateAnonymousPostWithMedia(input: {
  post: AnonymousPost;
  category: string;
  body: string;
  backgroundStyle?: AnonymousBackgroundId;
  attachments: ComposerImageAttachment[];
  onProgress?: (state: UploadProgressState) => void;
}): Promise<AnonymousPost> {
  const lockedPostType = resolveAnonymousPostType(input.post);
  const isTextPost = lockedPostType === 'text';
  const effectiveAttachments = isTextPost ? [] : input.attachments;
  const mediaItems = isTextPost
    ? []
    : buildOrderedMediaItems(effectiveAttachments, {
        allowPerPhotoCaptions: false,
      });
  const cleanCategory = input.category.trim();
  const cleanBody = input.body.trim();
  const effectiveBg: AnonymousBackgroundId | undefined =
    isTextPost &&
    input.backgroundStyle &&
    input.backgroundStyle !== 'plain' &&
    ALLOWED_ANONYMOUS_BACKGROUND_IDS.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : undefined;

  const checkPayload: Record<string, unknown> = {
    id: input.post.id,
    category: cleanCategory,
    body: cleanBody,
  };
  if (input.post.postType) {
    checkPayload.postType = lockedPostType;
  }
  if (effectiveBg) checkPayload.backgroundStyle = effectiveBg;
  if (!isTextPost && mediaItems.length > 0) {
    checkPayload.mediaItems = mediaItems;
  }
  validateAnonymousPostPayload(checkPayload);

  const previousImageIds = (input.post.mediaItems ?? []).map((m) => m.imageId);
  const keptImageIds = new Set(mediaItems.map((m) => m.imageId));
  const removedCandidates = previousImageIds.filter(
    (id) => !keptImageIds.has(id)
  );
  const removedExistingIds = await resolveExistingImageIds(removedCandidates);

  input.onProgress?.({ percent: 45, label: 'Updating anonymous post...' });

  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.anonymousPosts, input.post.id), {
    category: cleanCategory,
    body: cleanBody,
    backgroundStyle: isTextPost && effectiveBg ? effectiveBg : deleteField(),
    mediaItems: !isTextPost && mediaItems.length > 0 ? mediaItems : deleteField(),
    updatedAt: serverTimestamp(),
  });

  for (const att of effectiveAttachments) {
    if (!att.compressed) continue;
    const mediaRecord = buildMediaImageFirestoreRecord({
      imageId: att.imageId,
      targetCollection: 'anonymousPosts',
      targetId: input.post.id,
      compressed: att.compressed,
      createdAtValue: serverTimestamp(),
    });
    batch.set(doc(db, COLLECTION_NAMES.mediaImages, att.imageId), mediaRecord);
  }

  for (const removedId of removedExistingIds) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, removedId));
  }

  const path = `${COLLECTION_NAMES.anonymousPosts}/${input.post.id}`;
  await commitWriteBatchWithRetry(
    batch,
    OperationType.UPDATE,
    path,
    auth.currentUser?.uid
  );

  for (const removedId of removedCandidates) {
    evictMediaImageCache(removedId);
  }
  for (const att of effectiveAttachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Updated' });

  const updatedAnonPost: AnonymousPost = {
    ...input.post,
    category: cleanCategory,
    body: cleanBody,
    backgroundStyle: isTextPost ? effectiveBg : undefined,
    mediaItems: !isTextPost && mediaItems.length > 0 ? mediaItems : undefined,
    updatedAt: Date.now(),
  };
  notifyAnonymousPostUpdated(updatedAnonPost);
  return updatedAnonPost;
}

export async function removeSingleImageFromPost(input: {
  kind: 'posts' | 'anonymousPosts';
  post: CommunityPost | AnonymousPost;
  imageIdToRemove: string;
}): Promise<CommunityPost | AnonymousPost> {
  const remaining = (input.post.mediaItems ?? [])
    .filter((item) => item.imageId !== input.imageIdToRemove)
    .map((item, idx) => ({ ...item, order: idx }));

  if (input.kind === 'posts' && remaining.length === 0) {
    throw new Error(
      'Photo posts require at least one photograph. Edit or delete the post instead.'
    );
  }

  if (input.post.body.trim().length === 0 && remaining.length === 0) {
    throw new Error(
      'Cannot remove the only image when the post caption is empty. Edit the post or delete it instead.'
    );
  }

  validatePostMediaItems(remaining);
  const existingToDelete = await resolveExistingImageIds([
    input.imageIdToRemove,
  ]);

  const collectionName =
    input.kind === 'posts'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;
  const batch = writeBatch(db);
  batch.update(doc(db, collectionName, input.post.id), {
    mediaItems: remaining.length > 0 ? remaining : deleteField(),
    updatedAt: serverTimestamp(),
  });

  for (const id of existingToDelete) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, id));
  }

  const path = `${collectionName}/${input.post.id}`;
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  evictMediaImageCache(input.imageIdToRemove);
  const updatedPost = {
    ...input.post,
    mediaItems: remaining.length > 0 ? remaining : undefined,
    updatedAt: Date.now(),
  };
  if (input.kind === 'posts') {
    notifyCommunityPostUpdated(updatedPost as CommunityPost);
  } else {
    notifyAnonymousPostUpdated(updatedPost as AnonymousPost);
  }
  return updatedPost;
}

/**
 * Atomically deletes a community or anonymous post along with ALL associated
 * comments, nested replies, reactions, image documents, and identity mappings.
 */
export async function deletePostCascading(input: {
  kind: 'posts' | 'anonymousPosts';
  post: CommunityPost | AnonymousPost;
  actorUid: string;
}): Promise<void> {
  const postId = input.post.id;
  const collectionName =
    input.kind === 'posts'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;
  const commentCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;

  const commentFetchLimit = input.kind === 'anonymousPosts' ? 150 : 200;

  const [commentsSnap, reactionsSnap, mediaQuerySnap, savedActorSnap] =
    await Promise.all([
      getDocs(
        query(
          collection(db, commentCollection),
          where('postId', '==', postId),
          where('status', '==', 'published'),
          limit(commentFetchLimit)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.postReactions),
          where('targetCollection', '==', input.kind),
          where('targetId', '==', postId),
          limit(300)
        )
      ).catch(() => null),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.mediaImages),
          where('targetCollection', '==', input.kind),
          where('targetId', '==', postId),
          limit(20)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.savedPosts),
          where('ownerUID', '==', input.actorUid),
          where('targetId', '==', postId),
          limit(10)
        )
      ).catch(() => null),
    ]);

  const mediaIdsFromPost = (input.post.mediaItems ?? []).map((m) => m.imageId);
  const existingMediaIds = new Set<string>(
    mediaQuerySnap.docs.map((item) => item.id)
  );
  const extraExisting = await resolveExistingImageIds(
    mediaIdsFromPost.filter((id) => !existingMediaIds.has(id))
  );
  for (const id of extraExisting) {
    existingMediaIds.add(id);
  }

  let ownership: {
    exists: boolean;
    postIds: string[];
    commentIds: string[];
  } | null = null;
  let hasAnonymousHistoryDoc = false;
  let actorOwnAnonReactionRef: ReturnType<typeof doc> | null = null;

  if (input.kind === 'anonymousPosts') {
    const [ownResult, historySnap, actorReactionSnap] = await Promise.all([
      readPrivateAnonymousOwnership(input.actorUid),
      getDoc(
        doc(
          db,
          COLLECTION_NAMES.privateUserData,
          input.actorUid,
          SUBCOLLECTION_NAMES.anonymousHistory,
          postId
        )
      ).catch(() => null),
      reactionsSnap === null
        ? getDoc(
            doc(
              db,
              COLLECTION_NAMES.postReactions,
              `${input.kind}_${postId}_${input.actorUid}`
            )
          ).catch(() => null)
        : Promise.resolve(null),
    ]);
    ownership = ownResult;
    hasAnonymousHistoryDoc = Boolean(historySnap?.exists());
    if (actorReactionSnap?.exists()) {
      actorOwnAnonReactionRef = actorReactionSnap.ref;
    }
  }

  // Chunk 0 keeps the post, identity mappings, history, media, saved bookmarks, and comments atomic
  // so exists()/!existsAfter() security rule checks evaluate cleanly inside a <= 380-write batch.
  const primaryRefs: Array<ReturnType<typeof doc>> = [];
  for (const commentDoc of commentsSnap.docs) {
    primaryRefs.push(commentDoc.ref);
    if (input.kind === 'anonymousPosts') {
      primaryRefs.push(
        doc(db, COLLECTION_NAMES.anonymousIdentityMappings, commentDoc.id)
      );
    }
  }
  if (savedActorSnap) {
    for (const savedDoc of savedActorSnap.docs) {
      if ((savedDoc.data() as SavedPost).targetCollection === input.kind) {
        primaryRefs.push(savedDoc.ref);
      }
    }
  }
  for (const mediaId of existingMediaIds) {
    primaryRefs.push(doc(db, COLLECTION_NAMES.mediaImages, mediaId));
  }
  if (input.kind === 'anonymousPosts') {
    primaryRefs.push(doc(db, COLLECTION_NAMES.anonymousIdentityMappings, postId));
    if (hasAnonymousHistoryDoc) {
      primaryRefs.push(
        doc(
          db,
          COLLECTION_NAMES.privateUserData,
          input.actorUid,
          SUBCOLLECTION_NAMES.anonymousHistory,
          postId
        )
      );
    }
  }
  primaryRefs.push(doc(db, collectionName, postId));

  const reactionRefs: Array<ReturnType<typeof doc>> = reactionsSnap
    ? reactionsSnap.docs.map((reactionDoc) => reactionDoc.ref)
    : actorOwnAnonReactionRef
      ? [actorOwnAnonReactionRef]
      : [];

  const CHUNK_SIZE = 380;
  const remainingPrimaryCapacity = Math.max(0, CHUNK_SIZE - primaryRefs.length);
  const chunk0Refs = [
    ...primaryRefs,
    ...reactionRefs.slice(0, remainingPrimaryCapacity),
  ];
  const overflowReactionRefs = reactionRefs.slice(remainingPrimaryCapacity);

  const path = `${collectionName}/${postId}`;
  try {
    const firstBatch = writeBatch(db);
    for (const ref of chunk0Refs) {
      firstBatch.delete(ref);
    }
    await firstBatch.commit();

    for (let i = 0; i < overflowReactionRefs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const ref of overflowReactionRefs.slice(i, i + CHUNK_SIZE)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (
    input.kind === 'anonymousPosts' &&
    ownership?.exists &&
    ownership.postIds.includes(postId)
  ) {
    updateDoc(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
      ownedAnonymousPostIds: ownership.postIds.filter((id) => id !== postId),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }

  for (const mediaId of existingMediaIds) {
    evictMediaImageCache(mediaId);
  }
  for (const metaId of mediaIdsFromPost) {
    evictMediaImageCache(metaId);
  }
  if (input.kind === 'posts') {
    notifyCommunityPostDeleted(postId);
  } else {
    notifyAnonymousPostDeleted(postId);
  }
}

export async function togglePostReaction(input: {
  kind: 'posts' | 'anonymousPosts';
  postId: string;
  actorUid: string;
  reactionType?: ReactionType;
  currentlyLiked?: boolean;
}): Promise<{ liked: boolean; likesCount: number }> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.postId)) {
    throw new Error('Sign in to like campus posts.');
  }

  const reactionId = `${input.kind}_${input.postId}_${input.actorUid}`;
  const collectionName =
    input.kind === 'posts'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;
  const postRef = doc(db, collectionName, input.postId);
  const reactionRef = doc(db, COLLECTION_NAMES.postReactions, reactionId);
  const path = `${collectionName}/${input.postId}`;

  try {
    const result = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [postSnap, reactionSnap] = await Promise.all([
          tx.get(postRef),
          tx.get(reactionRef),
        ]);

        if (!postSnap.exists()) {
          throw new Error('This post is no longer available.');
        }

        const postData = postSnap.data() as {
          ownerUID?: string;
          title?: string;
          body?: string;
          mediaItems?: PostMediaMeta[];
          likesCount?: number;
        };
        const postOwnerUid =
          input.kind === 'posts' ? postData.ownerUID ?? null : null;
        const postSnippet =
          input.kind === 'posts'
            ? summarizeNotificationExcerpt(postData.title || postData.body, 120)
            : '';
        const postImageId =
          input.kind === 'posts' ? postData.mediaItems?.[0]?.imageId : undefined;

        const nextState = computeNextReactionTransactionState({
          alreadyLiked: reactionSnap.exists(),
          currentLikesCount: postData.likesCount,
        });

        if (!nextState.liked) {
          tx.delete(reactionRef);
          if (nextState.shouldUpdatePostLikesCount) {
            tx.update(postRef, { likesCount: nextState.likesCount });
          }
          return {
            liked: false,
            likesCount: nextState.likesCount,
            postOwnerUid,
            postSnippet,
            postImageId,
          };
        }

        tx.set(reactionRef, {
          targetCollection: input.kind,
          targetId: input.postId,
          ownerUID: input.actorUid,
          reactionType: input.reactionType ?? 'like',
          createdAt: serverTimestamp(),
        });
        tx.update(postRef, { likesCount: nextState.likesCount });
        return {
          liked: true,
          likesCount: nextState.likesCount,
          postOwnerUid,
          postSnippet,
          postImageId,
        };
      })
    );

    if (
      input.kind === 'posts' &&
      result.liked &&
      result.postOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: result.postOwnerUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildReactionNotificationId('posts', input.postId, input.actorUid),
        recipientUid: result.postOwnerUid,
        eventType: 'reaction',
        title: 'Someone liked your post',
        body: result.postSnippet || undefined,
        targetPath: `/?view=for-you&postId=${input.postId}`,
        actorUid: input.actorUid,
        targetImageId: result.postImageId,
      });
    }

    if (input.kind === 'posts') {
      notifyCommunityPostReactionChanged(
        input.postId,
        result.liked,
        result.likesCount
      );
    } else {
      notifyAnonymousPostReactionChanged(
        input.postId,
        result.liked,
        result.likesCount
      );
    }

    return {
      liked: result.liked,
      likesCount: result.likesCount,
    };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchViewerLikedPostIds(
  kind:
    | 'posts'
    | 'anonymousPosts'
    | 'anonymousComments'
    | 'events'
    | 'postComments'
    | 'updates',
  viewerUid: string | null | undefined
): Promise<Set<string>> {
  if (!viewerUid || !isValidFirestoreId(viewerUid)) {
    return new Set();
  }

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.postReactions),
      where('ownerUID', '==', viewerUid),
      where('targetCollection', '==', kind),
      limit(200)
    );
    const snap = await getDocs(q);
    const likedIds = new Set<string>();
    for (const item of snap.docs) {
      const data = item.data() as PostReaction;
      likedIds.add(data.targetId);
    }
    return likedIds;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.postReactions);
  }
}

export async function toggleAnonymousCommentReaction(input: {
  commentId: string;
  actorUid: string;
  currentlyLiked?: boolean;
}): Promise<{ liked: boolean; likesCount: number }> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.commentId)) {
    throw new Error('Sign in to like anonymous comments.');
  }

  const reactionId = `anonymousComments_${input.commentId}_${input.actorUid}`;
  const commentRef = doc(db, COLLECTION_NAMES.anonymousComments, input.commentId);
  const reactionRef = doc(db, COLLECTION_NAMES.postReactions, reactionId);
  const path = `${COLLECTION_NAMES.anonymousComments}/${input.commentId}`;

  try {
    return await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [commentSnap, reactionSnap] = await Promise.all([
          tx.get(commentRef),
          tx.get(reactionRef),
        ]);
        if (!commentSnap.exists()) {
          throw new Error('This comment is no longer available.');
        }

        const nextState = computeNextReactionTransactionState({
          alreadyLiked: reactionSnap.exists(),
          currentLikesCount: (commentSnap.data() as { likesCount?: number })
            .likesCount,
        });

        if (!nextState.liked) {
          tx.delete(reactionRef);
          if (nextState.shouldUpdatePostLikesCount) {
            tx.update(commentRef, { likesCount: nextState.likesCount });
          }
          return { liked: false, likesCount: nextState.likesCount };
        }

        tx.set(reactionRef, {
          targetCollection: 'anonymousComments',
          targetId: input.commentId,
          ownerUID: input.actorUid,
          reactionType: 'like',
          createdAt: serverTimestamp(),
        });
        tx.update(commentRef, { likesCount: nextState.likesCount });
        return { liked: true, likesCount: nextState.likesCount };
      })
    );
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function submitAnonymousReport(input: {
  targetType: AnonymousReportTargetType;
  targetId: string;
  postId: string;
  reporterUid: string;
  reason: AnonymousReportReason;
  details?: string;
  excerpt: string;
}): Promise<AnonymousReport> {
  if (!isValidFirestoreId(input.reporterUid)) {
    throw new Error('Sign in to report inappropriate anonymous content.');
  }

  const reportId = `${input.targetType}_${input.targetId}_${input.reporterUid}`;
  const cleanDetails = input.details?.trim().slice(0, 500) ?? '';
  const cleanExcerpt = input.excerpt.trim().slice(0, 240);

  const payload: Record<string, unknown> = {
    id: reportId,
    targetType: input.targetType,
    targetId: input.targetId,
    postId: input.postId,
    reporterUid: input.reporterUid,
    reason: input.reason,
    excerpt: cleanExcerpt,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanDetails) {
    payload.details = cleanDetails;
  }

  validateAnonymousReportPayload(payload);

  const reportRef = doc(db, COLLECTION_NAMES.anonymousReports, reportId);
  const path = `${COLLECTION_NAMES.anonymousReports}/${reportId}`;

  try {
    const existingSnap = await getDoc(reportRef);
    if (existingSnap.exists()) {
      throw new Error(
        'You have already reported this item. Moderators will review it shortly.'
      );
    }
    await setDoc(reportRef, payload);
    return {
      ...(payload as unknown as AnonymousReport),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export type SavedTargetCollection = SavedPost['targetCollection'];

export interface SavedCommunityPostItem {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export interface SavedContentBundle {
  posts: SavedCommunityPostItem[];
  anonymousPosts: AnonymousPost[];
  listings: MarketplaceListing[];
  opportunities: Opportunity[];
  events: CampusEvent[];
}

export async function fetchViewerSavedPostIds(
  kind: SavedTargetCollection,
  viewerUid: string | null | undefined
): Promise<Set<string>> {
  if (!viewerUid || !isValidFirestoreId(viewerUid)) {
    return new Set();
  }

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.savedPosts),
      where('ownerUID', '==', viewerUid),
      limit(200)
    );
    const snap = await getDocs(q);
    const savedIds = new Set<string>();
    for (const item of snap.docs) {
      const data = item.data() as SavedPost;
      if (data.targetCollection === kind) {
        savedIds.add(data.targetId);
      }
    }
    return savedIds;
  } catch {
    return new Set();
  }
}

export async function toggleSavedPost(input: {
  actorUid: string;
  targetCollection: SavedTargetCollection;
  targetId: string;
  currentlySaved?: boolean;
}): Promise<{ saved: boolean }> {
  if (
    !isValidFirestoreId(input.actorUid) ||
    !isValidFirestoreId(input.targetId)
  ) {
    throw new Error('Sign in to bookmark campus posts.');
  }

  const savedId = `${input.actorUid}_${input.targetCollection}_${input.targetId}`;
  const savedRef = doc(db, COLLECTION_NAMES.savedPosts, savedId);
  const path = `${COLLECTION_NAMES.savedPosts}/${savedId}`;

  let shouldUnsave = input.currentlySaved;
  if (shouldUnsave === undefined) {
    const existingSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.savedPosts),
        where('ownerUID', '==', input.actorUid),
        where('targetId', '==', input.targetId),
        limit(10)
      )
    );
    shouldUnsave = existingSnap.docs.some(
      (d) => (d.data() as SavedPost).targetCollection === input.targetCollection
    );
  }

  try {
    if (shouldUnsave) {
      await runWithFirestoreConnectionRetry(() => deleteDoc(savedRef));
      if (input.targetCollection === 'posts') {
        notifyCommunityPostSavedChanged(input.targetId, false);
      } else if (input.targetCollection === 'updates') {
        notifyAdminUpdateSavedChanged(input.targetId, false);
      } else if (input.targetCollection === 'anonymousPosts') {
        notifyAnonymousPostSavedChanged(input.targetId, false);
      } else if (input.targetCollection === 'events') {
        notifyEventSavedChanged(input.targetId, false);
      } else if (input.targetCollection === 'opportunities') {
        notifyOpportunitySavedChanged(input.targetId, false);
      }
      return { saved: false };
    }
    await runWithFirestoreConnectionRetry(() =>
      setDoc(savedRef, {
        id: savedId,
        ownerUID: input.actorUid,
        targetCollection: input.targetCollection,
        targetId: input.targetId,
        createdAt: serverTimestamp(),
      })
    );
    if (input.targetCollection === 'posts') {
      notifyCommunityPostSavedChanged(input.targetId, true);
    } else if (input.targetCollection === 'updates') {
      notifyAdminUpdateSavedChanged(input.targetId, true);
    } else if (input.targetCollection === 'anonymousPosts') {
      notifyAnonymousPostSavedChanged(input.targetId, true);
    } else if (input.targetCollection === 'events') {
      notifyEventSavedChanged(input.targetId, true);
    } else if (input.targetCollection === 'opportunities') {
      notifyOpportunitySavedChanged(input.targetId, true);
    }
    return { saved: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchOwnerSavedContentBundle(
  ownerUid: string
): Promise<SavedContentBundle> {
  if (!isValidFirestoreId(ownerUid)) {
    return {
      posts: [],
      anonymousPosts: [],
      listings: [],
      opportunities: [],
      events: [],
    };
  }

  const q = query(
    collection(db, COLLECTION_NAMES.savedPosts),
    where('ownerUID', '==', ownerUid),
    limit(120)
  );
  const snap = await getDocs(q);
  const entries = snap.docs
    .map((item) => item.data() as SavedPost)
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      return bMs - aMs;
    });

  const postIds: string[] = [];
  const anonIds: string[] = [];
  const listingIds: string[] = [];
  const opportunityIds: string[] = [];
  const eventIds: string[] = [];

  for (const entry of entries) {
    if (!isValidFirestoreId(entry.targetId)) continue;
    if (entry.targetCollection === 'posts') postIds.push(entry.targetId);
    else if (entry.targetCollection === 'anonymousPosts') anonIds.push(entry.targetId);
    else if (entry.targetCollection === 'marketplaceListings') listingIds.push(entry.targetId);
    else if (entry.targetCollection === 'opportunities') opportunityIds.push(entry.targetId);
    else if (entry.targetCollection === 'events') eventIds.push(entry.targetId);
  }

  const [postSnaps, anonSnaps, listingSnaps, oppSnaps, eventSnaps] = await Promise.all([
    Promise.allSettled(
      postIds.map((id) => getDoc(doc(db, COLLECTION_NAMES.posts, id)))
    ),
    Promise.allSettled(
      anonIds.map((id) => getDoc(doc(db, COLLECTION_NAMES.anonymousPosts, id)))
    ),
    Promise.allSettled(
      listingIds.map((id) =>
        getDoc(doc(db, COLLECTION_NAMES.marketplaceListings, id))
      )
    ),
    Promise.allSettled(
      opportunityIds.map((id) =>
        getDoc(doc(db, COLLECTION_NAMES.opportunities, id))
      )
    ),
    Promise.allSettled(
      eventIds.map((id) => getDoc(doc(db, COLLECTION_NAMES.events, id)))
    ),
  ]);

  const rawPosts: CommunityPost[] = [];
  for (const res of postSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as CommunityPost;
      if (data.status === 'published') rawPosts.push(data);
    }
  }

  const authorUids = Array.from(
    new Set(rawPosts.map((p) => p.ownerUID).filter(isValidFirestoreId))
  );
  const authorMap =
    authorUids.length > 0
      ? await fetchPublicProfileProjectionsByUids(authorUids)
      : new Map<string, PublicProfileProjection>();

  const anonymousPosts: AnonymousPost[] = [];
  for (const res of anonSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as AnonymousPost;
      if (data.status === 'published') anonymousPosts.push(data);
    }
  }

  const listings: MarketplaceListing[] = [];
  for (const res of listingSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      listings.push(res.value.data() as MarketplaceListing);
    }
  }

  const opportunities: Opportunity[] = [];
  for (const res of oppSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as Opportunity;
      if (data.status !== 'unpublished') {
        opportunities.push(data);
      }
    }
  }

  const events: CampusEvent[] = [];
  for (const res of eventSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as CampusEvent;
      if (data.published !== false) {
        events.push(data);
      }
    }
  }

  return {
    posts: rawPosts.map((post) => ({
      post,
      author: authorMap.get(post.ownerUID) ?? null,
    })),
    anonymousPosts,
    listings,
    opportunities,
    events,
  };
}

/**
 * Fetches ONLY the authenticated owner's private anonymous post history
 * by merging the owner-only anonymousHistory subcollection with legacy pointers.
 */
export async function fetchMyAnonymousHistory(
  ownerUid: string
): Promise<AnonymousPost[]> {
  if (!isValidFirestoreId(ownerUid)) {
    return [];
  }

  const [historySnap, legacyOwnership] = await Promise.all([
    getDocs(
      query(
        collection(
          db,
          COLLECTION_NAMES.privateUserData,
          ownerUid,
          SUBCOLLECTION_NAMES.anonymousHistory
        ),
        limit(100)
      )
    ).catch(() => null),
    readPrivateAnonymousOwnership(ownerUid),
  ]);

  const postIdsSet = new Set<string>();
  if (historySnap) {
    for (const item of historySnap.docs) {
      const data = item.data() as PrivateAnonymousHistoryEntry;
      const targetId = isValidFirestoreId(data.postId) ? data.postId : item.id;
      if (isValidFirestoreId(targetId)) {
        postIdsSet.add(targetId);
      }
    }
  }
  for (const legacyId of legacyOwnership.postIds) {
    if (isValidFirestoreId(legacyId)) {
      postIdsSet.add(legacyId);
    }
  }

  const postIds = Array.from(postIdsSet);
  if (postIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    postIds.map((postId) =>
      getDoc(doc(db, COLLECTION_NAMES.anonymousPosts, postId))
    )
  );

  const posts: AnonymousPost[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as AnonymousPost;
      if (data.status === 'published') {
        posts.push(data);
      }
    }
  }

  return posts.sort((a, b) => {
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

export type CommentsPageCursor =
  | { mode: 'firestore'; docSnap: QueryDocumentSnapshot<DocumentData> }
  | { mode: 'offset'; offset: number };

export interface CommentsPageResult {
  items: CommentWithAuthor[];
  nextCursor: CommentsPageCursor | null;
  hasMore: boolean;
}

async function hydrateCommentAuthors(
  kind: 'posts' | 'anonymousPosts',
  rawComments: (PostComment | AnonymousComment)[]
): Promise<CommentWithAuthor[]> {
  if (kind === 'anonymousPosts') {
    return rawComments.map((comment) => ({
      comment,
      author: null,
    }));
  }

  const uids = Array.from(
    new Set(
      rawComments
        .map((item) => (item as PostComment).ownerUID)
        .filter(isValidFirestoreId)
    )
  );

  const authorMap =
    uids.length > 0
      ? await fetchPublicProfileProjectionsByUids(uids)
      : new Map<string, PublicProfileProjection>();

  return rawComments.map((comment) => ({
    comment,
    author: authorMap.get((comment as PostComment).ownerUID) ?? null,
  }));
}

export async function fetchCommentsPageForPost(
  kind: 'posts' | 'anonymousPosts',
  postId: string,
  options: { pageSize?: number; cursor?: CommentsPageCursor | null } = {}
): Promise<CommentsPageResult> {
  if (!isValidFirestoreId(postId)) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const pageSize = Math.max(1, Math.min(50, options.pageSize ?? 20));
  const commentCollection =
    kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;

  try {
    if (options.cursor?.mode === 'offset') {
      const snap = await getDocs(
        query(
          collection(db, commentCollection),
          where('postId', '==', postId),
          where('status', '==', 'published'),
          limit(150)
        )
      );
      const sorted = snap.docs
        .map((item) => item.data() as PostComment | AnonymousComment)
        .sort((a, b) => {
          const aMs = extractTimestampMs(a.createdAt) ?? 0;
          const bMs = extractTimestampMs(b.createdAt) ?? 0;
          return aMs - bMs;
        });
      const slice = sorted.slice(
        options.cursor.offset,
        options.cursor.offset + pageSize
      );
      const hasMore = options.cursor.offset + slice.length < sorted.length;
      const items = await hydrateCommentAuthors(kind, slice);
      return {
        items,
        nextCursor: hasMore
          ? { mode: 'offset', offset: options.cursor.offset + slice.length }
          : null,
        hasMore,
      };
    }

    const cursorSnap =
      options.cursor?.mode === 'firestore' ? options.cursor.docSnap : null;
    try {
      const snap = await getDocs(
        query(
          collection(db, commentCollection),
          where('postId', '==', postId),
          where('status', '==', 'published'),
          orderBy('createdAt', 'asc'),
          ...(cursorSnap ? [startAfter(cursorSnap)] : []),
          limit(pageSize + 1)
        )
      );
      const hasMore = snap.docs.length > pageSize;
      const pageDocs = snap.docs.slice(0, pageSize);
      const rawComments = pageDocs.map(
        (item) => item.data() as PostComment | AnonymousComment
      );
      const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
      const items = await hydrateCommentAuthors(kind, rawComments);
      return {
        items,
        nextCursor:
          hasMore && lastDoc ? { mode: 'firestore', docSnap: lastDoc } : null,
        hasMore,
      };
    } catch (innerError) {
      if (!isFirebaseErrorCode(innerError, 'failed-precondition')) {
        throw innerError;
      }
      const fallbackSnap = await getDocs(
        query(
          collection(db, commentCollection),
          where('postId', '==', postId),
          where('status', '==', 'published'),
          limit(150)
        )
      );
      const sorted = fallbackSnap.docs
        .map((item) => item.data() as PostComment | AnonymousComment)
        .sort((a, b) => {
          const aMs = extractTimestampMs(a.createdAt) ?? 0;
          const bMs = extractTimestampMs(b.createdAt) ?? 0;
          return aMs - bMs;
        });
      const slice = sorted.slice(0, pageSize);
      const hasMore = slice.length < sorted.length;
      const items = await hydrateCommentAuthors(kind, slice);
      return {
        items,
        nextCursor: hasMore ? { mode: 'offset', offset: slice.length } : null,
        hasMore,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, commentCollection);
  }
}

export async function fetchCommentsForPost(
  kind: 'posts' | 'anonymousPosts',
  postId: string
): Promise<CommentWithAuthor[]> {
  const res = await fetchCommentsPageForPost(kind, postId, { pageSize: 50 });
  return res.items;
}

export async function addPostComment(input: {
  kind: 'posts' | 'anonymousPosts';
  postId: string;
  body: string;
  parentCommentId?: string;
  actorUid: string;
  actorRole: UserRole;
}): Promise<{ comment: PostComment | AnonymousComment; commentsCount: number }> {
  const cleanBody = input.body.trim();
  if (
    cleanBody.length < BLUEPRINT_LIMITS.commentBodyMin ||
    cleanBody.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be between 1 and ${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.postId)) {
    throw new Error('Sign in to comment on posts.');
  }

  const commentCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;
  const postCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;

  const commentId = generateFirestoreDocId(commentCollection);
  const postRef = doc(db, postCollection, input.postId);
  const commentRef = doc(db, commentCollection, commentId);

  const [ownership, mappingRole] =
    input.kind === 'anonymousPosts'
      ? await Promise.all([
          readPrivateAnonymousOwnership(input.actorUid),
          resolveAuthorRoleForAnonymousMapping(input.actorUid, input.actorRole),
        ])
      : [null, input.actorRole];

  const commentPayload: Record<string, unknown> = {
    id: commentId,
    postId: input.postId,
    body: cleanBody,
    status: 'published',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.parentCommentId && isValidFirestoreId(input.parentCommentId)) {
    commentPayload.parentCommentId = input.parentCommentId;
  }
  if (input.kind === 'posts') {
    commentPayload.ownerUID = input.actorUid;
    commentPayload.targetCollection = 'posts';
    commentPayload.likesCount = 0;
  } else {
    commentPayload.likesCount = 0;
  }

  let postOwnerUid: string | null = null;
  let postImageId: string | undefined;

  const path = `${commentCollection}/${commentId}`;
  try {
    const commentsCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const postSnap = await tx.get(postRef);
        if (!postSnap.exists()) {
          throw new Error('This post is no longer available.');
        }
        const postData = postSnap.data() as {
          ownerUID?: string;
          mediaItems?: PostMediaMeta[];
          commentsCount?: number;
        };
        if (input.kind === 'posts') {
          postOwnerUid = postData.ownerUID ?? null;
          postImageId = postData.mediaItems?.[0]?.imageId;
        }
        const currentCount = Number(postData.commentsCount ?? 0);
        const nextCount = currentCount + 1;

        tx.set(commentRef, commentPayload);
        tx.update(postRef, { commentsCount: nextCount });

        if (input.kind === 'anonymousPosts') {
          tx.set(
            doc(db, COLLECTION_NAMES.anonymousIdentityMappings, commentId),
            {
              entryId: commentId,
              entryType: 'anonymousComments',
              authorUid: input.actorUid,
              authorRole: mappingRole,
              createdAt: serverTimestamp(),
            }
          );
        }

        return nextCount;
      })
    );

    if (input.kind === 'posts') {
      const targetPath = `/?view=for-you&postId=${input.postId}&commentId=${commentId}`;
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
          title: 'Someone replied to your comment',
          body: excerpt || undefined,
          targetPath,
          actorUid: input.actorUid,
          targetImageId: postImageId,
        });
      }

      if (
        postOwnerUid &&
        postOwnerUid !== parentOwnerUid &&
        shouldEmitActivityNotification({
          actorUid: input.actorUid,
          recipientUid: postOwnerUid,
        })
      ) {
        void createSafeMemberNotification({
          id: buildCommentNotificationId(commentId),
          recipientUid: postOwnerUid,
          eventType: 'comment',
          title: input.parentCommentId
            ? 'New reply on your post'
            : 'Someone commented on your post',
          body: excerpt || undefined,
          targetPath,
          actorUid: input.actorUid,
          targetImageId: postImageId,
        });
      }

      void emitPublicMentionNotifications({
        sourceId: commentId,
        text: cleanBody,
        actorUid: input.actorUid,
        excludeUids: [parentOwnerUid, postOwnerUid],
        title: 'Someone mentioned you in a comment',
        targetPath,
        targetImageId: postImageId,
      });
    }

    if (
      input.kind === 'posts' &&
      !isUndergroundSupremeAdminUser(auth.currentUser)
    ) {
      void updateDoc(doc(db, COLLECTION_NAMES.users, input.actorUid), {
        hasPublicActivity: true,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }

    if (input.kind === 'anonymousPosts' && ownership?.exists) {
      const nextIds = [
        commentId,
        ...ownership.commentIds.filter((id) => id !== commentId),
      ].slice(0, 200);
      updateDoc(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
        ownedAnonymousCommentIds: nextIds,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }

    notifyPostCommentMutated(
      input.kind === 'posts' ? 'ordinary' : 'anonymous',
      input.postId,
      commentsCount
    );

    return {
      comment: {
        ...(commentPayload as unknown as PostComment | AnonymousComment),
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

export async function editPostComment(input: {
  kind: 'posts' | 'anonymousPosts';
  commentId: string;
  body: string;
}): Promise<void> {
  const cleanBody = input.body.trim();
  if (
    cleanBody.length < BLUEPRINT_LIMITS.commentBodyMin ||
    cleanBody.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be between 1 and ${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }

  const commentCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;
  const path = `${commentCollection}/${input.commentId}`;

  const batch = writeBatch(db);
  batch.update(doc(db, commentCollection, input.commentId), {
    body: cleanBody,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePostComment(input: {
  kind: 'posts' | 'anonymousPosts';
  postId: string;
  commentId: string;
  replyIdsToRemove: string[];
  actorUid: string;
}): Promise<number> {
  const commentCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;
  const postCollection =
    input.kind === 'posts'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;

  const idsToDelete = Array.from(
    new Set([input.commentId, ...input.replyIdsToRemove].filter(isValidFirestoreId))
  );
  const postRef = doc(db, postCollection, input.postId);

  const ownership =
    input.kind === 'anonymousPosts'
      ? await readPrivateAnonymousOwnership(input.actorUid)
      : null;

  const path = `${commentCollection}/${input.commentId}`;
  try {
    const nextCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const postSnap = await tx.get(postRef);
        const currentCount = postSnap.exists()
          ? Number((postSnap.data() as { commentsCount?: number }).commentsCount ?? 0)
          : 0;
        const computedNextCount = Math.max(0, currentCount - idsToDelete.length);

        for (const id of idsToDelete) {
          tx.delete(doc(db, commentCollection, id));
          if (input.kind === 'anonymousPosts') {
            tx.delete(doc(db, COLLECTION_NAMES.anonymousIdentityMappings, id));
          }
        }

        if (postSnap.exists() && computedNextCount !== currentCount) {
          tx.update(postRef, { commentsCount: computedNextCount });
        }

        return computedNextCount;
      })
    );

    if (input.kind === 'anonymousPosts' && ownership?.exists) {
      const deletedSet = new Set(idsToDelete);
      const filtered = ownership.commentIds.filter((id) => !deletedSet.has(id));
      if (filtered.length !== ownership.commentIds.length) {
        updateDoc(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
          ownedAnonymousCommentIds: filtered,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
    }

    notifyPostCommentMutated(
      input.kind === 'posts' ? 'ordinary' : 'anonymous',
      input.postId,
      nextCount
    );

    return nextCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function revealAnonymousEntryAuthor(input: {
  entryId: string;
  revealedByUid: string;
  reason: string;
}): Promise<RevealedAuthorResult> {
  if (!canRevealAnonymousAuthor(auth.currentUser)) {
    throw new Error(
      'Only designated Supreme Admin accounts may reveal anonymous authors.'
    );
  }
  const cleanReason = input.reason.trim();
  if (
    cleanReason.length < BLUEPRINT_LIMITS.auditReasonMin ||
    cleanReason.length > BLUEPRINT_LIMITS.auditReasonMax
  ) {
    throw new Error(
      `Audit reason must be between ${BLUEPRINT_LIMITS.auditReasonMin} and ${BLUEPRINT_LIMITS.auditReasonMax} characters.`
    );
  }

  const mappingPath = `${COLLECTION_NAMES.anonymousIdentityMappings}/${input.entryId}`;
  let mapping: AnonymousIdentityMapping | null = null;
  try {
    const snap = await getDoc(
      doc(db, COLLECTION_NAMES.anonymousIdentityMappings, input.entryId)
    );
    if (!snap.exists()) {
      throw new Error('No identity mapping exists for that anonymous entry.');
    }
    mapping = snap.data() as AnonymousIdentityMapping;
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, mappingPath);
  }

  let profile: PublicProfileProjection | null = null;
  try {
    const userSnap = await getDoc(
      doc(db, COLLECTION_NAMES.users, mapping.authorUid)
    );
    if (userSnap.exists()) {
      profile = toPublicProfileProjection(userSnap.data() as PublicUserProfile);
    }
  } catch {
    profile = null;
  }

  const auditId = generateFirestoreDocId(COLLECTION_NAMES.anonymousAuditLogs);
  const auditBatch = writeBatch(db);
  auditBatch.set(doc(db, COLLECTION_NAMES.anonymousAuditLogs, auditId), {
    id: auditId,
    targetEntryId: input.entryId,
    revealedByUid: input.revealedByUid,
    reason: cleanReason,
    createdAt: serverTimestamp(),
  });

  try {
    await auditBatch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.anonymousAuditLogs}/${auditId}`
    );
  }

  return {
    entryId: mapping.entryId,
    authorUid: mapping.authorUid,
    authorRole: mapping.authorRole,
    profile,
  };
}

export async function fetchSinglePublishedPostWithAuthor(
  postId: string
): Promise<{ post: CommunityPost; author: PublicProfileProjection | null } | null> {
  if (!isValidFirestoreId(postId)) return null;
  const path = `${COLLECTION_NAMES.posts}/${postId}`;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.posts, postId));
    if (!snap.exists()) return null;
    const post = snap.data() as CommunityPost;
    if (post.status !== 'published') return null;

    let author: PublicProfileProjection | null = null;
    if (isValidFirestoreId(post.ownerUID)) {
      try {
        const authorMap = await fetchPublicProfileProjectionsByUids([
          post.ownerUID,
        ]);
        author = authorMap.get(post.ownerUID) ?? null;
      } catch {
        author = null;
      }
    }

    return { post, author };
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchSinglePublishedAnonymousPost(
  postId: string
): Promise<AnonymousPost | null> {
  if (!isValidFirestoreId(postId)) return null;
  const path = `${COLLECTION_NAMES.anonymousPosts}/${postId}`;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.anonymousPosts, postId));
    if (!snap.exists()) return null;
    const post = snap.data() as AnonymousPost;
    return post.status === 'published' ? post : null;
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchCommentsForMarketplaceListing(
  listingId: string
): Promise<CommentWithAuthor[]> {
  if (!isValidFirestoreId(listingId)) return [];
  try {
    const q = query(
      collection(db, COLLECTION_NAMES.postComments),
      where('postId', '==', listingId),
      where('status', '==', 'published'),
      limit(150)
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((item) => item.data() as PostComment)
      .filter((c) => c.targetCollection === 'marketplaceListings')
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.createdAt) ?? 0;
        const bMs = extractTimestampMs(b.createdAt) ?? 0;
        return aMs - bMs;
      });
    return await hydrateCommentAuthors('posts', items);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.postComments
    );
  }
}

export async function addMarketplaceListingComment(input: {
  listingId: string;
  body: string;
  parentCommentId?: string;
  actorUid: string;
}): Promise<{ comment: PostComment; commentsCount: number }> {
  if (
    !isValidFirestoreId(input.listingId) ||
    !isValidFirestoreId(input.actorUid)
  ) {
    throw new Error('Sign in to ask questions or comment on listings.');
  }

  const trimmed = input.body.trim();
  if (
    trimmed.length < BLUEPRINT_LIMITS.commentBodyMin ||
    trimmed.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be 1–${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }

  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, input.listingId);
  const commentId = generateFirestoreDocId(COLLECTION_NAMES.postComments);
  const commentRef = doc(db, COLLECTION_NAMES.postComments, commentId);
  const path = `${COLLECTION_NAMES.postComments}/${commentId}`;

  const payload: Record<string, unknown> = {
    id: commentId,
    postId: input.listingId,
    targetCollection: 'marketplaceListings',
    ownerUID: input.actorUid,
    body: trimmed,
    status: 'published',
    likesCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.parentCommentId && isValidFirestoreId(input.parentCommentId)) {
    payload.parentCommentId = input.parentCommentId;
  }

  let sellerUid: string | null = null;
  let listingTitle = '';
  let listingImageId: string | undefined;

  try {
    const nextCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const listingSnap = await tx.get(listingRef);
        if (!listingSnap.exists()) {
          throw new Error('This listing is no longer available.');
        }
        const listingData = listingSnap.data() as MarketplaceListing;
        if (listingData.status !== 'active') {
          throw new Error('Comments are only open on active marketplace listings.');
        }
        sellerUid = listingData.ownerUID;
        listingTitle = listingData.title;
        listingImageId = listingData.mediaItems?.[0]?.imageId;

        const currentCount = Number(listingData.commentsCount ?? 0);
        const updatedCount = Math.max(0, currentCount) + 1;

        tx.set(commentRef, payload);
        tx.update(listingRef, { commentsCount: updatedCount });
        return updatedCount;
      })
    );

    const targetPath = `/?view=marketplace&listingId=${input.listingId}&commentId=${commentId}`;
    const excerpt = summarizeNotificationExcerpt(trimmed, 140);
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
        title: `Reply on "${summarizeNotificationExcerpt(listingTitle, 60)}"`,
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: listingImageId,
      });
    }

    if (
      sellerUid &&
      sellerUid !== parentOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: sellerUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildCommentNotificationId(commentId),
        recipientUid: sellerUid,
        eventType: 'comment',
        title: `New question on "${summarizeNotificationExcerpt(listingTitle, 60)}"`,
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: listingImageId,
      });
    }

    void emitPublicMentionNotifications({
      sourceId: commentId,
      text: trimmed,
      actorUid: input.actorUid,
      excludeUids: [parentOwnerUid, sellerUid],
      title: `You were mentioned on "${summarizeNotificationExcerpt(listingTitle, 60)}"`,
      targetPath,
      targetImageId: listingImageId,
    });

    notifyMarketplaceListingCommentMutated(input.listingId, nextCount);

    const nowMs = Date.now();
    return {
      comment: {
        id: commentId,
        postId: input.listingId,
        targetCollection: 'marketplaceListings',
        parentCommentId: payload.parentCommentId as string | undefined,
        ownerUID: input.actorUid,
        body: trimmed,
        status: 'published',
        likesCount: 0,
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      commentsCount: nextCount,
    };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function editMarketplaceListingComment(input: {
  commentId: string;
  body: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.commentId)) {
    throw new Error('Invalid comment identifier.');
  }
  const trimmed = input.body.trim();
  if (
    trimmed.length < BLUEPRINT_LIMITS.commentBodyMin ||
    trimmed.length > BLUEPRINT_LIMITS.commentBodyMax
  ) {
    throw new Error(
      `Comments must be 1–${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }
  const path = `${COLLECTION_NAMES.postComments}/${input.commentId}`;
  try {
    await runWithFirestoreConnectionRetry(() =>
      updateDoc(doc(db, COLLECTION_NAMES.postComments, input.commentId), {
        body: trimmed,
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

export async function deleteMarketplaceListingComment(input: {
  listingId: string;
  commentId: string;
  replyIdsToRemove?: string[];
}): Promise<number> {
  if (
    !isValidFirestoreId(input.listingId) ||
    !isValidFirestoreId(input.commentId)
  ) {
    throw new Error('Invalid comment identifier.');
  }

  const idsToDelete = Array.from(
    new Set([input.commentId, ...(input.replyIdsToRemove ?? [])])
  ).filter(isValidFirestoreId);

  const listingRef = doc(
    db,
    COLLECTION_NAMES.marketplaceListings,
    input.listingId
  );
  const path = `${COLLECTION_NAMES.postComments}/${input.commentId}`;

  try {
    const nextCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const listingSnap = await tx.get(listingRef);
        const currentCount = listingSnap.exists()
          ? Number((listingSnap.data() as MarketplaceListing).commentsCount ?? 0)
          : 0;
        const computedNextCount = Math.max(0, currentCount - idsToDelete.length);

        for (const id of idsToDelete) {
          tx.delete(doc(db, COLLECTION_NAMES.postComments, id));
        }
        if (listingSnap.exists() && computedNextCount < currentCount) {
          tx.update(listingRef, { commentsCount: computedNextCount });
        }
        return computedNextCount;
      })
    );
    notifyMarketplaceListingCommentMutated(input.listingId, nextCount);
    return nextCount;
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordDeduplicatedPostView(input: {
  kind: 'ordinary' | 'anonymous';
  postId: string;
  viewerUid?: string | null;
  currentViewsCount?: number;
  isBackgroundRefresh?: boolean;
}): Promise<number | null> {
  if (input.isBackgroundRefresh || !isValidFirestoreId(input.postId)) {
    return null;
  }

  const targetCollection =
    input.kind === 'ordinary'
      ? COLLECTION_NAMES.posts
      : COLLECTION_NAMES.anonymousPosts;
  const hasSignedInViewer =
    Boolean(input.viewerUid) &&
    isValidFirestoreId(input.viewerUid!) &&
    auth.currentUser?.uid === input.viewerUid;
  const viewerKey = hasSignedInViewer ? input.viewerUid! : 'guest';

  if (hasRecordedPostViewLocally(targetCollection, input.postId, viewerKey)) {
    return null;
  }

  if (!hasSignedInViewer) {
    // Guest sessions deduplicate locally without attempting restricted Firestore view writes.
    markPostViewLocally(targetCollection, input.postId, 'guest');
    return null;
  }

  const postRef = doc(db, targetCollection, input.postId);
  try {
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      return null;
    }
    const postData = postSnap.data() as {
      status?: string;
      viewsCount?: number;
    };
    if (postData.status !== 'published') {
      return null;
    }

    const baseViews =
      typeof postData.viewsCount === 'number' && Number.isFinite(postData.viewsCount)
        ? Math.max(0, Math.floor(postData.viewsCount))
        : Math.max(0, Math.floor(input.currentViewsCount ?? 0));
    const nextViews = baseViews + 1;

    const viewId = buildPostViewDocId(
      targetCollection,
      input.postId,
      input.viewerUid!
    );
    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTION_NAMES.postViews, viewId), {
      id: viewId,
      targetCollection,
      targetId: input.postId,
      createdAt: serverTimestamp(),
    });
    batch.update(postRef, { viewsCount: nextViews });

    await batch.commit();
    markPostViewLocally(targetCollection, input.postId, input.viewerUid!);
    notifyPostViewCountUpdated(input.kind, input.postId, nextViews);
    return nextViews;
  } catch (error) {
    if (
      isFirebaseErrorCode(error, 'permission-denied') ||
      isFirebaseErrorCode(error, 'already-exists')
    ) {
      // Server rule blocks duplicate postViews creation; record locally to avoid retries.
      markPostViewLocally(targetCollection, input.postId, input.viewerUid!);
    }
    return null;
  }
}

export async function syncOwnAnonymousLikesReceivedCount(
  uid: string
): Promise<number> {
  if (!isValidFirestoreId(uid) || auth.currentUser?.uid !== uid) {
    return 0;
  }
  try {
    const [ownPosts, userSnap] = await Promise.all([
      fetchMyAnonymousHistory(uid),
      getDoc(doc(db, COLLECTION_NAMES.users, uid)),
    ]);
    const totalLikes = ownPosts.reduce((sum, post) => {
      const likes =
        post.status === 'published' && Number.isFinite(post.likesCount)
          ? Math.max(0, Math.floor(post.likesCount))
          : 0;
      return sum + likes;
    }, 0);

    if (userSnap.exists()) {
      const currentStored = (userSnap.data() as PublicUserProfile)
        .anonymousLikesReceivedCount;
      if (Math.floor(currentStored ?? 0) !== totalLikes) {
        await updateDoc(doc(db, COLLECTION_NAMES.users, uid), {
          anonymousLikesReceivedCount: totalLikes,
          updatedAt: serverTimestamp(),
        });
      }
    }
    return totalLikes;
  } catch {
    return 0;
  }
}

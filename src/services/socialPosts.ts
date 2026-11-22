import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type UpdateData,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ALLOWED_ANONYMOUS_BACKGROUND_IDS,
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  SUBCOLLECTION_NAMES,
  canRolePublishCommunityFeed,
  isValidFirestoreId,
  validateAnonymousPostPayload,
  validateCommunityPostPayload,
  validatePostMediaItems,
  type AnonymousBackgroundId,
  type AnonymousComment,
  type AnonymousIdentityMapping,
  type AnonymousPost,
  type CommunityPost,
  type MarketplaceListing,
  type Opportunity,
  type PostComment,
  type PostMediaMeta,
  type PostReaction,
  type PrivateAnonymousHistoryEntry,
  type PrivateUserData,
  type PublicProfileProjection,
  type PublicUserProfile,
  type ReactionType,
  type SavedPost,
  type UserRole,
} from '../types/database';
import { toPublicProfileProjection } from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import type { CompressedImageResult } from '../utils/imageCompression';
import {
  buildMediaImageFirestoreRecord,
  evictMediaImageCache,
  generateFirestoreDocId,
  primeMediaImageCache,
  type UploadProgressState,
} from './mediaStorage';

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

function buildOrderedMediaItems(
  attachments: ComposerImageAttachment[]
): PostMediaMeta[] {
  if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    throw new Error(
      `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
    );
  }

  return attachments.map((att, index) => {
    const cleanCaption = att.caption.trim().slice(0, BLUEPRINT_LIMITS.imageCaptionMax);
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

export async function fetchOwnedAnonymousEntries(
  uid: string | null | undefined
): Promise<{ postIds: Set<string>; commentIds: Set<string> }> {
  if (!uid || !isValidFirestoreId(uid)) {
    return { postIds: new Set(), commentIds: new Set() };
  }
  const result = await readPrivateAnonymousOwnership(uid);
  return {
    postIds: new Set(result.postIds),
    commentIds: new Set(result.commentIds),
  };
}

export async function createCommunityPostWithMedia(input: {
  ownerUID: string;
  authorRole: UserRole;
  category: string;
  title?: string;
  body: string;
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
  const mediaItems = buildOrderedMediaItems(input.attachments);
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const cleanCategory = input.category.trim();
  const isOfficial =
    (input.authorRole === 'owner' || input.authorRole === 'supreme_admin') &&
    Boolean(input.isOfficial);

  const postDoc: Record<string, unknown> = {
    id: postId,
    ownerUID: input.ownerUID,
    authorRole: input.authorRole,
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
  if (mediaItems.length > 0) {
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

  for (const att of input.attachments) {
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
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  for (const att of input.attachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Published' });

  return {
    ...(postDoc as unknown as CommunityPost),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function createAnonymousPostWithMedia(input: {
  authorUid: string;
  authorRole: UserRole;
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
  const mediaItems = buildOrderedMediaItems(input.attachments);
  const cleanCategory = input.category.trim();
  const cleanBody = input.body.trim();

  const effectiveBg: AnonymousBackgroundId | undefined =
    mediaItems.length === 0 &&
    input.backgroundStyle &&
    input.backgroundStyle !== 'plain' &&
    ALLOWED_ANONYMOUS_BACKGROUND_IDS.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : undefined;

  const publicDoc: Record<string, unknown> = {
    id: postId,
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
  if (mediaItems.length > 0) {
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

  const ownership = await readPrivateAnonymousOwnership(input.authorUid);

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.anonymousPosts, postId), publicDoc);
  batch.set(
    doc(db, COLLECTION_NAMES.anonymousIdentityMappings, postId),
    {
      entryId: postId,
      entryType: 'anonymousPosts',
      authorUid: input.authorUid,
      authorRole: input.authorRole,
      createdAt: serverTimestamp(),
    }
  );

  for (const att of input.attachments) {
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

  if (ownership.exists) {
    const nextPostIds = [
      postId,
      ...ownership.postIds.filter((id) => id !== postId),
    ].slice(0, 100);
    batch.update(doc(db, COLLECTION_NAMES.privateUserData, input.authorUid), {
      ownedAnonymousPostIds: nextPostIds,
      updatedAt: serverTimestamp(),
    });
  }

  input.onProgress?.({ percent: 72, label: 'Confirming with Firebase...' });

  const path = `${COLLECTION_NAMES.anonymousPosts}/${postId}`;
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  for (const att of input.attachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Published anonymously' });

  return {
    ...(publicDoc as unknown as AnonymousPost),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function updateCommunityPostWithMedia(input: {
  post: CommunityPost;
  actorUid: string;
  category: string;
  title?: string;
  body: string;
  attachments: ComposerImageAttachment[];
  onProgress?: (state: UploadProgressState) => void;
}): Promise<CommunityPost> {
  const mediaItems = buildOrderedMediaItems(input.attachments);
  const cleanTitle = input.title?.trim() ?? '';
  const cleanBody = input.body.trim();
  const cleanCategory = input.category.trim();

  validateCommunityPostPayload({
    id: input.post.id,
    ownerUID: input.post.ownerUID,
    category: cleanCategory,
    title: cleanTitle,
    body: cleanBody,
    mediaItems,
  });

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
    mediaItems: mediaItems.length > 0 ? mediaItems : deleteField(),
    updatedAt: serverTimestamp(),
  };

  batch.update(doc(db, COLLECTION_NAMES.posts, input.post.id), updateFields);

  for (const att of input.attachments) {
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
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  for (const removedId of removedCandidates) {
    evictMediaImageCache(removedId);
  }
  for (const att of input.attachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Updated' });

  return {
    ...input.post,
    category: cleanCategory,
    title: cleanTitle || undefined,
    body: cleanBody,
    mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
    updatedAt: Date.now(),
  };
}

export async function updateAnonymousPostWithMedia(input: {
  post: AnonymousPost;
  category: string;
  body: string;
  backgroundStyle?: AnonymousBackgroundId;
  attachments: ComposerImageAttachment[];
  onProgress?: (state: UploadProgressState) => void;
}): Promise<AnonymousPost> {
  const mediaItems = buildOrderedMediaItems(input.attachments);
  const cleanCategory = input.category.trim();
  const cleanBody = input.body.trim();
  const effectiveBg: AnonymousBackgroundId | undefined =
    mediaItems.length === 0 &&
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
  if (effectiveBg) checkPayload.backgroundStyle = effectiveBg;
  if (mediaItems.length > 0) checkPayload.mediaItems = mediaItems;
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
    backgroundStyle: effectiveBg ?? deleteField(),
    mediaItems: mediaItems.length > 0 ? mediaItems : deleteField(),
    updatedAt: serverTimestamp(),
  });

  for (const att of input.attachments) {
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
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  for (const removedId of removedCandidates) {
    evictMediaImageCache(removedId);
  }
  for (const att of input.attachments) {
    if (att.compressed) {
      primeMediaImageCache(att.imageId, att.compressed.dataUrl);
    }
  }
  input.onProgress?.({ percent: 100, label: 'Updated' });

  return {
    ...input.post,
    category: cleanCategory,
    body: cleanBody,
    backgroundStyle: effectiveBg,
    mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
    updatedAt: Date.now(),
  };
}

export async function removeSingleImageFromPost(input: {
  kind: 'posts' | 'anonymousPosts';
  post: CommunityPost | AnonymousPost;
  imageIdToRemove: string;
}): Promise<CommunityPost | AnonymousPost> {
  const remaining = (input.post.mediaItems ?? [])
    .filter((item) => item.imageId !== input.imageIdToRemove)
    .map((item, idx) => ({ ...item, order: idx }));

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
  return {
    ...input.post,
    mediaItems: remaining.length > 0 ? remaining : undefined,
    updatedAt: Date.now(),
  };
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

  const [commentsSnap, reactionsSnap, mediaQuerySnap, savedActorSnap] =
    await Promise.all([
      getDocs(
        query(
          collection(db, commentCollection),
          where('postId', '==', postId),
          limit(200)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.postReactions),
          where('targetCollection', '==', input.kind),
          where('targetId', '==', postId),
          limit(200)
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

  const batch = writeBatch(db);

  for (const commentDoc of commentsSnap.docs) {
    batch.delete(commentDoc.ref);
    if (input.kind === 'anonymousPosts') {
      batch.delete(
        doc(db, COLLECTION_NAMES.anonymousIdentityMappings, commentDoc.id)
      );
    }
  }

  if (reactionsSnap) {
    for (const reactionDoc of reactionsSnap.docs) {
      batch.delete(reactionDoc.ref);
    }
  } else if (actorOwnAnonReactionRef) {
    batch.delete(actorOwnAnonReactionRef);
  }

  if (savedActorSnap) {
    for (const savedDoc of savedActorSnap.docs) {
      if ((savedDoc.data() as SavedPost).targetCollection === input.kind) {
        batch.delete(savedDoc.ref);
      }
    }
  }

  for (const mediaId of existingMediaIds) {
    batch.delete(doc(db, COLLECTION_NAMES.mediaImages, mediaId));
  }

  if (input.kind === 'anonymousPosts') {
    batch.delete(doc(db, COLLECTION_NAMES.anonymousIdentityMappings, postId));
    if (hasAnonymousHistoryDoc) {
      batch.delete(
        doc(
          db,
          COLLECTION_NAMES.privateUserData,
          input.actorUid,
          SUBCOLLECTION_NAMES.anonymousHistory,
          postId
        )
      );
    }
    if (ownership?.exists && ownership.postIds.includes(postId)) {
      batch.update(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
        ownedAnonymousPostIds: ownership.postIds.filter((id) => id !== postId),
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.delete(doc(db, collectionName, postId));

  const path = `${collectionName}/${postId}`;
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  for (const mediaId of existingMediaIds) {
    evictMediaImageCache(mediaId);
  }
  for (const metaId of mediaIdsFromPost) {
    evictMediaImageCache(metaId);
  }
}

export async function togglePostReaction(input: {
  kind: 'posts' | 'anonymousPosts';
  postId: string;
  actorUid: string;
  reactionType?: ReactionType;
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
    return await runTransaction(db, async (tx) => {
      const [postSnap, reactionSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(reactionRef),
      ]);

      if (!postSnap.exists()) {
        throw new Error('This post is no longer available.');
      }

      const currentLikes = Number(
        (postSnap.data() as { likesCount?: number }).likesCount ?? 0
      );

      if (reactionSnap.exists()) {
        const nextLikes = Math.max(0, currentLikes - 1);
        tx.delete(reactionRef);
        tx.update(postRef, { likesCount: nextLikes });
        return { liked: false, likesCount: nextLikes };
      }

      const nextLikes = currentLikes + 1;
      tx.set(reactionRef, {
        targetCollection: input.kind,
        targetId: input.postId,
        ownerUID: input.actorUid,
        reactionType: input.reactionType ?? 'like',
        createdAt: serverTimestamp(),
      });
      tx.update(postRef, { likesCount: nextLikes });
      return { liked: true, likesCount: nextLikes };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchViewerLikedPostIds(
  kind: 'posts' | 'anonymousPosts',
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
      await deleteDoc(savedRef);
      return { saved: false };
    }
    await setDoc(savedRef, {
      id: savedId,
      ownerUID: input.actorUid,
      targetCollection: input.targetCollection,
      targetId: input.targetId,
      createdAt: serverTimestamp(),
    });
    return { saved: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchOwnerSavedContentBundle(
  ownerUid: string
): Promise<SavedContentBundle> {
  if (!isValidFirestoreId(ownerUid)) {
    return { posts: [], anonymousPosts: [], listings: [], opportunities: [] };
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

  for (const entry of entries) {
    if (!isValidFirestoreId(entry.targetId)) continue;
    if (entry.targetCollection === 'posts') postIds.push(entry.targetId);
    else if (entry.targetCollection === 'anonymousPosts') anonIds.push(entry.targetId);
    else if (entry.targetCollection === 'marketplaceListings') listingIds.push(entry.targetId);
    else if (entry.targetCollection === 'opportunities') opportunityIds.push(entry.targetId);
  }

  const [postSnaps, anonSnaps, listingSnaps, oppSnaps] = await Promise.all([
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
  const authorMap = new Map<string, PublicProfileProjection>();
  if (authorUids.length > 0) {
    const authorResults = await Promise.allSettled(
      authorUids.map(async (uid) => {
        const uSnap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
        if (!uSnap.exists()) return null;
        const p = uSnap.data() as PublicUserProfile;
        if (p.accountStatus !== 'active') return null;
        return { uid, projection: toPublicProfileProjection(p) };
      })
    );
    for (const r of authorResults) {
      if (r.status === 'fulfilled' && r.value) {
        authorMap.set(r.value.uid, r.value.projection);
      }
    }
  }

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
      opportunities.push(res.value.data() as Opportunity);
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

export async function fetchCommentsForPost(
  kind: 'posts' | 'anonymousPosts',
  postId: string
): Promise<CommentWithAuthor[]> {
  if (!isValidFirestoreId(postId)) return [];

  const commentCollection =
    kind === 'posts'
      ? COLLECTION_NAMES.postComments
      : COLLECTION_NAMES.anonymousComments;

  try {
    const q = query(
      collection(db, commentCollection),
      where('postId', '==', postId),
      where('status', '==', 'published'),
      limit(150)
    );
    const snap = await getDocs(q);

    const rawComments = snap.docs
      .map((item) => item.data() as PostComment | AnonymousComment)
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.createdAt) ?? 0;
        const bMs = extractTimestampMs(b.createdAt) ?? 0;
        return aMs - bMs;
      });

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

    const authorMap = new Map<string, PublicProfileProjection>();
    if (uids.length > 0) {
      const settled = await Promise.allSettled(
        uids.map(async (uid) => {
          const uSnap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
          if (!uSnap.exists()) return null;
          const profile = uSnap.data() as PublicUserProfile;
          if (profile.isHiddenFromDirectory || profile.accountStatus !== 'active') {
            return null;
          }
          return { uid, projection: toPublicProfileProjection(profile) };
        })
      );
      for (const entry of settled) {
        if (entry.status === 'fulfilled' && entry.value) {
          authorMap.set(entry.value.uid, entry.value.projection);
        }
      }
    }

    return rawComments.map((comment) => ({
      comment,
      author: authorMap.get((comment as PostComment).ownerUID) ?? null,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, commentCollection);
  }
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

  const ownership =
    input.kind === 'anonymousPosts'
      ? await readPrivateAnonymousOwnership(input.actorUid)
      : null;

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
  }

  const path = `${commentCollection}/${commentId}`;
  try {
    const commentsCount = await runTransaction(db, async (tx) => {
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists()) {
        throw new Error('This post is no longer available.');
      }
      const currentCount = Number(
        (postSnap.data() as { commentsCount?: number }).commentsCount ?? 0
      );
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
            authorRole: input.actorRole,
            createdAt: serverTimestamp(),
          }
        );

        if (ownership?.exists) {
          const nextIds = [
            commentId,
            ...ownership.commentIds.filter((id) => id !== commentId),
          ].slice(0, 200);
          tx.update(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
            ownedAnonymousCommentIds: nextIds,
            updatedAt: serverTimestamp(),
          });
        }
      }

      return nextCount;
    });

    return {
      comment: {
        ...(commentPayload as unknown as PostComment | AnonymousComment),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      commentsCount,
    };
  } catch (error) {
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
    return await runTransaction(db, async (tx) => {
      const postSnap = await tx.get(postRef);
      const currentCount = postSnap.exists()
        ? Number((postSnap.data() as { commentsCount?: number }).commentsCount ?? 0)
        : 0;
      const nextCount = Math.max(0, currentCount - idsToDelete.length);

      for (const id of idsToDelete) {
        tx.delete(doc(db, commentCollection, id));
        if (input.kind === 'anonymousPosts') {
          tx.delete(doc(db, COLLECTION_NAMES.anonymousIdentityMappings, id));
        }
      }

      if (postSnap.exists() && nextCount !== currentCount) {
        tx.update(postRef, { commentsCount: nextCount });
      }

      if (input.kind === 'anonymousPosts' && ownership?.exists) {
        const deletedSet = new Set(idsToDelete);
        const filtered = ownership.commentIds.filter((id) => !deletedSet.has(id));
        if (filtered.length !== ownership.commentIds.length) {
          tx.update(doc(db, COLLECTION_NAMES.privateUserData, input.actorUid), {
            ownedAnonymousCommentIds: filtered,
            updatedAt: serverTimestamp(),
          });
        }
      }

      return nextCount;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function revealAnonymousEntryAuthor(input: {
  entryId: string;
  revealedByUid: string;
  reason: string;
}): Promise<RevealedAuthorResult> {
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

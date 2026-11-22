import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  isValidFirestoreId,
  type CampusEvent,
  type PostComment,
  type PublicProfileProjection,
  type PublicUserProfile,
  type ReactionType,
} from '../types/database';
import { toPublicProfileProjection, isFirebaseErrorCode } from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import { isCampusEventPublished } from '../utils/events';
import {
  computeNextReactionTransactionState,
  isFirestoreSdkError,
  runWithFirestoreConnectionRetry,
} from '../utils/firestoreRetry';
import { generateFirestoreDocId } from './mediaStorage';
import { createSafeMemberNotification } from './firestoreFoundation';
import {
  buildCommentNotificationId,
  buildReactionNotificationId,
  buildReplyNotificationId,
  shouldEmitActivityNotification,
  summarizeNotificationExcerpt,
} from '../utils/notifications';
import type { CommentWithAuthor } from './socialPosts';

export async function fetchPublishedCampusEvents(): Promise<CampusEvent[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.events),
        where('published', '==', true),
        limit(150)
      )
    );
    return snap.docs
      .map((item) => item.data() as CampusEvent)
      .filter((evt) => isCampusEventPublished(evt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.events);
  }
}

export async function fetchCampusEventById(
  eventId: string
): Promise<CampusEvent | null> {
  if (!isValidFirestoreId(eventId)) return null;
  const path = `${COLLECTION_NAMES.events}/${eventId}`;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.events, eventId));
    if (!snap.exists()) return null;
    const data = snap.data() as CampusEvent;
    return isCampusEventPublished(data) ? data : null;
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function toggleEventReaction(input: {
  eventId: string;
  actorUid: string;
  reactionType?: ReactionType;
}): Promise<{ liked: boolean; likesCount: number }> {
  if (
    !isValidFirestoreId(input.eventId) ||
    !isValidFirestoreId(input.actorUid)
  ) {
    throw new Error('Sign in to react to campus events.');
  }

  const eventRef = doc(db, COLLECTION_NAMES.events, input.eventId);
  const reactionId = `events_${input.eventId}_${input.actorUid}`;
  const reactionRef = doc(db, COLLECTION_NAMES.postReactions, reactionId);
  const path = `${COLLECTION_NAMES.postReactions}/${reactionId}`;

  try {
    const result = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [eventSnap, reactionSnap] = await Promise.all([
          tx.get(eventRef),
          tx.get(reactionRef),
        ]);
        if (!eventSnap.exists()) {
          throw new Error('This event is no longer available.');
        }

        const evtData = eventSnap.data() as CampusEvent;
        if (!isCampusEventPublished(evtData)) {
          throw new Error('This event is no longer available.');
        }

        const eventOwnerUid = evtData.ownerUID ?? null;
        const eventTitle = evtData.title;
        const eventImageId = evtData.mediaItems?.[0]?.imageId;
        const eventBannerUrl = evtData.bannerUrl;

        const currentCount = Number(evtData.likesCount ?? 0);
        const nextState = computeNextReactionTransactionState({
          alreadyLiked: reactionSnap.exists(),
          currentLikesCount: currentCount,
        });

        if (!nextState.liked) {
          tx.delete(reactionRef);
          if (nextState.shouldUpdatePostLikesCount) {
            tx.update(eventRef, { likesCount: nextState.likesCount });
          }
          return {
            liked: false,
            likesCount: nextState.likesCount,
            eventOwnerUid,
            eventTitle,
            eventImageId,
            eventBannerUrl,
          };
        }

        tx.set(reactionRef, {
          targetCollection: 'events',
          targetId: input.eventId,
          ownerUID: input.actorUid,
          reactionType: input.reactionType ?? 'like',
          createdAt: serverTimestamp(),
        });
        tx.update(eventRef, { likesCount: nextState.likesCount });
        return {
          liked: true,
          likesCount: nextState.likesCount,
          eventOwnerUid,
          eventTitle,
          eventImageId,
          eventBannerUrl,
        };
      })
    );

    if (
      result.liked &&
      result.eventOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: result.eventOwnerUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildReactionNotificationId('events', input.eventId, input.actorUid),
        recipientUid: result.eventOwnerUid,
        eventType: 'reaction',
        title: `Someone liked event "${summarizeNotificationExcerpt(result.eventTitle, 80)}"`,
        targetPath: `/?view=upcoming-events&eventId=${input.eventId}`,
        actorUid: input.actorUid,
        targetImageId: result.eventImageId,
        targetImageUrl: result.eventImageId ? undefined : result.eventBannerUrl,
      });
    }

    return { liked: result.liked, likesCount: result.likesCount };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

async function hydrateCommentAuthors(
  comments: PostComment[]
): Promise<CommentWithAuthor[]> {
  const authorUids = Array.from(
    new Set(comments.map((c) => c.ownerUID).filter(isValidFirestoreId))
  );
  const authorMap = new Map<string, PublicProfileProjection>();

  if (authorUids.length > 0) {
    const results = await Promise.allSettled(
      authorUids.map(async (uid) => {
        const snap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
        if (!snap.exists()) return null;
        const profile = snap.data() as PublicUserProfile;
        if (profile.accountStatus !== 'active') return null;
        return { uid, projection: toPublicProfileProjection(profile) };
      })
    );
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        authorMap.set(res.value.uid, res.value.projection);
      }
    }
  }

  return comments.map((comment) => ({
    comment,
    author: authorMap.get(comment.ownerUID) ?? null,
  }));
}

export async function fetchEventComments(
  eventId: string
): Promise<CommentWithAuthor[]> {
  if (!isValidFirestoreId(eventId)) return [];

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.postComments),
      where('postId', '==', eventId),
      where('status', '==', 'published'),
      limit(150)
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((item) => item.data() as PostComment)
      .filter((c) => !c.targetCollection || c.targetCollection === 'events')
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.createdAt) ?? 0;
        const bMs = extractTimestampMs(b.createdAt) ?? 0;
        return aMs - bMs;
      });
    return await hydrateCommentAuthors(items);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.postComments
    );
  }
}

export async function addEventComment(input: {
  eventId: string;
  body: string;
  parentCommentId?: string;
  actorUid: string;
}): Promise<{ comment: PostComment; commentsCount: number }> {
  if (
    !isValidFirestoreId(input.eventId) ||
    !isValidFirestoreId(input.actorUid)
  ) {
    throw new Error('Sign in to comment on campus events.');
  }

  const trimmed = input.body.trim();
  if (trimmed.length < 1 || trimmed.length > BLUEPRINT_LIMITS.commentBodyMax) {
    throw new Error(
      `Comments must be 1–${BLUEPRINT_LIMITS.commentBodyMax} characters.`
    );
  }

  const eventRef = doc(db, COLLECTION_NAMES.events, input.eventId);
  const commentId = generateFirestoreDocId(COLLECTION_NAMES.postComments);
  const commentRef = doc(db, COLLECTION_NAMES.postComments, commentId);
  const path = `${COLLECTION_NAMES.postComments}/${commentId}`;

  const payload: Record<string, unknown> = {
    id: commentId,
    postId: input.eventId,
    targetCollection: 'events',
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

  let eventOwnerUid: string | null = null;
  let eventTitle = '';
  let eventImageId: string | undefined;
  let eventBannerUrl: string | undefined;

  try {
    const nextCount = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const evtSnap = await tx.get(eventRef);
        if (!evtSnap.exists()) {
          throw new Error('This event is no longer available.');
        }
        const evtData = evtSnap.data() as CampusEvent;
        if (!isCampusEventPublished(evtData)) {
          throw new Error('This event is no longer available.');
        }
        eventOwnerUid = evtData.ownerUID;
        eventTitle = evtData.title;
        eventImageId = evtData.mediaItems?.[0]?.imageId;
        eventBannerUrl = evtData.bannerUrl;

        const currentCount = Number(evtData.commentsCount ?? 0);
        const updatedCount = Math.max(0, currentCount) + 1;

        tx.set(commentRef, payload);
        tx.update(eventRef, { commentsCount: updatedCount });
        return updatedCount;
      })
    );

    const targetPath = `/?view=upcoming-events&eventId=${input.eventId}&commentId=${commentId}`;
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
        title: `Reply on "${summarizeNotificationExcerpt(eventTitle, 60)}"`,
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: eventImageId,
        targetImageUrl: eventImageId ? undefined : eventBannerUrl,
      });
    }

    if (
      eventOwnerUid &&
      eventOwnerUid !== parentOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: eventOwnerUid,
      })
    ) {
      void createSafeMemberNotification({
        id: buildCommentNotificationId(commentId),
        recipientUid: eventOwnerUid,
        eventType: 'comment',
        title: `New comment on "${summarizeNotificationExcerpt(eventTitle, 60)}"`,
        body: excerpt || undefined,
        targetPath,
        actorUid: input.actorUid,
        targetImageId: eventImageId,
        targetImageUrl: eventImageId ? undefined : eventBannerUrl,
      });
    }

    const nowMs = Date.now();
    return {
      comment: {
        id: commentId,
        postId: input.eventId,
        targetCollection: 'events',
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

export async function editEventComment(input: {
  commentId: string;
  body: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.commentId)) {
    throw new Error('Invalid comment identifier.');
  }
  const trimmed = input.body.trim();
  if (trimmed.length < 1 || trimmed.length > BLUEPRINT_LIMITS.commentBodyMax) {
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

export async function deleteEventComment(input: {
  eventId: string;
  commentId: string;
  replyIdsToRemove?: string[];
}): Promise<number> {
  if (
    !isValidFirestoreId(input.eventId) ||
    !isValidFirestoreId(input.commentId)
  ) {
    throw new Error('Invalid comment identifier.');
  }

  const idsToDelete = Array.from(
    new Set([input.commentId, ...(input.replyIdsToRemove ?? [])])
  ).filter(isValidFirestoreId);

  const eventRef = doc(db, COLLECTION_NAMES.events, input.eventId);
  const path = `${COLLECTION_NAMES.postComments}/${input.commentId}`;

  try {
    return await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const evtSnap = await tx.get(eventRef);
        const currentCount = evtSnap.exists()
          ? Number((evtSnap.data() as CampusEvent).commentsCount ?? 0)
          : 0;
        const nextCount = Math.max(0, currentCount - idsToDelete.length);

        for (const id of idsToDelete) {
          tx.delete(doc(db, COLLECTION_NAMES.postComments, id));
        }
        if (evtSnap.exists() && nextCount < currentCount) {
          tx.update(eventRef, { commentsCount: nextCount });
        }
        return nextCount;
      })
    );
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function togglePostCommentReaction(input: {
  commentId: string;
  actorUid: string;
}): Promise<{ liked: boolean; likesCount: number }> {
  if (
    !isValidFirestoreId(input.commentId) ||
    !isValidFirestoreId(input.actorUid)
  ) {
    throw new Error('Sign in to like comments.');
  }

  const commentRef = doc(db, COLLECTION_NAMES.postComments, input.commentId);
  const reactionId = `postComments_${input.commentId}_${input.actorUid}`;
  const reactionRef = doc(db, COLLECTION_NAMES.postReactions, reactionId);
  const path = `${COLLECTION_NAMES.postReactions}/${reactionId}`;

  try {
    const result = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [commentSnap, reactionSnap] = await Promise.all([
          tx.get(commentRef),
          tx.get(reactionRef),
        ]);
        if (!commentSnap.exists()) {
          throw new Error('This comment is no longer available.');
        }

        const commentData = commentSnap.data() as PostComment;
        const commentOwnerUid = commentData.ownerUID ?? null;
        const commentBody = commentData.body;
        const targetCollection = commentData.targetCollection ?? 'posts';
        const parentPostId = commentData.postId;

        const currentCount = Number(commentData.likesCount ?? 0);
        const nextState = computeNextReactionTransactionState({
          alreadyLiked: reactionSnap.exists(),
          currentLikesCount: currentCount,
        });

        if (!nextState.liked) {
          tx.delete(reactionRef);
          if (nextState.shouldUpdatePostLikesCount) {
            tx.update(commentRef, { likesCount: nextState.likesCount });
          }
          return {
            liked: false,
            likesCount: nextState.likesCount,
            commentOwnerUid,
            commentBody,
            targetCollection,
            parentPostId,
          };
        }

        tx.set(reactionRef, {
          targetCollection: 'postComments',
          targetId: input.commentId,
          ownerUID: input.actorUid,
          reactionType: 'like',
          createdAt: serverTimestamp(),
        });
        tx.update(commentRef, { likesCount: nextState.likesCount });
        return {
          liked: true,
          likesCount: nextState.likesCount,
          commentOwnerUid,
          commentBody,
          targetCollection,
          parentPostId,
        };
      })
    );

    if (
      result.liked &&
      result.commentOwnerUid &&
      shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: result.commentOwnerUid,
      })
    ) {
      const targetPath =
        result.targetCollection === 'events'
          ? `/?view=upcoming-events&eventId=${result.parentPostId}&commentId=${input.commentId}`
          : result.targetCollection === 'marketplaceListings'
            ? `/?view=marketplace&listingId=${result.parentPostId}&commentId=${input.commentId}`
            : `/?view=for-you&postId=${result.parentPostId}&commentId=${input.commentId}`;

      void createSafeMemberNotification({
        id: buildReactionNotificationId(
          'postComments',
          input.commentId,
          input.actorUid
        ),
        recipientUid: result.commentOwnerUid,
        eventType: 'reaction',
        title: 'Someone liked your comment',
        body: summarizeNotificationExcerpt(result.commentBody, 120) || undefined,
        targetPath,
        actorUid: input.actorUid,
      });
    }

    return { liked: result.liked, likesCount: result.likesCount };
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

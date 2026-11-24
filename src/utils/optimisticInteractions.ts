import type { CommentWithAuthor } from '../services/socialPosts';
import type {
  AnonymousComment,
  PostComment,
  PublicProfileProjection,
} from '../types/database';

let optimisticSeq = 0;

export function createOptimisticTempId(prefix = 'optimistic'): string {
  optimisticSeq += 1;
  return `${prefix}_${Date.now()}_${optimisticSeq}`;
}

export function isOptimisticTempId(id: string): boolean {
  return id.startsWith('optimistic_');
}

export function computeOptimisticReactionToggle(input: {
  currentlyLiked: boolean;
  currentCount: number;
}): { nextLiked: boolean; nextCount: number } {
  const safeCount =
    Number.isFinite(input.currentCount) && input.currentCount > 0
      ? Math.trunc(input.currentCount)
      : 0;
  if (input.currentlyLiked) {
    return {
      nextLiked: false,
      nextCount: Math.max(0, safeCount - 1),
    };
  }
  return {
    nextLiked: true,
    nextCount: safeCount + 1,
  };
}

export function buildOptimisticCommentEntry(input: {
  tempId: string;
  targetCollection:
    | 'posts'
    | 'events'
    | 'updates'
    | 'anonymousPosts'
    | 'marketplaceListings';
  postId: string;
  actorUid: string;
  body: string;
  parentCommentId?: string;
  author: PublicProfileProjection | null;
  nowMs?: number;
}): CommentWithAuthor {
  const nowMs = input.nowMs ?? Date.now();
  const trimmed = input.body.trim();

  if (input.targetCollection === 'anonymousPosts') {
    const anonComment: AnonymousComment = {
      id: input.tempId,
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      body: trimmed,
      status: 'published',
      likesCount: 0,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    return {
      comment: anonComment,
      author: null,
    };
  }

  const postComment: PostComment = {
    id: input.tempId,
    postId: input.postId,
    targetCollection: input.targetCollection,
    parentCommentId: input.parentCommentId,
    ownerUID: input.actorUid,
    body: trimmed,
    status: 'published',
    likesCount: 0,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  return {
    comment: postComment,
    author: input.author,
  };
}

export function appendOptimisticCommentEntry(
  items: readonly CommentWithAuthor[],
  entry: CommentWithAuthor
): CommentWithAuthor[] {
  if (items.some((existing) => existing.comment.id === entry.comment.id)) {
    return [...items];
  }
  return [...items, entry];
}

export function reconcileOptimisticCommentEntry(
  items: readonly CommentWithAuthor[],
  tempId: string,
  persistedComment: PostComment | AnonymousComment,
  fallbackAuthor: PublicProfileProjection | null
): CommentWithAuthor[] {
  const hasPersistedAlready = items.some(
    (entry) => entry.comment.id === persistedComment.id
  );
  if (hasPersistedAlready) {
    return items.filter((entry) => entry.comment.id !== tempId);
  }

  let replaced = false;
  const next = items.map((entry) => {
    if (entry.comment.id !== tempId) return entry;
    replaced = true;
    return {
      comment: persistedComment,
      author: entry.author ?? fallbackAuthor,
    };
  });

  if (!replaced) {
    next.push({
      comment: persistedComment,
      author: fallbackAuthor,
    });
  }
  return next;
}

export function removeCommentTreeEntries(
  items: readonly CommentWithAuthor[],
  idsToRemove: ReadonlySet<string>
): {
  remaining: CommentWithAuthor[];
  removed: CommentWithAuthor[];
} {
  const remaining: CommentWithAuthor[] = [];
  const removed: CommentWithAuthor[] = [];
  for (const entry of items) {
    if (idsToRemove.has(entry.comment.id)) {
      removed.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  return { remaining, removed };
}

export function restoreCommentEntriesOrdered(
  items: readonly CommentWithAuthor[],
  removedEntries: readonly CommentWithAuthor[]
): CommentWithAuthor[] {
  const existingIds = new Set(items.map((e) => e.comment.id));
  const merged = [...items];
  for (const entry of removedEntries) {
    if (!existingIds.has(entry.comment.id)) {
      merged.push(entry);
      existingIds.add(entry.comment.id);
    }
  }
  return merged.sort((a, b) => {
    const aTime =
      typeof a.comment.createdAt === 'number' ? a.comment.createdAt : 0;
    const bTime =
      typeof b.comment.createdAt === 'number' ? b.comment.createdAt : 0;
    return aTime - bTime;
  });
}

export function computeOptimisticCommentReactionMap(input: {
  commentId: string;
  likedSet: ReadonlySet<string>;
  countsMap: Readonly<Record<string, number>>;
  baseCount: number;
}): {
  nextLiked: boolean;
  nextCount: number;
  nextLikedSet: Set<string>;
  nextCountsMap: Record<string, number>;
} {
  const currentlyLiked = input.likedSet.has(input.commentId);
  const currentCount = input.countsMap[input.commentId] ?? input.baseCount;
  const { nextLiked, nextCount } = computeOptimisticReactionToggle({
    currentlyLiked,
    currentCount,
  });

  const nextLikedSet = new Set(input.likedSet);
  if (nextLiked) nextLikedSet.add(input.commentId);
  else nextLikedSet.delete(input.commentId);

  const nextCountsMap: Record<string, number> = {
    ...input.countsMap,
    [input.commentId]: nextCount,
  };

  return {
    nextLiked,
    nextCount,
    nextLikedSet,
    nextCountsMap,
  };
}

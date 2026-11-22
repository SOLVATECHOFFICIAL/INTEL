import test from 'node:test';
import assert from 'node:assert/strict';
import type { PostComment, PublicProfileProjection } from '../types/database';
import {
  appendOptimisticCommentEntry,
  buildOptimisticCommentEntry,
  computeOptimisticCommentReactionMap,
  computeOptimisticReactionToggle,
  createOptimisticTempId,
  isOptimisticTempId,
  reconcileOptimisticCommentEntry,
  removeCommentTreeEntries,
  restoreCommentEntriesOrdered,
} from './optimisticInteractions';

const SAMPLE_AUTHOR: PublicProfileProjection = {
  fullName: 'Adebayo Tunde',
  username: 'adebayo',
  badge: 'verified',
  accountStatus: 'active',
  followersCount: 12,
  followingCount: 5,
  createdAt: 1000,
};

test('computeOptimisticReactionToggle increments and decrements safely without negative counts', () => {
  assert.deepEqual(
    computeOptimisticReactionToggle({ currentlyLiked: false, currentCount: 0 }),
    { nextLiked: true, nextCount: 1 }
  );
  assert.deepEqual(
    computeOptimisticReactionToggle({ currentlyLiked: true, currentCount: 3 }),
    { nextLiked: false, nextCount: 2 }
  );
  assert.deepEqual(
    computeOptimisticReactionToggle({ currentlyLiked: true, currentCount: 0 }),
    { nextLiked: false, nextCount: 0 }
  );
});

test('optimistic comments and replies append immediately, reconcile temp IDs, prevent duplicates, and roll back cleanly', () => {
  const tempId = createOptimisticTempId();
  assert.equal(isOptimisticTempId(tempId), true);
  assert.equal(isOptimisticTempId('real_comment_1'), false);

  const entry = buildOptimisticCommentEntry({
    tempId,
    targetCollection: 'events',
    postId: 'evt_1',
    actorUid: 'user_1',
    body: 'See you at the auditorium!',
    author: SAMPLE_AUTHOR,
    nowMs: 5000,
  });

  const appended = appendOptimisticCommentEntry([], entry);
  assert.equal(appended.length, 1);
  // Prevent duplicate append of same id
  assert.equal(appendOptimisticCommentEntry(appended, entry).length, 1);

  const persisted: PostComment = {
    id: 'server_c1',
    postId: 'evt_1',
    targetCollection: 'events',
    ownerUID: 'user_1',
    body: 'See you at the auditorium!',
    status: 'published',
    likesCount: 0,
    createdAt: 5100,
    updatedAt: 5100,
  };

  const reconciled = reconcileOptimisticCommentEntry(
    appended,
    tempId,
    persisted,
    SAMPLE_AUTHOR
  );
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].comment.id, 'server_c1');
  assert.equal(reconciled[0].author?.username, 'adebayo');

  // If persisted id already exists alongside tempId, reconciliation removes duplicate temp entry
  const duplicated = [...reconciled, entry];
  const deduped = reconcileOptimisticCommentEntry(
    duplicated,
    tempId,
    persisted,
    SAMPLE_AUTHOR
  );
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].comment.id, 'server_c1');

  // Optimistic delete + rollback on error
  const replyTempId = createOptimisticTempId();
  const replyEntry = buildOptimisticCommentEntry({
    tempId: replyTempId,
    targetCollection: 'events',
    postId: 'evt_1',
    actorUid: 'user_2',
    body: 'Count me in!',
    parentCommentId: 'server_c1',
    author: SAMPLE_AUTHOR,
    nowMs: 6000,
  });
  const withReply = appendOptimisticCommentEntry(deduped, replyEntry);
  const { remaining, removed } = removeCommentTreeEntries(
    withReply,
    new Set(['server_c1', replyTempId])
  );
  assert.equal(remaining.length, 0);
  assert.equal(removed.length, 2);

  const restored = restoreCommentEntriesOrdered(remaining, removed);
  assert.deepEqual(
    restored.map((e) => e.comment.id),
    ['server_c1', replyTempId]
  );
});

test('computeOptimisticCommentReactionMap toggles comment likes immediately and supports rollback', () => {
  const initialLiked = new Set<string>();
  const initialCounts: Record<string, number> = {};

  const liked = computeOptimisticCommentReactionMap({
    commentId: 'c1',
    likedSet: initialLiked,
    countsMap: initialCounts,
    baseCount: 2,
  });
  assert.equal(liked.nextLiked, true);
  assert.equal(liked.nextCount, 3);
  assert.equal(liked.nextLikedSet.has('c1'), true);

  const unliked = computeOptimisticCommentReactionMap({
    commentId: 'c1',
    likedSet: liked.nextLikedSet,
    countsMap: liked.nextCountsMap,
    baseCount: 2,
  });
  assert.equal(unliked.nextLiked, false);
  assert.equal(unliked.nextCount, 2);
  assert.equal(unliked.nextLikedSet.has('c1'), false);
});

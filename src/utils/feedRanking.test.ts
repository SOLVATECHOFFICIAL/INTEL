import test from 'node:test';
import assert from 'node:assert/strict';
import type { CommunityPost } from '../types/database';
import {
  computeForYouPostScore,
  rankForYouCommunityPosts,
  sortLatestCommunityPosts,
} from './feedRanking';

function makePost(overrides: Partial<CommunityPost> & { id: string }): CommunityPost {
  return {
    ownerUID: 'user_1',
    authorRole: 'verified',
    postType: 'text',
    category: 'Campus Update',
    body: 'Sample campus post.',
    backgroundStyle: 'navy_slate',
    isOfficial: false,
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

test('sortLatestCommunityPosts orders strictly newest-first without pinned priority', () => {
  const olderPinned = makePost({
    id: 'p_old_pinned',
    isPinned: true,
    createdAt: 1_000,
  });
  const middle = makePost({
    id: 'p_mid',
    createdAt: 5_000,
  });
  const newest = makePost({
    id: 'p_new',
    createdAt: 9_000,
  });
  const deletedPost = makePost({
    id: 'p_deleted',
    status: 'deleted',
    createdAt: 99_000,
  });

  const sorted = sortLatestCommunityPosts([olderPinned, middle, newest, deletedPost]);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['p_new', 'p_mid', 'p_old_pinned']
  );
});

test('rankForYouCommunityPosts prioritizes pinned, official, followed, and engaged recent posts using only real fields', () => {
  const nowMs = 100_000_000;
  const freshFollowed = makePost({
    id: 'p_followed',
    ownerUID: 'author_followed',
    createdAt: nowMs - 1_800_000, // 30 mins ago
    likesCount: 5,
    commentsCount: 2,
  });
  const freshUnfollowed = makePost({
    id: 'p_plain',
    ownerUID: 'author_other',
    createdAt: nowMs - 1_800_000,
    likesCount: 0,
    commentsCount: 0,
  });
  const officialPost = makePost({
    id: 'p_official',
    ownerUID: 'author_admin',
    isOfficial: true,
    createdAt: nowMs - 3_600_000, // 1 hr ago
  });
  const pinnedPost = makePost({
    id: 'p_pinned',
    ownerUID: 'author_admin',
    isPinned: true,
    createdAt: nowMs - 86_400_000, // 1 day ago
  });

  const ranked = rankForYouCommunityPosts(
    [freshUnfollowed, officialPost, freshFollowed, pinnedPost],
    {
      followedUids: new Set(['author_followed']),
      nowMs,
    }
  );

  assert.equal(ranked[0].id, 'p_pinned');
  assert.ok(
    computeForYouPostScore(officialPost, { nowMs }) >
      computeForYouPostScore(freshUnfollowed, { nowMs })
  );
  assert.ok(
    computeForYouPostScore(freshFollowed, {
      followedUids: new Set(['author_followed']),
      nowMs,
    }) > computeForYouPostScore(freshUnfollowed, { nowMs })
  );
});

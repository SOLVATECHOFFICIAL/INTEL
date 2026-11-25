import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AnonymousPost,
  CommunityPost,
  PublicProfileProjection,
} from '../types/database';
import {
  BoundedLruMap,
  SingleFlightRegistry,
  areSetsEqual,
  computeActivePollDelayMs,
  computeSnapshotSignature,
  deserializeRecordMap,
  deserializeSet,
  isNewerOrSameTimestamp,
  isPersistableCacheKey,
  mergeAnchoredFeedStream,
  mergeCommunityPostItems,
  mergeOrderedRecords,
  patchAuthorProjectionInMap,
  patchAuthorProjectionInPostItems,
  perfMetrics,
  removeItemById,
  reuseSetIfUnchanged,
  sanitizeAnonymousPostForCache,
  sanitizeAnonymousPostsForCache,
  serializeRecordMap,
  serializeSet,
  stripFirestoreCursor,
  subtractPostLikesSafe,
  upsertItemById,
} from './cacheSync';

function makeProfile(
  uid: string,
  overrides: Partial<PublicProfileProjection> = {}
): PublicProfileProjection {
  return {
    fullName: `Member ${uid}`,
    username: `user_${uid}`,
    department: 'Computer Science',
    level: '300L',
    badge: 'verified',
    accountStatus: 'active',
    showWhatsappPublicly: false,
    followersCount: 10,
    followingCount: 5,
    createdAt: 1000,
    ...overrides,
  };
}

function makeCommunityPost(
  id: string,
  overrides: Partial<CommunityPost> = {}
): CommunityPost {
  return {
    id,
    ownerUID: 'u1',
    authorRole: 'verified',
    postType: 'text',
    category: 'Campus Update',
    body: `Post ${id}`,
    isOfficial: false,
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test('serializeSet and deserializeSet roundtrip string sets safely', () => {
  const original = new Set(['a', 'b', 'c']);
  const serialized = serializeSet(original);
  assert.deepEqual(serialized, ['a', 'b', 'c']);
  const restored = deserializeSet(serialized);
  assert.deepEqual(Array.from(restored), ['a', 'b', 'c']);
  assert.equal(deserializeSet(null).size, 0);
});

test('serializeRecordMap and deserializeRecordMap roundtrip key-value maps safely', () => {
  const original = new Map<string, number>([
    ['post-1', 12],
    ['post-2', 4],
  ]);
  const restored = deserializeRecordMap<number>(serializeRecordMap(original));
  assert.equal(restored.get('post-1'), 12);
  assert.equal(restored.get('post-2'), 4);
  assert.equal(deserializeRecordMap('invalid').size, 0);
});

test('stripFirestoreCursor preserves offset cursors and clears Firestore snapshots', () => {
  assert.deepEqual(stripFirestoreCursor({ mode: 'offset', offset: 24 }), {
    mode: 'offset',
    offset: 24,
  });
  assert.equal(stripFirestoreCursor({ mode: 'firestore' }), null);
  assert.equal(stripFirestoreCursor(null), null);
});

test('isPersistableCacheKey blocks admin, audit, and anonymous mapping keys', () => {
  assert.equal(isPersistableCacheKey('adminAuditLogs:recent'), false);
  assert.equal(isPersistableCacheKey('badgeAuditLogs:all'), false);
  assert.equal(isPersistableCacheKey('anonymousIdentityMappings:p1'), false);
  assert.equal(isPersistableCacheKey('anonymousReports:pending'), false);
  assert.equal(isPersistableCacheKey('admin:overview'), false);
  assert.equal(isPersistableCacheKey('feed:for-you:guest'), true);
  assert.equal(isPersistableCacheKey('profile:public:amaka'), true);
});

test('sanitizeAnonymousPostForCache strips any identity linkage defensively', () => {
  const dirty = {
    id: 'anon-1',
    postType: 'text',
    category: 'Campus Life',
    body: 'Hello campus',
    status: 'published',
    visibility: 'public',
    likesCount: 3,
    commentsCount: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ownerUID: 'secret-uid',
    authorUid: 'secret-uid-2',
    email: 'secret@lasued.edu.ng',
  } as unknown as AnonymousPost;

  const [sanitized] = sanitizeAnonymousPostsForCache([dirty]);
  assert.equal('ownerUID' in sanitized, false);
  assert.equal('authorUid' in sanitized, false);
  assert.equal('email' in sanitized, false);
  assert.equal(sanitized.id, 'anon-1');
  assert.equal(sanitized.body, 'Hello campus');
  assert.equal(
    'ownerUID' in sanitizeAnonymousPostForCache(dirty),
    false
  );
});

test('monotonic timestamp protection stops stale caches overwriting newer server state', () => {
  const newer = { createdAt: 1000, updatedAt: 5000 };
  const older = { createdAt: 1000, updatedAt: 3000 };
  assert.equal(isNewerOrSameTimestamp(older, newer), false);
  assert.equal(isNewerOrSameTimestamp(newer, older), true);
  assert.equal(isNewerOrSameTimestamp(newer, newer), true);
});

test('mergeCommunityPostItems deduplicates, preserves older pages and keeps unchanged refs', () => {
  const author1 = makeProfile('u1');
  const existingItem1 = { post: makeCommunityPost('p1', { likesCount: 2 }), author: author1 };
  const existingItem2 = { post: makeCommunityPost('p2', { likesCount: 5 }), author: author1 };
  const olderPageItem = { post: makeCommunityPost('p3'), author: author1 };

  const incoming = [
    { post: makeCommunityPost('p0', { createdAt: 2000, updatedAt: 2000 }), author: author1 },
    { post: makeCommunityPost('p1', { likesCount: 2 }), author: makeProfile('u1') },
    { post: makeCommunityPost('p2', { likesCount: 8, updatedAt: 2500 }), author: author1 },
  ];

  const mergedHead = mergeCommunityPostItems({
    existing: [existingItem1, existingItem2, olderPageItem],
    incoming,
    preferIncomingOrder: false,
    preserveTail: true,
  });

  assert.deepEqual(
    mergedHead.map((i) => i.post.id),
    ['p0', 'p1', 'p2', 'p3']
  );
  // Unchanged p1 and p3 retain identical object references so React.memo skips re-render
  assert.equal(mergedHead[1], existingItem1);
  assert.equal(mergedHead[2].post.likesCount, 8);
  assert.equal(mergedHead[3], olderPageItem);

  // Stale incoming data does not overwrite newer updated p2
  const staleMerged = mergeCommunityPostItems({
    existing: mergedHead,
    incoming: [
      { post: makeCommunityPost('p2', { likesCount: 1, updatedAt: 1200 }), author: author1 },
    ],
  });
  assert.equal(
    staleMerged.find((i) => i.post.id === 'p2')?.post.likesCount,
    8
  );
});

test('mergeOrderedRecords prevents duplicates and supports preferIncomingOrder', () => {
  const r1 = { id: 'a', createdAt: 100, updatedAt: 100, name: 'First' };
  const r2 = { id: 'b', createdAt: 200, updatedAt: 200, name: 'Second' };
  const r3 = { id: 'c', createdAt: 50, updatedAt: 50, name: 'Third' };

  const merged = mergeOrderedRecords({
    existing: [r1, r2, r3],
    incoming: [
      { id: 'b', createdAt: 200, updatedAt: 300, name: 'Second Updated' },
      { id: 'a', createdAt: 100, updatedAt: 100, name: 'First' },
      { id: 'b', createdAt: 200, updatedAt: 300, name: 'Second Updated' },
    ],
    preferIncomingOrder: true,
    preserveTail: true,
  });

  assert.deepEqual(
    merged.map((m) => m.id),
    ['b', 'a', 'c']
  );
  assert.equal(merged[0].name, 'Second Updated');
  assert.equal(merged[1], r1);
  assert.equal(merged[2], r3);
});

test('upsertItemById, removeItemById, and patchAuthorProjectionInPostItems update cleanly', () => {
  const p1 = makeCommunityPost('p1');
  const p2 = makeCommunityPost('p2');
  const added = upsertItemById([p1], p2, true);
  assert.deepEqual(
    added.map((p) => p.id),
    ['p2', 'p1']
  );
  const replaced = upsertItemById(added, { ...p1, body: 'Edited' });
  assert.equal(replaced[1].body, 'Edited');
  const removed = removeItemById(replaced, 'p2');
  assert.deepEqual(
    removed.map((p) => p.id),
    ['p1']
  );

  const authorOld = makeProfile('u1', { fullName: 'Old Name' });
  const authorNew = makeProfile('u1', { fullName: 'New Name' });
  const items = [{ post: p1, author: authorOld }];
  const patched = patchAuthorProjectionInPostItems(items, authorNew);
  assert.equal(patched[0].author?.fullName, 'New Name');
});

test('SingleFlightRegistry coalesces concurrent calls and cleans up after settlement', async () => {
  const registry = new SingleFlightRegistry();
  let executions = 0;

  const task = () =>
    new Promise<number>((resolve) => {
      executions += 1;
      setTimeout(() => resolve(42), 10);
    });

  const [a, b, c] = await Promise.all([
    registry.run('key-1', task),
    registry.run('key-1', task),
    registry.run('key-1', task),
  ]);

  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(c, 42);
  assert.equal(executions, 1);
  assert.equal(registry.size(), 0);

  // Subsequent run executes freshly
  await registry.run('key-1', task);
  assert.equal(executions, 2);
});

test('BoundedLruMap evicts oldest accessed key when capacity is exceeded', () => {
  const cache = new BoundedLruMap<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // 'a' becomes MRU, 'b' becomes LRU
  cache.set('c', 3);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('computeActivePollDelayMs pauses when hidden or offline and backs off on errors/data-saver', () => {
  assert.equal(
    computeActivePollDelayMs({ isVisible: false, isOnline: true }),
    null
  );
  assert.equal(
    computeActivePollDelayMs({ isVisible: true, isOnline: false }),
    null
  );
  assert.equal(
    computeActivePollDelayMs({ isVisible: true, isOnline: true }),
    5000
  );
  assert.equal(
    computeActivePollDelayMs({
      isVisible: true,
      isOnline: true,
      isDataSaver: true,
    }),
    12000
  );
  assert.equal(
    computeActivePollDelayMs({
      isVisible: true,
      isOnline: true,
      consecutiveErrors: 2,
    }),
    20000
  );
  assert.equal(
    computeActivePollDelayMs({
      isVisible: true,
      isOnline: true,
      consecutiveErrors: 6,
    }),
    30000
  );
});

test('perfMetrics tracks hits, misses, and timings cleanly', () => {
  perfMetrics.reset();
  perfMetrics.recordHit('feed');
  perfMetrics.recordHit('feed');
  perfMetrics.recordMiss('feed');
  perfMetrics.recordTiming('feed', 40);
  perfMetrics.recordTiming('feed', 80);

  const summary = perfMetrics.getSummary();
  assert.deepEqual(summary.feed, {
    hits: 2,
    misses: 1,
    loads: 2,
    avgMs: 60,
    lastMs: 80,
  });
});

test('areSetsEqual and reuseSetIfUnchanged preserve reference identity for equal sets', () => {
  const prev = new Set(['p1', 'p2']);
  const same = new Set(['p2', 'p1']);
  const diff = new Set(['p1', 'p3']);

  assert.equal(areSetsEqual(prev, same), true);
  assert.equal(areSetsEqual(prev, diff), false);
  assert.equal(reuseSetIfUnchanged(prev, same), prev);
  assert.equal(reuseSetIfUnchanged(prev, diff), diff);
});

test('computeSnapshotSignature ignores volatile keys and detects structural content updates', () => {
  const snapA = {
    tab: 'for-you',
    cachedAt: 1000,
    lastAccessedAt: 1000,
    docSnap: { id: 'ignored-1' },
    ids: new Set(['b', 'a']),
    posts: [{ id: 'p1', likesCount: 4, updatedAt: { toMillis: () => 5000 } }],
  };
  const snapB = {
    tab: 'for-you',
    cachedAt: 999999,
    lastAccessedAt: 888888,
    docSnap: { id: 'ignored-2' },
    ids: new Set(['a', 'b']),
    posts: [{ id: 'p1', likesCount: 4, updatedAt: { toMillis: () => 5000 } }],
  };
  const snapC = {
    ...snapB,
    posts: [{ id: 'p1', likesCount: 5, updatedAt: { toMillis: () => 5000 } }],
  };

  assert.equal(computeSnapshotSignature(snapA), computeSnapshotSignature(snapB));
  assert.notEqual(computeSnapshotSignature(snapA), computeSnapshotSignature(snapC));
});

test('computeActivePollDelayMs throttles constrained devices gracefully', () => {
  assert.equal(
    computeActivePollDelayMs({
      isVisible: true,
      isOnline: true,
      isConstrainedDevice: true,
    }),
    10000
  );
  assert.equal(
    computeActivePollDelayMs({
      isVisible: true,
      isOnline: true,
      isConstrainedDevice: true,
      isDataSaver: true,
    }),
    12000
  );
});

test('patchAuthorProjectionInMap preserves ref when unchanged and updates target uid', () => {
  const oldAuthor = makeProfile('u1', { fullName: 'Amaka Old' });
  const sameAuthor = makeProfile('u1', { fullName: 'Amaka Old' });
  const newAuthor = makeProfile('u1', { fullName: 'Amaka New' });
  const map = new Map<string, PublicProfileProjection>([['u1', oldAuthor]]);

  assert.equal(patchAuthorProjectionInMap(map, sameAuthor, 'u1'), map);
  const updated = patchAuthorProjectionInMap(map, newAuthor, 'u1');
  assert.notEqual(updated, map);
  assert.equal(updated.get('u1')?.fullName, 'Amaka New');
});

test('mergeAnchoredFeedStream locks prefix and drops unseen updates at anchorIndex + 1 without duplicates', () => {
  const existing = [
    { id: 'p1', likes: 1 },
    { id: 'p2', likes: 4 },
    { id: 'p3', likes: 9 },
  ];
  const incoming = [
    { id: 'p_new_1', likes: 0 },
    { id: 'p_new_2', likes: 2 },
    { id: 'p2', likes: 7 },
    { id: 'p1', likes: 3 },
    { id: 'p_new_1', likes: 0 },
    { id: 'p3', likes: 9 },
  ];

  // When watching p2 (index 1) mid-feed, p1 & p2 stay anchored in order with updated likes,
  // unseen incoming posts insert strictly at index 2 (after p2), and p3 remains after.
  const midFeedResult = mergeAnchoredFeedStream({
    existing,
    incoming,
    anchorId: 'p2',
    isScrolledMidFeed: true,
  });

  assert.deepEqual(
    midFeedResult.items.map((item) => item.id),
    ['p1', 'p2', 'p_new_1', 'p_new_2', 'p3']
  );
  assert.equal(midFeedResult.insertionIndex, 2);
  assert.equal(midFeedResult.insertedCount, 2);
  assert.equal(midFeedResult.items[0].likes, 3);
  assert.equal(midFeedResult.items[1].likes, 7);

  // Near top (`isScrolledMidFeed: false`), incoming ranked order applies cleanly without duplicates
  const topResult = mergeAnchoredFeedStream({
    existing,
    incoming,
    anchorId: 'p2',
    isScrolledMidFeed: false,
  });
  assert.deepEqual(
    topResult.items.map((item) => item.id),
    ['p_new_1', 'p_new_2', 'p2', 'p1', 'p3']
  );
});

test('subtractPostLikesSafe safely decrements likes and clamps to zero', () => {
  assert.equal(subtractPostLikesSafe(25, 7), 18);
  assert.equal(subtractPostLikesSafe(5, 12), 0);
  assert.equal(subtractPostLikesSafe(Number.NaN, 3), 0);
  assert.equal(subtractPostLikesSafe(10, -4), 10);
});

test('mergeOrderedRecords and mergeCommunityPostItems prune deleted head items while preserving genuine paginated tail items', () => {
  // 1. When preserveTail is false, any missing items (even all when incoming is empty) are pruned
  const r1 = { id: 'e1', createdAt: 300, updatedAt: 300 };
  const r2 = { id: 'e2', createdAt: 200, updatedAt: 200 };
  const r3 = { id: 'e3', createdAt: 100, updatedAt: 100 };

  assert.deepEqual(
    mergeOrderedRecords({
      existing: [r1, r2, r3],
      incoming: [r1, r3],
      preferIncomingOrder: true,
      preserveTail: false,
    }).map((r) => r.id),
    ['e1', 'e3']
  );

  assert.deepEqual(
    mergeOrderedRecords({
      existing: [r1, r2],
      incoming: [],
      preferIncomingOrder: true,
      preserveTail: false,
    }),
    []
  );

  // 2. When preserveTail is true, deleted posts inside the refreshed head window are pruned,
  //    while genuine paginated older tail items remain intact.
  const author = makeProfile('u1');
  const headNewer = { post: makeCommunityPost('p4', { createdAt: 4000, updatedAt: 4000 }), author };
  const headDeleted = { post: makeCommunityPost('p3_deleted', { createdAt: 3000, updatedAt: 3000 }), author };
  const headKept = { post: makeCommunityPost('p2', { createdAt: 2000, updatedAt: 2000 }), author };
  const tailOlder = { post: makeCommunityPost('p1_tail', { createdAt: 1000, updatedAt: 1000 }), author };

  const prunedHead = mergeCommunityPostItems({
    existing: [headNewer, headDeleted, headKept, tailOlder],
    incoming: [headNewer, headKept],
    preferIncomingOrder: false,
    preserveTail: true,
  });
  assert.deepEqual(
    prunedHead.map((i) => i.post.id),
    ['p4', 'p2', 'p1_tail']
  );

  // Empty incoming clears stale existing list even with preserveTail: true
  assert.deepEqual(
    mergeCommunityPostItems({
      existing: [headNewer, headKept],
      incoming: [],
      preferIncomingOrder: false,
      preserveTail: true,
    }),
    []
  );
});

test('mergeAnchoredFeedStream prunes deleted posts when pruneMissing is true and retains explicit preserveMissingIds', () => {
  const existing = [
    { id: 'p1', likes: 1 },
    { id: 'p2_deleted', likes: 2 },
    { id: 'p3_anchor', likes: 3 },
    { id: 'p4_tail', likes: 4 },
  ];
  const incoming = [
    { id: 'p_fresh', likes: 0 },
    { id: 'p1', likes: 1 },
    { id: 'p3_anchor', likes: 5 },
  ];

  const merged = mergeAnchoredFeedStream({
    existing,
    incoming,
    anchorId: 'p3_anchor',
    isScrolledMidFeed: true,
    pruneMissing: true,
    preserveMissingIds: new Set(['p4_tail']),
  });

  assert.deepEqual(
    merged.items.map((item) => item.id),
    ['p1', 'p3_anchor', 'p_fresh', 'p4_tail']
  );
  assert.equal(merged.items[1].likes, 5);
});

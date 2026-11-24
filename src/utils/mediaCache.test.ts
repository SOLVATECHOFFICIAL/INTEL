import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MediaMemoryLru,
  buildScopedMediaCacheKey,
  computeFileSelectionFingerprint,
  parseImageDataUrlToBinary,
  partitionDuplicateSelectedFiles,
  reorderArrayItem,
  selectProfilePreloadTargets,
} from './mediaCache';

test('buildScopedMediaCacheKey isolates public vs per-user private entries and rejects invalid IDs', () => {
  assert.equal(buildScopedMediaCacheKey('img123'), 'pub:v1:img123');
  assert.equal(
    buildScopedMediaCacheKey('img123', { scope: 'private', viewerUid: 'user_abc' }),
    'priv:v1:user_abc:img123'
  );
  assert.equal(
    buildScopedMediaCacheKey('img123', { scope: 'private', viewerUid: null }),
    null
  );
  assert.equal(buildScopedMediaCacheKey('bad/id'), null);
});

test('MediaMemoryLru enforces entry count, byte ceiling, recency, explicit byte weights, and onEvict', () => {
  const lru = new MediaMemoryLru(5, 1200);
  const payload300 = 'x'.repeat(300); // 600 bytes UTF-16 estimate each

  lru.set('k1', payload300); // 600 bytes
  lru.set('k2', payload300); // 600 bytes -> total 1200
  assert.equal(lru.get('k1'), payload300); // refreshes k1, k2 is now oldest

  lru.set('k3', payload300); // exceeds 1200B, evicts k2
  assert.equal(lru.get('k2'), null);
  assert.equal(lru.get('k1'), payload300);
  assert.equal(lru.get('k3'), payload300);

  // Explicit byteWeight tracks lightweight blob: ObjectURLs by actual compressed size
  const evicted: string[] = [];
  const blobLru = new MediaMemoryLru(10, 1500, (key) => evicted.push(key));
  blobLru.set('pub:v1:a', 'blob:https://app.local/1', 900);
  blobLru.set('pub:v1:b', 'blob:https://app.local/2', 900); // exceeds 1500, evicts a
  assert.equal(blobLru.get('pub:v1:a'), null);
  assert.equal(blobLru.get('pub:v1:b'), 'blob:https://app.local/2');
  assert.deepEqual(evicted, ['pub:v1:a']);

  // Entry-count eviction when under byte cap
  const countLimited = new MediaMemoryLru(2, 100_000);
  countLimited.set('a', 'v1');
  countLimited.set('b', 'v2');
  countLimited.get('a'); // refresh 'a'
  countLimited.set('c', 'v3');
  assert.equal(countLimited.get('b'), null);
  assert.equal(countLimited.get('a'), 'v1');
  assert.equal(countLimited.get('c'), 'v3');

  // Prefix/predicate eviction clears only user-scoped items
  const scoped = new MediaMemoryLru(10, 10_000);
  scoped.set('pub:v1:postImg', 'aaa');
  scoped.set('priv:v1:uid1:secret', 'bbb');
  scoped.set('priv:v1:uid2:secret', 'ccc');
  const removed = scoped.deleteMatching((k) => k.startsWith('priv:v1:uid1:'));
  assert.equal(removed, 1);
  assert.equal(scoped.get('priv:v1:uid1:secret'), null);
  assert.equal(scoped.get('pub:v1:postImg'), 'aaa');
  assert.equal(scoped.get('priv:v1:uid2:secret'), 'ccc');
});

test('parseImageDataUrlToBinary decodes image data URLs and rejects invalid payloads', () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const b64 = Buffer.from(bytes).toString('base64');
  const parsed = parseImageDataUrlToBinary(`data:image/webp;base64,${b64}`);
  assert.ok(parsed);
  assert.equal(parsed.mimeType, 'image/webp');
  assert.deepEqual(Array.from(parsed.bytes), Array.from(bytes));

  assert.equal(parseImageDataUrlToBinary('https://example.com/a.webp'), null);
  assert.equal(parseImageDataUrlToBinary('data:text/plain;base64,SGVsbG8='), null);
});

test('selectProfilePreloadTargets prioritizes cover, avatar, post leads, gallery frames, and respects Data Saver limits', () => {
  const selection = selectProfilePreloadTargets({
    coverImageId: 'cover_1',
    photoImageId: 'avatar_1',
    posts: [
      {
        mediaItems: [
          { imageId: 'post1_a', order: 0 },
          { imageId: 'post1_b', order: 1 },
          { imageId: 'cover_1', order: 2 }, // duplicate should be skipped
        ],
      },
      { mediaItems: [{ imageId: 'post2_a', order: 0 }] },
      { mediaItems: [{ imageId: 'post3_a', order: 0 }] },
      { mediaItems: [{ imageId: 'post4_a', order: 0 }] },
    ],
    likedPosts: [{ post: { mediaItems: [{ imageId: 'liked_1', order: 0 }] } }],
    listings: [{ mediaItems: [{ imageId: 'listing_1', order: 0 }] }],
    maxTotal: 10,
  });

  assert.deepEqual(selection.highPriority, [
    'cover_1',
    'avatar_1',
    'post1_a',
    'post2_a',
    'post3_a',
  ]);
  assert.deepEqual(selection.normalPriority, [
    'post4_a',
    'post1_b',
    'liked_1',
    'listing_1',
  ]);

  const dataSaverSelection = selectProfilePreloadTargets({
    coverImageId: 'cover_1',
    photoImageId: 'avatar_1',
    posts: [
      { mediaItems: [{ imageId: 'post1_a', order: 0 }, { imageId: 'post1_b', order: 1 }] },
      { mediaItems: [{ imageId: 'post2_a', order: 0 }] },
      { mediaItems: [{ imageId: 'post3_a', order: 0 }] },
    ],
    isDataSaver: true,
  });
  assert.equal(
    dataSaverSelection.highPriority.length + dataSaverSelection.normalPriority.length,
    4
  );
  assert.deepEqual(dataSaverSelection.normalPriority, []);
});

test('partitionDuplicateSelectedFiles filters accidental duplicate selections cleanly', () => {
  const f1 = { name: 'Lecture.jpg', size: 42000, lastModified: 1700000100 };
  const f2 = { name: 'Campus.png', size: 95000, lastModified: 1700000200 };
  const dupF1 = { name: 'lecture.jpg', size: 42000, lastModified: 1700000100 };

  const existing = new Set([computeFileSelectionFingerprint(f1)]);
  const result = partitionDuplicateSelectedFiles([dupF1, f2, f2], existing);

  assert.equal(result.unique.length, 1);
  assert.equal(result.unique[0].name, 'Campus.png');
  assert.equal(result.duplicateCount, 2);
});

test('reorderArrayItem swaps positions cleanly without mutating the source array', () => {
  const source = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderArrayItem(source, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(reorderArrayItem(source, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(reorderArrayItem(source, -1, 2), ['a', 'b', 'c', 'd']);
  assert.deepEqual(source, ['a', 'b', 'c', 'd']);
});

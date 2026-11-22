import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MediaMemoryLru,
  buildScopedMediaCacheKey,
  computeFileSelectionFingerprint,
  partitionDuplicateSelectedFiles,
  reorderArrayItem,
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

test('MediaMemoryLru enforces entry count, byte ceiling, recency, and targeted eviction', () => {
  const lru = new MediaMemoryLru(5, 1200);
  const payload300 = 'x'.repeat(300); // 600 bytes UTF-16 estimate each

  lru.set('k1', payload300); // 600 bytes
  lru.set('k2', payload300); // 600 bytes -> total 1200
  assert.equal(lru.get('k1'), payload300); // refreshes k1, k2 is now oldest

  lru.set('k3', payload300); // exceeds 1200B, evicts k2
  assert.equal(lru.get('k2'), null);
  assert.equal(lru.get('k1'), payload300);
  assert.equal(lru.get('k3'), payload300);

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

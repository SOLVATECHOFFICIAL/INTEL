import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalPostViewKey,
  buildPostViewDocId,
  clearPostViewSessionCache,
  formatCompactViewCount,
  hasRecordedPostViewLocally,
  markPostViewLocally,
} from './postViews';

test('formatCompactViewCount formats singular, small, thousand, and million view counts cleanly', () => {
  assert.equal(formatCompactViewCount(undefined), '0 views');
  assert.equal(formatCompactViewCount(-4), '0 views');
  assert.equal(formatCompactViewCount(0), '0 views');
  assert.equal(formatCompactViewCount(1), '1 view');
  assert.equal(formatCompactViewCount(14), '14 views');
  assert.equal(formatCompactViewCount(999), '999 views');
  assert.equal(formatCompactViewCount(1200), '1.2K views');
  assert.equal(formatCompactViewCount(2_100_000), '2.1M views');
});

test('buildPostViewDocId and session view deduplication prevent duplicate triggers', () => {
  clearPostViewSessionCache();

  assert.equal(
    buildPostViewDocId('posts', 'post_123', 'user_abc'),
    'posts_post_123_user_abc'
  );
  assert.equal(
    buildPostViewDocId('anonymousPosts', 'anon_456', 'user_abc'),
    'anonymousPosts_anon_456_user_abc'
  );
  assert.equal(
    buildLocalPostViewKey('posts', 'post_123', 'user_abc'),
    'user_abc:posts:post_123'
  );

  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc'), false);
  markPostViewLocally('posts', 'post_123', 'user_abc', 1000);
  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc', 2000), true);
  assert.equal(hasRecordedPostViewLocally('anonymousPosts', 'post_123', 'user_abc', 2000), false);

  clearPostViewSessionCache();
  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc'), false);
});

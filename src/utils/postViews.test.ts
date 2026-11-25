import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_VIEW_MIN_DWELL_MS,
  POST_VIEW_MIN_INTERSECTION_RATIO,
  POST_VIEW_RATE_LIMIT_MAX_EVENTS,
  POST_VIEW_RATE_LIMIT_WINDOW_MS,
  buildLocalPostViewKey,
  buildPostViewDocId,
  canRecordPostViewWithinRateLimit,
  clearPostViewSessionCache,
  formatCompactViewCount,
  getOrCreateGuestVisitorId,
  hasRecordedPostViewLocally,
  isLikelyAutomatedBrowser,
  markPostViewLocally,
  recordPostViewTimestamp,
  resetPostViewRateLimiter,
  resolveActiveViewActor,
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

test('buildPostViewDocId and session view deduplication prevent duplicate triggers across posts, anonymousPosts, and updates', () => {
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
    buildPostViewDocId('updates', 'upd_789', 'guest_abc123456'),
    'updates_upd_789_guest_abc123456'
  );
  assert.equal(
    buildLocalPostViewKey('posts', 'post_123', 'user_abc'),
    'user_abc:posts:post_123'
  );

  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc'), false);
  markPostViewLocally('posts', 'post_123', 'user_abc', 1000);
  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc', 2000), true);
  assert.equal(hasRecordedPostViewLocally('anonymousPosts', 'post_123', 'user_abc', 2000), false);
  assert.equal(hasRecordedPostViewLocally('updates', 'post_123', 'user_abc', 2000), false);

  markPostViewLocally('updates', 'upd_789', 'guest_abc123456', 1000);
  assert.equal(hasRecordedPostViewLocally('updates', 'upd_789', 'guest_abc123456', 2000), true);

  clearPostViewSessionCache();
  assert.equal(hasRecordedPostViewLocally('posts', 'post_123', 'user_abc'), false);
  assert.equal(hasRecordedPostViewLocally('updates', 'upd_789', 'guest_abc123456'), false);
});

test('getOrCreateGuestVisitorId and resolveActiveViewActor distinguish signed-in accounts and persistent guests', () => {
  const guestA = getOrCreateGuestVisitorId();
  const guestB = getOrCreateGuestVisitorId();
  assert.match(guestA, /^guest_[a-zA-Z0-9_-]{8,58}$/);
  assert.equal(guestA, guestB);

  const guestActor = resolveActiveViewActor(null);
  assert.equal(guestActor.actorType, 'guest');
  assert.equal(guestActor.actorId, guestA);
  assert.equal(guestActor.dedupKey, guestA);

  const userActor = resolveActiveViewActor('uid_member_1');
  assert.equal(userActor.actorType, 'user');
  assert.equal(userActor.actorId, 'uid_member_1');
  assert.equal(userActor.dedupKey, 'uid_member_1');
});

test('postViews anti-abuse constants and sliding-window rate limiter block burst view inflation and reset cleanly after window', () => {
  assert.equal(POST_VIEW_MIN_INTERSECTION_RATIO, 0.4);
  assert.equal(POST_VIEW_MIN_DWELL_MS, 1200);
  assert.equal(POST_VIEW_RATE_LIMIT_MAX_EVENTS, 15);
  assert.equal(POST_VIEW_RATE_LIMIT_WINDOW_MS, 60_000);
  assert.equal(typeof isLikelyAutomatedBrowser(), 'boolean');

  resetPostViewRateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < POST_VIEW_RATE_LIMIT_MAX_EVENTS; i += 1) {
    assert.equal(canRecordPostViewWithinRateLimit(t0 + i * 100), true);
    recordPostViewTimestamp(t0 + i * 100);
  }

  // 16th event within 60s window is blocked
  assert.equal(canRecordPostViewWithinRateLimit(t0 + 2_000), false);

  // Sliding window opens again once the earliest timestamps expire past 60s
  assert.equal(
    canRecordPostViewWithinRateLimit(t0 + POST_VIEW_RATE_LIMIT_WINDOW_MS + 1),
    true
  );

  resetPostViewRateLimiter();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchForRoute, parseLocationSearch } from './urlRouting';

test('parseLocationSearch extracts deep-link postId, commentId, listingId, eventId, and opportunityId', () => {
  const postParsed = parseLocationSearch(
    '?view=for-you&postId=post_123&commentId=cmt_456'
  );
  assert.equal(postParsed.route, 'for-you');
  assert.equal(postParsed.postId, 'post_123');
  assert.equal(postParsed.commentId, 'cmt_456');

  const listingParsed = parseLocationSearch(
    '?view=marketplace&listingId=mkt_99&commentId=cmt_77'
  );
  assert.equal(listingParsed.route, 'marketplace');
  assert.equal(listingParsed.listingId, 'mkt_99');
  assert.equal(listingParsed.commentId, 'cmt_77');

  const eventParsed = parseLocationSearch(
    '?view=upcoming-events&eventId=evt_10&commentId=cmt_20'
  );
  assert.equal(eventParsed.route, 'upcoming-events');
  assert.equal(eventParsed.eventId, 'evt_10');
  assert.equal(eventParsed.commentId, 'cmt_20');

  // Rejects invalid script/injection values
  const invalidParsed = parseLocationSearch(
    '?view=anonymous&postId=bad/id!&commentId=<script>'
  );
  assert.equal(invalidParsed.route, 'anonymous');
  assert.equal(invalidParsed.postId, null);
  assert.equal(invalidParsed.commentId, null);
});

test('buildSearchForRoute preserves root path for plain home and serializes deep links cleanly', () => {
  assert.equal(buildSearchForRoute('for-you'), '/');

  assert.equal(
    buildSearchForRoute('for-you', { postId: 'post_1', commentId: 'cmt_2' }),
    '/?view=for-you&postId=post_1&commentId=cmt_2'
  );

  assert.equal(
    buildSearchForRoute('anonymous', { postId: 'anon_1', commentId: 'ac_9' }),
    '/?view=anonymous&postId=anon_1&commentId=ac_9'
  );

  assert.equal(
    buildSearchForRoute('marketplace', { listingId: 'list_5', commentId: 'cmt_8' }),
    '/?view=marketplace&listingId=list_5&commentId=cmt_8'
  );
});

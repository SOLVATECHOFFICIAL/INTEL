import test from 'node:test';
import assert from 'node:assert/strict';
import type { NotificationItem } from '../types/database';
import {
  DEFAULT_NOTIFICATION_PREFS,
  applyOptimisticDeleteNotification,
  applyOptimisticMarkAllRead,
  applyOptimisticMarkRead,
  buildAnnouncementNotificationId,
  buildAnonymousReplyNotificationId,
  buildCommentNotificationId,
  buildMarketplaceExpiredNotificationId,
  buildMarketplaceReviewNotificationId,
  buildMentionNotificationId,
  buildReactionNotificationId,
  buildReplyNotificationId,
  computeUnreadNotificationsCount,
  extractMentionedUsernames,
  filterNotifications,
  formatNotificationRelativeTime,
  isAnonymousNotificationLeakFree,
  mergeNotifications,
  normalizeNotificationPrefs,
  resolveNotificationDestination,
  restoreDeletedNotification,
  rollbackOptimisticMarkReadIds,
  shouldEmitActivityNotification,
} from './notifications';

function makeNotification(
  overrides: Partial<NotificationItem> = {}
): NotificationItem {
  return {
    id: overrides.id ?? 'notif_1',
    recipientUid: overrides.recipientUid ?? 'user_a',
    eventType: overrides.eventType ?? 'reaction',
    title: overrides.title ?? 'Adaobi liked your post',
    isRead: overrides.isRead ?? false,
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    ...overrides,
  };
}

test('deterministic notification ID builders prevent duplicates and enforce Firestore ID constraints', () => {
  const rx1 = buildReactionNotificationId('posts', 'post_abc', 'actor_1');
  const rx2 = buildReactionNotificationId('posts', 'post_abc', 'actor_1');
  assert.equal(rx1, rx2);
  assert.match(rx1, /^[a-zA-Z0-9_-]{1,128}$/);

  const longId = 'a'.repeat(160);
  for (const id of [
    buildReactionNotificationId('postComments', longId, longId),
    buildCommentNotificationId(longId),
    buildReplyNotificationId(longId),
    buildAnonymousReplyNotificationId(longId),
    buildMarketplaceReviewNotificationId(longId, 'approved'),
    buildMarketplaceExpiredNotificationId(longId),
    buildAnnouncementNotificationId(longId, longId),
    buildMentionNotificationId(longId, longId),
  ]) {
    assert.match(id, /^[a-zA-Z0-9_-]{1,128}$/);
  }
});

test('extractMentionedUsernames parses unique handles cleanly and ignores emails', () => {
  assert.deepEqual(
    extractMentionedUsernames(
      'Shoutout to @Adaobi_01 and @chidi_law plus @adaobi_01 — email test@lasued.edu.ng stays ignored'
    ),
    ['adaobi_01', 'chidi_law']
  );
  assert.deepEqual(extractMentionedUsernames(''), []);
});

test('shouldEmitActivityNotification suppresses self-notifications and invalid IDs', () => {
  assert.equal(
    shouldEmitActivityNotification({ actorUid: 'u1', recipientUid: 'u1' }),
    false
  );
  assert.equal(
    shouldEmitActivityNotification({ actorUid: '', recipientUid: 'u2' }),
    false
  );
  assert.equal(
    shouldEmitActivityNotification({ actorUid: 'u1', recipientUid: 'u2' }),
    true
  );
});

test('anonymous reply notifications must never leak actor identity fields', () => {
  const safeAnon = makeNotification({
    eventType: 'anonymous_reply',
    title: 'New reply on your anonymous post',
    targetPath: '/?view=anonymous&postId=ap_1&commentId=ac_2',
  });
  assert.equal(isAnonymousNotificationLeakFree(safeAnon), true);

  const leakyAnon = makeNotification({
    eventType: 'anonymous_reply',
    actorUid: 'secret_uid',
  });
  assert.equal(isAnonymousNotificationLeakFree(leakyAnon), false);
});

test('optimistic mark read, mark all read, delete, and rollback reconcile deterministically', () => {
  const list: NotificationItem[] = [
    makeNotification({ id: 'n1', isRead: false, createdAt: 3000 }),
    makeNotification({ id: 'n2', isRead: true, createdAt: 2000 }),
    makeNotification({ id: 'n3', isRead: false, createdAt: 1000 }),
  ];

  // Single mark read + rollback
  const readRes = applyOptimisticMarkRead(list, 'n1');
  assert.equal(readRes.changed, true);
  assert.equal(readRes.previousWasRead, false);
  assert.equal(computeUnreadNotificationsCount(readRes.nextItems), 1);

  const rolledBackSingle = rollbackOptimisticMarkReadIds(
    readRes.nextItems,
    ['n1']
  );
  assert.equal(computeUnreadNotificationsCount(rolledBackSingle), 2);

  // Mark all read + rollback
  const allRes = applyOptimisticMarkAllRead(list);
  assert.deepEqual(allRes.changedIds, ['n1', 'n3']);
  assert.equal(computeUnreadNotificationsCount(allRes.nextItems), 0);

  const rolledBackAll = rollbackOptimisticMarkReadIds(
    allRes.nextItems,
    allRes.changedIds
  );
  assert.equal(computeUnreadNotificationsCount(rolledBackAll), 2);

  // Optimistic delete + restore at original index
  const delRes = applyOptimisticDeleteNotification(list, 'n2');
  assert.equal(delRes.nextItems.length, 2);
  assert.equal(delRes.removedIndex, 1);
  const restored = restoreDeletedNotification(
    delRes.nextItems,
    delRes.removedItem!,
    delRes.removedIndex
  );
  assert.deepEqual(
    restored.map((item) => item.id),
    ['n1', 'n2', 'n3']
  );
});

test('mergeNotifications deduplicates live head against older pages cleanly', () => {
  const live = [
    makeNotification({ id: 'n3', isRead: true, createdAt: 3000 }),
    makeNotification({ id: 'n2', isRead: false, createdAt: 2000 }),
  ];
  const older = [
    makeNotification({ id: 'n2', isRead: false, createdAt: 2000 }),
    makeNotification({ id: 'n1', isRead: true, createdAt: 1000 }),
  ];
  const merged = mergeNotifications(live, older);
  assert.deepEqual(
    merged.map((i) => i.id),
    ['n3', 'n2', 'n1']
  );
  assert.equal(merged[0].isRead, true);
});

test('notification preferences map legacy keys and filter unread count + list accurately', () => {
  const prefs = normalizeNotificationPrefs({
    reactions: false,
    marketplaceUpdates: false,
    commentsAndReplies: true,
  });
  assert.equal(prefs.likes, false);
  assert.equal(prefs.marketplace, false);
  assert.equal(prefs.comments, true);
  assert.equal(prefs.events, DEFAULT_NOTIFICATION_PREFS.events);

  const items: NotificationItem[] = [
    makeNotification({ id: 'a', eventType: 'reaction', isRead: false }),
    makeNotification({ id: 'b', eventType: 'comment', isRead: false }),
    makeNotification({ id: 'c', eventType: 'marketplace_approved', isRead: false }),
    makeNotification({ id: 'd', eventType: 'announcement', isRead: true }),
  ];

  assert.equal(computeUnreadNotificationsCount(items, prefs), 1);

  const filteredUnread = filterNotifications(items, {
    readFilter: 'unread',
    categoryFilter: 'all',
    prefs,
  });
  assert.deepEqual(
    filteredUnread.map((i) => i.id),
    ['b']
  );
});

test('resolveNotificationDestination routes every notification type to its exact target', () => {
  const commentDest = resolveNotificationDestination(
    makeNotification({
      eventType: 'reply',
      targetPath: '/?view=for-you&postId=p1&commentId=c9',
    })
  );
  assert.equal(commentDest?.route, 'for-you');
  assert.equal(commentDest?.options.postId, 'p1');
  assert.equal(commentDest?.options.commentId, 'c9');

  const mktDest = resolveNotificationDestination(
    makeNotification({
      eventType: 'comment',
      targetPath: '/?view=marketplace&listingId=m4&commentId=c2',
    })
  );
  assert.equal(mktDest?.route, 'marketplace');
  assert.equal(mktDest?.options.listingId, 'm4');
  assert.equal(mktDest?.options.commentId, 'c2');

  const followDest = resolveNotificationDestination(
    makeNotification({
      eventType: 'follow',
      actorUsername: 'chidi_law',
      targetPath: undefined,
    })
  );
  assert.equal(followDest?.route, 'profile');
  assert.equal(followDest?.options.username, 'chidi_law');
});

test('formatNotificationRelativeTime produces readable human durations', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatNotificationRelativeTime(now - 15_000, now), 'Just now');
  assert.equal(formatNotificationRelativeTime(now - 12 * 60_000, now), '12m ago');
  assert.equal(
    formatNotificationRelativeTime(now - 3 * 3_600_000, now),
    '3h ago'
  );
  assert.equal(
    formatNotificationRelativeTime(now - 26 * 3_600_000, now),
    'Yesterday'
  );
});

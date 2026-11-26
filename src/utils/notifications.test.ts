import test from 'node:test';
import assert from 'node:assert/strict';
import type { NotificationItem } from '../types/database';
import {
  DEFAULT_NOTIFICATION_PREFS,
  applyOptimisticDeleteNotification,
  applyOptimisticMarkAllRead,
  applyOptimisticMarkRead,
  applyOptimisticMarkUnread,
  buildAnnouncementNotificationId,
  buildAnonymousLikeMilestoneNotificationId,
  buildAnonymousLikeNotificationId,
  buildAnonymousReplyNotificationId,
  buildCommentNotificationId,
  buildMarketplaceExpiredNotificationId,
  buildMarketplaceReviewNotificationId,
  buildMentionNotificationId,
  buildOfficialUpdateNotificationId,
  buildReactionNotificationId,
  buildReplyNotificationId,
  computeUnreadNotificationsCount,
  extractMentionedUsernames,
  filterNotifications,
  formatNotificationRelativeTime,
  getNotificationTypeLabel,
  isAnonymousNotificationLeakFree,
  isNotificationAllowedByPrefs,
  mergeNotifications,
  normalizeNotificationPrefs,
  resolveNotificationDestination,
  restoreDeletedNotification,
  rollbackOptimisticMarkReadIds,
  rollbackOptimisticMarkUnreadIds,
  shouldEmitActivityNotification,
  shouldThrottleReactionNotification,
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

  const rxRepeatA = buildReactionNotificationId('posts', 'post_abc', 'actor_1', 'm1abc');
  const rxRepeatB = buildReactionNotificationId('posts', 'post_abc', 'actor_1', 'm1abd');
  assert.notEqual(rxRepeatA, rxRepeatB);
  assert.match(rxRepeatA, /^[a-zA-Z0-9_-]{1,128}$/);

  const cooldownMap = new Map<string, number>();
  assert.equal(shouldThrottleReactionNotification(cooldownMap, 'p:1:a', 1000, 4000), false);
  assert.equal(shouldThrottleReactionNotification(cooldownMap, 'p:1:a', 2500, 4000), true);
  assert.equal(shouldThrottleReactionNotification(cooldownMap, 'p:1:a', 5500, 4000), false);

  const longId = 'a'.repeat(160);
  for (const id of [
    buildReactionNotificationId('postComments', longId, longId),
    buildReactionNotificationId('postComments', longId, longId, 'nonce_12345'),
    buildReactionNotificationId('updates', longId, longId),
    buildCommentNotificationId(longId),
    buildReplyNotificationId(longId),
    buildAnonymousReplyNotificationId(longId),
    buildMarketplaceReviewNotificationId(longId, 'approved'),
    buildMarketplaceExpiredNotificationId(longId),
    buildAnnouncementNotificationId(longId, longId),
    buildOfficialUpdateNotificationId(longId, longId),
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

test('anonymous reply and anonymous reaction notifications must never leak actor identity fields', () => {
  const safeAnon = makeNotification({
    eventType: 'anonymous_reply',
    title: 'New reply on your anonymous post',
    targetPath: '/?view=anonymous&postId=ap_1&commentId=ac_2',
  });
  assert.equal(isAnonymousNotificationLeakFree(safeAnon), true);

  const safeAnonLike = makeNotification({
    eventType: 'anonymous_reaction',
    title: 'Someone liked your anonymous post',
    targetPath: '/?view=anonymous&postId=ap_1',
  });
  assert.equal(isAnonymousNotificationLeakFree(safeAnonLike), true);
  assert.equal(getNotificationTypeLabel('anonymous_reaction'), 'Anonymous Like');

  const leakyAnon = makeNotification({
    eventType: 'anonymous_reply',
    actorUid: 'secret_uid',
  });
  assert.equal(isAnonymousNotificationLeakFree(leakyAnon), false);

  const leakyAnonReaction = makeNotification({
    eventType: 'anonymous_reaction',
    actorUsername: 'adaobi',
  });
  assert.equal(isAnonymousNotificationLeakFree(leakyAnonReaction), false);

  const secretActorUid = 'uid_secret_student_99';
  const rxId1 = buildAnonymousLikeNotificationId('anonymousPosts', 'ap_1', secretActorUid);
  const rxId2 = buildAnonymousLikeNotificationId('anonymousPosts', 'ap_1', secretActorUid);
  const rxIdOther = buildAnonymousLikeNotificationId('anonymousPosts', 'ap_1', 'uid_other_student');
  assert.equal(rxId1, rxId2);
  assert.notEqual(rxId1, rxIdOther);
  assert.match(rxId1, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.equal(rxId1.includes(secretActorUid), false);

  const milestoneId = buildAnonymousLikeMilestoneNotificationId('anonymousComments', 'ac_2', 5);
  assert.match(milestoneId, /^anon_lcnt_c_ac_2_5$/);

  const threadReplyParentId = buildAnonymousReplyNotificationId('ac_3', 'par');
  const threadReplyDirectId = buildAnonymousReplyNotificationId('ac_3', 'rpl');
  assert.notEqual(threadReplyParentId, threadReplyDirectId);
  assert.match(threadReplyParentId, /^[a-zA-Z0-9_-]{1,128}$/);
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

  // Single mark unread + rollback
  const unreadRes = applyOptimisticMarkUnread(list, 'n2');
  assert.equal(unreadRes.changed, true);
  assert.equal(unreadRes.previousWasRead, true);
  assert.equal(computeUnreadNotificationsCount(unreadRes.nextItems), 3);

  const unreadNoop = applyOptimisticMarkUnread(list, 'n1');
  assert.equal(unreadNoop.changed, false);

  const rolledBackUnread = rollbackOptimisticMarkUnreadIds(
    unreadRes.nextItems,
    ['n2']
  );
  assert.equal(computeUnreadNotificationsCount(rolledBackUnread), 2);
  assert.equal(rolledBackUnread[1].isRead, true);

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

  // anonymous_reaction requires both likes and anonymous_replies to be enabled
  assert.equal(
    isNotificationAllowedByPrefs(
      { eventType: 'anonymous_reaction' },
      { ...DEFAULT_NOTIFICATION_PREFS, likes: true, anonymous_replies: true }
    ),
    true
  );
  assert.equal(
    isNotificationAllowedByPrefs(
      { eventType: 'anonymous_reaction' },
      { ...DEFAULT_NOTIFICATION_PREFS, likes: false, anonymous_replies: true }
    ),
    false
  );
  assert.equal(
    isNotificationAllowedByPrefs(
      { eventType: 'anonymous_reaction' },
      { ...DEFAULT_NOTIFICATION_PREFS, likes: true, anonymous_replies: false }
    ),
    false
  );
});

test('bursts of 100+ notifications remain unclipped and preference-filtered', () => {
  const burst = Array.from({ length: 120 }, (_, i) =>
    makeNotification({
      id: `burst_${i}`,
      eventType: i % 3 === 0 ? 'reaction' : i % 3 === 1 ? 'reply' : 'anonymous_reaction',
      isRead: false,
      createdAt: 1_700_000_000_000 + i,
    })
  );
  assert.equal(computeUnreadNotificationsCount(burst, DEFAULT_NOTIFICATION_PREFS), 120);

  const noLikesPrefs = { ...DEFAULT_NOTIFICATION_PREFS, likes: false };
  // Only replies (40 items) remain when likes are disabled (blocks reaction & anonymous_reaction)
  assert.equal(computeUnreadNotificationsCount(burst, noLikesPrefs), 40);
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

  const updateDest = resolveNotificationDestination(
    makeNotification({
      eventType: 'official_update',
      targetPath: '/?view=updates&postId=upd_9',
    })
  );
  assert.equal(updateDest?.route, 'updates');
  assert.equal(updateDest?.options.postId, 'upd_9');
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

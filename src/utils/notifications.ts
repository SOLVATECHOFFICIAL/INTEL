import {
  isValidFirestoreId,
  type NotificationEventType,
  type NotificationItem,
} from '../types/database';
import type { ActiveRoute } from '../types/platform';
import { extractTimestampMs } from './contextualSearch';
import { extractActorUsernameFromNotification } from './followRelations';
import { parseLocationSearch } from './urlRouting';

export type NotificationReadFilter = 'all' | 'unread';

export type NotificationCategoryFilter =
  | 'all'
  | 'interactions'
  | 'followers'
  | 'marketplace'
  | 'campus_updates'
  | 'announcements';

export type NotificationPrefKey =
  | 'likes'
  | 'comments'
  | 'replies'
  | 'mentions'
  | 'anonymous_replies'
  | 'followers'
  | 'marketplace'
  | 'events'
  | 'opportunities'
  | 'announcements';

export type NotificationPreferences = Record<NotificationPrefKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  likes: true,
  comments: true,
  replies: true,
  mentions: true,
  anonymous_replies: true,
  followers: true,
  marketplace: true,
  events: true,
  opportunities: true,
  announcements: true,
};

export interface NotificationPreferenceOption {
  key: NotificationPrefKey;
  label: string;
  description: string;
}

export const NOTIFICATION_PREFERENCE_OPTIONS: readonly NotificationPreferenceOption[] =
  [
    {
      key: 'likes',
      label: 'Post & Comment Likes',
      description: 'Notify when someone likes your posts or comments.',
    },
    {
      key: 'comments',
      label: 'Comments',
      description: 'Notify when someone comments on your posts or listings.',
    },
    {
      key: 'replies',
      label: 'Replies',
      description: 'Notify when someone replies to your comment thread.',
    },
    {
      key: 'mentions',
      label: 'Mentions (@username)',
      description: 'Notify when someone mentions your @username in a public post or comment.',
    },
    {
      key: 'anonymous_replies',
      label: 'Anonymous Thread Replies & Likes',
      description:
        'Receive Notification Centre and push alerts when an anonymous post or comment receives a reply or like, without revealing any identity.',
    },
    {
      key: 'followers',
      label: 'New Followers',
      description: 'Notify when another LASUED Intel member follows you.',
    },
    {
      key: 'marketplace',
      label: 'Marketplace Activity',
      description:
        'Notify about listing approvals, rejections, expiry reminders, and buyer questions.',
    },
    {
      key: 'events',
      label: 'Campus Events',
      description:
        'Notify about newly published campus events and important schedule or venue updates.',
    },
    {
      key: 'opportunities',
      label: 'Opportunities & Deadlines',
      description:
        'Notify about newly published scholarships, internships, grants, and closing deadlines.',
    },
    {
      key: 'announcements',
      label: 'Official Announcements',
      description:
        'Receive official community notices published by LASUED Intel Administrators.',
    },
  ] as const;

export const NOTIFICATION_CATEGORY_FILTERS: readonly {
  id: NotificationCategoryFilter;
  label: string;
}[] = [
  { id: 'all', label: 'All Types' },
  { id: 'interactions', label: 'Likes & Replies' },
  { id: 'followers', label: 'Followers' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'campus_updates', label: 'Events & Opps' },
  { id: 'announcements', label: 'Announcements' },
] as const;

export function normalizeNotificationPrefs(
  raw?: Record<string, boolean> | null
): NotificationPreferences {
  const normalized: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFS };
  if (!raw || typeof raw !== 'object') {
    return normalized;
  }

  // Backward compatibility with legacy signup keys
  if (typeof raw.commentsAndReplies === 'boolean') {
    normalized.comments = raw.commentsAndReplies;
    normalized.replies = raw.commentsAndReplies;
  }
  if (typeof raw.reactions === 'boolean') {
    normalized.likes = raw.reactions;
  }
  if (typeof raw.marketplaceUpdates === 'boolean') {
    normalized.marketplace = raw.marketplaceUpdates;
  }
  if (typeof raw.opportunitiesAndEvents === 'boolean') {
    normalized.opportunities = raw.opportunitiesAndEvents;
    normalized.events = raw.opportunitiesAndEvents;
  }

  (Object.keys(DEFAULT_NOTIFICATION_PREFS) as NotificationPrefKey[]).forEach(
    (key) => {
      if (typeof raw[key] === 'boolean') {
        normalized[key] = raw[key];
      }
    }
  );

  return normalized;
}

export function mapEventTypeToPrefKey(
  eventType: NotificationEventType
): NotificationPrefKey | null {
  switch (eventType) {
    case 'reaction':
      return 'likes';
    case 'comment':
      return 'comments';
    case 'reply':
      return 'replies';
    case 'mention':
      return 'mentions';
    case 'anonymous_reply':
    case 'anonymous_reaction':
      return 'anonymous_replies';
    case 'follow':
      return 'followers';
    case 'marketplace_approved':
    case 'marketplace_rejected':
    case 'marketplace_expired':
      return 'marketplace';
    case 'new_event':
      return 'events';
    case 'new_opportunity':
      return 'opportunities';
    case 'announcement':
    case 'official_update':
      return 'announcements';
    case 'badge_change':
    case 'account_change':
    default:
      return null;
  }
}

export function isNotificationAllowedByPrefs(
  item: Pick<NotificationItem, 'eventType'>,
  prefs?: NotificationPreferences | null
): boolean {
  if (!prefs) return true;
  if (item.eventType === 'anonymous_reaction') {
    return prefs.likes !== false && prefs.anonymous_replies !== false;
  }
  const prefKey = mapEventTypeToPrefKey(item.eventType);
  if (!prefKey) return true;
  return prefs[prefKey] !== false;
}

export function getNotificationCategoryGroup(
  eventType: NotificationEventType
): Exclude<NotificationCategoryFilter, 'all'> {
  switch (eventType) {
    case 'reaction':
    case 'comment':
    case 'reply':
    case 'mention':
    case 'anonymous_reply':
    case 'anonymous_reaction':
      return 'interactions';
    case 'follow':
      return 'followers';
    case 'marketplace_approved':
    case 'marketplace_rejected':
    case 'marketplace_expired':
      return 'marketplace';
    case 'new_event':
    case 'new_opportunity':
      return 'campus_updates';
    case 'announcement':
    case 'official_update':
    case 'badge_change':
    case 'account_change':
    default:
      return 'announcements';
  }
}

export function getNotificationTypeLabel(
  eventType: NotificationEventType
): string {
  switch (eventType) {
    case 'reaction':
      return 'Like';
    case 'comment':
      return 'Comment';
    case 'reply':
      return 'Reply';
    case 'mention':
      return 'Mention';
    case 'anonymous_reply':
      return 'Anonymous Reply';
    case 'anonymous_reaction':
      return 'Anonymous Like';
    case 'follow':
      return 'Follower';
    case 'marketplace_approved':
      return 'Marketplace Approved';
    case 'marketplace_rejected':
      return 'Marketplace Review';
    case 'marketplace_expired':
      return 'Marketplace Expired';
    case 'new_event':
      return 'Campus Event';
    case 'new_opportunity':
      return 'Opportunity';
    case 'badge_change':
      return 'Badge Update';
    case 'account_change':
      return 'Account Update';
    case 'announcement':
      return 'Official Announcement';
    case 'official_update':
      return 'Official Update';
  }
}

function sanitizeIdPart(raw: string, maxLen: number): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
}

export function buildReactionNotificationId(
  targetCollection:
    | 'posts'
    | 'updates'
    | 'events'
    | 'postComments'
    | 'marketplaceListings',
  targetId: string,
  actorUid: string
): string {
  const shortCol =
    targetCollection === 'posts'
      ? 'p'
      : targetCollection === 'updates'
        ? 'u'
        : targetCollection === 'events'
          ? 'e'
          : targetCollection === 'marketplaceListings'
            ? 'm'
            : 'pc';
  return `rx_${shortCol}_${sanitizeIdPart(targetId, 44)}_${sanitizeIdPart(actorUid, 44)}`;
}

export function buildCommentNotificationId(commentId: string): string {
  return `cmt_${sanitizeIdPart(commentId, 118)}`;
}

export function buildReplyNotificationId(commentId: string): string {
  return `rpl_${sanitizeIdPart(commentId, 118)}`;
}

export function buildMentionNotificationId(
  sourceId: string,
  recipientUid: string
): string {
  return `mnt_${sanitizeIdPart(sourceId, 58)}_${sanitizeIdPart(recipientUid, 58)}`;
}

export function extractMentionedUsernames(
  text: string | undefined | null,
  maxMentions = 8
): string[] {
  if (!text) return [];
  const matches = text.matchAll(/(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,32})\b/g);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const candidate = match[1]?.toLowerCase();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= maxMentions) break;
  }
  return result;
}

function hashIdentifierPart(raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

export function buildAnonymousReplyNotificationId(
  commentId: string,
  suffix?: string
): string {
  if (suffix) {
    return `anon_reply_${sanitizeIdPart(commentId, 90)}_${sanitizeIdPart(suffix, 16)}`;
  }
  return `anon_reply_${sanitizeIdPart(commentId, 110)}`;
}

export function buildAnonymousLikeNotificationId(
  targetCollection: 'anonymousPosts' | 'anonymousComments',
  targetId: string,
  actorUid: string
): string {
  const shortCol = targetCollection === 'anonymousPosts' ? 'p' : 'c';
  return `anon_rx_${shortCol}_${sanitizeIdPart(targetId, 44)}_${hashIdentifierPart(actorUid)}`;
}

export function buildAnonymousLikeMilestoneNotificationId(
  targetCollection: 'anonymousPosts' | 'anonymousComments',
  targetId: string,
  likesCount: number
): string {
  const shortCol = targetCollection === 'anonymousPosts' ? 'p' : 'c';
  const safeCount = Math.max(1, Math.floor(likesCount));
  return `anon_lcnt_${shortCol}_${sanitizeIdPart(targetId, 44)}_${safeCount}`;
}

export function buildMarketplaceReviewNotificationId(
  listingId: string,
  decision: 'approved' | 'rejected'
): string {
  return `mkt_${decision === 'approved' ? 'apv' : 'rej'}_${sanitizeIdPart(listingId, 110)}`;
}

export function buildMarketplaceExpiredNotificationId(listingId: string): string {
  return `mkt_exp_${sanitizeIdPart(listingId, 110)}`;
}

export function buildAnnouncementNotificationId(
  announcementId: string,
  recipientUid: string
): string {
  return `ann_${sanitizeIdPart(announcementId, 48)}_${sanitizeIdPart(recipientUid, 48)}`;
}

export function buildOfficialUpdateNotificationId(
  updateId: string,
  recipientUid: string
): string {
  return `upd_${sanitizeIdPart(updateId, 48)}_${sanitizeIdPart(recipientUid, 48)}`;
}

export function shouldEmitActivityNotification(input: {
  actorUid?: string | null;
  recipientUid?: string | null;
}): boolean {
  if (!input.actorUid || !input.recipientUid) return false;
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.recipientUid)) {
    return false;
  }
  return input.actorUid !== input.recipientUid;
}

export function isAnonymousNotificationLeakFree(
  item: Partial<NotificationItem>
): boolean {
  if (
    item.eventType !== 'anonymous_reply' &&
    item.eventType !== 'anonymous_reaction'
  ) {
    return true;
  }
  return (
    !item.actorUid &&
    !item.actorUsername &&
    !item.actorName &&
    !item.actorPhotoUrl &&
    !item.actorPhotoImageId
  );
}

export function applyOptimisticMarkRead(
  items: readonly NotificationItem[],
  notificationId: string
): {
  nextItems: NotificationItem[];
  changed: boolean;
  previousWasRead: boolean;
} {
  let changed = false;
  let previousWasRead = true;
  const nextItems = items.map((item) => {
    if (item.id !== notificationId) return item;
    previousWasRead = item.isRead;
    if (!item.isRead) {
      changed = true;
      return { ...item, isRead: true };
    }
    return item;
  });
  return { nextItems, changed, previousWasRead };
}

export function applyOptimisticMarkAllRead(
  items: readonly NotificationItem[]
): {
  nextItems: NotificationItem[];
  changedIds: string[];
} {
  const changedIds: string[] = [];
  const nextItems = items.map((item) => {
    if (!item.isRead) {
      changedIds.push(item.id);
      return { ...item, isRead: true };
    }
    return item;
  });
  return { nextItems, changedIds };
}

export function rollbackOptimisticMarkReadIds(
  items: readonly NotificationItem[],
  unreadIdsToRestore: readonly string[]
): NotificationItem[] {
  const restoreSet = new Set(unreadIdsToRestore);
  if (restoreSet.size === 0) return [...items];
  return items.map((item) =>
    restoreSet.has(item.id) ? { ...item, isRead: false } : item
  );
}

export function applyOptimisticMarkUnread(
  items: readonly NotificationItem[],
  notificationId: string
): {
  nextItems: NotificationItem[];
  changed: boolean;
  previousWasRead: boolean;
} {
  let changed = false;
  let previousWasRead = false;
  const nextItems = items.map((item) => {
    if (item.id !== notificationId) return item;
    previousWasRead = item.isRead;
    if (item.isRead) {
      changed = true;
      return { ...item, isRead: false };
    }
    return item;
  });
  return { nextItems, changed, previousWasRead };
}

export function rollbackOptimisticMarkUnreadIds(
  items: readonly NotificationItem[],
  readIdsToRestore: readonly string[]
): NotificationItem[] {
  const restoreSet = new Set(readIdsToRestore);
  if (restoreSet.size === 0) return [...items];
  return items.map((item) =>
    restoreSet.has(item.id) ? { ...item, isRead: true } : item
  );
}

export function applyOptimisticDeleteNotification(
  items: readonly NotificationItem[],
  notificationId: string
): {
  nextItems: NotificationItem[];
  removedItem: NotificationItem | null;
  removedIndex: number;
} {
  const removedIndex = items.findIndex((item) => item.id === notificationId);
  if (removedIndex === -1) {
    return {
      nextItems: [...items],
      removedItem: null,
      removedIndex: -1,
    };
  }
  const removedItem = items[removedIndex];
  const nextItems = [
    ...items.slice(0, removedIndex),
    ...items.slice(removedIndex + 1),
  ];
  return { nextItems, removedItem, removedIndex };
}

export function restoreDeletedNotification(
  items: readonly NotificationItem[],
  removedItem: NotificationItem,
  originalIndex: number
): NotificationItem[] {
  if (items.some((item) => item.id === removedItem.id)) {
    return [...items];
  }
  const safeIndex = Math.max(0, Math.min(items.length, originalIndex));
  return [
    ...items.slice(0, safeIndex),
    removedItem,
    ...items.slice(safeIndex),
  ];
}

export function mergeNotifications(
  liveItems: readonly NotificationItem[],
  olderItems: readonly NotificationItem[]
): NotificationItem[] {
  const map = new Map<string, NotificationItem>();
  for (const item of olderItems) {
    map.set(item.id, item);
  }
  for (const item of liveItems) {
    // Live items override older cached snapshots for real-time updates
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

export function computeUnreadNotificationsCount(
  items: readonly NotificationItem[],
  prefs?: NotificationPreferences | null
): number {
  let count = 0;
  for (const item of items) {
    if (!item.isRead && isNotificationAllowedByPrefs(item, prefs)) {
      count += 1;
    }
  }
  return count;
}

export function filterNotifications(
  items: readonly NotificationItem[],
  options: {
    readFilter: NotificationReadFilter;
    categoryFilter: NotificationCategoryFilter;
    prefs?: NotificationPreferences | null;
  }
): NotificationItem[] {
  return items.filter((item) => {
    if (!isNotificationAllowedByPrefs(item, options.prefs)) {
      return false;
    }
    if (options.readFilter === 'unread' && item.isRead) {
      return false;
    }
    if (
      options.categoryFilter !== 'all' &&
      getNotificationCategoryGroup(item.eventType) !== options.categoryFilter
    ) {
      return false;
    }
    return true;
  });
}

export function formatNotificationRelativeTime(
  value: unknown,
  nowMs: number = Date.now()
): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Just now';
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year:
      new Date(ms).getFullYear() !== new Date(nowMs).getFullYear()
        ? 'numeric'
        : undefined,
  });
}

export function formatNotificationExactTime(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Just now';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface NotificationDestination {
  route: ActiveRoute;
  options: {
    username?: string | null;
    opportunityId?: string | null;
    eventId?: string | null;
    postId?: string | null;
    commentId?: string | null;
    listingId?: string | null;
  };
}

export function resolveNotificationDestination(
  item: NotificationItem
): NotificationDestination | null {
  if (item.targetPath) {
    const queryIndex = item.targetPath.indexOf('?');
    if (queryIndex !== -1) {
      const searchPart = item.targetPath.slice(queryIndex);
      const parsed = parseLocationSearch(searchPart);
      return {
        route: parsed.route,
        options: {
          username: parsed.profileUsername,
          opportunityId: parsed.opportunityId,
          eventId: parsed.eventId,
          postId: parsed.postId,
          commentId: parsed.commentId,
          listingId: parsed.listingId,
        },
      };
    }
  }

  if (item.eventType === 'follow') {
    const actorUsername = extractActorUsernameFromNotification(item);
    if (actorUsername) {
      return {
        route: 'profile',
        options: { username: actorUsername },
      };
    }
  }

  switch (item.eventType) {
    case 'new_event':
      return { route: 'upcoming-events', options: {} };
    case 'new_opportunity':
      return { route: 'opportunities', options: {} };
    case 'marketplace_approved':
    case 'marketplace_rejected':
    case 'marketplace_expired':
      return { route: 'marketplace', options: {} };
    case 'anonymous_reply':
    case 'anonymous_reaction':
      return { route: 'anonymous', options: {} };
    case 'official_update':
      return { route: 'updates', options: {} };
    case 'announcement':
      return { route: 'for-you', options: {} };
    default:
      return null;
  }
}

export function summarizeNotificationExcerpt(
  text: string | undefined | null,
  maxLength = 140
): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

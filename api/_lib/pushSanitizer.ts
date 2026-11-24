import crypto from 'node:crypto';

export interface SanitizedPushClientPayload {
  notificationId: string | null;
  eventType: string;
  title: string;
  body: string;
  targetPath: string;
  tag: string;
  unreadCount: number;
  isAnonymous: boolean;
}

export function isValidFirestoreId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function isValidVapidPublicKey(key: unknown): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{60,180}$/.test(key.trim());
}

export function isValidVapidPrivateKey(key: unknown): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(key.trim());
}

export function isValidHttpsPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  const trimmed = endpoint.trim();
  if (trimmed.length < 16 || trimmed.length > 1024) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeVapidSubject(rawSubject?: string | null): string {
  const trimmed = typeof rawSubject === 'string' ? rawSubject.trim() : '';
  if (!trimmed) return 'mailto:lasuedintel@gmail.com';
  if (/^(mailto:|https:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }
  return 'mailto:lasuedintel@gmail.com';
}

export function sanitizeInternalTargetPath(
  rawPath: unknown,
  allowedOrigin = 'https://lasued-intel.vercel.app'
): string {
  if (typeof rawPath !== 'string') {
    return '/?view=notifications';
  }
  const trimmed = rawPath.trim();
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) {
    return '/?view=notifications';
  }
  try {
    const base = new URL(allowedOrigin);
    const resolved = new URL(trimmed, base.origin);
    if (resolved.origin !== base.origin) {
      return '/?view=notifications';
    }
    return `${resolved.pathname || '/'}${resolved.search}`;
  } catch {
    return '/?view=notifications';
  }
}

export function mapEventTypeToPrefKey(eventType: string): string | null {
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
      return 'announcements';
    default:
      return null;
  }
}

export function isNotificationAllowedByRawPrefs(
  eventType: string,
  rawPrefs?: Record<string, unknown> | null
): boolean {
  if (!rawPrefs || typeof rawPrefs !== 'object') return true;
  const prefKey = mapEventTypeToPrefKey(eventType);
  if (!prefKey) return true;

  if (typeof rawPrefs[prefKey] === 'boolean') {
    return rawPrefs[prefKey] !== false;
  }

  // Legacy key compatibility
  if ((prefKey === 'comments' || prefKey === 'replies') && typeof rawPrefs.commentsAndReplies === 'boolean') {
    return rawPrefs.commentsAndReplies !== false;
  }
  if (prefKey === 'likes' && typeof rawPrefs.reactions === 'boolean') {
    return rawPrefs.reactions !== false;
  }
  if (prefKey === 'marketplace' && typeof rawPrefs.marketplaceUpdates === 'boolean') {
    return rawPrefs.marketplaceUpdates !== false;
  }
  if ((prefKey === 'opportunities' || prefKey === 'events') && typeof rawPrefs.opportunitiesAndEvents === 'boolean') {
    return rawPrefs.opportunitiesAndEvents !== false;
  }

  return true;
}

export function sanitizePushPayloadForClient(input: {
  notificationId?: string | null;
  eventType: string;
  title?: unknown;
  body?: unknown;
  targetPath?: unknown;
  unreadCount?: number;
  allowedOrigin?: string;
}): SanitizedPushClientPayload {
  const isAnonymous = input.eventType === 'anonymous_reply';
  const rawTitle =
    typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  const safeTitle = isAnonymous
    ? (rawTitle || 'New reply in The Unfiltered').slice(0, 120)
    : (rawTitle || 'LASUED Intel Update').slice(0, 120);

  const rawBody =
    typeof input.body === 'string' ? input.body.replace(/\s+/g, ' ').trim() : '';
  const safeBody = (
    rawBody || 'Tap to view the latest campus update on LASUED Intel.'
  ).slice(0, 240);

  const targetPath = sanitizeInternalTargetPath(
    input.targetPath,
    input.allowedOrigin
  );
  const notificationId = isValidFirestoreId(input.notificationId)
    ? input.notificationId
    : null;
  const unreadCount =
    typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount)
      ? Math.max(0, Math.floor(input.unreadCount))
      : 0;

  const tag = isAnonymous
    ? notificationId
      ? `anon_${notificationId.slice(0, 48)}`
      : 'lasued_anonymous'
    : notificationId
      ? `notif_${notificationId.slice(0, 60)}`
      : `lasued_${input.eventType.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;

  return {
    notificationId,
    eventType: input.eventType,
    title: safeTitle,
    body: safeBody,
    targetPath,
    tag,
    unreadCount,
    isAnonymous,
  };
}

export function timingSafeSecretMatch(
  provided: string,
  expected: string
): boolean {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function computeBroadcastDedupId(input: {
  eventType: string;
  title: string;
  targetPath: string;
  firstNotificationId?: string;
}): string {
  const seed = `${input.eventType}|${input.targetPath}|${input.title}|${input.firstNotificationId || ''}`;
  const hash = crypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
  return `bcast_${hash}`;
}

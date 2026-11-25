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

export function unquoteEnvValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  while (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

export function normalizeVapidKey(raw: unknown): string {
  return unquoteEnvValue(raw)
    .replace(/\s+/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isValidFirestoreId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function isValidVapidPublicKey(key: unknown): key is string {
  const normalized = normalizeVapidKey(key);
  return /^[A-Za-z0-9_-]{60,180}$/.test(normalized);
}

export function isValidVapidPrivateKey(key: unknown): key is string {
  const normalized = normalizeVapidKey(key);
  return /^[A-Za-z0-9_-]{32,128}$/.test(normalized);
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
  const trimmed = unquoteEnvValue(rawSubject);
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
  allowedOrigin = 'https://lasuedintel.com.ng'
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
    case 'official_update':
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
  tag?: string | null;
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

  const customTag =
    typeof input.tag === 'string'
      ? input.tag.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      : '';

  const tag = customTag
    ? customTag
    : isAnonymous
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

export function clampTestPushOptions(input?: {
  count?: unknown;
  delaySeconds?: unknown;
}): {
  count: number;
  delaySeconds: number;
} {
  const rawCount =
    typeof input?.count === 'number' && Number.isFinite(input.count)
      ? Math.floor(input.count)
      : 1;
  const count = Math.min(3, Math.max(1, rawCount));

  const rawDelay =
    typeof input?.delaySeconds === 'number' && Number.isFinite(input.delaySeconds)
      ? Math.floor(input.delaySeconds)
      : 0;
  const delaySeconds = Math.min(6, Math.max(0, rawDelay));

  return { count, delaySeconds };
}

export function buildTestPushPayloads(input: {
  batchId: string;
  count: number;
  unreadCount?: number;
  allowedOrigin?: string;
}): SanitizedPushClientPayload[] {
  const safeBatch = input.batchId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'test';
  const safeCount = Math.min(3, Math.max(1, Math.floor(input.count)));

  const templates: Array<{
    eventType: string;
    title: string;
    body: string;
    targetPath: string;
  }> = [
    {
      eventType: 'official_update',
      title: 'LASUED Intel Test Alert (1/' + safeCount + ')',
      body:
        safeCount === 1
          ? 'Background push is working! Alerts arrive even when Chrome is closed.'
          : 'First queued alert — background push wakes your device when data reconnects.',
      targetPath: '/?view=notifications',
    },
    {
      eventType: 'comment',
      title: 'Campus Post Reply (2/' + safeCount + ')',
      body: 'Adaobi replied: "Have you seen the updated LASUED lecture timetable?"',
      targetPath: '/?view=for-you',
    },
    {
      eventType: 'mention',
      title: 'Campus Mention (3/' + safeCount + ')',
      body: 'Chidi @mentioned you in The Unfiltered — notifications stack like WhatsApp.',
      targetPath: '/?view=anonymous',
    },
  ];

  return templates.slice(0, safeCount).map((tpl, idx) =>
    sanitizePushPayloadForClient({
      eventType: tpl.eventType,
      title: tpl.title,
      body: tpl.body,
      targetPath: tpl.targetPath,
      unreadCount: input.unreadCount ?? idx + 1,
      allowedOrigin: input.allowedOrigin,
      tag: `test_${safeBatch}_${idx + 1}`,
    })
  );
}

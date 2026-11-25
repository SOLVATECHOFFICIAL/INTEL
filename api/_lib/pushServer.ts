import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  getHeaderValue,
  getServerPushConfigStatus,
  parseServiceAccountJson,
  resolveNormalizedFirestoreDatabaseId,
  type VercelLikeRequest,
} from './pushConfig.js';
import {
  isNotificationAllowedByRawPrefs,
  isValidFirestoreId,
  isValidHttpsPushEndpoint,
  sanitizePushPayloadForClient,
  timingSafeSecretMatch,
  unquoteEnvValue,
} from './pushSanitizer.js';

export {
  getHeaderValue,
  getServerPushConfigDiagnostics,
  getServerPushConfigStatus,
  parseServiceAccountJson,
  readJsonBody,
  resolveNormalizedFirestoreDatabaseId,
  sendJson,
  type ParsedServiceAccount,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from './pushConfig.js';

export type VerifiedCaller =
  | { kind: 'webhook' }
  | {
      kind: 'user';
      uid: string;
      email: string;
      role: 'supreme_admin' | 'moderator' | 'verified' | 'member';
      isSuspended: boolean;
    };

export interface PushDeliverySummary {
  attempted: number;
  delivered: number;
  pruned: number;
  failed: number;
}

const PUBLIC_SUPREME_ADMIN_EMAIL = 'lasuedintel@gmail.com';
const UNDERGROUND_SUPREME_ADMIN_EMAIL = 'awoyinfasolomon1@gmail.com';

let cachedVapidSetupSignature: string | null = null;

type WebPushModule = typeof import('web-push');
let cachedWebPushModule: WebPushModule | null = null;

async function loadWebPushClient(): Promise<WebPushModule> {
  if (!cachedWebPushModule) {
    const imported = await import('web-push');
    cachedWebPushModule =
      (imported as unknown as { default?: WebPushModule }).default ?? imported;
  }
  return cachedWebPushModule;
}

export function getAdminClients(): {
  db: Firestore;
  auth: ReturnType<typeof getAuth>;
} | null {
  const serviceAccount = parseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
  if (!serviceAccount) return null;

  try {
    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp({ credential: cert(serviceAccount) });

    const databaseId = resolveNormalizedFirestoreDatabaseId();

    const db =
      databaseId === '(default)'
        ? getFirestore(app)
        : getFirestore(app, databaseId);
    const auth = getAuth(app);
    return { db, auth };
  } catch {
    return null;
  }
}

export async function ensureWebPushConfigured(): Promise<boolean> {
  const cfg = getServerPushConfigStatus();
  if (!cfg.vapidConfigured || !cfg.vapidPublicKey || !cfg.vapidPrivateKey) {
    return false;
  }

  const signature = `${cfg.vapidSubject}|${cfg.vapidPublicKey}`;
  if (cachedVapidSetupSignature !== signature) {
    const wp = await loadWebPushClient();
    wp.setVapidDetails(
      cfg.vapidSubject,
      cfg.vapidPublicKey,
      cfg.vapidPrivateKey
    );
    cachedVapidSetupSignature = signature;
  }
  return true;
}

export async function verifyPushApiCaller(
  req: VercelLikeRequest,
  adminAuth: ReturnType<typeof getAuth>,
  db: Firestore
): Promise<VerifiedCaller | null> {
  const configuredSecret = unquoteEnvValue(process.env.PUSH_WEBHOOK_SECRET);
  const providedSecret = unquoteEnvValue(
    getHeaderValue(req, 'x-push-webhook-secret')
  );
  if (configuredSecret && providedSecret) {
    if (timingSafeSecretMatch(providedSecret, configuredSecret)) {
      return { kind: 'webhook' };
    }
    return null;
  }

  const authHeader = getHeaderValue(req, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match?.[1]) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(match[1].trim(), true);
    const uid = decoded.uid;
    if (!isValidFirestoreId(uid)) return null;

    const email = (decoded.email ?? '').trim().toLowerCase();
    const emailVerified = decoded.email_verified === true;
    const [userSnap, roleSnap] = await Promise.all([
      db.collection('users').doc(uid).get().catch(() => null),
      db.collection('userRoles').doc(uid).get().catch(() => null),
    ]);

    const accountStatus = userSnap?.data()?.accountStatus;
    const isSuspended = accountStatus === 'suspended';

    let role: 'supreme_admin' | 'moderator' | 'verified' | 'member' = 'member';
    if (
      emailVerified &&
      (email === PUBLIC_SUPREME_ADMIN_EMAIL ||
        email === UNDERGROUND_SUPREME_ADMIN_EMAIL)
    ) {
      role = 'supreme_admin';
    } else if (emailVerified) {
      const roleData = roleSnap?.data();
      const rawRole = roleData?.role;
      if (
        !roleData?.isPermanentOwner &&
        (rawRole === 'moderator' || rawRole === 'verified')
      ) {
        role = rawRole;
      }
    }

    return {
      kind: 'user',
      uid,
      email,
      role,
      isSuspended,
    };
  } catch {
    return null;
  }
}

export async function claimPushDedupLock(
  db: Firestore,
  dedupId: string
): Promise<boolean> {
  if (!isValidFirestoreId(dedupId)) return false;
  try {
    await db
      .collection('_serverPushDedup')
      .doc(dedupId)
      .create({
        id: dedupId,
        createdAt: FieldValue.serverTimestamp(),
      });
    return true;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 6 || String(code).toLowerCase().includes('already-exists')) {
      return false;
    }
    throw error;
  }
}

async function computeUnreadNotificationCountForUser(
  db: Firestore,
  uid: string,
  prefs?: Record<string, unknown> | null
): Promise<number> {
  try {
    const unreadSnap = await db
      .collection('notifications')
      .where('recipientUid', '==', uid)
      .where('isRead', '==', false)
      .select('eventType')
      .limit(1000)
      .get();

    let count = 0;
    for (const docSnap of unreadSnap.docs) {
      const eventType = String(docSnap.data()?.eventType ?? '');
      if (isNotificationAllowedByRawPrefs(eventType, prefs)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 1;
  }
}

interface StoredPushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function deliverWebPushToRecipient(
  db: Firestore,
  input: {
    recipientUid: string;
    notificationId?: string | null;
    eventType: string;
    title: string;
    body?: string;
    targetPath?: string;
    allowedOrigin: string;
    preloadedSubscriptions?: StoredPushSub[];
  }
): Promise<PushDeliverySummary> {
  if (!isValidFirestoreId(input.recipientUid)) {
    return { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  }

  const privateSnap = await db
    .collection('privateUserData')
    .doc(input.recipientUid)
    .get()
    .catch(() => null);
  const prefs =
    (privateSnap?.data()?.notificationPrefs as Record<string, unknown> | undefined) ??
    null;

  if (!isNotificationAllowedByRawPrefs(input.eventType, prefs)) {
    return { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  }

  let subscriptions = input.preloadedSubscriptions;
  if (!subscriptions) {
    const subSnap = await db
      .collection('privateUserData')
      .doc(input.recipientUid)
      .collection('pushSubscriptions')
      .limit(25)
      .get();

    subscriptions = subSnap.docs.map((docSnap) => {
      const data = docSnap.data() ?? {};
      return {
        id: docSnap.id,
        endpoint: String(data.endpoint ?? ''),
        p256dh: String(data.p256dh ?? ''),
        auth: String(data.auth ?? ''),
      };
    });
  }

  const rawSubs = subscriptions.filter(
    (sub) =>
      isValidHttpsPushEndpoint(sub.endpoint) &&
      sub.p256dh.length >= 20 &&
      sub.auth.length >= 10
  );

  // Deduplicate by endpoint so multiple docs for the same device endpoint never double-notify
  const seenEndpoints = new Set<string>();
  const duplicateSubIds: string[] = [];
  const validSubs: StoredPushSub[] = [];
  for (const sub of rawSubs) {
    const normalizedEndpoint = sub.endpoint.trim();
    if (seenEndpoints.has(normalizedEndpoint)) {
      duplicateSubIds.push(sub.id);
      continue;
    }
    seenEndpoints.add(normalizedEndpoint);
    validSubs.push({ ...sub, endpoint: normalizedEndpoint });
  }

  if (duplicateSubIds.length > 0) {
    void Promise.allSettled(
      duplicateSubIds.map((dupId) =>
        db
          .collection('privateUserData')
          .doc(input.recipientUid)
          .collection('pushSubscriptions')
          .doc(dupId)
          .delete()
      )
    );
  }

  if (validSubs.length === 0) {
    return { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  }

  const unreadCount = await computeUnreadNotificationCountForUser(
    db,
    input.recipientUid,
    prefs
  );

  const clientPayload = sanitizePushPayloadForClient({
    notificationId: input.notificationId,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    targetPath: input.targetPath,
    unreadCount,
    allowedOrigin: input.allowedOrigin,
  });

  const serializedPayload = JSON.stringify(clientPayload);
  const wp = await loadWebPushClient();
  let delivered = 0;
  let pruned = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    validSubs.map(async (sub) => {
      try {
        await wp.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          serializedPayload,
          {
            TTL: 86_400,
            urgency: 'normal',
          }
        );
        return { outcome: 'delivered' as const, subId: sub.id };
      } catch (err) {
        if (shouldPrunePushFailure(err)) {
          await db
            .collection('privateUserData')
            .doc(input.recipientUid)
            .collection('pushSubscriptions')
            .doc(sub.id)
            .delete()
            .catch(() => undefined);
          return { outcome: 'pruned' as const, subId: sub.id };
        }
        return { outcome: 'failed' as const, subId: sub.id };
      }
    })
  );

  for (const resItem of results) {
    if (resItem.status === 'fulfilled') {
      if (resItem.value.outcome === 'delivered') delivered += 1;
      else if (resItem.value.outcome === 'pruned') pruned += 1;
      else failed += 1;
    } else {
      failed += 1;
    }
  }

  return {
    attempted: validSubs.length,
    delivered,
    pruned,
    failed,
  };
}

export function shouldPrunePushFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { statusCode?: unknown; body?: unknown; message?: unknown };
  const statusCode =
    typeof record.statusCode === 'number' ? record.statusCode : null;

  if (statusCode === 404 || statusCode === 410) {
    return true;
  }

  if (statusCode === 400 || statusCode === 403) {
    const detail = `${typeof record.body === 'string' ? record.body : ''} ${
      typeof record.message === 'string' ? record.message : ''
    }`.toLowerCase();
    return (
      detail.includes('notregistered') ||
      detail.includes('unregistered') ||
      detail.includes('invalidregistration') ||
      detail.includes('mismatchsenderid') ||
      detail.includes('vapidpkhashmismatch') ||
      detail.includes('expired')
    );
  }

  return false;
}


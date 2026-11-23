import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import {
  isNotificationAllowedByRawPrefs,
  isValidFirestoreId,
  isValidHttpsPushEndpoint,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  normalizeVapidSubject,
  sanitizePushPayloadForClient,
  timingSafeSecretMatch,
} from './pushSanitizer';
import { resolveServerPublicOrigin } from './siteOrigin';

export interface VercelLikeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

export interface VercelLikeResponse {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: unknown) => void;
  end: (chunk?: string) => void;
}

export type VerifiedCaller =
  | { kind: 'webhook' }
  | {
      kind: 'user';
      uid: string;
      email: string;
      role: 'owner' | 'supreme_admin' | 'moderator' | 'verified' | 'member';
      isSuspended: boolean;
    };

export interface PushDeliverySummary {
  attempted: number;
  delivered: number;
  pruned: number;
  failed: number;
}

const PERMANENT_OWNER_EMAIL = 'estheriawoyinfa52@gmail.com';
const PUBLIC_SUPREME_ADMIN_EMAIL = 'lasuedintel@gmail.com';
const UNDERGROUND_SUPREME_ADMIN_EMAIL = 'awoyinfasolomon1@gmail.com';
const DEFAULT_FIRESTORE_DB_ID = 'ai-studio-intel-5bda81a4-c388-4f50-b629-ca521ae04516';

let cachedVapidSetupSignature: string | null = null;

export function sendJson(
  res: VercelLikeResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const target = res.status(statusCode);
    if (typeof target.json === 'function') {
      target.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export function getHeaderValue(
  req: VercelLikeRequest,
  headerName: string
): string {
  const lower = headerName.toLowerCase();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return (value[0] ?? '').trim();
      return typeof value === 'string' ? value.trim() : '';
    }
  }
  return '';
}

export async function readJsonBody(
  req: VercelLikeRequest
): Promise<Record<string, unknown> | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Array.isArray(req.body)) {
      return req.body as Record<string, unknown>;
    }
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof req[Symbol.asyncIterator] === 'function') {
    try {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        totalBytes += buf.byteLength;
        if (totalBytes > 128 * 1024) {
          return null;
        }
        chunks.push(buf);
      }
      if (chunks.length === 0) return {};
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return {};
}

function parseServiceAccountJson(raw: string | undefined): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const candidates = [trimmed];
  if (!trimmed.startsWith('{')) {
    try {
      candidates.push(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
      // Ignore base64 fallback error
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (
        parsed &&
        typeof parsed.project_id === 'string' &&
        typeof parsed.client_email === 'string' &&
        typeof parsed.private_key === 'string'
      ) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // Continue trying candidates
    }
  }
  return null;
}

export function getServerPushConfigStatus(): {
  vapidConfigured: boolean;
  firebaseAdminConfigured: boolean;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  allowedOrigin: string;
} {
  const publicKey =
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ||
    process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ||
    '';
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || '';
  const subject = normalizeVapidSubject(process.env.WEB_PUSH_VAPID_SUBJECT);
  const serviceAccount = parseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
  const allowedOrigin = resolveServerPublicOrigin();

  const vapidConfigured =
    isValidVapidPublicKey(publicKey) && isValidVapidPrivateKey(privateKey);

  return {
    vapidConfigured,
    firebaseAdminConfigured: Boolean(serviceAccount),
    vapidPublicKey: isValidVapidPublicKey(publicKey) ? publicKey : null,
    vapidPrivateKey: isValidVapidPrivateKey(privateKey) ? privateKey : null,
    vapidSubject: subject,
    allowedOrigin,
  };
}

export function getAdminClients(): {
  db: Firestore;
  auth: ReturnType<typeof getAuth>;
} | null {
  const serviceAccount = parseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
  if (!serviceAccount) return null;

  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({ credential: cert(serviceAccount) });

  const databaseId =
    process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() || DEFAULT_FIRESTORE_DB_ID;

  const db = getFirestore(app, databaseId);
  const auth = getAuth(app);
  return { db, auth };
}

export function ensureWebPushConfigured(): boolean {
  const cfg = getServerPushConfigStatus();
  if (!cfg.vapidConfigured || !cfg.vapidPublicKey || !cfg.vapidPrivateKey) {
    return false;
  }

  const signature = `${cfg.vapidSubject}|${cfg.vapidPublicKey}`;
  if (cachedVapidSetupSignature !== signature) {
    webpush.setVapidDetails(
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
  const configuredSecret = process.env.PUSH_WEBHOOK_SECRET?.trim() || '';
  const providedSecret = getHeaderValue(req, 'x-push-webhook-secret');
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

    let role: 'owner' | 'supreme_admin' | 'moderator' | 'verified' | 'member' =
      'member';
    if (emailVerified && email === PERMANENT_OWNER_EMAIL) {
      role = 'owner';
    } else if (
      emailVerified &&
      (email === PUBLIC_SUPREME_ADMIN_EMAIL ||
        email === UNDERGROUND_SUPREME_ADMIN_EMAIL)
    ) {
      role = 'supreme_admin';
    } else {
      const rawRole = roleSnap?.data()?.role;
      if (
        rawRole === 'owner' ||
        rawRole === 'supreme_admin' ||
        rawRole === 'moderator' ||
        rawRole === 'verified'
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

  const validSubs = subscriptions.filter(
    (sub) =>
      isValidHttpsPushEndpoint(sub.endpoint) &&
      sub.p256dh.length >= 20 &&
      sub.auth.length >= 10
  );

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
  let delivered = 0;
  let pruned = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    validSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
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
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
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

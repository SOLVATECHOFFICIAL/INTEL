import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import {
  COLLECTION_NAMES,
  SUBCOLLECTION_NAMES,
  isValidFirestoreId,
  type NotificationEventType,
  type PushSubscriptionRecord,
} from '../types/database';
import {
  computeDeterministicPushSubscriptionId,
  detectDeviceEnvironment,
  isValidHttpsPushEndpoint,
  isValidVapidPublicKey,
  urlBase64ToUint8Array,
} from '../utils/pwa';

let cachedServerVapidKey: string | null | undefined;
const PUSH_ENDPOINT_MARKER_PREFIX = 'lasued_intel_push_synced_';

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractSubscriptionKeys(sub: PushSubscription): {
  endpoint: string;
  p256dh: string;
  authKey: string;
} {
  const json = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
  const endpoint = (json?.endpoint || sub.endpoint || '').trim();
  const p256dh =
    json?.keys?.p256dh ||
    arrayBufferToBase64Url(
      typeof sub.getKey === 'function' ? sub.getKey('p256dh') : null
    );
  const authKey =
    json?.keys?.auth ||
    arrayBufferToBase64Url(
      typeof sub.getKey === 'function' ? sub.getKey('auth') : null
    );

  return { endpoint, p256dh: p256dh.trim(), authKey: authKey.trim() };
}

export async function fetchConfiguredVapidPublicKey(): Promise<string | null> {
  try {
    const buildEnvKey = import.meta?.env?.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
    if (typeof buildEnvKey === 'string' && isValidVapidPublicKey(buildEnvKey)) {
      cachedServerVapidKey = buildEnvKey.trim();
      return cachedServerVapidKey;
    }
  } catch {
    // Ignore import.meta fallback errors
  }

  if (cachedServerVapidKey !== undefined) {
    return cachedServerVapidKey;
  }

  if (typeof fetch !== 'function') {
    cachedServerVapidKey = null;
    return null;
  }

  try {
    const response = await fetch('/api/push/config', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    const data = (await response.json()) as {
      configured?: boolean;
      vapidPublicKey?: string | null;
    };
    if (data.configured && isValidVapidPublicKey(data.vapidPublicKey)) {
      cachedServerVapidKey = data.vapidPublicKey!.trim();
      return cachedServerVapidKey;
    }
    cachedServerVapidKey = null;
    return null;
  } catch {
    return null;
  }
}

export function clearCachedVapidKey(): void {
  cachedServerVapidKey = undefined;
}

function writeSyncedPushMarker(uid: string, endpoint: string | null): void {
  if (typeof window === 'undefined') return;
  const key = `${PUSH_ENDPOINT_MARKER_PREFIX}${uid}`;
  try {
    if (!endpoint) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, endpoint);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function readSyncedPushMarker(uid: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${PUSH_ENDPOINT_MARKER_PREFIX}${uid}`);
  } catch {
    return null;
  }
}

export async function getActiveBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof window === 'undefined' ||
    !('PushManager' in window)
  ) {
    return null;
  }

  try {
    const registration =
      (await navigator.serviceWorker.getRegistration('/')) ??
      (await navigator.serviceWorker.ready);
    if (!registration?.pushManager) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function savePushSubscriptionForUser(
  uid: string,
  subscription: PushSubscription
): Promise<PushSubscriptionRecord> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Invalid signed-in user identifier.');
  }

  const { endpoint, p256dh, authKey } = extractSubscriptionKeys(subscription);
  if (!isValidHttpsPushEndpoint(endpoint)) {
    throw new Error('Browser returned an invalid push endpoint URL.');
  }
  if (p256dh.length < 20 || authKey.length < 10) {
    throw new Error('Browser push encryption keys were incomplete.');
  }

  const subId = await computeDeterministicPushSubscriptionId(endpoint);
  const subRef = doc(
    db,
    COLLECTION_NAMES.privateUserData,
    uid,
    SUBCOLLECTION_NAMES.pushSubscriptions,
    subId
  );

  const env = detectDeviceEnvironment();
  const userAgent =
    typeof navigator !== 'undefined' && navigator.userAgent
      ? navigator.userAgent.slice(0, 300)
      : undefined;
  const platform =
    typeof navigator !== 'undefined' && navigator.platform
      ? navigator.platform.slice(0, 64)
      : undefined;

  const existingSnap = await getDoc(subRef).catch(() => null);
  const basePayload: Record<string, unknown> = {
    id: subId,
    uid,
    endpoint,
    p256dh,
    auth: authKey,
    isStandalone: env.isStandalone,
    updatedAt: serverTimestamp(),
  };
  if (userAgent) basePayload.userAgent = userAgent;
  if (platform) basePayload.platform = platform;

  if (existingSnap?.exists()) {
    await updateDoc(subRef, basePayload);
  } else {
    await setDoc(subRef, {
      ...basePayload,
      createdAt: serverTimestamp(),
    });
  }

  writeSyncedPushMarker(uid, endpoint);

  return {
    id: subId,
    uid,
    endpoint,
    p256dh,
    auth: authKey,
    userAgent,
    platform,
    isStandalone: env.isStandalone,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function verifyStoredPushSubscriptionForUser(
  uid: string
): Promise<boolean> {
  if (!isValidFirestoreId(uid)) return false;
  const sub = await getActiveBrowserPushSubscription();
  if (!sub) return false;
  const { endpoint } = extractSubscriptionKeys(sub);
  if (!isValidHttpsPushEndpoint(endpoint)) return false;

  if (readSyncedPushMarker(uid) === endpoint) {
    return true;
  }

  try {
    const subId = await computeDeterministicPushSubscriptionId(endpoint);
    const snap = await getDoc(
      doc(
        db,
        COLLECTION_NAMES.privateUserData,
        uid,
        SUBCOLLECTION_NAMES.pushSubscriptions,
        subId
      )
    );
    if (snap.exists()) {
      writeSyncedPushMarker(uid, endpoint);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function subscribeDeviceToWebPush(
  uid: string,
  vapidPublicKeyOverride?: string | null
): Promise<PushSubscriptionRecord> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Sign in to enable push notifications for your account.');
  }

  const vapidKey =
    vapidPublicKeyOverride && isValidVapidPublicKey(vapidPublicKeyOverride)
      ? vapidPublicKeyOverride.trim()
      : await fetchConfiguredVapidPublicKey();

  if (!vapidKey) {
    throw new Error(
      'Web Push server keys are not configured for this deployment yet.'
    );
  }

  const registration =
    (await navigator.serviceWorker.getRegistration('/')) ??
    (await navigator.serviceWorker.ready);

  if (!registration?.pushManager) {
    throw new Error(
      'Push notifications are not available in the active service worker.'
    );
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    });
  }

  return await savePushSubscriptionForUser(uid, subscription);
}

export async function disableCurrentDevicePushSubscription(
  uid?: string | null
): Promise<void> {
  const sub = await getActiveBrowserPushSubscription();
  const endpoint = sub ? extractSubscriptionKeys(sub).endpoint : null;

  if (uid && isValidFirestoreId(uid)) {
    writeSyncedPushMarker(uid, null);
    if (endpoint) {
      try {
        const subId = await computeDeterministicPushSubscriptionId(endpoint);
        await deleteDoc(
          doc(
            db,
            COLLECTION_NAMES.privateUserData,
            uid,
            SUBCOLLECTION_NAMES.pushSubscriptions,
            subId
          )
        );
      } catch {
        // Non-blocking cleanup
      }
    }
  }

  if (sub) {
    try {
      await sub.unsubscribe();
    } catch {
      // Ignore browser unsubscribe errors
    }
  }
}

export async function cleanupDevicePushBeforeSignOut(
  uid?: string | null
): Promise<void> {
  await disableCurrentDevicePushSubscription(uid);

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      reg?.active?.postMessage({ type: 'LASUED_CLEAR_USER_CACHE' });
      reg?.active?.postMessage({
        type: 'LASUED_SYNC_BADGE',
        unreadCount: 0,
      });
    } catch {
      // Non-blocking
    }
  }
}

export async function deleteAllOwnPushSubscriptionsDocs(
  uid: string
): Promise<void> {
  if (!isValidFirestoreId(uid)) return;
  try {
    const colRef = collection(
      db,
      COLLECTION_NAMES.privateUserData,
      uid,
      SUBCOLLECTION_NAMES.pushSubscriptions
    );
    const snap = await getDocs(colRef);
    await Promise.allSettled(snap.docs.map((item) => deleteDoc(item.ref)));
    writeSyncedPushMarker(uid, null);
  } catch {
    // Non-blocking
  }
}

export async function syncAppBadgeWithServiceWorker(
  unreadCount: number
): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };

  try {
    if (unreadCount <= 0) {
      await nav.clearAppBadge?.();
    } else {
      await nav.setAppBadge?.(Math.floor(unreadCount));
    }
  } catch {
    // Ignore unsupported badge environments
  }

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      reg?.active?.postMessage({
        type: 'LASUED_SYNC_BADGE',
        unreadCount: Math.max(0, Math.floor(unreadCount)),
      });
    } catch {
      // Non-blocking
    }
  }
}

export async function triggerBestEffortPushDispatch(input: {
  notificationId: string;
  recipientUid?: string;
}): Promise<void> {
  if (typeof fetch !== 'function' || typeof navigator === 'undefined') return;
  if (navigator.onLine === false) return;
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  try {
    const token = await currentUser.getIdToken();
    await fetch('/api/push/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        notificationId: input.notificationId,
        recipientUid: input.recipientUid,
      }),
    });
  } catch {
    // Server dispatch may be offline or not configured in preview; never fail UI writes
  }
}

export async function triggerBestEffortPushBroadcast(input: {
  eventType: NotificationEventType;
  title: string;
  body?: string;
  targetPath?: string;
  recipientUids?: string[];
  notificationIds?: string[];
}): Promise<void> {
  if (typeof fetch !== 'function' || typeof navigator === 'undefined') return;
  if (navigator.onLine === false) return;
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  try {
    const token = await currentUser.getIdToken();
    await fetch('/api/push/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        targetPath: input.targetPath,
        recipientUids: input.recipientUids,
        notificationIds: input.notificationIds,
      }),
    });
  } catch {
    // Server broadcast is best-effort and non-blocking
  }
}

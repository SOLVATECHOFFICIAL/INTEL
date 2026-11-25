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
  doVapidApplicationServerKeysMatch,
  isValidHttpsPushEndpoint,
  isValidVapidPublicKey,
  urlBase64ToUint8Array,
} from '../utils/pwa';

let cachedServerVapidKey: string | null | undefined;
const PUSH_ENDPOINT_MARKER_PREFIX = 'lasued_intel_push_synced_';
const PUSH_OPT_OUT_KEY_PREFIX = 'lasued_intel_push_opt_out_';

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
  if (cachedServerVapidKey !== undefined) {
    return cachedServerVapidKey;
  }

  let buildEnvKey: string | null = null;
  try {
    const rawBuildKey = import.meta?.env?.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
    if (typeof rawBuildKey === 'string' && isValidVapidPublicKey(rawBuildKey)) {
      buildEnvKey = rawBuildKey.trim();
    }
  } catch {
    // Ignore import.meta fallback errors
  }

  if (typeof fetch !== 'function') {
    cachedServerVapidKey = buildEnvKey;
    return cachedServerVapidKey;
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
    if (data.configured) {
      const serverKey = isValidVapidPublicKey(data.vapidPublicKey)
        ? data.vapidPublicKey!.trim()
        : buildEnvKey;
      if (serverKey) {
        cachedServerVapidKey = serverKey;
        return cachedServerVapidKey;
      }
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

export function readDevicePushOptOut(uid?: string | null): boolean {
  if (typeof window === 'undefined' || !uid || !isValidFirestoreId(uid)) {
    return false;
  }
  try {
    return window.localStorage.getItem(`${PUSH_OPT_OUT_KEY_PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}

export function writeDevicePushOptOut(
  uid: string | null | undefined,
  optedOut: boolean
): void {
  if (typeof window === 'undefined' || !uid || !isValidFirestoreId(uid)) {
    return;
  }
  const key = `${PUSH_OPT_OUT_KEY_PREFIX}${uid}`;
  try {
    if (optedOut) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota errors
  }
}

async function waitForActiveServiceWorker(
  timeoutMs = 3000
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  const direct =
    (await navigator.serviceWorker.getRegistration('/').catch(() => undefined)) ??
    (await navigator.serviceWorker.getRegistration().catch(() => undefined));
  if (direct) return direct;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
    const registration = await waitForActiveServiceWorker();
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
  const basePayload: {
    id: string;
    uid: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    isStandalone: boolean;
    updatedAt: ReturnType<typeof serverTimestamp>;
    userAgent?: string;
    platform?: string;
  } = {
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
  if (readDevicePushOptOut(uid)) return false;
  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission !== 'granted'
  ) {
    return false;
  }

  const sub = await getActiveBrowserPushSubscription();
  if (!sub) return false;

  const configuredVapidKey = await fetchConfiguredVapidPublicKey().catch(
    () => null
  );
  const existingServerKey = sub.options?.applicationServerKey ?? null;
  if (
    configuredVapidKey &&
    existingServerKey &&
    !doVapidApplicationServerKeysMatch(existingServerKey, configuredVapidKey)
  ) {
    try {
      await disableCurrentDevicePushSubscription(uid);
      const rotated = await subscribeDeviceToWebPush(uid, configuredVapidKey);
      return Boolean(rotated.endpoint);
    } catch {
      return false;
    }
  }

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
    // Browser rotated/renewed its PushSubscription endpoint under granted permission; re-save safely
    await savePushSubscriptionForUser(uid, sub);
    return true;
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

  const registration = await waitForActiveServiceWorker(4000);

  if (!registration?.pushManager) {
    throw new Error(
      'Push notifications are not available in the active service worker.'
    );
  }

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const existingServerKey = subscription.options?.applicationServerKey ?? null;
    if (
      existingServerKey &&
      !doVapidApplicationServerKeysMatch(existingServerKey, vapidKey)
    ) {
      const staleEndpoint = extractSubscriptionKeys(subscription).endpoint;
      if (staleEndpoint) {
        try {
          const staleSubId =
            await computeDeterministicPushSubscriptionId(staleEndpoint);
          await deleteDoc(
            doc(
              db,
              COLLECTION_NAMES.privateUserData,
              uid,
              SUBCOLLECTION_NAMES.pushSubscriptions,
              staleSubId
            )
          );
        } catch {
          // Non-blocking cleanup before VAPID key rotation
        }
      }
      await subscription.unsubscribe().catch(() => undefined);
      subscription = null;
    }
  }

  if (!subscription) {
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    });
  }

  writeDevicePushOptOut(uid, false);
  return await savePushSubscriptionForUser(uid, subscription);
}

export async function disableCurrentDevicePushSubscription(
  uid?: string | null,
  options?: { markOptedOut?: boolean }
): Promise<void> {
  const sub = await getActiveBrowserPushSubscription();
  const endpoint = sub ? extractSubscriptionKeys(sub).endpoint : null;

  if (uid && isValidFirestoreId(uid)) {
    writeSyncedPushMarker(uid, null);
    if (options?.markOptedOut) {
      writeDevicePushOptOut(uid, true);
    }
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

async function getCurrentBearerToken(): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  try {
    const token = await currentUser.getIdToken();
    return token && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

export async function triggerBestEffortPushDispatch(input: {
  notificationId: string;
  recipientUid?: string;
}): Promise<void> {
  if (typeof fetch !== 'function' || !isValidFirestoreId(input.notificationId)) {
    return;
  }
  try {
    const vapidKey = await fetchConfiguredVapidPublicKey();
    if (!vapidKey) return;
    const token = await getCurrentBearerToken();
    if (!token) return;

    await fetch('/api/push/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        notificationId: input.notificationId,
        ...(input.recipientUid && isValidFirestoreId(input.recipientUid)
          ? { recipientUid: input.recipientUid }
          : {}),
      }),
    });
  } catch {
    // Non-blocking best-effort background push delivery
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
  if (typeof fetch !== 'function' || !input.title.trim()) {
    return;
  }
  try {
    const vapidKey = await fetchConfiguredVapidPublicKey();
    if (!vapidKey) return;
    const token = await getCurrentBearerToken();
    if (!token) return;

    await fetch('/api/push/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventType: input.eventType,
        title: input.title,
        ...(input.body ? { body: input.body } : {}),
        ...(input.targetPath ? { targetPath: input.targetPath } : {}),
        ...(Array.isArray(input.recipientUids)
          ? { recipientUids: input.recipientUids }
          : {}),
        ...(Array.isArray(input.notificationIds)
          ? { notificationIds: input.notificationIds }
          : {}),
      }),
    });
  } catch {
    // Non-blocking best-effort background push broadcast
  }
}

export interface TestPushResult {
  ok: boolean;
  mode: 'server_push' | 'local_preview' | 'no_subscription' | 'unconfigured' | 'error';
  delivered: number;
  attempted: number;
  message: string;
}

async function triggerLocalNotificationPreview(input: {
  count: number;
  delaySeconds: number;
}): Promise<number> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return 0;
  }

  if (input.delaySeconds > 0) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, Math.min(6000, input.delaySeconds * 1000))
    );
  }

  const registration = await waitForActiveServiceWorker(2000).catch(() => null);
  const batchId = Date.now().toString(36);
  const samples = [
    {
      title: `LASUED Intel Test Alert (1/${input.count})`,
      body:
        input.count === 1
          ? 'Local notification preview works in your notification tray.'
          : 'First preview alert — stacked alerts use unique tags like WhatsApp.',
      targetPath: '/?view=notifications',
    },
    {
      title: `Campus Post Reply (2/${input.count})`,
      body: 'Adaobi replied: "Have you seen the updated LASUED lecture timetable?"',
      targetPath: '/?view=for-you',
    },
    {
      title: `Campus Mention (3/${input.count})`,
      body: 'Chidi @mentioned you in The Unfiltered — stacked notification preview.',
      targetPath: '/?view=anonymous',
    },
  ].slice(0, input.count);

  let shown = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const tag = `local_test_${batchId}_${i + 1}`;
    try {
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(sample.title, {
          body: sample.body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
          data: { targetPath: sample.targetPath },
        });
      } else {
        new Notification(sample.title, {
          body: sample.body,
          icon: '/pwa-192x192.png',
          tag,
        });
      }
      shown += 1;
    } catch {
      // Continue trying remaining preview items
    }
    if (i < samples.length - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  return shown;
}

export async function sendTestPushNotifications(input?: {
  count?: number;
  delaySeconds?: number;
}): Promise<TestPushResult> {
  const count = Math.min(3, Math.max(1, Math.floor(input?.count ?? 1)));
  const delaySeconds = Math.min(6, Math.max(0, Math.floor(input?.delaySeconds ?? 0)));

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      ok: false,
      mode: 'error',
      delivered: 0,
      attempted: 0,
      message: 'Sign in first to test push notifications.',
    };
  }

  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission !== 'granted'
  ) {
    return {
      ok: false,
      mode: 'error',
      delivered: 0,
      attempted: 0,
      message: 'Allow notifications in your browser first before running a test.',
    };
  }

  const vapidKey = await fetchConfiguredVapidPublicKey().catch(() => null);
  const token = await getCurrentBearerToken();

  if (vapidKey && token && typeof fetch === 'function') {
    try {
      const hasSub = await verifyStoredPushSubscriptionForUser(currentUser.uid).catch(
        () => false
      );
      if (!hasSub) {
        await subscribeDeviceToWebPush(currentUser.uid, vapidKey).catch(() => null);
      }

      const response = await fetch('/api/push/test', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ count, delaySeconds }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          ok?: boolean;
          configured?: boolean;
          noSubscription?: boolean;
          attempted?: number;
          delivered?: number;
        };

        if (data.configured) {
          if (data.noSubscription || (data.attempted ?? 0) === 0) {
            return {
              ok: false,
              mode: 'no_subscription',
              delivered: 0,
              attempted: 0,
              message:
                'This device does not have an active push subscription saved yet. Tap "Allow Notifications" first.',
            };
          }

          if ((data.delivered ?? 0) > 0) {
            return {
              ok: true,
              mode: 'server_push',
              delivered: data.delivered ?? 0,
              attempted: data.attempted ?? 0,
              message:
                count > 1
                  ? `${count} stacked Web Push alerts sent to your notification bar!`
                  : 'Test Web Push alert delivered! Check your device notification bar.',
            };
          }

          return {
            ok: false,
            mode: 'server_push',
            delivered: 0,
            attempted: data.attempted ?? 0,
            message:
              'Push endpoint did not accept delivery (your browser subscription may need re-enabling).',
          };
        }
      }
    } catch {
      // Fall through to local browser preview if network disconnected right after click
      if (delaySeconds > 0) {
        return {
          ok: true,
          mode: 'server_push',
          delivered: 0,
          attempted: 1,
          message:
            'Test stack request dispatched. Keep data off for a few seconds, then reconnect to see alerts arrive.',
        };
      }
    }
  }

  const shownLocally = await triggerLocalNotificationPreview({
    count,
    delaySeconds,
  });
  if (shownLocally > 0) {
    return {
      ok: true,
      mode: 'local_preview',
      delivered: shownLocally,
      attempted: count,
      message:
        'Local notification preview shown (real closed-browser & offline-queue push activates once server VAPID & Firebase Admin keys are deployed on Vercel).',
    };
  }

  return {
    ok: false,
    mode: 'unconfigured',
    delivered: 0,
    attempted: 0,
    message:
      'Unable to display a test notification on this device right now. Check browser site notification settings.',
  };
}

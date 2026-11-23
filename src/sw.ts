import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

interface SwNotificationAction {
  action: string;
  title: string;
}

interface SwWindowClient {
  id: string;
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus: () => Promise<SwWindowClient>;
  postMessage: (message: unknown) => void;
}

interface SwRegistration {
  showNotification: (
    title: string,
    options?: {
      body?: string;
      icon?: string;
      badge?: string;
      tag?: string;
      renotify?: boolean;
      data?: Record<string, unknown>;
      actions?: SwNotificationAction[];
    }
  ) => Promise<void>;
}

interface SwGlobalScope {
  __WB_MANIFEST?: Array<PrecacheEntry | string>;
  location: Location;
  registration: SwRegistration;
  navigator?: Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  clients: {
    claim: () => Promise<void>;
    matchAll: (options?: {
      type?: 'window' | 'worker' | 'sharedworker' | 'all';
      includeUncontrolled?: boolean;
    }) => Promise<SwWindowClient[]>;
    openWindow: (url: string) => Promise<SwWindowClient | null>;
  };
  skipWaiting: () => Promise<void>;
  addEventListener: (
    type: string,
    listener: (event: unknown) => void
  ) => void;
}

interface SwExtendableEvent {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SwPushEvent extends SwExtendableEvent {
  data?: {
    json: () => unknown;
    text: () => string;
  } | null;
}

interface SwNotificationClickEvent extends SwExtendableEvent {
  notification: {
    data?: Record<string, unknown>;
    close: () => void;
  };
  action?: string;
}

interface SwMessageEvent extends SwExtendableEvent {
  data?: unknown;
}

const sw = self as unknown as SwGlobalScope;

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(sw.__WB_MANIFEST ?? []);

const SENSITIVE_HOSTS = new Set([
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseremoteconfig.googleapis.com',
  'www.googleapis.com',
]);

function isSensitiveOrApiUrl(url: URL): boolean {
  if (url.pathname.startsWith('/api/')) return true;
  if (SENSITIVE_HOSTS.has(url.hostname)) return true;
  return false;
}

// Navigation requests: NetworkFirst with cached app shell and /offline.html fallback
registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' &&
    url.origin === sw.location.origin &&
    !url.pathname.startsWith('/api/'),
  async ({ event, request }) => {
    const strategy = new NetworkFirst({
      cacheName: 'lasued-pages-v1',
      networkTimeoutSeconds: 4,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 25,
          maxAgeSeconds: 24 * 60 * 60,
        }),
      ],
    });

    try {
      const response = await strategy.handle({ event, request });
      if (response) return response;
    } catch {
      // Fallback handled below
    }

    const cachedShell =
      (await matchPrecache('/index.html')) ??
      (await caches.match('/index.html')) ??
      (await caches.match('/'));
    if (cachedShell) {
      return cachedShell;
    }

    const offlineFallback =
      (await matchPrecache('/offline.html')) ??
      (await caches.match('/offline.html'));
    if (offlineFallback) {
      return offlineFallback;
    }

    return new Response(
      '<!doctype html><html lang="en"><body><h1>Offline</h1><p>LASUED Intel requires a connection right now.</p></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
);

// Google Fonts CSS stylesheets
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: 'lasued-google-fonts-styles-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

// Google Fonts font binaries
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'lasued-google-fonts-webfonts-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ],
  })
);

// Same-origin static assets & images (excluding /api/* and auth endpoints)
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    url.origin === sw.location.origin &&
    !isSensitiveOrApiUrl(url) &&
    (request.destination === 'image' ||
      request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font'),
  new StaleWhileRevalidate({
    cacheName: 'lasued-static-assets-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 14 * 24 * 60 * 60,
      }),
    ],
  })
);

function resolveSafeInternalPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    return '/?view=notifications';
  }
  const trimmed = rawPath.trim();
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) {
    return '/?view=notifications';
  }
  try {
    const parsed = new URL(trimmed, sw.location.origin);
    if (parsed.origin !== sw.location.origin) {
      return '/?view=notifications';
    }
    return `${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return '/?view=notifications';
  }
}

async function applyAppBadgeSafely(count: unknown): Promise<void> {
  if (typeof count !== 'number' || !Number.isFinite(count)) return;
  try {
    if (count <= 0) {
      await sw.navigator?.clearAppBadge?.();
    } else {
      await sw.navigator?.setAppBadge?.(Math.floor(count));
    }
  } catch {
    // App Badging API may be unavailable on the device
  }
}

sw.addEventListener('push', (rawEvent: unknown) => {
  const event = rawEvent as SwPushEvent;
  let payload: Record<string, unknown> = {};

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      try {
        const text = event.data.text();
        if (text) {
          payload = { body: text };
        }
      } catch {
        payload = {};
      }
    }
  }

  const eventType =
    typeof payload.eventType === 'string' ? payload.eventType : '';
  const isAnonymous =
    eventType === 'anonymous_reply' || payload.isAnonymous === true;

  const rawTitle =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim().slice(0, 140)
      : 'LASUED Intel';
  const title = isAnonymous
    ? rawTitle || 'New reply in The Unfiltered'
    : rawTitle;

  const rawBody =
    typeof payload.body === 'string' ? payload.body.trim().slice(0, 260) : '';
  const body =
    isAnonymous && rawBody
      ? rawBody
      : rawBody || 'Tap to view the latest update on LASUED Intel.';

  const targetPath = resolveSafeInternalPath(payload.targetPath);
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim().slice(0, 80)
      : undefined;

  const notificationPromise = Promise.all([
    applyAppBadgeSafely(payload.unreadCount),
    sw.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      ...(tag ? { tag, renotify: true } : {}),
      data: {
        targetPath,
        notificationId:
          typeof payload.notificationId === 'string'
            ? payload.notificationId
            : null,
        eventType,
      },
    }),
  ]);

  event.waitUntil(notificationPromise);
});

sw.addEventListener('notificationclick', (rawEvent: unknown) => {
  const event = rawEvent as SwNotificationClickEvent;
  event.notification.close();

  const targetPath = resolveSafeInternalPath(
    event.notification.data?.targetPath
  );
  const targetUrl = new URL(targetPath, sw.location.origin).toString();

  const focusOrOpen = (async () => {
    const windowClients = await sw.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const sameOriginClient =
      windowClients.find(
        (client) =>
          client.url.startsWith(sw.location.origin) &&
          client.visibilityState === 'visible'
      ) ??
      windowClients.find((client) => client.url.startsWith(sw.location.origin));

    if (sameOriginClient) {
      try {
        await sameOriginClient.focus();
      } catch {
        // Focus may be restricted on some OS versions; postMessage still routes
      }
      sameOriginClient.postMessage({
        type: 'LASUED_NAVIGATE_NOTIFICATION',
        targetPath,
      });
      return;
    }

    await sw.clients.openWindow(targetUrl);
  })();

  event.waitUntil(focusOrOpen);
});

sw.addEventListener('message', (rawEvent: unknown) => {
  const event = rawEvent as SwMessageEvent;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(sw.skipWaiting());
    return;
  }

  if (data.type === 'LASUED_SYNC_BADGE') {
    event.waitUntil(applyAppBadgeSafely(data.unreadCount));
    return;
  }

  if (data.type === 'LASUED_CLEAR_USER_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((name) => name === 'lasued-pages-v1')
            .map((name) => caches.delete(name))
        )
      )
    );
  }
});

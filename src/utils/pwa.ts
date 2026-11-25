import type { ActiveRoute, MarketplaceTab, ProfileTab } from '../types/platform';
import {
  normalizeRouteDestination,
  type NormalizedRouteDestination,
} from './navigationHistory';
import { parseLocationSearch } from './urlRouting';

export interface DeviceEnvironmentSnapshot {
  isIosOrIpadOs: boolean;
  isAndroid: boolean;
  isStandalone: boolean;
  isAppleSafari: boolean;
  hasNotificationApi: boolean;
  hasServiceWorkerApi: boolean;
  hasPushManagerApi: boolean;
  isSecureContext: boolean;
}

export interface PushCapabilityAssessment {
  supported: boolean;
  canShowEnableButton: boolean;
  isStandaloneRequiredOnIos: boolean;
  unsupportedReason: string | null;
}

export interface BrowserCapabilityInput {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  matchMediaStandalone?: boolean;
  navigatorStandalone?: boolean;
  referrer?: string;
  hasNotificationApi?: boolean;
  hasServiceWorkerApi?: boolean;
  hasPushManagerApi?: boolean;
  isSecureContext?: boolean;
  origin?: string;
}

export function formatUnreadBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  const normalized = Math.floor(count);
  if (normalized <= 0) return null;
  if (normalized > 999) return '999+';
  return String(normalized);
}

export function detectDeviceEnvironment(
  input?: BrowserCapabilityInput
): DeviceEnvironmentSnapshot {
  const ua =
    input?.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const platform =
    input?.platform ??
    (typeof navigator !== 'undefined' ? navigator.platform : '');
  const maxTouchPoints =
    input?.maxTouchPoints ??
    (typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : 0);

  const isIosDevice = /iPhone|iPad|iPod/i.test(ua);
  const isIpadDesktopUa = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const isIosOrIpadOs =
    isIosDevice || isIpadDesktopUa || /iPhone|iPad|iPod/i.test(platform);

  const isAndroid = /Android/i.test(ua);

  const matchMediaStandalone =
    input?.matchMediaStandalone ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches
      : false);

  const navigatorStandalone =
    input?.navigatorStandalone ??
    (typeof navigator !== 'undefined' &&
      Boolean(
        (navigator as Navigator & { standalone?: boolean }).standalone
      ));

  const referrer =
    input?.referrer ??
    (typeof document !== 'undefined' ? document.referrer : '');
  const isAndroidTwa = referrer.startsWith('android-app://');

  const isStandalone = Boolean(
    matchMediaStandalone || navigatorStandalone || isAndroidTwa
  );

  const isAppleSafari =
    /Safari/i.test(ua) &&
    !/Chrome|CriOS|EdgiOS|FxiOS|OPiOS|Android/i.test(ua);

  const hasNotificationApi =
    input?.hasNotificationApi ??
    (typeof window !== 'undefined' && 'Notification' in window);
  const hasServiceWorkerApi =
    input?.hasServiceWorkerApi ??
    (typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
  const hasPushManagerApi =
    input?.hasPushManagerApi ??
    (typeof window !== 'undefined' && 'PushManager' in window);

  const origin =
    input?.origin ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  const isLocalHostOrigin =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  const isSecureContext =
    input?.isSecureContext ??
    (typeof window !== 'undefined'
      ? Boolean(window.isSecureContext) || isLocalHostOrigin
      : false);

  return {
    isIosOrIpadOs,
    isAndroid,
    isStandalone,
    isAppleSafari,
    hasNotificationApi,
    hasServiceWorkerApi,
    hasPushManagerApi,
    isSecureContext,
  };
}

export function evaluatePushCapabilities(
  env: DeviceEnvironmentSnapshot
): PushCapabilityAssessment {
  if (!env.isSecureContext) {
    return {
      supported: false,
      canShowEnableButton: false,
      isStandaloneRequiredOnIos: false,
      unsupportedReason: 'Push notifications require a secure HTTPS connection.',
    };
  }

  if (env.isIosOrIpadOs && !env.isStandalone) {
    return {
      supported: false,
      canShowEnableButton: false,
      isStandaloneRequiredOnIos: true,
      unsupportedReason:
        'On iPhone and iPad, install LASUED Intel to your Home Screen and open the installed app to enable notifications.',
    };
  }

  if (
    !env.hasNotificationApi ||
    !env.hasServiceWorkerApi ||
    !env.hasPushManagerApi
  ) {
    return {
      supported: false,
      canShowEnableButton: false,
      isStandaloneRequiredOnIos: false,
      unsupportedReason:
        'This browser does not support Web Push notifications.',
    };
  }

  return {
    supported: true,
    canShowEnableButton: true,
    isStandaloneRequiredOnIos: false,
    unsupportedReason: null,
  };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const clean = base64String.trim();
  const padding = '='.repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
  const nodeBuffer = (
    globalThis as unknown as {
      Buffer?: {
        from: (input: string, encoding: string) => {
          toString: (encoding: string) => string;
        };
      };
    }
  ).Buffer;
  const rawData =
    typeof atob === 'function'
      ? atob(base64)
      : nodeBuffer
        ? nodeBuffer.from(base64, 'base64').toString('binary')
        : '';
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isValidVapidPublicKey(key?: string | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  return /^[A-Za-z0-9_-]{60,180}$/.test(trimmed);
}

export function isValidHttpsPushEndpoint(endpoint?: string | null): boolean {
  if (!endpoint || typeof endpoint !== 'string') return false;
  const trimmed = endpoint.trim();
  if (trimmed.length < 16 || trimmed.length > 1024) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function computeDeterministicPushSubscriptionId(
  endpoint: string
): Promise<string> {
  const trimmed = endpoint.trim();
  if (
    typeof crypto !== 'undefined' &&
    crypto.subtle &&
    typeof TextEncoder !== 'undefined'
  ) {
    const bytes = new TextEncoder().encode(trimmed);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `sub_${hex}`;
  }

  // Fallback FNV-1a double hash (strictly alphanumeric/underscore ID <= 128 chars)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `sub_${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export interface ParsedPushTargetNavigation {
  route: ActiveRoute;
  destination: NormalizedRouteDestination;
  normalizedUrl: string;
}

export function parseNotificationTargetUrl(
  rawTarget?: string | null,
  expectedOrigin?: string
): ParsedPushTargetNavigation | null {
  if (!rawTarget || typeof rawTarget !== 'string') {
    return null;
  }
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  // Reject dangerous or non-HTTP schemes
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return null;
  }

  let search: string;
  let pathname: string;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsedUrl = new URL(trimmed);
      if (
        expectedOrigin &&
        parsedUrl.origin.toLowerCase() !== expectedOrigin.toLowerCase()
      ) {
        return null;
      }
      search = parsedUrl.search;
      pathname = parsedUrl.pathname || '/';
    } catch {
      return null;
    }
  } else {
    try {
      const base = expectedOrigin || 'https://lasuedintel.com.ng';
      const parsedUrl = new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, base);
      search = parsedUrl.search;
      pathname = parsedUrl.pathname || '/';
    } catch {
      return null;
    }
  }

  const parsed = parseLocationSearch(search);
  const destination = normalizeRouteDestination({
    route: parsed.route,
    username: parsed.profileUsername,
    profileTab: parsed.profileTab as ProfileTab | null,
    searchScope: parsed.searchScope,
    searchQuery: parsed.searchQuery,
    opportunityId: parsed.opportunityId,
    eventId: parsed.eventId,
    postId: parsed.postId,
    commentId: parsed.commentId,
    listingId: parsed.listingId,
    marketplaceTab: parsed.marketplaceTab as MarketplaceTab,
    accountSection: parsed.accountSection,
  });

  return {
    route: destination.route,
    destination,
    normalizedUrl: `${pathname}${search}`,
  };
}

import { registerSW } from 'virtual:pwa-register';

let hasRegistered = false;
let updateServiceWorkerFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

/**
 * Registers the Workbox-powered Service Worker once at application startup.
 * Degrades silently when Service Workers are unsupported or blocked (e.g. private browsing).
 */
export function registerPwaServiceWorker(): void {
  if (hasRegistered) return;
  if (import.meta.env.DEV) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  hasRegistered = true;

  try {
    updateServiceWorkerFn = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        // Periodically check for updated SW bundles without interrupting active sessions
        window.setInterval(() => {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return;
          }
          void registration.update().catch(() => undefined);
        }, 60 * 60 * 1000);
      },
      onRegisterError() {
        // Non-blocking: web app remains fully usable without Service Worker
      },
    });
  } catch {
    // Ignore registration failures in restricted browser environments
  }
}

export async function triggerServiceWorkerUpdate(): Promise<void> {
  if (!updateServiceWorkerFn) return;
  await updateServiceWorkerFn(true);
}

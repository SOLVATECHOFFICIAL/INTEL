import { useCallback, useEffect, useState } from 'react';
import { detectDeviceEnvironment } from '../utils/pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'lasued_intel_pwa_install_dismissed_at';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function readDismissedState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export interface UsePWAInstallResult {
  canInstallNatively: boolean;
  isStandalone: boolean;
  isIosOrIpadOs: boolean;
  isIosInstallEligible: boolean;
  isInstallAvailable: boolean;
  isDismissed: boolean;
  isIosGuideOpen: boolean;
  installing: boolean;
  triggerInstall: () => Promise<'accepted' | 'dismissed' | 'ios_guide' | 'unavailable'>;
  closeIosGuide: () => void;
  dismissInstallPromo: () => void;
}

export function usePWAInstall(): UsePWAInstallResult {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(
    () => detectDeviceEnvironment().isStandalone
  );
  const [isIosOrIpadOs] = useState<boolean>(
    () => detectDeviceEnvironment().isIosOrIpadOs
  );
  const [isDismissed, setIsDismissed] = useState<boolean>(() =>
    readDismissedState()
  );
  const [isIosGuideOpen, setIsIosGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setIsIosGuideOpen(false);
    };

    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;
    const handleDisplayModeChange = () => {
      setIsStandalone(detectDeviceEnvironment().isStandalone);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery?.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const canInstallNatively = !isStandalone && Boolean(deferredPrompt);
  const isIosInstallEligible =
    !isStandalone && isIosOrIpadOs && !deferredPrompt;
  const isInstallAvailable =
    !isStandalone && (canInstallNatively || isIosInstallEligible);

  const triggerInstall = useCallback(async () => {
    if (isStandalone) return 'unavailable' as const;

    if (deferredPrompt) {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);
        if (choice.outcome === 'accepted') {
          setIsStandalone(true);
        }
        return choice.outcome;
      } catch {
        return 'dismissed' as const;
      } finally {
        setInstalling(false);
      }
    }

    if (isIosOrIpadOs) {
      setIsIosGuideOpen(true);
      return 'ios_guide' as const;
    }

    return 'unavailable' as const;
  }, [deferredPrompt, isIosOrIpadOs, isStandalone]);

  const closeIosGuide = useCallback(() => {
    setIsIosGuideOpen(false);
  }, []);

  const dismissInstallPromo = useCallback(() => {
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
      } catch {
        // Ignore quota errors
      }
    }
  }, []);

  return {
    canInstallNatively,
    isStandalone,
    isIosOrIpadOs,
    isIosInstallEligible,
    isInstallAvailable,
    isDismissed,
    isIosGuideOpen,
    installing,
    triggerInstall,
    closeIosGuide,
    dismissInstallPromo,
  };
}

import React, { useEffect } from 'react';
import { CheckCircle2, Download, Loader2, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export type PWAInstallControlVariant =
  | 'banner'
  | 'sidebar'
  | 'drawer'
  | 'settings';

interface PWAInstallControlProps {
  variant: PWAInstallControlVariant;
  onActionComplete?: () => void;
}

export const PWAInstallControl: React.FC<PWAInstallControlProps> = ({
  variant,
  onActionComplete,
}) => {
  const {
    isStandalone,
    isInstallAvailable,
    isIosInstallEligible,
    isDismissed,
    isIosGuideOpen,
    installing,
    triggerInstall,
    closeIosGuide,
    dismissInstallPromo,
  } = usePWAInstall();

  useEffect(() => {
    if (!isIosGuideOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeIosGuide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isIosGuideOpen, closeIosGuide]);

  if (isStandalone) {
    if (variant === 'settings') {
      return (
        <span
          data-testid="pwa-installed-indicator"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <CheckCircle2
            className="h-4 w-4 text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>App Installed</span>
        </span>
      );
    }
    return null;
  }

  if (!isInstallAvailable) {
    return null;
  }

  if (variant === 'banner' && isDismissed) {
    return null;
  }

  const installLabel = isIosInstallEligible
    ? 'Add to Home Screen'
    : 'Install LASUED Intel';

  const handleInstallClick = async () => {
    const result = await triggerInstall();
    if (result === 'accepted' || result === 'dismissed') {
      onActionComplete?.();
    }
  };

  const iosGuideModal = isIosGuideOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs dark:bg-black/75 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-install-guide-title"
      onClick={closeIosGuide}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="LASUED Intel app icon"
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
            />
            <div>
              <h2
                id="ios-install-guide-title"
                className="font-display text-base font-bold text-[#0B1A2E] dark:text-slate-100"
              >
                Install on iPhone &amp; iPad
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Add to your Home Screen for quick access.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeIosGuide}
            aria-label="Close installation instructions"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <ol className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 sm:text-sm">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white dark:bg-sky-600">
              1
            </span>
            <span>
              Tap{' '}
              <span className="inline-flex items-center gap-1 font-semibold text-[#1E88E5] dark:text-sky-400">
                <Share className="h-3.5 w-3.5" aria-hidden="true" />
                Share
              </span>{' '}
              in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white dark:bg-sky-600">
              2
            </span>
            <span>
              Scroll down and tap{' '}
              <strong className="font-semibold">Add to Home Screen</strong>.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white dark:bg-sky-600">
              3
            </span>
            <span>
              Open <strong className="font-semibold">LASUED Intel</strong> from
              your Home Screen.
            </span>
          </li>
        </ol>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={closeIosGuide}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0B1A2E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#132844] dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (variant === 'banner') {
    return (
      <>
        <div
          role="region"
          aria-label="Install LASUED Intel application"
          data-testid="pwa-install-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="LASUED Intel icon"
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
            />
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                LASUED Intel App
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {isIosInstallEligible
                  ? 'Add LASUED Intel to your Home Screen.'
                  : 'Install for quick launch and offline access.'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstallClick()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500 sm:text-sm"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{installLabel}</span>
            </button>

            <button
              type="button"
              onClick={dismissInstallPromo}
              aria-label="Dismiss install banner"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {iosGuideModal}
      </>
    );
  }

  if (variant === 'sidebar') {
    return (
      <>
        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            disabled={installing}
            onClick={() => void handleInstallClick()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1A2E] px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#132844] disabled:opacity-60 dark:border dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            {installing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
            )}
            <span>{installLabel}</span>
          </button>
        </div>
        {iosGuideModal}
      </>
    );
  }

  if (variant === 'drawer') {
    return (
      <>
        <button
          type="button"
          disabled={installing}
          onClick={() => void handleInstallClick()}
          className="flex min-h-[48px] w-full items-center justify-between rounded-xl bg-[#0B1A2E] px-3.5 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-[#132844] disabled:opacity-60 dark:border dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
        >
          <span className="flex items-center gap-3">
            {installing ? (
              <Loader2
                className="h-4 w-4 animate-spin text-[#1E88E5] dark:text-sky-400"
                aria-hidden="true"
              />
            ) : (
              <Smartphone
                className="h-4 w-4 text-[#1E88E5] dark:text-sky-400"
                aria-hidden="true"
              />
            )}
            <span>{installLabel}</span>
          </span>
        </button>
        {iosGuideModal}
      </>
    );
  }

  // settings variant
  return (
    <>
      <button
        type="button"
        disabled={installing}
        onClick={() => void handleInstallClick()}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500 sm:text-sm"
      >
        {installing ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4 text-[#1E88E5] dark:text-white" aria-hidden="true" />
        )}
        <span>{installLabel}</span>
      </button>
      {iosGuideModal}
    </>
  );
};

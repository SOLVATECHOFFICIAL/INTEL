import React, { useEffect } from 'react';
import { Download, Loader2, Share, Smartphone, X } from 'lucide-react';
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

  if (isStandalone || !isInstallAvailable) {
    return null;
  }

  if (variant === 'banner' && isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    const result = await triggerInstall();
    if (result === 'accepted' || result === 'dismissed') {
      onActionComplete?.();
    }
  };

  const iosGuideModal = isIosGuideOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-install-guide-title"
      onClick={closeIosGuide}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="LASUED Intel app icon"
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 object-cover"
            />
            <div>
              <h2
                id="ios-install-guide-title"
                className="font-display text-base font-bold text-[#0B1A2E]"
              >
                Install LASUED Intel on iPhone &amp; iPad
              </h2>
              <p className="text-xs text-slate-600">
                Add to your Home Screen for the full app experience.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeIosGuide}
            aria-label="Close installation instructions"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <ol className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-[#0B1A2E] sm:text-sm">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white">
              1
            </span>
            <span>
              Tap the{' '}
              <span className="inline-flex items-center gap-1 font-semibold text-[#1E88E5]">
                <Share className="h-3.5 w-3.5" aria-hidden="true" />
                Share
              </span>{' '}
              button in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white">
              2
            </span>
            <span>
              Scroll down and choose{' '}
              <strong className="font-semibold">Add to Home Screen</strong>.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-[11px] font-bold text-white">
              3
            </span>
            <span>
              Open <strong className="font-semibold">LASUED Intel</strong> from
              your Home Screen to launch full screen and unlock notifications on
              iOS 16.4+.
            </span>
          </li>
        </ol>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={closeIosGuide}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0B1A2E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#132844]"
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs"
        >
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="LASUED Intel icon"
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover"
            />
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#0B1A2E]">
                LASUED Intel App
              </p>
              <p className="text-xs text-slate-600">
                {isIosInstallEligible
                  ? 'Add LASUED Intel to your Home Screen for faster app-style access.'
                  : 'Install for quick launch, offline reading, and push updates.'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstallClick()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] disabled:opacity-60 sm:text-sm"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Install LASUED Intel</span>
            </button>

            <button
              type="button"
              onClick={dismissInstallPromo}
              aria-label="Dismiss install banner"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
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
        <div className="border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={installing}
            onClick={() => void handleInstallClick()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1A2E] px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#132844] disabled:opacity-60"
          >
            {installing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>Install LASUED Intel</span>
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
          className="flex min-h-[48px] w-full items-center justify-between rounded-xl bg-[#0B1A2E] px-3.5 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-[#132844] disabled:opacity-60"
        >
          <span className="flex items-center gap-3">
            {installing ? (
              <Loader2
                className="h-4 w-4 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
            ) : (
              <Smartphone
                className="h-4 w-4 text-[#1E88E5]"
                aria-hidden="true"
              />
            )}
            <span>Install LASUED Intel</span>
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
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844] disabled:opacity-60 sm:text-sm"
      >
        {installing ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
        )}
        <span>Install LASUED Intel</span>
      </button>
      {iosGuideModal}
    </>
  );
};

import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Info,
  Loader2,
  Smartphone,
  X,
} from 'lucide-react';
import { useWebPushNotifications } from '../../hooks/useWebPushNotifications';
import {
  fetchPushConfigDiagnostics,
  type ServerPushDiagnostics,
} from '../../services/webPush';
import { PWAInstallControl } from './PWAInstallControl';

export type WebPushButtonVariant = 'inline' | 'compact' | 'full' | 'banner';

const PUSH_BANNER_DISMISS_KEY = 'lasued_intel_push_banner_dismissed_at';
const PUSH_BANNER_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readBannerDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(PUSH_BANNER_DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < PUSH_BANNER_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

interface WebPushNotificationButtonProps {
  variant?: WebPushButtonVariant;
  allowDisable?: boolean;
  showIosHint?: boolean;
  hideWhenEnabled?: boolean;
  dismissible?: boolean;
  onlyWhenPromptable?: boolean;
  allCategoriesDisabled?: boolean;
}

export const WebPushNotificationButton: React.FC<
  WebPushNotificationButtonProps
> = ({
  variant = 'inline',
  allowDisable = false,
  showIosHint = false,
  hideWhenEnabled = false,
  dismissible = false,
  onlyWhenPromptable = false,
  allCategoriesDisabled = false,
}) => {
  const {
    capability,
    status,
    permission,
    vapidConfigured,
    errorMessage,
    enableNotifications,
    disableNotifications,
    clearError,
  } = useWebPushNotifications();

  const [dismissed, setDismissed] = useState<boolean>(() =>
    dismissible ? readBannerDismissed() : false
  );
  const [diagnostics, setDiagnostics] = useState<ServerPushDiagnostics | null>(
    null
  );

  useEffect(() => {
    if (status !== 'server_unconfigured' || variant === 'compact') {
      return;
    }
    let active = true;
    void fetchPushConfigDiagnostics().then((res) => {
      if (active && res) {
        setDiagnostics(res);
      }
    });
    return () => {
      active = false;
    };
  }, [status, variant]);

  if (dismissible && dismissed) {
    return null;
  }

  if (status === 'hidden' || status === 'checking') {
    return null;
  }

  if (onlyWhenPromptable && status !== 'ready_to_enable' && status !== 'enabling') {
    return null;
  }

  if (status === 'enabled' && hideWhenEnabled) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PUSH_BANNER_DISMISS_KEY, String(Date.now()));
      } catch {
        // Ignore storage quota errors
      }
    }
  };

  if (status === 'opted_out' || allCategoriesDisabled) {
    if (!allowDisable || variant === 'compact' || variant === 'banner') {
      return null;
    }
    return (
      <div
        data-testid="web-push-opted-out-notice"
        className="flex flex-col justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-2.5">
          <BellOff
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-[#0B1A2E] dark:text-slate-100">
              {allCategoriesDisabled
                ? 'Notification alerts turned off'
                : 'Device notifications turned off'}
            </p>
            <p className="mt-0.5 leading-relaxed text-slate-600 dark:text-slate-400">
              {allCategoriesDisabled
                ? 'All notification categories above are turned off.'
                : 'Push alerts are off on this device.'}
            </p>
          </div>
        </div>
        {!allCategoriesDisabled && (
          <button
            type="button"
            onClick={() => {
              clearError();
              void enableNotifications();
            }}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Bell className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
            <span>Turn back on</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'ios_install_required') {
    if (!showIosHint && variant !== 'banner' && variant !== 'full') {
      return null;
    }
    return (
      <div
        data-testid="web-push-ios-install-hint"
        className="flex flex-col justify-between gap-3 rounded-xl border border-[#1E88E5]/25 bg-sky-50/70 p-3.5 text-xs text-[#0B1A2E] dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-slate-100 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-2.5">
          <Smartphone
            className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5] dark:text-sky-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Add to Home Screen for iPhone notifications
            </p>
            <p className="mt-0.5 leading-relaxed text-slate-600 dark:text-slate-300">
              Tap Safari Share &rarr; Add to Home Screen, then open the installed
              app to enable alerts.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <PWAInstallControl variant="settings" />
        </div>
      </div>
    );
  }

  if (status === 'unsupported') {
    if (variant === 'compact') {
      return null;
    }
    return (
      <div
        data-testid="web-push-unsupported-notice"
        className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <span>
          {capability.unsupportedReason ||
            'Browser push notifications are unavailable here, though in-app alerts still work.'}
        </span>
      </div>
    );
  }

  if (status === 'server_unconfigured') {
    if (variant === 'compact') {
      return null;
    }
    return (
      <div
        data-testid="web-push-unconfigured-notice"
        className="flex flex-col justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-2.5">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              {permission === 'granted'
                ? 'Browser Alerts Allowed — Awaiting Server Push Keys'
                : 'Device push alerts await server setup'}
            </p>
            <p className="mt-0.5 leading-relaxed text-amber-900/90 dark:text-amber-200/90">
              In-app alerts are active. Background push activates once server
              push keys are configured.
            </p>
            {diagnostics && diagnostics.missingItems.length > 0 && (
              <p className="mt-1 text-[11px] font-medium text-amber-950 dark:text-amber-200">
                Missing server env:{' '}
                <span className="font-mono">
                  {diagnostics.missingItems.join(', ')}
                </span>
              </p>
            )}
          </div>
        </div>

        {(allowDisable || variant === 'banner') && (
          <button
            type="button"
            onClick={() => void disableNotifications()}
            data-testid="turn-off-device-notifications-button"
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 self-start rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-100/60 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-100 dark:hover:bg-amber-900/60 sm:self-center"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Turn off on this device</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'denied') {
    if (variant === 'compact') {
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
          Push notifications are blocked in your browser settings.
        </div>
      );
    }

    return (
      <div
        data-testid="web-push-denied-notice"
        className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300"
      >
        <BellOff
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[#0B1A2E] dark:text-slate-100">
            Notifications blocked in browser settings
          </p>
          <p className="mt-0.5 leading-relaxed text-slate-600 dark:text-slate-400">
            To allow push alerts later, turn notifications back on in your
            browser site settings and refresh.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'enabled') {
    if (variant === 'compact') {
      return (
        <div className="flex min-h-[46px] w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs font-semibold text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span className="flex items-center gap-2.5">
            <CheckCircle2
              className="h-4 w-4 text-emerald-700 dark:text-emerald-400"
              aria-hidden="true"
            />
            <span>Notifications Enabled</span>
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="web-push-enabled-badge"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <CheckCircle2
            className="h-4 w-4 text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>Notifications Enabled</span>
        </span>

        {allowDisable && (
          <button
            type="button"
            onClick={() => void disableNotifications()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Turn off on this device</span>
          </button>
        )}
      </div>
    );
  }

  const isEnabling = status === 'enabling';
  const showVapidPendingHint = vapidConfigured === false;

  if (variant === 'banner') {
    return (
      <div
        data-testid="web-push-setup-banner"
        className="flex flex-col justify-between gap-3 rounded-xl border border-[#1E88E5]/25 bg-[#1E88E5]/[0.05] p-3.5 dark:border-sky-500/30 dark:bg-sky-950/30 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-2.5">
          <Bell
            className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5] dark:text-sky-400"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs font-bold text-[#0B1A2E] dark:text-slate-100 sm:text-sm">
              Allow device notifications
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Get alerts for replies, mentions, followers, and campus news.
            </p>
            {showVapidPendingHint && !errorMessage && (
              <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                Server push keys are not set yet; you can still enable browser
                permission now.
              </p>
            )}
            {errorMessage && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">
                {errorMessage}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={isEnabling}
            onClick={() => {
              clearError();
              void enableNotifications();
            }}
            data-testid="enable-notifications-button"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500 sm:text-sm"
          >
            {isEnabling ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bell className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isEnabling ? 'Requesting...' : 'Allow Notifications'}</span>
          </button>

          {dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss notification prompt"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled={isEnabling}
          onClick={() => {
            clearError();
            void enableNotifications();
          }}
          data-testid="enable-notifications-compact-button"
          className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/10 px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] transition-colors hover:bg-[#1E88E5]/15 disabled:opacity-60 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-slate-100 dark:hover:bg-sky-900/50"
        >
          <span className="flex items-center gap-3">
            {isEnabling ? (
              <Loader2
                className="h-4 w-4 animate-spin text-[#1E88E5] dark:text-sky-400"
                aria-hidden="true"
              />
            ) : (
              <Bell className="h-4 w-4 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
            )}
            <span>{isEnabling ? 'Requesting...' : 'Allow Notifications'}</span>
          </span>
        </button>
        {errorMessage && (
          <p role="alert" className="px-1 text-xs font-medium text-red-700 dark:text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={isEnabling}
        onClick={() => {
          clearError();
          void enableNotifications();
        }}
        data-testid="enable-notifications-button"
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500 sm:text-sm"
      >
        {isEnabling ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Bell className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isEnabling ? 'Requesting...' : 'Allow Notifications'}</span>
      </button>

      {status === 'ready_to_enable' && (
        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
          Get instant alerts for replies, mentions, followers, and updates.
        </p>
      )}

      {showVapidPendingHint && !errorMessage && (
        <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
          Server push keys are not set yet; clicking still saves browser
          permission.
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
};


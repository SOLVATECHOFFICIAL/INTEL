import React from 'react';
import { Bell, BellOff, CheckCircle2, Loader2 } from 'lucide-react';
import { useWebPushNotifications } from '../../hooks/useWebPushNotifications';

export type WebPushButtonVariant = 'inline' | 'compact' | 'full';

interface WebPushNotificationButtonProps {
  variant?: WebPushButtonVariant;
  allowDisable?: boolean;
  showIosHint?: boolean;
}

export const WebPushNotificationButton: React.FC<
  WebPushNotificationButtonProps
> = ({ variant = 'inline', allowDisable = false, showIosHint = false }) => {
  const {
    capability,
    status,
    errorMessage,
    enableNotifications,
    disableNotifications,
    clearError,
  } = useWebPushNotifications();

  if (status === 'hidden') {
    if (showIosHint && capability.isStandaloneRequiredOnIos) {
      return (
        <p className="text-xs leading-relaxed text-slate-600">
          On iPhone and iPad, install LASUED Intel to your Home Screen and open
          the installed app to turn on push notifications.
        </p>
      );
    }
    return null;
  }

  if (status === 'denied') {
    if (variant === 'compact') {
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          Push notifications are blocked in your browser site settings.
        </div>
      );
    }

    return (
      <div className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
        <BellOff className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>Notifications blocked in browser settings</span>
      </div>
    );
  }

  if (status === 'enabled') {
    if (variant === 'compact') {
      return (
        <div className="flex min-h-[46px] w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs font-semibold text-emerald-900">
          <span className="flex items-center gap-2.5">
            <CheckCircle2
              className="h-4 w-4 text-emerald-700"
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
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2
            className="h-4 w-4 text-emerald-700"
            aria-hidden="true"
          />
          <span>Notifications Enabled</span>
        </span>

        {allowDisable && (
          <button
            type="button"
            onClick={() => void disableNotifications()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Turn off on this device</span>
          </button>
        )}
      </div>
    );
  }

  const isEnabling = status === 'enabling';

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
          className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/10 px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] transition-colors hover:bg-[#1E88E5]/15 disabled:opacity-60"
        >
          <span className="flex items-center gap-3">
            {isEnabling ? (
              <Loader2
                className="h-4 w-4 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
            ) : (
              <Bell className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>{isEnabling ? 'Enabling...' : 'Enable Notifications'}</span>
          </span>
        </button>
        {errorMessage && (
          <p role="alert" className="px-1 text-xs font-medium text-red-700">
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
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] disabled:opacity-60 sm:text-sm"
      >
        {isEnabling ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Bell className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isEnabling ? 'Enabling...' : 'Enable Notifications'}</span>
      </button>

      {errorMessage && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
};

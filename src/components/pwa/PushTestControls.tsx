import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Layers, Loader2 } from 'lucide-react';
import { useWebPushNotifications } from '../../hooks/useWebPushNotifications';
import {
  sendTestPushNotifications,
  type TestPushResult,
} from '../../services/webPush';

interface PushTestControlsProps {
  compact?: boolean;
}

export const PushTestControls: React.FC<PushTestControlsProps> = ({
  compact = false,
}) => {
  const { capability, status, permission, vapidConfigured } =
    useWebPushNotifications();
  const [sendingMode, setSendingMode] = useState<'single' | 'stack' | null>(
    null
  );
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const [result, setResult] = useState<TestPushResult | null>(null);

  useEffect(() => {
    if (countdownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCountdownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdownSeconds]);

  const canTest =
    capability.canShowEnableButton &&
    permission === 'granted' &&
    status !== 'opted_out' &&
    status !== 'hidden';

  if (!canTest) {
    return null;
  }

  const handleRunTest = async (mode: 'single' | 'stack') => {
    if (sendingMode) return;
    setResult(null);
    setSendingMode(mode);
    const delaySeconds = mode === 'stack' ? 6 : 0;
    const count = mode === 'stack' ? 3 : 1;
    if (delaySeconds > 0) {
      setCountdownSeconds(delaySeconds);
    }

    try {
      const outcome = await sendTestPushNotifications({
        count,
        delaySeconds,
      });
      setResult(outcome);
    } finally {
      setSendingMode(null);
      setCountdownSeconds(0);
    }
  };

  return (
    <div
      data-testid="push-test-controls"
      className={`rounded-xl border border-slate-200 bg-slate-50/70 ${
        compact ? 'p-3' : 'p-3.5'
      }`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#0B1A2E]">
            <BellRing className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            <span>Test Device Notification Bar</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
            {vapidConfigured
              ? 'Tap "Test 3-Alert Stack (6s)" then close Chrome or switch off data for a moment—when data reconnects, all 3 alerts will pile up in your notification bar like WhatsApp.'
              : 'Notification permission is granted. You can test a local alert preview now; closed-browser & offline queuing starts once Vercel push keys finish deploying.'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={sendingMode !== null}
            onClick={() => void handleRunTest('single')}
            data-testid="test-single-notification-button"
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap transition-colors hover:bg-slate-100 disabled:opacity-60"
          >
            {sendingMode === 'single' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E88E5]" aria-hidden="true" />
            ) : (
              <BellRing className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>Send 1 Test Alert</span>
          </button>

          <button
            type="button"
            disabled={sendingMode !== null}
            onClick={() => void handleRunTest('stack')}
            data-testid="test-stack-notifications-button"
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844] disabled:opacity-60"
          >
            {sendingMode === 'stack' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E88E5]" aria-hidden="true" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>
              {sendingMode === 'stack' && countdownSeconds > 0
                ? `Sending in ${countdownSeconds}s...`
                : 'Test 3-Alert Stack (6s)'}
            </span>
          </button>
        </div>
      </div>

      {sendingMode === 'stack' && (
        <p
          role="status"
          data-testid="test-stack-countdown-notice"
          className="mt-2.5 rounded-lg border border-[#1E88E5]/25 bg-[#1E88E5]/[0.06] px-3 py-2 text-[11px] font-medium text-[#0B1A2E]"
        >
          Server timer started ({countdownSeconds > 0 ? `${countdownSeconds}s` : 'finishing'}) — minimize or close Chrome now, or turn off mobile data and switch it back on in ~15 seconds to watch 3 alerts stack up.
        </p>
      )}

      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          data-testid="test-notification-result"
          className={`mt-2.5 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium ${
            result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{result.message}</span>
        </p>
      )}
    </div>
  );
};

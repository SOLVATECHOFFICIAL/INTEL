import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MailCheck,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { requestEmailVerification } from '../../services/auth';
import { mapFirebaseAuthError } from '../../utils/authValidation';

interface EmailVerificationBannerProps {
  variant?: 'banner' | 'notification';
  className?: string;
}

const RESEND_COOLDOWN_SECONDS = 45;
const DISMISS_STORAGE_PREFIX = 'lasued_intel_verify_banner_dismissed_v1';

function readDismissedFromSession(uid: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.sessionStorage.getItem(`${DISMISS_STORAGE_PREFIX}:${uid}`) === '1'
    );
  } catch {
    return false;
  }
}

export const EmailVerificationBanner: React.FC<EmailVerificationBannerProps> = ({
  variant = 'banner',
  className = '',
}) => {
  const { authReady, user, isSuspended, refreshVerificationStatus } =
    useFirebase();
  const [dismissedUid, setDismissedUid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  if (!authReady || !user || !user.email || user.emailVerified) {
    return null;
  }

  const isDismissed =
    variant === 'banner' &&
    (dismissedUid === user.uid || readDismissedFromSession(user.uid));

  if (isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissedUid(user.uid);
    try {
      window.sessionStorage.setItem(
        `${DISMISS_STORAGE_PREFIX}:${user.uid}`,
        '1'
      );
    } catch {
      // Ignore sessionStorage errors
    }
  };

  const handleSendVerification = async () => {
    if (sending || cooldownSeconds > 0 || isSuspended) return;
    setSending(true);
    setFeedback(null);
    try {
      await requestEmailVerification(user);
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setFeedback({
        tone: 'success',
        text: `Verification link sent to ${user.email}. Check your Gmail inbox or Spam folder, click the link, then tap "I've Verified — Refresh".`,
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: mapFirebaseAuthError(error),
      });
    } finally {
      setSending(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setFeedback(null);
    try {
      const snapshot = await refreshVerificationStatus();
      if (!snapshot.user?.emailVerified) {
        setFeedback({
          tone: 'info',
          text: 'Your Gmail is not marked verified yet. Open the verification email in your inbox, click the confirmation link, then tap Refresh again.',
        });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: mapFirebaseAuthError(error),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const isNotificationVariant = variant === 'notification';

  return (
    <section
      role="region"
      aria-label="Verify your email address"
      data-testid={
        isNotificationVariant
          ? 'email-verification-notification-card'
          : 'email-verification-banner'
      }
      className={`relative overflow-hidden rounded-2xl border border-amber-300/70 bg-gradient-to-r from-[#0B1A2E] via-[#13315C] to-[#1E88E5] p-4 text-white shadow-lg sm:p-5 ${className}`}
    >
      {/* Crisp metallic sheen overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-amber-200/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-amber-300/15 blur-2xl"
      />

      <div className="relative z-10 flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/45 bg-amber-400/20 text-amber-300 shadow-inner">
            <MailCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/45 bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold tracking-wide text-amber-200 uppercase">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {isNotificationVariant ? 'Verification Notice' : 'Verify Gmail'}
              </span>
              <h2 className="font-display text-sm font-bold text-white sm:text-base">
                {isNotificationVariant
                  ? 'Confirm your Gmail address to unlock all campus features'
                  : 'Verify your email address to activate full posting & campus alerts'}
              </h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-sky-100 sm:text-sm">
              Signed in as{' '}
              <span className="font-semibold text-amber-200 break-all">
                {user.email}
              </span>
              . Open the verification email in your Gmail inbox (or check Spam /
              Promotions), or send a fresh link right now.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={sending || cooldownSeconds > 0 || isSuspended}
            onClick={() => void handleSendVerification()}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-[#0B1A2E] whitespace-nowrap shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-65 sm:text-sm"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {sending
                ? 'Sending...'
                : cooldownSeconds > 0
                  ? `Resend (${cooldownSeconds}s)`
                  : 'Send Verification Link'}
            </span>
          </button>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap transition hover:bg-white/20 disabled:opacity-60 sm:text-sm"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {refreshing ? 'Checking...' : "I've Verified — Refresh"}
            </span>
          </button>

          {variant === 'banner' && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss email verification reminder for this session"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 bg-white/5 text-sky-100 transition hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={`relative z-10 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-medium sm:text-sm ${
            feedback.tone === 'success'
              ? 'border-emerald-300/50 bg-emerald-500/20 text-emerald-50'
              : feedback.tone === 'error'
                ? 'border-red-300/60 bg-red-500/25 text-red-50'
                : 'border-amber-300/50 bg-amber-400/15 text-amber-50'
          }`}
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{feedback.text}</span>
        </div>
      )}
    </section>
  );
};

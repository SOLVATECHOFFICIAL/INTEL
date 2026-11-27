import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
} from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { signInWithEmail } from '../../services/auth';
import {
  isFirebaseErrorCode,
  isValidEmailAddress,
  mapFirebaseAuthError,
} from '../../utils/authValidation';
import { ActiveRoute } from '../../types/platform';

interface LoginPageProps {
  returnRoute: ActiveRoute;
  onSuccess: (destination: ActiveRoute) => void;
  onNavigate: (route: ActiveRoute) => void;
  onBack?: () => void;
  onRefreshAccount: () => Promise<void>;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  returnRoute,
  onSuccess,
  onNavigate,
  onBack,
  onRefreshAccount,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmailLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setStatusMessage(null);

    if (!isValidEmailAddress(email)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Enter your account password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithEmail(email, password);
      await onRefreshAccount();
      onSuccess(returnRoute);
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordRecovery = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setStatusMessage(null);

    const normalizedEmail = email.trim();
    if (!isValidEmailAddress(normalizedEmail)) {
      setErrorMessage(
        'Enter the valid email address linked to your LASUED Intel account.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setStatusMessage(
        `If an account exists for ${normalizedEmail}, a Firebase password reset link has been sent. Check your inbox and spam folder.`
      );
    } catch (error) {
      // Prevent account enumeration while ensuring clear UX if Firebase returns user-not-found
      if (isFirebaseErrorCode(error, 'auth/user-not-found')) {
        setStatusMessage(
          `If an account exists for ${normalizedEmail}, a Firebase password reset link has been sent. Check your inbox and spam folder.`
        );
      } else {
        setErrorMessage(mapFirebaseAuthError(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="login-heading" className="mx-auto w-full max-w-md">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : onNavigate(returnRoute))}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <h1
          id="login-heading"
          className="font-display text-2xl font-bold tracking-tight text-[#0B1A2E] dark:text-white"
        >
          {mode === 'login' ? 'Sign in to LASUED Intel' : 'Reset password'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
          {mode === 'login'
            ? 'Enter your email and password to sign in.'
            : 'Enter your registered email and we will send a password reset link.'}
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        )}

        {mode === 'login' ? (
          <form
            onSubmit={handleEmailLogin}
            noValidate
            className="mt-6 space-y-4"
          >
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
              >
                Email address <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
                >
                  Password <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setStatusMessage(null);
                    setMode('forgot');
                  }}
                  className="min-h-[36px] px-1 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative mt-1.5">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex min-w-[44px] items-center justify-center text-slate-500 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1565C0] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={handlePasswordRecovery}
            noValidate
            className="mt-6 space-y-4"
          >
            <div>
              <label
                htmlFor="forgot-email"
                className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
              >
                Registered email <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Open the link in your email to set a new password, then sign in here.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1565C0] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {isSubmitting ? 'Sending reset link...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStatusMessage(null);
                setMode('login');
              }}
              className="flex min-h-[44px] w-full items-center justify-center text-sm font-medium text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
            >
              Back to Sign In
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          New to LASUED Intel?{' '}
          <button
            type="button"
            onClick={() => onNavigate('register')}
            className="font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            Create an account
          </button>
        </p>
      </div>
    </section>
  );
};

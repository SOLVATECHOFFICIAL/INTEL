import React from 'react';
import { Lock, LogIn, UserPlus } from 'lucide-react';
import { ActiveRoute } from '../../types/platform';

interface GuestPromptCardProps {
  title: string;
  description: string;
  returnRoute: ActiveRoute;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onDismiss?: () => void;
}

export const GuestPromptCard: React.FC<GuestPromptCardProps> = ({
  title,
  description,
  returnRoute,
  onRequireAuth,
  onDismiss,
}) => {
  return (
    <div
      role="region"
      aria-label="Account sign-in required"
      className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0B1A2E] text-white">
          <Lock className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-[#0B1A2E] sm:text-base">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {description}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onRequireAuth('login', returnRoute)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#1E88E5] px-4 py-2 text-sm font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0]"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onRequireAuth('register', returnRoute)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] whitespace-nowrap transition-colors hover:bg-slate-100"
            >
              <UserPlus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Create Account
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="min-h-[44px] px-3 text-sm font-medium text-slate-600 hover:text-[#0B1A2E]"
              >
                Continue browsing
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

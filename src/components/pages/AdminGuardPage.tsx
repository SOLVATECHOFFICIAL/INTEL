import React from 'react';
import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { ActiveRoute } from '../../types/platform';
import {
  canAccessAdminDashboard,
  getAccountTierDisplayLabel,
} from '../../utils/authValidation';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface AdminGuardPageProps {
  onNavigate: (route: ActiveRoute) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const AdminGuardPage: React.FC<AdminGuardPageProps> = ({
  onNavigate,
  onRequireAuth,
}) => {
  const { authReady, user, effectiveTier, isSuspended } = useFirebase();
  const hasAccess = canAccessAdminDashboard(effectiveTier, isSuspended);

  if (!authReady) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-200" />
      </section>
    );
  }

  if (!user) {
    return (
      <section
        aria-labelledby="admin-restricted-heading"
        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <h1
          id="admin-restricted-heading"
          className="font-display text-2xl font-bold text-[#0B1A2E]"
        >
          Administrator Access Required
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          This area is restricted to authorized LASUED Intel administrators.
        </p>
        <div className="mt-5">
          <GuestPromptCard
            title="Sign in with an authorized account"
            description="Public visitors cannot view administrative controls."
            returnRoute="admin"
            onRequireAuth={onRequireAuth}
          />
        </div>
      </section>
    );
  }

  if (!hasAccess) {
    return (
      <section
        aria-labelledby="admin-denied-heading"
        className="min-w-0 flex-1 rounded-2xl border border-red-200 bg-white p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1
              id="admin-denied-heading"
              className="font-display text-xl font-bold text-[#0B1A2E]"
            >
              Access Restricted
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Your account tier ({getAccountTierDisplayLabel(effectiveTier)}) does
              not have Supreme Admin or Owner permissions. Administrative
              endpoints and dashboard tools are strictly enforced by Firestore
              Security Rules and cannot be unlocked from the browser.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('for-you')}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132844]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Return to Campus Feed
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="admin-heading"
      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B1A2E] text-white">
          <ShieldCheck className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
        </div>
        <div>
          <h1
            id="admin-heading"
            className="font-display text-xl font-bold text-[#0B1A2E] sm:text-2xl"
          >
            Administrator Dashboard
          </h1>
          <p className="text-xs text-slate-500">
            Authenticated tier: {getAccountTierDisplayLabel(effectiveTier)}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        Your verified role record in Cloud Firestore grants administrative access.
        Moderation queues, badge management, and anonymous audit tools will be
        populated in the administrative tooling rollout.
      </p>
    </section>
  );
};

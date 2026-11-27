import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus, UserCheck, UserPlus } from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { formatFirestoreOrAppError } from '../utils/authValidation';
import {
  normalizeFollowUsername,
  resolveFollowButtonPresentation,
} from '../utils/followRelations';

interface TikTokFollowButtonProps {
  targetUsername: string;
  compact?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  onRequireAuth?: () => void;
  onFollowChange?: (nextFollowing: boolean) => void;
  className?: string;
}

export const TikTokFollowButton: React.FC<TikTokFollowButtonProps> = ({
  targetUsername,
  compact = true,
  fullWidth = false,
  disabled = false,
  onRequireAuth,
  onFollowChange,
  className = '',
}) => {
  const {
    user,
    isSuspended,
    getRelationshipState,
    pendingFollowUsernames,
    toggleFollow,
  } = useFirebase();

  const normalizedTarget = normalizeFollowUsername(targetUsername);
  const [errorTooltip, setErrorTooltip] = useState<string | null>(null);

  useEffect(() => {
    if (!errorTooltip) return;
    const timer = window.setTimeout(() => setErrorTooltip(null), 3500);
    return () => window.clearTimeout(timer);
  }, [errorTooltip]);

  if (!normalizedTarget) {
    return null;
  }

  const relationship = getRelationshipState(normalizedTarget);
  if (relationship === 'self') {
    return null;
  }

  const busy = pendingFollowUsernames.has(normalizedTarget);
  const presentation = resolveFollowButtonPresentation(
    relationship,
    normalizedTarget
  );

  const handleToggle = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setErrorTooltip(null);

    if (!user) {
      onRequireAuth?.();
      return;
    }
    if (isSuspended) {
      setErrorTooltip('Suspended accounts cannot follow or unfollow members.');
      return;
    }
    if (busy || disabled) return;

    try {
      const nextFollowing = await toggleFollow(normalizedTarget);
      onFollowChange?.(nextFollowing);
    } catch (err) {
      setErrorTooltip(
        formatFirestoreOrAppError(err, 'Could not update follow status.')
      );
    }
  };

  return (
    <div
      className={`relative inline-flex shrink-0 items-center ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      <button
        type="button"
        onClick={(e) => void handleToggle(e)}
        disabled={busy || disabled}
        aria-label={presentation.ariaLabel}
        aria-pressed={
          relationship === 'following' || relationship === 'friends'
        }
        title={presentation.title}
        data-follow-state={relationship}
        data-follow-target={normalizedTarget}
        className={`inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors disabled:opacity-60 ${
          compact
            ? 'min-h-[30px] px-2.5 py-1 text-[11px]'
            : 'min-h-[42px] px-4 py-2 text-xs sm:text-sm'
        } ${fullWidth ? 'w-full' : ''} ${
          relationship === 'friends'
            ? 'rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
            : relationship === 'following'
            ? 'rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            : relationship === 'follow_back'
            ? 'rounded-lg bg-[#1E88E5] text-white hover:bg-[#1565C0]'
            : 'rounded-lg bg-[#0B1A2E] text-white hover:bg-[#132844] dark:bg-sky-600 dark:hover:bg-sky-500'
        } ${className}`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : relationship === 'friends' ? (
          <UserCheck
            className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          />
        ) : relationship === 'following' ? (
          <Check className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
        ) : relationship === 'follow_back' ? (
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{presentation.label}</span>
      </button>

      {errorTooltip && (
        <div
          role="alert"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] font-medium text-red-800 shadow-lg dark:border-red-900/60 dark:bg-red-950 dark:text-red-300"
        >
          {errorTooltip}
        </div>
      )}
    </div>
  );
};

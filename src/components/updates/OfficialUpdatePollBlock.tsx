import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import {
  castOrChangeOfficialPollVote,
  fetchOfficialPollWithViewerVote,
  toggleOfficialPollStatus,
} from '../../services/officialPolls';
import type {
  CampusPoll,
  PollVoteRecord,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  formatFirestoreOrAppError,
  type EffectiveAccountTier,
} from '../../utils/authValidation';
import {
  canUserVoteInPoll,
  canViewPollResults,
  computePollPercentages,
  formatPollExpirySummary,
} from '../../utils/polls';

export interface OfficialUpdatePollBlockProps {
  updateId: string;
  pollId: string;
  viewerUid: string | null;
  viewerTier: EffectiveAccountTier;
  viewerSuspended: boolean;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  returnRoute?: ActiveRoute;
}

export const OfficialUpdatePollBlock: React.FC<OfficialUpdatePollBlockProps> = ({
  updateId,
  pollId,
  viewerUid,
  viewerTier,
  viewerSuspended,
  onRequireAuth,
  returnRoute = 'updates',
}) => {
  const requestKey = `${pollId}:${viewerUid ?? 'guest'}`;
  const [poll, setPoll] = useState<CampusPoll | null>(null);
  const [viewerVote, setViewerVote] = useState<PollVoteRecord | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [editingVote, setEditingVote] = useState(false);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [guestPrompt, setGuestPrompt] = useState(false);

  const voteLockRef = useRef(false);
  const isSupremeAdmin = viewerTier === 'supreme_admin' && !viewerSuspended;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let active = true;

    void fetchOfficialPollWithViewerVote(pollId, viewerUid)
      .then((bundle) => {
        if (!active) return;
        setPoll(bundle.poll);
        setViewerVote(bundle.viewerVote);
        setSelectedIndices(bundle.viewerVote?.selectedIndices ?? []);
        setEditingVote(false);
        setErrorMessage(null);
        setNowMs(Date.now());
      })
      .catch(() => {
        if (!active) return;
        setPoll(null);
      })
      .finally(() => {
        if (active) setLoadedKey(requestKey);
      });

    return () => {
      active = false;
    };
  }, [pollId, requestKey, viewerUid]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return subscribeCacheMutations((event) => {
      if (
        event.type === 'official_poll_mutated' &&
        event.poll.id === pollId
      ) {
        setPoll(event.poll);
        setNowMs(Date.now());
      } else if (
        event.type === 'official_poll_deleted' &&
        event.pollId === pollId
      ) {
        setPoll(null);
        setViewerVote(null);
      }
    });
  }, [pollId]);

  if (loading) {
    return (
      <div
        className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
        data-testid={`official-poll-loading-${pollId}`}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E88E5]" />
          Loading official poll...
        </div>
      </div>
    );
  }

  if (!poll) {
    return null;
  }

  const hasVoted = Boolean(viewerVote && viewerVote.selectedIndices.length > 0);
  const voteEligibility = canUserVoteInPoll({
    poll,
    viewerUid,
    viewerTier,
    viewerSuspended,
    existingVote: viewerVote,
    nowMs,
  });

  const canInteractWithOptions =
    !viewerUid
      ? poll.status === 'open' && !formatPollExpirySummary(poll.expiresAt, poll.status, nowMs).includes('Expired')
      : voteEligibility.allowed && (!hasVoted || editingVote);

  const showResults = canViewPollResults({
    poll,
    hasVoted,
    viewerTier,
    viewerSuspended,
    nowMs,
  });

  const percentages = computePollPercentages(poll.optionCounts, poll.totalVotes);
  const expiryLabel = formatPollExpirySummary(poll.expiresAt, poll.status, nowMs);
  const maxVotesInOption = Math.max(0, ...poll.optionCounts);

  const handleOptionToggle = (index: number) => {
    setErrorMessage(null);
    setGuestPrompt(false);

    if (!viewerUid) {
      setGuestPrompt(true);
      return;
    }

    if (!canInteractWithOptions) {
      return;
    }

    if (!poll.allowMultiple) {
      setSelectedIndices([index]);
      return;
    }

    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter((item) => item !== index));
      return;
    }
    if (selectedIndices.length >= poll.maxSelections) {
      setErrorMessage(
        `You can select up to ${poll.maxSelections} options in this poll.`
      );
      return;
    }
    setSelectedIndices([...selectedIndices, index].sort((a, b) => a - b));
  };

  const handleSubmitVote = async () => {
    setErrorMessage(null);
    setGuestPrompt(false);

    if (!viewerUid) {
      setGuestPrompt(true);
      return;
    }
    if (!voteEligibility.allowed) {
      setErrorMessage(
        voteEligibility.reason || 'You cannot vote on this official poll.'
      );
      return;
    }
    if (selectedIndices.length === 0) {
      setErrorMessage('Select at least one option to cast your vote.');
      return;
    }
    if (voteLockRef.current || submittingVote) return;

    voteLockRef.current = true;
    setSubmittingVote(true);

    try {
      const res = await castOrChangeOfficialPollVote({
        pollId: poll.id,
        updateId,
        actorUid: viewerUid,
        selectedIndices,
      });
      setPoll(res.poll);
      setViewerVote(res.vote);
      setSelectedIndices(res.vote.selectedIndices);
      setEditingVote(false);
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(err, 'Could not record your vote.')
      );
    } finally {
      voteLockRef.current = false;
      setSubmittingVote(false);
    }
  };

  const handleTogglePollStatus = async () => {
    if (!isSupremeAdmin || !viewerUid || togglingStatus) return;
    setTogglingStatus(true);
    setErrorMessage(null);
    try {
      const updated = await toggleOfficialPollStatus({
        poll,
        actorUid: viewerUid,
        actorRole: 'supreme_admin',
      });
      setPoll(updated);
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(err, 'Could not update poll status.')
      );
    } finally {
      setTogglingStatus(false);
    }
  };

  const isSelectionChanged =
    !hasVoted ||
    selectedIndices.length !== (viewerVote?.selectedIndices.length ?? 0) ||
    selectedIndices.some((val, i) => val !== viewerVote?.selectedIndices[i]);

  return (
    <div
      className="mt-3.5 rounded-xl border border-[#1E88E5]/25 bg-slate-50/80 p-3.5 sm:p-4"
      data-testid={`official-poll-card-${poll.id}`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0B1A2E] text-white">
            <BarChart3 className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wide text-[#1E88E5] uppercase">
              Official Poll
            </p>
            <h4 className="mt-0.5 font-display text-sm font-bold leading-snug text-[#0B1A2E]">
              {poll.question}
            </h4>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
            poll.status === 'closed' || expiryLabel === 'Expired'
              ? 'bg-slate-200 text-slate-700'
              : 'bg-[#1E88E5]/10 text-[#0B1A2E]'
          }`}
        >
          <Clock className="h-3 w-3 text-[#1E88E5]" aria-hidden="true" />
          {expiryLabel}
        </span>
      </div>

      {/* Poll Rule Hints */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span>
          {poll.allowMultiple
            ? `Multiple choice (up to ${poll.maxSelections})`
            : 'Single choice'}
        </span>
        {poll.voterScope === 'verified_and_above' && (
          <span className="inline-flex items-center gap-1 font-medium text-[#0B1A2E]">
            <ShieldCheck className="h-3 w-3 text-[#1E88E5]" aria-hidden="true" />
            Verified+ voters only
          </span>
        )}
        {poll.resultsVisibility === 'after_vote' && !showResults && (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3 text-slate-400" aria-hidden="true" />
            Results visible after voting
          </span>
        )}
        {poll.resultsVisibility === 'after_close' && !showResults && (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3 text-slate-400" aria-hidden="true" />
            Results unlock when poll closes
          </span>
        )}
      </div>

      {/* Options */}
      <div className="mt-3 space-y-2">
        {poll.options.map((optionLabel, idx) => {
          const isVotedByUser = viewerVote?.selectedIndices.includes(idx) ?? false;
          const isDraftSelected = selectedIndices.includes(idx);
          const count = poll.optionCounts[idx] ?? 0;
          const pct = percentages[idx] ?? 0;
          const isLeading =
            showResults && poll.totalVotes > 0 && count === maxVotesInOption;

          return (
            <button
              key={`${poll.id}-opt-${idx}`}
              type="button"
              disabled={submittingVote || (!canInteractWithOptions && Boolean(viewerUid))}
              onClick={() => handleOptionToggle(idx)}
              aria-pressed={canInteractWithOptions ? isDraftSelected : isVotedByUser}
              className={`relative w-full overflow-hidden rounded-lg border text-left transition-colors ${
                isDraftSelected && canInteractWithOptions
                  ? 'border-[#1E88E5] bg-white ring-1 ring-[#1E88E5]'
                  : isVotedByUser
                  ? 'border-[#1E88E5]/60 bg-white'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } disabled:cursor-default`}
            >
              {showResults && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 left-0 transition-all duration-300 ${
                    isVotedByUser
                      ? 'bg-[#1E88E5]/16'
                      : isLeading
                      ? 'bg-[#0B1A2E]/8'
                      : 'bg-slate-200/55'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              )}

              <div className="relative z-10 flex min-h-[40px] items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] ${
                      poll.allowMultiple ? 'rounded' : 'rounded-full'
                    } ${
                      (canInteractWithOptions ? isDraftSelected : isVotedByUser)
                        ? 'border-[#1E88E5] bg-[#1E88E5] text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {(canInteractWithOptions ? isDraftSelected : isVotedByUser) && (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                  </span>
                  <span className="truncate text-xs font-semibold text-[#0B1A2E] sm:text-sm">
                    {optionLabel}
                  </span>
                </div>

                {showResults && (
                  <div className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                    <span className="font-bold text-[#0B1A2E]">{pct}%</span>
                    <span className="text-[11px] text-slate-500">({count})</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Action Buttons Row */}
      {viewerUid && canInteractWithOptions && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              submittingVote ||
              selectedIndices.length === 0 ||
              (hasVoted && !isSelectionChanged)
            }
            onClick={() => void handleSubmitVote()}
            data-testid={`official-poll-vote-btn-${poll.id}`}
            className="lasued-action-gradient inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            {submittingVote && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            <span>{hasVoted ? 'Save Vote Change' : 'Submit Vote'}</span>
          </button>

          {editingVote && (
            <button
              type="button"
              disabled={submittingVote}
              onClick={() => {
                setEditingVote(false);
                setSelectedIndices(viewerVote?.selectedIndices ?? []);
                setErrorMessage(null);
              }}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {!viewerUid && guestPrompt && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
          <span>Sign in with your LASUED Intel account to cast your vote.</span>
          <button
            type="button"
            onClick={() => onRequireAuth('login', returnRoute)}
            className="font-semibold text-[#1E88E5] hover:underline"
          >
            Sign In
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {/* Footer Meta & Admin Quick Controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[#0B1A2E] tabular-nums">
            {poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}
          </span>
          {hasVoted && !editingVote && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#1E88E5]">Your vote recorded</span>
              {poll.allowVoteChange && voteEligibility.allowed && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingVote(true);
                    setErrorMessage(null);
                  }}
                  className="inline-flex items-center gap-1 font-semibold text-[#0B1A2E] underline-offset-2 hover:text-[#1E88E5] hover:underline"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Change vote
                </button>
              )}
            </>
          )}
          {viewerUid && !hasVoted && !voteEligibility.allowed && voteEligibility.reason && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-600">{voteEligibility.reason}</span>
            </>
          )}
        </div>

        {isSupremeAdmin && (
          <button
            type="button"
            disabled={togglingStatus}
            onClick={() => void handleTogglePollStatus()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-50"
          >
            {togglingStatus && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            <span>{poll.status === 'open' ? 'Close Poll' : 'Reopen Poll'}</span>
          </button>
        )}
      </div>
    </div>
  );
};

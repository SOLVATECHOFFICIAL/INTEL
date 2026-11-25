import {
  BLUEPRINT_LIMITS,
  type CampusPoll,
  type PollResultsVisibility,
  type PollVoterScope,
  type PollVoteRecord,
} from '../types/database';
import type { EffectiveAccountTier } from './authValidation';
import { extractTimestampMs } from './contextualSearch';

export interface OfficialPollDraftInput {
  question: string;
  description?: string;
  options: readonly string[];
  allowMultiple: boolean;
  maxSelections: number;
  allowVoteChange: boolean;
  voterScope: PollVoterScope;
  resultsVisibility: PollResultsVisibility;
  expiresAtMs: number;
}

export interface NormalizedPollDraft {
  question: string;
  description?: string;
  options: string[];
  allowMultiple: boolean;
  maxSelections: number;
  allowVoteChange: boolean;
  voterScope: PollVoterScope;
  resultsVisibility: PollResultsVisibility;
  expiresAtMs: number;
}

export function clampPollMaxSelections(
  maxSelections: number,
  optionCount: number
): number {
  const safeCount = Math.max(BLUEPRINT_LIMITS.pollOptionsMin, Math.floor(optionCount || 2));
  const raw = Math.floor(Number(maxSelections || 2));
  return Math.max(2, Math.min(safeCount, raw));
}

export const POLL_DURATION_PRESETS = [
  { id: '24h', label: '24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { id: '3d', label: '3 days', durationMs: 3 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '14d', label: '14 days', durationMs: 14 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', durationMs: 30 * 24 * 60 * 60 * 1000 },
] as const;

export function normalizeAndValidatePollDraft(
  draft: OfficialPollDraftInput,
  options: { nowMs?: number; requireFutureExpiry?: boolean } = {}
): NormalizedPollDraft {
  const nowMs = options.nowMs ?? Date.now();
  const requireFutureExpiry = options.requireFutureExpiry ?? true;

  const cleanQuestion = draft.question.trim();
  if (
    cleanQuestion.length < BLUEPRINT_LIMITS.pollQuestionMin ||
    cleanQuestion.length > BLUEPRINT_LIMITS.pollQuestionMax
  ) {
    throw new Error(
      `Poll question must be ${BLUEPRINT_LIMITS.pollQuestionMin}–${BLUEPRINT_LIMITS.pollQuestionMax} characters.`
    );
  }

  const cleanDescription = (draft.description ?? '').trim();
  if (cleanDescription.length > BLUEPRINT_LIMITS.pollDescriptionMax) {
    throw new Error(
      `Poll description must be ${BLUEPRINT_LIMITS.pollDescriptionMax} characters or fewer.`
    );
  }

  const cleanOptions = draft.options
    .map((opt) => opt.trim())
    .filter((opt) => opt.length > 0);

  if (
    cleanOptions.length < BLUEPRINT_LIMITS.pollOptionsMin ||
    cleanOptions.length > BLUEPRINT_LIMITS.pollOptionsMax
  ) {
    throw new Error(
      `Official polls require between ${BLUEPRINT_LIMITS.pollOptionsMin} and ${BLUEPRINT_LIMITS.pollOptionsMax} non-empty options.`
    );
  }

  const seenOptions = new Set<string>();
  for (let i = 0; i < cleanOptions.length; i += 1) {
    const opt = cleanOptions[i];
    if (opt.length > BLUEPRINT_LIMITS.pollOptionMaxLength) {
      throw new Error(
        `Poll option ${i + 1} must be ${BLUEPRINT_LIMITS.pollOptionMaxLength} characters or fewer.`
      );
    }
    const lower = opt.toLowerCase();
    if (seenOptions.has(lower)) {
      throw new Error('Poll options must be distinct.');
    }
    seenOptions.add(lower);
  }

  const allowMultiple = Boolean(draft.allowMultiple);
  const maxSelections = allowMultiple
    ? Math.max(
        2,
        Math.min(cleanOptions.length, Math.floor(Number(draft.maxSelections || 2)))
      )
    : 1;

  if (!Number.isFinite(draft.expiresAtMs)) {
    throw new Error('Select a valid poll closing date and time.');
  }
  if (requireFutureExpiry && draft.expiresAtMs <= nowMs + 60 * 1000) {
    throw new Error('Poll closing time must be at least 1 minute in the future.');
  }

  const voterScope: PollVoterScope =
    draft.voterScope === 'verified_and_above'
      ? 'verified_and_above'
      : 'all_members';
  const resultsVisibility: PollResultsVisibility =
    draft.resultsVisibility === 'after_vote' ||
    draft.resultsVisibility === 'after_close'
      ? draft.resultsVisibility
      : 'always';

  return {
    question: cleanQuestion,
    ...(cleanDescription ? { description: cleanDescription } : {}),
    options: cleanOptions,
    allowMultiple,
    maxSelections: allowMultiple
      ? clampPollMaxSelections(maxSelections, cleanOptions.length)
      : 1,
    allowVoteChange: Boolean(draft.allowVoteChange),
    voterScope,
    resultsVisibility,
    expiresAtMs: Math.floor(draft.expiresAtMs),
  };
}

export function isPollExpired(
  poll: Pick<CampusPoll, 'expiresAt'>,
  nowMs: number = Date.now()
): boolean {
  const expMs = extractTimestampMs(poll.expiresAt);
  if (expMs === null) return false;
  return nowMs >= expMs;
}

export function isPollClosedOrExpired(
  poll: Pick<CampusPoll, 'status' | 'expiresAt'>,
  nowMs: number = Date.now()
): boolean {
  return poll.status !== 'open' || isPollExpired(poll, nowMs);
}

export function isViewerEligibleForPollScope(
  voterScope: PollVoterScope,
  viewerUid: string | null,
  viewerTier: EffectiveAccountTier,
  viewerSuspended: boolean
): boolean {
  if (!viewerUid || viewerSuspended || viewerTier === 'guest') {
    return false;
  }
  if (voterScope === 'all_members') {
    return true;
  }
  return (
    viewerTier === 'verified' ||
    viewerTier === 'moderator' ||
    viewerTier === 'supreme_admin'
  );
}

export function canUserVoteInPoll(input: {
  poll: Pick<CampusPoll, 'status' | 'expiresAt' | 'voterScope' | 'allowVoteChange'>;
  viewerUid: string | null;
  viewerTier: EffectiveAccountTier;
  viewerSuspended: boolean;
  existingVote: Pick<PollVoteRecord, 'selectedIndices'> | null;
  nowMs?: number;
}): { allowed: boolean; isChangingVote: boolean; reason?: string } {
  const nowMs = input.nowMs ?? Date.now();
  const hasExistingVote = Boolean(
    input.existingVote && input.existingVote.selectedIndices.length > 0
  );

  if (input.poll.status === 'closed') {
    return {
      allowed: false,
      isChangingVote: hasExistingVote,
      reason: 'This official poll has been closed by an administrator.',
    };
  }
  if (isPollExpired(input.poll, nowMs)) {
    return {
      allowed: false,
      isChangingVote: hasExistingVote,
      reason: 'Voting has ended because this official poll expired.',
    };
  }
  if (!input.viewerUid || input.viewerTier === 'guest') {
    return {
      allowed: false,
      isChangingVote: false,
      reason: 'Sign in with your LASUED Intel account to vote.',
    };
  }
  if (input.viewerSuspended) {
    return {
      allowed: false,
      isChangingVote: hasExistingVote,
      reason: 'Suspended accounts cannot vote in official polls.',
    };
  }
  if (
    !isViewerEligibleForPollScope(
      input.poll.voterScope,
      input.viewerUid,
      input.viewerTier,
      input.viewerSuspended
    )
  ) {
    return {
      allowed: false,
      isChangingVote: hasExistingVote,
      reason: 'This official poll is restricted to Verified, Moderator, and Admin members.',
    };
  }
  if (hasExistingVote && !input.poll.allowVoteChange) {
    return {
      allowed: false,
      isChangingVote: true,
      reason: 'Vote changes are disabled on this official poll.',
    };
  }

  return { allowed: true, isChangingVote: hasExistingVote };
}

export function canViewPollResults(input: {
  poll: Pick<CampusPoll, 'resultsVisibility' | 'status' | 'expiresAt'>;
  hasVoted: boolean;
  viewerTier: EffectiveAccountTier;
  viewerSuspended: boolean;
  nowMs?: number;
}): boolean {
  if (input.viewerTier === 'supreme_admin' && !input.viewerSuspended) {
    return true;
  }
  if (input.poll.resultsVisibility === 'always') {
    return true;
  }
  if (input.poll.resultsVisibility === 'after_vote') {
    return input.hasVoted || isPollClosedOrExpired(input.poll, input.nowMs);
  }
  // after_close
  return isPollClosedOrExpired(input.poll, input.nowMs);
}

export function normalizeSelectedIndices(
  indices: readonly number[],
  optionCount: number,
  maxSelections: number
): number[] {
  const unique = Array.from(
    new Set(
      indices.filter(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx < optionCount
      )
    )
  ).sort((a, b) => a - b);

  if (unique.length === 0) {
    throw new Error('Select at least one option to cast your vote.');
  }
  if (unique.length > maxSelections) {
    throw new Error(
      maxSelections === 1
        ? 'Select only 1 option on this poll.'
        : `Select at most ${maxSelections} options on this poll.`
    );
  }
  return unique;
}

export function computeNextPollCountsOnVote(input: {
  optionCount: number;
  currentCounts: readonly number[];
  currentTotalVotes: number;
  previousSelectedIndices: readonly number[];
  nextSelectedIndices: readonly number[];
}): { optionCounts: number[]; totalVotes: number } {
  const nextCounts = Array.from({ length: input.optionCount }, (_, idx) => {
    const raw = Number(input.currentCounts[idx] ?? 0);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  });

  const prevSet = new Set(input.previousSelectedIndices);
  const nextSet = new Set(input.nextSelectedIndices);

  for (let i = 0; i < input.optionCount; i += 1) {
    const wasSelected = prevSet.has(i);
    const isSelected = nextSet.has(i);
    if (!wasSelected && isSelected) {
      nextCounts[i] += 1;
    } else if (wasSelected && !isSelected) {
      nextCounts[i] = Math.max(0, nextCounts[i] - 1);
    }
  }

  const safePrevTotal =
    Number.isFinite(input.currentTotalVotes) && input.currentTotalVotes >= 0
      ? Math.floor(input.currentTotalVotes)
      : 0;
  const totalVotes =
    input.previousSelectedIndices.length === 0
      ? safePrevTotal + 1
      : safePrevTotal;

  return { optionCounts: nextCounts, totalVotes };
}

export function computePollPercentages(
  optionCounts: readonly number[],
  totalVotes: number
): number[] {
  if (!optionCounts.length) return [];
  const denominator =
    totalVotes > 0
      ? totalVotes
      : optionCounts.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (denominator <= 0) {
    return optionCounts.map(() => 0);
  }
  return optionCounts.map((count) => {
    const safe = Math.max(0, Number(count) || 0);
    return Math.min(100, Math.round((safe / denominator) * 100));
  });
}

export function formatPollExpirySummary(
  expiresAt: unknown,
  status: 'open' | 'closed',
  nowMs: number = Date.now()
): string {
  if (status === 'closed') {
    return 'Closed by Admin';
  }
  const expMs = extractTimestampMs(expiresAt);
  if (expMs === null) {
    return 'Open';
  }
  const diffMs = expMs - nowMs;
  if (diffMs <= 0) {
    return 'Expired';
  }
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 60) {
    return `Ends in ${Math.max(1, mins)}m`;
  }
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `Ends in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `Ends in ${days}d`;
}

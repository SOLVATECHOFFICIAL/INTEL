import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUserVoteInPoll,
  canViewPollResults,
  computeNextPollCountsOnVote,
  computePollPercentages,
  normalizeAndValidatePollDraft,
  normalizeSelectedIndices,
} from './polls';

test('normalizeAndValidatePollDraft enforces bounds, uniqueness, and single vs multi-choice limits', () => {
  const now = 1_700_000_000_000;
  const future = now + 24 * 60 * 60 * 1000;

  assert.throws(() =>
    normalizeAndValidatePollDraft(
      {
        question: 'Too',
        options: ['Yes', 'No'],
        allowMultiple: false,
        maxSelections: 1,
        allowVoteChange: false,
        voterScope: 'all_members',
        resultsVisibility: 'always',
        expiresAtMs: future,
      },
      { nowMs: now }
    )
  );

  assert.throws(() =>
    normalizeAndValidatePollDraft(
      {
        question: 'Duplicate check?',
        options: ['Option A', 'option a'],
        allowMultiple: false,
        maxSelections: 1,
        allowVoteChange: false,
        voterScope: 'all_members',
        resultsVisibility: 'always',
        expiresAtMs: future,
      },
      { nowMs: now }
    )
  );

  assert.throws(() =>
    normalizeAndValidatePollDraft(
      {
        question: 'Past expiry check?',
        options: ['Option A', 'Option B'],
        allowMultiple: false,
        maxSelections: 1,
        allowVoteChange: false,
        voterScope: 'all_members',
        resultsVisibility: 'always',
        expiresAtMs: now - 1000,
      },
      { nowMs: now }
    )
  );

  const normalized = normalizeAndValidatePollDraft(
    {
      question: '  Preferred exam hall schedule?  ',
      description: '   Applies across all 200L–400L CBT faculties.   ',
      options: [' Morning ', ' Afternoon ', ''],
      allowMultiple: true,
      maxSelections: 5,
      allowVoteChange: true,
      voterScope: 'verified_and_above',
      resultsVisibility: 'after_vote',
      expiresAtMs: future,
    },
    { nowMs: now }
  );

  assert.equal(normalized.question, 'Preferred exam hall schedule?');
  assert.equal(normalized.description, 'Applies across all 200L–400L CBT faculties.');
  assert.deepEqual(normalized.options, ['Morning', 'Afternoon']);
  assert.equal(normalized.maxSelections, 2);

  assert.throws(() =>
    normalizeAndValidatePollDraft(
      {
        question: 'Description cap check?',
        description: 'x'.repeat(301),
        options: ['Option A', 'Option B'],
        allowMultiple: false,
        maxSelections: 1,
        allowVoteChange: false,
        voterScope: 'all_members',
        resultsVisibility: 'always',
        expiresAtMs: future,
      },
      { nowMs: now }
    )
  );
});

test('canUserVoteInPoll enforces expiry, closed state, scope, suspension, and allowVoteChange', () => {
  const now = 1_700_000_000_000;
  const basePoll = {
    status: 'open' as const,
    expiresAt: now + 3600_000,
    voterScope: 'all_members' as const,
    allowVoteChange: false,
  };

  assert.equal(
    canUserVoteInPoll({
      poll: basePoll,
      viewerUid: null,
      viewerTier: 'guest',
      viewerSuspended: false,
      existingVote: null,
      nowMs: now,
    }).allowed,
    false
  );

  assert.equal(
    canUserVoteInPoll({
      poll: { ...basePoll, expiresAt: now - 1 },
      viewerUid: 'u1',
      viewerTier: 'member',
      viewerSuspended: false,
      existingVote: null,
      nowMs: now,
    }).allowed,
    false
  );

  assert.equal(
    canUserVoteInPoll({
      poll: { ...basePoll, status: 'closed' },
      viewerUid: 'u1',
      viewerTier: 'member',
      viewerSuspended: false,
      existingVote: null,
      nowMs: now,
    }).allowed,
    false
  );

  assert.equal(
    canUserVoteInPoll({
      poll: { ...basePoll, voterScope: 'verified_and_above' },
      viewerUid: 'u1',
      viewerTier: 'member',
      viewerSuspended: false,
      existingVote: null,
      nowMs: now,
    }).allowed,
    false
  );

  assert.equal(
    canUserVoteInPoll({
      poll: { ...basePoll, voterScope: 'verified_and_above' },
      viewerUid: 'u1',
      viewerTier: 'verified',
      viewerSuspended: false,
      existingVote: null,
      nowMs: now,
    }).allowed,
    true
  );

  // Duplicate vote disallowed when allowVoteChange is false
  assert.equal(
    canUserVoteInPoll({
      poll: basePoll,
      viewerUid: 'u1',
      viewerTier: 'member',
      viewerSuspended: false,
      existingVote: { selectedIndices: [0] },
      nowMs: now,
    }).allowed,
    false
  );

  // Vote change allowed when allowVoteChange is true
  const changeAllowed = canUserVoteInPoll({
    poll: { ...basePoll, allowVoteChange: true },
    viewerUid: 'u1',
    viewerTier: 'member',
    viewerSuspended: false,
    existingVote: { selectedIndices: [0] },
    nowMs: now,
  });
  assert.equal(changeAllowed.allowed, true);
  assert.equal(changeAllowed.isChangingVote, true);
});

test('canViewPollResults honors after_vote, after_close, and supreme_admin override', () => {
  const now = 1_700_000_000_000;
  const openAfterVote = {
    resultsVisibility: 'after_vote' as const,
    status: 'open' as const,
    expiresAt: now + 60_000,
  };
  assert.equal(
    canViewPollResults({
      poll: openAfterVote,
      hasVoted: false,
      viewerTier: 'member',
      viewerSuspended: false,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    canViewPollResults({
      poll: openAfterVote,
      hasVoted: true,
      viewerTier: 'member',
      viewerSuspended: false,
      nowMs: now,
    }),
    true
  );

  const openAfterClose = {
    resultsVisibility: 'after_close' as const,
    status: 'open' as const,
    expiresAt: now + 60_000,
  };
  assert.equal(
    canViewPollResults({
      poll: openAfterClose,
      hasVoted: true,
      viewerTier: 'member',
      viewerSuspended: false,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    canViewPollResults({
      poll: openAfterClose,
      hasVoted: false,
      viewerTier: 'supreme_admin',
      viewerSuspended: false,
      nowMs: now,
    }),
    true
  );
  assert.equal(
    canViewPollResults({
      poll: { ...openAfterClose, expiresAt: now - 1 },
      hasVoted: false,
      viewerTier: 'member',
      viewerSuspended: false,
      nowMs: now,
    }),
    true
  );
});

test('computeNextPollCountsOnVote and computePollPercentages maintain accurate vote tallies', () => {
  const sorted = normalizeSelectedIndices([2, 0, 2], 4, 2);
  assert.deepEqual(sorted, [0, 2]);

  const firstVote = computeNextPollCountsOnVote({
    optionCount: 3,
    currentCounts: [2, 1, 0],
    currentTotalVotes: 3,
    previousSelectedIndices: [],
    nextSelectedIndices: [1],
  });
  assert.deepEqual(firstVote, { optionCounts: [2, 2, 0], totalVotes: 4 });

  const changedVote = computeNextPollCountsOnVote({
    optionCount: 3,
    currentCounts: firstVote.optionCounts,
    currentTotalVotes: firstVote.totalVotes,
    previousSelectedIndices: [1],
    nextSelectedIndices: [0, 2],
  });
  assert.deepEqual(changedVote, { optionCounts: [3, 1, 1], totalVotes: 4 });

  assert.deepEqual(computePollPercentages([3, 1, 0], 4), [75, 25, 0]);
  assert.deepEqual(computePollPercentages([0, 0], 0), [0, 0]);
});

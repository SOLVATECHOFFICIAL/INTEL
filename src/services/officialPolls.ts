import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  SUBCOLLECTION_NAMES,
  isValidFirestoreId,
  type AdminAuditAction,
  type AdminUpdateAuthorMode,
  type CampusPoll,
  type PollVoteRecord,
  type UserRole,
} from '../types/database';
import { isDesignatedSupremeAdminUser, isFirebaseErrorCode } from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import {
  commitFreshWriteBatchWithRetry,
  isFirestoreSdkError,
  runWithFirestoreConnectionRetry,
} from '../utils/firestoreRetry';
import {
  computeNextPollCountsOnVote,
  normalizeAndValidatePollDraft,
  normalizeSelectedIndices,
  type OfficialPollDraftInput,
} from '../utils/polls';
import {
  notifyOfficialPollDeleted,
  notifyOfficialPollMutated,
} from './cacheInvalidation';
import { generateFirestoreDocId } from './mediaStorage';

export interface OfficialPollBundle {
  poll: CampusPoll | null;
  viewerVote: PollVoteRecord | null;
}

function attachPollAuditLogToBatch(
  batch: WriteBatch,
  input: {
    action: Extract<
      AdminAuditAction,
      'poll_created' | 'poll_updated' | 'poll_closed' | 'poll_deleted'
    >;
    pollId: string;
    targetLabel?: string;
    performedByUid: string;
    details?: string;
  }
): void {
  const logId = generateFirestoreDocId(COLLECTION_NAMES.adminAuditLogs);
  const cleanLabel = input.targetLabel?.trim().slice(0, 180);
  const cleanDetails = input.details
    ?.trim()
    .slice(0, BLUEPRINT_LIMITS.auditReasonMax);

  const payload: Record<string, unknown> = {
    id: logId,
    action: input.action,
    targetCollection: COLLECTION_NAMES.polls,
    targetId: input.pollId,
    performedByUid: input.performedByUid,
    performedByRole: 'supreme_admin',
    createdAt: serverTimestamp(),
  };
  if (cleanLabel) {
    payload.targetLabel = cleanLabel;
  }
  if (cleanDetails) {
    payload.details = cleanDetails;
  }

  batch.set(doc(db, COLLECTION_NAMES.adminAuditLogs, logId), payload);
}

export async function fetchOfficialPollById(
  pollId: string
): Promise<CampusPoll | null> {
  if (!isValidFirestoreId(pollId)) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.polls, pollId));
    return snap.exists() ? (snap.data() as CampusPoll) : null;
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(
      error,
      OperationType.GET,
      `${COLLECTION_NAMES.polls}/${pollId}`
    );
  }
}

export async function fetchOfficialPollWithViewerVote(
  pollId: string,
  viewerUid: string | null
): Promise<OfficialPollBundle> {
  if (!isValidFirestoreId(pollId)) {
    return { poll: null, viewerVote: null };
  }

  const poll = await fetchOfficialPollById(pollId);
  if (!poll) {
    return { poll: null, viewerVote: null };
  }

  if (!viewerUid || !isValidFirestoreId(viewerUid)) {
    return { poll, viewerVote: null };
  }

  try {
    const voteSnap = await getDoc(
      doc(
        db,
        COLLECTION_NAMES.polls,
        pollId,
        SUBCOLLECTION_NAMES.votes,
        viewerUid
      )
    );
    return {
      poll,
      viewerVote: voteSnap.exists() ? (voteSnap.data() as PollVoteRecord) : null,
    };
  } catch {
    return { poll, viewerVote: null };
  }
}

export function buildNewOfficialPollDocument(input: {
  pollId: string;
  updateId: string;
  authorMode: AdminUpdateAuthorMode;
  actorUid: string;
  draft: OfficialPollDraftInput;
}): {
  firestoreDoc: Record<string, unknown>;
  optimisticPoll: CampusPoll;
} {
  const normalized = normalizeAndValidatePollDraft(input.draft);
  const zeroCounts = normalized.options.map(() => 0);

  const firestoreDoc: Record<string, unknown> = {
    id: input.pollId,
    updateId: input.updateId,
    authorMode: input.authorMode,
    question: normalized.question,
    options: normalized.options,
    optionCounts: zeroCounts,
    totalVotes: 0,
    allowMultiple: normalized.allowMultiple,
    maxSelections: normalized.maxSelections,
    allowVoteChange: normalized.allowVoteChange,
    voterScope: normalized.voterScope,
    resultsVisibility: normalized.resultsVisibility,
    status: 'open',
    expiresAt: Timestamp.fromMillis(normalized.expiresAtMs),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.authorMode === 'public_admin') {
    firestoreDoc.ownerUID = input.actorUid;
  }

  const nowMs = Date.now();
  const optimisticPoll: CampusPoll = {
    id: input.pollId,
    updateId: input.updateId,
    authorMode: input.authorMode,
    ...(input.authorMode === 'public_admin' ? { ownerUID: input.actorUid } : {}),
    question: normalized.question,
    options: normalized.options,
    optionCounts: zeroCounts,
    totalVotes: 0,
    allowMultiple: normalized.allowMultiple,
    maxSelections: normalized.maxSelections,
    allowVoteChange: normalized.allowVoteChange,
    voterScope: normalized.voterScope,
    resultsVisibility: normalized.resultsVisibility,
    status: 'open',
    expiresAt: normalized.expiresAtMs,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  return { firestoreDoc, optimisticPoll };
}

export function attachCreatePollToBatch(
  batch: WriteBatch,
  input: {
    pollId: string;
    updateId: string;
    authorMode: AdminUpdateAuthorMode;
    actorUid: string;
    draft: OfficialPollDraftInput;
  }
): CampusPoll {
  const { firestoreDoc, optimisticPoll } = buildNewOfficialPollDocument(input);
  batch.set(doc(db, COLLECTION_NAMES.polls, input.pollId), firestoreDoc);
  attachPollAuditLogToBatch(batch, {
    action: 'poll_created',
    pollId: input.pollId,
    targetLabel: optimisticPoll.question,
    performedByUid: input.actorUid,
    details: `Attached official poll to update ${input.updateId}.`,
  });
  return optimisticPoll;
}

export function attachUpdatePollToBatch(
  batch: WriteBatch,
  input: {
    existingPoll: CampusPoll;
    actorUid: string;
    draft: OfficialPollDraftInput;
    status?: 'open' | 'closed';
  }
): CampusPoll {
  const existingExpMs = extractTimestampMs(input.existingPoll.expiresAt);
  const expiresChanged =
    existingExpMs === null || Math.abs(input.draft.expiresAtMs - existingExpMs) > 60_000;

  const normalized = normalizeAndValidatePollDraft(input.draft, {
    requireFutureExpiry: expiresChanged,
  });

  const optionsUnchanged =
    normalized.options.length === input.existingPoll.options.length &&
    normalized.options.every(
      (opt, idx) => opt === input.existingPoll.options[idx]
    );

  if (!optionsUnchanged && input.existingPoll.totalVotes > 0) {
    throw new Error(
      'Poll options cannot be added, removed, or renamed once votes have been cast.'
    );
  }

  const nextCounts = optionsUnchanged
    ? input.existingPoll.optionCounts
    : normalized.options.map(() => 0);
  const nextTotalVotes = optionsUnchanged ? input.existingPoll.totalVotes : 0;
  const nextStatus = input.status ?? input.existingPoll.status;

  batch.update(doc(db, COLLECTION_NAMES.polls, input.existingPoll.id), {
    question: normalized.question,
    options: normalized.options,
    optionCounts: nextCounts,
    totalVotes: nextTotalVotes,
    allowMultiple: normalized.allowMultiple,
    maxSelections: normalized.maxSelections,
    allowVoteChange: normalized.allowVoteChange,
    voterScope: normalized.voterScope,
    resultsVisibility: normalized.resultsVisibility,
    status: nextStatus,
    expiresAt: Timestamp.fromMillis(normalized.expiresAtMs),
    updatedAt: serverTimestamp(),
  });
  attachPollAuditLogToBatch(batch, {
    action: nextStatus === 'closed' && input.existingPoll.status === 'open' ? 'poll_closed' : 'poll_updated',
    pollId: input.existingPoll.id,
    targetLabel: normalized.question,
    performedByUid: input.actorUid,
    details: `Updated official poll settings on update ${input.existingPoll.updateId}.`,
  });

  return {
    ...input.existingPoll,
    question: normalized.question,
    options: normalized.options,
    optionCounts: nextCounts,
    totalVotes: nextTotalVotes,
    allowMultiple: normalized.allowMultiple,
    maxSelections: normalized.maxSelections,
    allowVoteChange: normalized.allowVoteChange,
    voterScope: normalized.voterScope,
    resultsVisibility: normalized.resultsVisibility,
    status: nextStatus,
    expiresAt: normalized.expiresAtMs,
    updatedAt: Date.now(),
  };
}

export async function collectPollCascadeDeleteRefs(pollId: string) {
  if (!isValidFirestoreId(pollId)) return [];
  const votesSnap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.polls, pollId, SUBCOLLECTION_NAMES.votes),
      limit(450)
    )
  ).catch(() => null);
  return [
    ...(votesSnap?.docs.map((d) => d.ref) ?? []),
    doc(db, COLLECTION_NAMES.polls, pollId),
  ];
}

export async function toggleOfficialPollStatus(input: {
  poll: CampusPoll;
  actorUid: string;
  actorRole: UserRole;
}): Promise<CampusPoll> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    currentUser.uid !== input.actorUid ||
    !isDesignatedSupremeAdminUser(currentUser) ||
    input.actorRole !== 'supreme_admin'
  ) {
    throw new Error('Only Supreme Administrators may close or reopen official polls.');
  }

  const nextStatus = input.poll.status === 'open' ? 'closed' : 'open';
  const path = `${COLLECTION_NAMES.polls}/${input.poll.id}`;

  try {
    await commitFreshWriteBatchWithRetry(
      () => writeBatch(db),
      (batch) => {
        batch.update(doc(db, COLLECTION_NAMES.polls, input.poll.id), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        attachPollAuditLogToBatch(batch, {
          action: nextStatus === 'closed' ? 'poll_closed' : 'poll_updated',
          pollId: input.poll.id,
          targetLabel: input.poll.question,
          performedByUid: input.actorUid,
          details:
            nextStatus === 'closed'
              ? 'Closed official poll manually.'
              : 'Reopened official poll.',
        });
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  const updatedPoll: CampusPoll = {
    ...input.poll,
    status: nextStatus,
    updatedAt: Date.now(),
  };
  notifyOfficialPollMutated(updatedPoll);
  return updatedPoll;
}

export async function castOrChangeOfficialPollVote(input: {
  pollId: string;
  updateId: string;
  actorUid: string;
  selectedIndices: readonly number[];
}): Promise<{ poll: CampusPoll; vote: PollVoteRecord }> {
  if (!isValidFirestoreId(input.actorUid)) {
    throw new Error('Sign in with your LASUED Intel account to vote.');
  }
  if (!isValidFirestoreId(input.pollId) || !isValidFirestoreId(input.updateId)) {
    throw new Error('Invalid official poll reference.');
  }

  const pollRef = doc(db, COLLECTION_NAMES.polls, input.pollId);
  const voteRef = doc(
    db,
    COLLECTION_NAMES.polls,
    input.pollId,
    SUBCOLLECTION_NAMES.votes,
    input.actorUid
  );
  const path = `${COLLECTION_NAMES.polls}/${input.pollId}`;

  try {
    const result = await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [pollSnap, voteSnap] = await Promise.all([
          tx.get(pollRef),
          tx.get(voteRef),
        ]);
        if (!pollSnap.exists()) {
          throw new Error('This official poll is no longer available.');
        }

        const pollData = pollSnap.data() as CampusPoll;
        if (pollData.updateId !== input.updateId) {
          throw new Error('This poll is not linked to the selected official update.');
        }
        if (pollData.status !== 'open') {
          throw new Error('This official poll has been closed.');
        }

        const expiresMs = extractTimestampMs(pollData.expiresAt);
        if (expiresMs !== null && Date.now() >= expiresMs) {
          throw new Error('Voting has ended because this official poll has expired.');
        }

        const previousVote = voteSnap.exists()
          ? (voteSnap.data() as PollVoteRecord)
          : null;
        if (previousVote && !pollData.allowVoteChange) {
          throw new Error('Vote changes are disabled on this official poll.');
        }

        const nextIndices = normalizeSelectedIndices(
          input.selectedIndices,
          pollData.options.length,
          pollData.maxSelections
        );

        const prevIndices = previousVote?.selectedIndices ?? [];
        if (
          previousVote &&
          prevIndices.length === nextIndices.length &&
          prevIndices.every((val, i) => val === nextIndices[i])
        ) {
          return { poll: pollData, vote: previousVote };
        }

        const { optionCounts, totalVotes } = computeNextPollCountsOnVote({
          optionCount: pollData.options.length,
          currentCounts: pollData.optionCounts,
          currentTotalVotes: pollData.totalVotes,
          previousSelectedIndices: prevIndices,
          nextSelectedIndices: nextIndices,
        });

        const nowMs = Date.now();
        if (previousVote) {
          tx.update(voteRef, {
            selectedIndices: nextIndices,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(voteRef, {
            id: input.actorUid,
            pollId: input.pollId,
            voterUid: input.actorUid,
            selectedIndices: nextIndices,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(pollRef, {
          optionCounts,
          totalVotes,
          updatedAt: serverTimestamp(),
        });

        const updatedPoll: CampusPoll = {
          ...pollData,
          optionCounts,
          totalVotes,
          updatedAt: nowMs,
        };
        const updatedVote: PollVoteRecord = {
          id: input.actorUid,
          pollId: input.pollId,
          voterUid: input.actorUid,
          selectedIndices: nextIndices,
          createdAt: previousVote?.createdAt ?? nowMs,
          updatedAt: nowMs,
        };

        return { poll: updatedPoll, vote: updatedVote };
      })
    );

    notifyOfficialPollMutated(result.poll);
    return result;
  } catch (error) {
    if (!isFirestoreSdkError(error)) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function emitOfficialPollDeleted(pollId: string, updateId: string): void {
  notifyOfficialPollDeleted(pollId, updateId);
}

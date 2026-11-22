import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFirestoreOrAppError } from './authValidation';
import {
  computeNextReactionTransactionState,
  isFirestoreSdkError,
  isTransientFirestoreConnectionError,
  runWithFirestoreConnectionRetry,
} from './firestoreRetry';

function makeFirebaseError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

test('isTransientFirestoreConnectionError identifies network failures and excludes rule errors', () => {
  assert.equal(
    isTransientFirestoreConnectionError(
      makeFirebaseError('unavailable', 'Connection failed.')
    ),
    true
  );
  assert.equal(
    isTransientFirestoreConnectionError(new Error('Connection failed.')),
    true
  );
  assert.equal(
    isTransientFirestoreConnectionError(
      makeFirebaseError('deadline-exceeded', 'Request time out')
    ),
    true
  );
  assert.equal(
    isTransientFirestoreConnectionError(
      makeFirebaseError('permission-denied', 'Missing or insufficient permissions.')
    ),
    false
  );
  assert.equal(
    isTransientFirestoreConnectionError(
      makeFirebaseError('not-found', 'Document not found.')
    ),
    false
  );
  assert.equal(
    isTransientFirestoreConnectionError(new Error('This post is no longer available.')),
    false
  );
});

test('isFirestoreSdkError distinguishes SDK errors from domain errors', () => {
  assert.equal(
    isFirestoreSdkError(makeFirebaseError('unavailable', 'Connection failed.')),
    true
  );
  assert.equal(
    isFirestoreSdkError(new Error('This post is no longer available.')),
    false
  );
});

test('runWithFirestoreConnectionRetry retries transient Connection failed errors and resolves on recovery', async () => {
  let calls = 0;
  const delays: number[] = [];

  const result = await runWithFirestoreConnectionRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw makeFirebaseError('unavailable', 'Connection failed.');
      }
      return { liked: true, likesCount: 4 };
    },
    {
      maxAttempts: 3,
      baseDelayMs: 50,
      sleep: async (ms) => {
        delays.push(ms);
      },
      isOnline: () => true,
    }
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 100]);
  assert.deepEqual(result, { liked: true, likesCount: 4 });
});

test('runWithFirestoreConnectionRetry does not retry permission-denied or offline states', async () => {
  let permCalls = 0;
  await assert.rejects(
    runWithFirestoreConnectionRetry(
      async () => {
        permCalls += 1;
        throw makeFirebaseError('permission-denied', 'Missing or insufficient permissions.');
      },
      {
        maxAttempts: 3,
        sleep: async () => undefined,
        isOnline: () => true,
      }
    ),
    /Missing or insufficient permissions/
  );
  assert.equal(permCalls, 1);

  let offlineCalls = 0;
  await assert.rejects(
    runWithFirestoreConnectionRetry(
      async () => {
        offlineCalls += 1;
        throw makeFirebaseError('unavailable', 'Connection failed.');
      },
      {
        maxAttempts: 3,
        sleep: async () => undefined,
        isOnline: () => false,
      }
    ),
    /Connection failed/
  );
  assert.equal(offlineCalls, 1);
});

test('computeNextReactionTransactionState computes authoritative like/unlike transitions cleanly', () => {
  assert.deepEqual(
    computeNextReactionTransactionState({
      alreadyLiked: false,
      currentLikesCount: 0,
    }),
    {
      liked: true,
      likesCount: 1,
      shouldUpdatePostLikesCount: true,
    }
  );

  assert.deepEqual(
    computeNextReactionTransactionState({
      alreadyLiked: true,
      currentLikesCount: 3,
    }),
    {
      liked: false,
      likesCount: 2,
      shouldUpdatePostLikesCount: true,
    }
  );

  // When reaction doc exists on a post whose counter is already 0, avoid invalid negative decrement
  assert.deepEqual(
    computeNextReactionTransactionState({
      alreadyLiked: true,
      currentLikesCount: 0,
    }),
    {
      liked: false,
      likesCount: 0,
      shouldUpdatePostLikesCount: false,
    }
  );
});

test('formatFirestoreOrAppError translates JSON-wrapped Connection failed errors for users', () => {
  const wrapped = new Error(
    JSON.stringify({
      error: 'Connection failed.',
      operationType: 'write',
      path: 'anonymousPosts/chMtLNpPDU9rxhk5w3Uf',
    })
  );
  const message = formatFirestoreOrAppError(
    wrapped,
    'Could not update your like right now.'
  );
  assert.match(message, /Network connection interrupted/i);
  assert.doesNotMatch(message, /anonymousPosts/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFirestoreOrAppError } from './authValidation';
import {
  commitFreshWriteBatchWithPermissionRetry,
  commitFreshWriteBatchWithRetry,
  computeNextReactionTransactionState,
  computeResilientSnapshotRetryDelayMs,
  hasValidFirebaseConfig,
  isFirestoreSdkError,
  isFirestoreTargetIdConflictError,
  isPermissionDeniedError,
  isTransientFirestoreConnectionError,
  runWithFirestoreConnectionRetry,
  runWithPermissionRetry,
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
    isTransientFirestoreConnectionError(
      new Error(
        'Could not reach Cloud Firestore backend. Connection failed 1 times. Most recent error: FirebaseError: [code=unavailable]: The operation could not be completed'
      )
    ),
    true
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

test('formatFirestoreOrAppError translates JSON-wrapped Connection failed and unavailable errors for users', () => {
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

  const unavailableMessage = formatFirestoreOrAppError(
    new Error('FirebaseError: [code=unavailable]: The operation could not be completed'),
    'Unable to reach campus servers.'
  );
  assert.match(unavailableMessage, /Network connection interrupted/i);
});

test('hasValidFirebaseConfig validates real configs and rejects placeholders', () => {
  assert.equal(
    hasValidFirebaseConfig({
      projectId: 'lasued-intel',
      apiKey: 'AIzaSyDummyKey',
      firestoreDatabaseId: '(default)',
    }),
    true
  );
  assert.equal(
    hasValidFirebaseConfig({
      projectId: 'remixed-project-id',
      apiKey: 'AIzaSyDummyKey',
      firestoreDatabaseId: '(default)',
    }),
    false
  );
  assert.equal(
    hasValidFirebaseConfig({
      projectId: 'lasued-intel',
      apiKey: '',
      firestoreDatabaseId: '(default)',
    }),
    false
  );
});

test('commitFreshWriteBatchWithRetry creates a brand-new batch on every retry without reusing committed batches', async () => {
  const createdBatches: Array<{ ops: string[]; committed: boolean }> = [];
  let attempt = 0;

  await commitFreshWriteBatchWithRetry(
    () => {
      const state = {
        ops: [] as string[],
        committed: false,
        set(key: string) {
          if (this.committed) {
            throw new Error(
              'A write batch can no longer be used after commit() has been called.'
            );
          }
          this.ops.push(key);
        },
        async commit() {
          if (this.committed) {
            throw new Error(
              'A write batch can no longer be used after commit() has been called.'
            );
          }
          this.committed = true;
          attempt += 1;
          if (attempt < 3) {
            throw makeFirebaseError('unavailable', 'Connection failed.');
          }
        },
      };
      createdBatches.push(state);
      return state;
    },
    (batch) => {
      batch.set('posts/post_123');
      batch.set('mediaImages/img_456');
    },
    {
      maxAttempts: 3,
      baseDelayMs: 0,
      sleep: async () => undefined,
      isOnline: () => true,
    }
  );

  assert.equal(attempt, 3);
  assert.equal(createdBatches.length, 3);
  for (const batch of createdBatches) {
    assert.equal(batch.committed, true);
    assert.deepEqual(batch.ops, ['posts/post_123', 'mediaImages/img_456']);
  }
});

test('commitFreshWriteBatchWithRetry stops immediately on non-transient errors without double-commit', async () => {
  let batchCount = 0;

  await assert.rejects(
    commitFreshWriteBatchWithRetry(
      () => {
        batchCount += 1;
        let committed = false;
        return {
          set() {},
          async commit() {
            if (committed) {
              throw new Error(
                'A write batch can no longer be used after commit() has been called.'
              );
            }
            committed = true;
            throw makeFirebaseError(
              'permission-denied',
              'Missing or insufficient permissions.'
            );
          },
        };
      },
      (batch) => {
        batch.set();
      },
      {
        maxAttempts: 3,
        baseDelayMs: 0,
        sleep: async () => undefined,
        isOnline: () => true,
      }
    ),
    /Missing or insufficient permissions/
  );

  assert.equal(batchCount, 1);
});

test('isPermissionDeniedError and runWithPermissionRetry refresh token once and recover with a fresh batch', async () => {
  assert.equal(
    isPermissionDeniedError(makeFirebaseError('permission-denied', 'Denied')),
    true
  );
  assert.equal(
    isPermissionDeniedError(makeFirebaseError('firestore/permission-denied', 'Denied')),
    true
  );
  assert.equal(
    isPermissionDeniedError(new Error('Missing or insufficient permissions.')),
    true
  );
  assert.equal(
    isPermissionDeniedError(makeFirebaseError('unavailable', 'Offline')),
    false
  );

  let refreshCalls = 0;
  let opCalls = 0;
  const recovered = await runWithPermissionRetry(
    async () => {
      opCalls += 1;
      if (opCalls === 1) {
        throw makeFirebaseError('permission-denied', 'Missing or insufficient permissions.');
      }
      return 'ok';
    },
    {
      refreshToken: async () => {
        refreshCalls += 1;
        return true;
      },
    }
  );
  assert.equal(recovered, 'ok');
  assert.equal(refreshCalls, 1);
  assert.equal(opCalls, 2);

  let batchCount = 0;
  let batchRefreshCalls = 0;
  await commitFreshWriteBatchWithPermissionRetry(
    () => {
      batchCount += 1;
      let committed = false;
      return {
        async commit() {
          if (committed) {
            throw new Error('Cannot reuse committed batch');
          }
          committed = true;
          if (batchCount === 1) {
            throw makeFirebaseError('permission-denied', 'Stale email_verified claim');
          }
        },
      };
    },
    () => {},
    {
      refreshToken: async () => {
        batchRefreshCalls += 1;
        return true;
      },
    }
  );
  assert.equal(batchRefreshCalls, 1);
  assert.equal(batchCount, 2);

  let noRefreshOpCalls = 0;
  await assert.rejects(
    runWithPermissionRetry(
      async () => {
        noRefreshOpCalls += 1;
        throw makeFirebaseError('permission-denied', 'Rule blocked');
      },
      {
        refreshToken: async () => false,
      }
    ),
    /Rule blocked/
  );
  assert.equal(noRefreshOpCalls, 1);
});

test('isFirestoreTargetIdConflictError and isTransientFirestoreConnectionError recover Target ID already exists errors', () => {
  const targetConflict = makeFirebaseError(
    'already-exists',
    'Target ID already exists: 1002'
  );
  const realWriteConflict = makeFirebaseError(
    'already-exists',
    'Document already exists.'
  );

  assert.equal(isFirestoreTargetIdConflictError(targetConflict), true);
  assert.equal(isFirestoreTargetIdConflictError(realWriteConflict), false);
  assert.equal(isTransientFirestoreConnectionError(targetConflict), true);
  assert.equal(isTransientFirestoreConnectionError(realWriteConflict), false);

  assert.equal(computeResilientSnapshotRetryDelayMs(0, 0), 350);
  assert.equal(computeResilientSnapshotRetryDelayMs(1, 50), 750);
  assert.equal(computeResilientSnapshotRetryDelayMs(10, 0), 10_000);

  const translated = formatFirestoreOrAppError(
    new Error(
      JSON.stringify({
        error: 'Target ID already exists: 1002',
        operationType: 'get',
        path: 'users/testUid',
      })
    ),
    'Fallback message'
  );
  assert.match(translated, /Network connection interrupted/i);
});

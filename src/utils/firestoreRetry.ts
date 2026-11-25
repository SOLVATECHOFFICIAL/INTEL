const NON_TRANSIENT_FIREBASE_CODES = new Set([
  'permission-denied',
  'not-found',
  'invalid-argument',
  'already-exists',
  'unauthenticated',
  'failed-precondition',
  'out-of-range',
  'unimplemented',
  'data-loss',
]);

const TRANSIENT_FIREBASE_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'aborted',
  'resource-exhausted',
  'cancelled',
]);

const TRANSIENT_MESSAGE_PATTERN =
  /Connection failed|the client is offline|Request time out|Failed to get document|network|transport|ECONNRESET|ETIMEDOUT/i;

export function isFirestoreSdkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === 'string' && maybeCode.trim().length > 0;
}

export function hasValidFirebaseConfig(config: {
  projectId?: unknown;
  apiKey?: unknown;
  firestoreDatabaseId?: unknown;
} | null | undefined): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const projectId =
    typeof config.projectId === 'string' ? config.projectId.trim() : '';
  const apiKey =
    typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  const databaseId =
    typeof config.firestoreDatabaseId === 'string'
      ? config.firestoreDatabaseId.trim()
      : '';
  if (!projectId || !apiKey || !databaseId) {
    return false;
  }
  return projectId !== 'remixed-project-id';
}

export function isTransientFirestoreConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') {
    const normalizedCode = maybeCode.trim().toLowerCase();
    if (NON_TRANSIENT_FIREBASE_CODES.has(normalizedCode)) {
      return false;
    }
    if (TRANSIENT_FIREBASE_CODES.has(normalizedCode)) {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: string }).message)
        : '';

  return TRANSIENT_MESSAGE_PATTERN.test(message);
}

export interface FirestoreRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultIsOnline = (): boolean => {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
};

export async function runWithFirestoreConnectionRetry<T>(
  operation: () => Promise<T>,
  options: FirestoreRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
  const sleep = options.sleep ?? defaultSleep;
  const isOnline = options.isOnline ?? defaultIsOnline;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const shouldRetry =
        attempt < maxAttempts &&
        isTransientFirestoreConnectionError(error) &&
        isOnline();

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') {
    const normalized = maybeCode.trim().toLowerCase();
    if (
      normalized === 'permission-denied' ||
      normalized === 'firestore/permission-denied'
    ) {
      return true;
    }
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: string }).message)
        : '';
  return /missing or insufficient permissions|permission[- ]denied/i.test(message);
}

export interface PermissionRetryOptions extends FirestoreRetryOptions {
  actorUid?: string;
  refreshToken?: () => Promise<boolean>;
}

export async function runWithPermissionRetry<T>(
  operation: () => Promise<T>,
  options: PermissionRetryOptions = {}
): Promise<T> {
  try {
    return await runWithFirestoreConnectionRetry(operation, options);
  } catch (error) {
    if (isPermissionDeniedError(error) && options.refreshToken) {
      const refreshed = await options.refreshToken().catch(() => false);
      if (refreshed) {
        return await runWithFirestoreConnectionRetry(operation, options);
      }
    }
    throw error;
  }
}

export async function commitFreshWriteBatchWithRetry<
  TBatch extends { commit: () => Promise<void> },
>(
  createBatch: () => TBatch,
  populateBatch: (batch: TBatch) => void,
  options: FirestoreRetryOptions = {}
): Promise<void> {
  await runWithFirestoreConnectionRetry(async () => {
    const batch = createBatch();
    populateBatch(batch);
    await batch.commit();
  }, options);
}

export async function commitFreshWriteBatchWithPermissionRetry<
  TBatch extends { commit: () => Promise<void> },
>(
  createBatch: () => TBatch,
  populateBatch: (batch: TBatch) => void,
  options: PermissionRetryOptions = {}
): Promise<void> {
  await runWithPermissionRetry(async () => {
    const batch = createBatch();
    populateBatch(batch);
    await batch.commit();
  }, options);
}

export interface NextReactionTransactionState {
  liked: boolean;
  likesCount: number;
  shouldUpdatePostLikesCount: boolean;
}

export function computeNextReactionTransactionState(input: {
  alreadyLiked: boolean;
  currentLikesCount: unknown;
}): NextReactionTransactionState {
  const parsedLikes = Number(input.currentLikesCount ?? 0);
  const currentLikes =
    Number.isFinite(parsedLikes) && parsedLikes > 0
      ? Math.trunc(parsedLikes)
      : 0;

  if (input.alreadyLiked) {
    const nextLikes = Math.max(0, currentLikes - 1);
    return {
      liked: false,
      likesCount: nextLikes,
      shouldUpdatePostLikesCount: nextLikes !== currentLikes,
    };
  }

  return {
    liked: true,
    likesCount: currentLikes + 1,
    shouldUpdatePostLikesCount: true,
  };
}

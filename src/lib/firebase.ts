import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { COLLECTION_NAMES } from '../types/database';
import {
  hasValidFirebaseConfig,
  isTransientFirestoreConnectionError,
  runWithFirestoreConnectionRetry,
} from '../utils/firestoreRetry';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const configuredFirestoreDbId =
  firebaseConfig.firestoreDatabaseId &&
  firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined;

function createFirestoreClient() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      configuredFirestoreDbId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
          localCache: persistentLocalCache({
            tabManager: persistentSingleTabManager({ forceOwnership: false }),
          }),
        },
        configuredFirestoreDbId
      );
    } catch {
      try {
        return initializeFirestore(
          app,
          {
            experimentalForceLongPolling: true,
            localCache: memoryLocalCache(),
          },
          configuredFirestoreDbId
        );
      } catch {
        return configuredFirestoreDbId
          ? getFirestore(app, configuredFirestoreDbId)
          : getFirestore(app);
      }
    }
  }
}

export const db = createFirestoreClient();
export const auth = getAuth(app);

export async function refreshAuthSessionToken(
  expectedUid?: string
): Promise<boolean> {
  const activeUser = auth.currentUser;
  if (!activeUser) {
    return false;
  }
  if (expectedUid && activeUser.uid !== expectedUid) {
    return false;
  }
  try {
    await activeUser.reload();
    await activeUser.getIdToken(true);
    return true;
  } catch {
    return false;
  }
}

export async function ensureVerifiedEmailTokenClaim(
  user: User | null
): Promise<void> {
  if (!user || !user.emailVerified) {
    return;
  }
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims?.email_verified !== true) {
      await user.getIdToken(true);
    }
  } catch {
    // Best-effort token freshness check
  }
}

export const FIREBASE_RUNTIME_INFO = {
  projectId: firebaseConfig.projectId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
} as const;

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface ConnectionCheckResult {
  connected: boolean;
  offlineError?: string;
}

export async function testConnection(): Promise<ConnectionCheckResult> {
  if (!hasValidFirebaseConfig(firebaseConfig)) {
    console.error('Please check your Firebase configuration.');
    return {
      connected: false,
      offlineError: 'Please check your Firebase configuration.',
    };
  }

  try {
    await runWithFirestoreConnectionRetry(
      () => getDocFromServer(doc(db, COLLECTION_NAMES.platformSettings, 'global')),
      { maxAttempts: 2, baseDelayMs: 500 }
    );
    return { connected: true };
  } catch (error) {
    if (isTransientFirestoreConnectionError(error)) {
      return {
        connected: false,
        offlineError: 'Unable to reach Firestore right now.',
      };
    }
    return { connected: true };
  }
}

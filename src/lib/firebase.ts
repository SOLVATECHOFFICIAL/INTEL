import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
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
      firebaseConfig.firestoreDatabaseId
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
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      try {
        return initializeFirestore(
          app,
          {
            experimentalForceLongPolling: true,
            localCache: memoryLocalCache(),
          },
          firebaseConfig.firestoreDatabaseId
        );
      } catch {
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
      }
    }
  }
}

export const db = createFirestoreClient();
export const auth = getAuth(app);

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
      () => getDocFromServer(doc(db, 'test', 'connection')),
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
    // Permission denied on nonexistent test/connection doc means server responded cleanly.
    return { connected: true };
  }
}

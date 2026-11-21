import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { PublicUserProfile, UserRoleRecord } from '../types/database';
import type { EffectiveAccountTier } from '../utils/authValidation';

export interface FirebaseContextValue {
  authReady: boolean;
  user: User | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
  effectiveTier: EffectiveAccountTier;
  isSuspended: boolean;
  unreadNotificationsCount: number;
  firestoreConnected: boolean | null;
  refreshAccountState: () => Promise<void>;
}

export const FirebaseContext = createContext<FirebaseContextValue>({
  authReady: false,
  user: null,
  profile: null,
  roleRecord: null,
  effectiveTier: 'guest',
  isSuspended: false,
  unreadNotificationsCount: 0,
  firestoreConnected: null,
  refreshAccountState: async () => {},
});

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}

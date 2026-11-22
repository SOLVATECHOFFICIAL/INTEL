import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { PublicUserProfile, UserRoleRecord } from '../types/database';
import type { EffectiveAccountTier } from '../utils/authValidation';
import type { FollowRelationshipState } from '../utils/followRelations';

export interface FirebaseContextValue {
  authReady: boolean;
  user: User | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
  effectiveTier: EffectiveAccountTier;
  isSuspended: boolean;
  unreadNotificationsCount: number;
  firestoreConnected: boolean | null;
  followingUsernames: Set<string>;
  followerUsernames: Set<string>;
  pendingFollowUsernames: Set<string>;
  getRelationshipState: (targetUsername: string) => FollowRelationshipState;
  toggleFollow: (targetUsername: string) => Promise<boolean>;
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
  followingUsernames: new Set(),
  followerUsernames: new Set(),
  pendingFollowUsernames: new Set(),
  getRelationshipState: () => 'follow',
  toggleFollow: async () => false,
  refreshAccountState: async () => {},
});

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}

import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type {
  NotificationItem,
  PublicUserProfile,
  UserRoleRecord,
} from '../types/database';
import type { EffectiveAccountTier } from '../utils/authValidation';
import type { FollowRelationshipState } from '../utils/followRelations';
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPreferences,
} from '../utils/notifications';

export interface SyncedAccountSnapshot {
  verified: boolean;
  user: User | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
}

export interface FirebaseContextValue {
  authReady: boolean;
  accountSyncReady: boolean;
  user: User | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
  effectiveTier: EffectiveAccountTier;
  isSuspended: boolean;
  unreadNotificationsCount: number;
  notifications: NotificationItem[];
  foregroundNotificationToast: NotificationItem | null;
  dismissForegroundNotificationToast: () => void;
  notificationsStatus: 'loading' | 'ready' | 'error';
  hasMoreNotifications: boolean;
  loadingOlderNotifications: boolean;
  notificationError: string | null;
  notificationPrefs: NotificationPreferences;
  interestCategories: string[];
  firestoreConnected: boolean | null;
  followingUsernames: Set<string>;
  followerUsernames: Set<string>;
  pendingFollowUsernames: Set<string>;
  getRelationshipState: (targetUsername: string) => FollowRelationshipState;
  toggleFollow: (targetUsername: string) => Promise<boolean>;
  markNotificationReadOptimistic: (notificationId: string) => Promise<void>;
  markNotificationUnreadOptimistic: (notificationId: string) => Promise<void>;
  markAllNotificationsReadOptimistic: () => Promise<void>;
  deleteNotificationOptimistic: (notificationId: string) => Promise<void>;
  loadOlderNotifications: () => Promise<void>;
  updateNotificationPrefsOptimistic: (
    nextPrefs: NotificationPreferences
  ) => Promise<void>;
  updateInterestCategoriesOptimistic: (
    nextInterests: readonly string[]
  ) => Promise<void>;
  clearNotificationError: () => void;
  refreshAccountState: () => Promise<void>;
  refreshVerificationStatus: () => Promise<SyncedAccountSnapshot>;
}

export const FirebaseContext = createContext<FirebaseContextValue>({
  authReady: false,
  accountSyncReady: false,
  user: null,
  profile: null,
  roleRecord: null,
  effectiveTier: 'guest',
  isSuspended: false,
  unreadNotificationsCount: 0,
  notifications: [],
  foregroundNotificationToast: null,
  dismissForegroundNotificationToast: () => {},
  notificationsStatus: 'loading',
  hasMoreNotifications: false,
  loadingOlderNotifications: false,
  notificationError: null,
  notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
  interestCategories: [],
  firestoreConnected: null,
  followingUsernames: new Set(),
  followerUsernames: new Set(),
  pendingFollowUsernames: new Set(),
  getRelationshipState: () => 'follow',
  toggleFollow: async () => false,
  markNotificationReadOptimistic: async () => {},
  markNotificationUnreadOptimistic: async () => {},
  markAllNotificationsReadOptimistic: async () => {},
  deleteNotificationOptimistic: async () => {},
  loadOlderNotifications: async () => {},
  updateNotificationPrefsOptimistic: async () => {},
  updateInterestCategoriesOptimistic: async () => {},
  clearNotificationError: () => {},
  refreshAccountState: async () => {},
  refreshVerificationStatus: async () => ({
    verified: false,
    user: null,
    profile: null,
    roleRecord: null,
  }),
});

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}

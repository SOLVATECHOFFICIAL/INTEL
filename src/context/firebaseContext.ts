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

export interface FirebaseContextValue {
  authReady: boolean;
  user: User | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
  effectiveTier: EffectiveAccountTier;
  isSuspended: boolean;
  unreadNotificationsCount: number;
  notifications: NotificationItem[];
  notificationsStatus: 'loading' | 'ready' | 'error';
  hasMoreNotifications: boolean;
  loadingOlderNotifications: boolean;
  notificationError: string | null;
  notificationPrefs: NotificationPreferences;
  firestoreConnected: boolean | null;
  followingUsernames: Set<string>;
  followerUsernames: Set<string>;
  pendingFollowUsernames: Set<string>;
  getRelationshipState: (targetUsername: string) => FollowRelationshipState;
  toggleFollow: (targetUsername: string) => Promise<boolean>;
  markNotificationReadOptimistic: (notificationId: string) => Promise<void>;
  markAllNotificationsReadOptimistic: () => Promise<void>;
  deleteNotificationOptimistic: (notificationId: string) => Promise<void>;
  loadOlderNotifications: () => Promise<void>;
  updateNotificationPrefsOptimistic: (
    nextPrefs: NotificationPreferences
  ) => Promise<void>;
  clearNotificationError: () => void;
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
  notifications: [],
  notificationsStatus: 'loading',
  hasMoreNotifications: false,
  loadingOlderNotifications: false,
  notificationError: null,
  notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
  firestoreConnected: null,
  followingUsernames: new Set(),
  followerUsernames: new Set(),
  pendingFollowUsernames: new Set(),
  getRelationshipState: () => 'follow',
  toggleFollow: async () => false,
  markNotificationReadOptimistic: async () => {},
  markAllNotificationsReadOptimistic: async () => {},
  deleteNotificationOptimistic: async () => {},
  loadOlderNotifications: async () => {},
  updateNotificationPrefsOptimistic: async () => {},
  clearNotificationError: () => {},
  refreshAccountState: async () => {},
});

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}

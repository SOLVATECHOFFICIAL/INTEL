import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { testConnection } from '../lib/firebase';
import { subscribeToAuthChanges } from '../services/auth';
import {
  fetchPublicMemberProfile,
  fetchUserRoleRecord,
  subscribePublicMemberProfile,
  subscribeUserNotifications,
  subscribeUserRoleRecord,
} from '../services/firestoreFoundation';
import type { PublicUserProfile, UserRoleRecord } from '../types/database';
import {
  isAccountSuspended,
  resolveEffectiveAccountTier,
} from '../utils/authValidation';
import { FirebaseContext } from './firebaseContext';

interface FirebaseProviderProps {
  children: ReactNode;
}

export function FirebaseProvider({ children }: FirebaseProviderProps) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [roleRecord, setRoleRecord] = useState<UserRoleRecord | null>(null);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    let active = true;
    void testConnection().then((result) => {
      if (active) {
        setFirestoreConnected(result.connected);
      }
    });

    const unsubscribeAuth = subscribeToAuthChanges((nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setProfile(null);
        setRoleRecord(null);
        setUnreadNotificationsCount(0);
      }
    });

    return () => {
      active = false;
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      return;
    }

    const unsubscribeRole = subscribeUserRoleRecord(user.uid, (record) => {
      setRoleRecord(record);
    });

    const unsubscribeProfile = subscribePublicMemberProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
      }
    );

    const unsubscribeNotifications = subscribeUserNotifications(
      user.uid,
      (items) => {
        setUnreadNotificationsCount(items.filter((item) => !item.isRead).length);
      }
    );

    return () => {
      unsubscribeRole();
      unsubscribeProfile();
      unsubscribeNotifications();
    };
  }, [authReady, user]);

  const refreshAccountState = useCallback(async () => {
    if (!user) return;
    const [nextProfile, nextRole] = await Promise.all([
      fetchPublicMemberProfile(user.uid),
      fetchUserRoleRecord(user.uid),
    ]);
    setProfile(nextProfile);
    setRoleRecord(nextRole);
  }, [user]);

  const effectiveTier = resolveEffectiveAccountTier(user, roleRecord);
  const isSuspended = isAccountSuspended(profile);

  return (
    <FirebaseContext.Provider
      value={{
        authReady,
        user,
        profile,
        roleRecord,
        effectiveTier,
        isSuspended,
        unreadNotificationsCount,
        firestoreConnected,
        refreshAccountState,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

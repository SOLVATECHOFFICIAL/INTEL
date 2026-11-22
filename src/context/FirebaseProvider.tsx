import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { testConnection } from '../lib/firebase';
import { subscribeToAuthChanges } from '../services/auth';
import {
  fetchPublicMemberProfile,
  fetchUserRoleRecord,
  followMemberByUsername,
  subscribePublicMemberProfile,
  subscribeUserNotifications,
  subscribeUserRoleRecord,
  subscribeViewerFollowUsernames,
  unfollowMemberByUsername,
} from '../services/firestoreFoundation';
import type { PublicUserProfile, UserRoleRecord } from '../types/database';
import {
  isAccountSuspended,
  resolveEffectiveAccountTier,
} from '../utils/authValidation';
import {
  applyOptimisticFollowUpdate,
  normalizeFollowUsername,
  resolveFollowRelationshipState,
  type FollowRelationshipState,
} from '../utils/followRelations';
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
  const [followingUsernames, setFollowingUsernames] = useState<Set<string>>(
    () => new Set()
  );
  const [followerUsernames, setFollowerUsernames] = useState<Set<string>>(
    () => new Set()
  );
  const [pendingFollowUsernames, setPendingFollowUsernames] = useState<
    Set<string>
  >(() => new Set());

  const uidToUsernameCacheRef = useRef<Map<string, string>>(new Map());

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
        setFollowingUsernames(new Set());
        setFollowerUsernames(new Set());
        setPendingFollowUsernames(new Set());
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
        if (nextProfile?.username) {
          uidToUsernameCacheRef.current.set(
            nextProfile.uid,
            nextProfile.username.toLowerCase()
          );
        }
      }
    );

    const unsubscribeNotifications = subscribeUserNotifications(
      user.uid,
      (items) => {
        setUnreadNotificationsCount(items.filter((item) => !item.isRead).length);
      }
    );

    const unsubscribeFollows = subscribeViewerFollowUsernames(
      user.uid,
      uidToUsernameCacheRef.current,
      ({ followingUsernames: nextFollowing, followerUsernames: nextFollowers }) => {
        setFollowingUsernames(nextFollowing);
        setFollowerUsernames(nextFollowers);
      }
    );

    return () => {
      unsubscribeRole();
      unsubscribeProfile();
      unsubscribeNotifications();
      unsubscribeFollows();
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

  const getRelationshipState = useCallback(
    (targetUsername: string): FollowRelationshipState => {
      if (!user) {
        return 'follow';
      }
      return resolveFollowRelationshipState({
        viewerUsername: profile?.username ?? null,
        targetUsername,
        followingUsernames,
        followerUsernames,
      });
    },
    [user, profile?.username, followingUsernames, followerUsernames]
  );

  const toggleFollow = useCallback(
    async (targetUsername: string): Promise<boolean> => {
      const normalized = normalizeFollowUsername(targetUsername);
      if (!normalized || !user) {
        throw new Error('Sign in to follow campus members.');
      }
      if (isAccountSuspended(profile)) {
        throw new Error('Suspended accounts cannot follow or unfollow members.');
      }
      if (profile?.username && normalizeFollowUsername(profile.username) === normalized) {
        return false;
      }
      if (pendingFollowUsernames.has(normalized)) {
        return followingUsernames.has(normalized);
      }

      const wasFollowing = followingUsernames.has(normalized);
      const nextFollowing = !wasFollowing;

      const optimistic = applyOptimisticFollowUpdate({
        viewerUsername: profile?.username ?? null,
        targetUsername: normalized,
        nextFollowing,
        followingUsernames,
        currentFollowingCount: profile?.followingCount ?? 0,
      });

      if (!optimistic.changed) {
        return wasFollowing;
      }

      setPendingFollowUsernames((prev) => {
        const next = new Set(prev);
        next.add(normalized);
        return next;
      });
      setFollowingUsernames(optimistic.followingUsernames);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              followingCount: optimistic.followingCount,
            }
          : prev
      );

      try {
        if (nextFollowing) {
          await followMemberByUsername(user.uid, normalized);
        } else {
          await unfollowMemberByUsername(user.uid, normalized);
        }
        return nextFollowing;
      } catch (err) {
        // Roll back optimistic state on error
        setFollowingUsernames((prev) => {
          const reverted = new Set(prev);
          if (wasFollowing) reverted.add(normalized);
          else reverted.delete(normalized);
          return reverted;
        });
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                followingCount: Math.max(
                  0,
                  (prev.followingCount ?? 0) + (wasFollowing ? 1 : -1)
                ),
              }
            : prev
        );
        throw err;
      } finally {
        setPendingFollowUsernames((prev) => {
          const next = new Set(prev);
          next.delete(normalized);
          return next;
        });
      }
    },
    [user, profile, followingUsernames, pendingFollowUsernames]
  );

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
        followingUsernames,
        followerUsernames,
        pendingFollowUsernames,
        getRelationshipState,
        toggleFollow,
        refreshAccountState,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

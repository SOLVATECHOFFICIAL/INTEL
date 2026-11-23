import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { testConnection } from '../lib/firebase';
import { clearViewerScopedMediaCache } from '../services/mediaStorage';
import { notifyViewerSessionReset } from '../services/cacheInvalidation';
import { clearSearchBundleCache } from '../services/searchDiscovery';
import { subscribeToAuthChanges } from '../services/auth';
import { syncAppBadgeWithServiceWorker } from '../services/webPush';
import {
  deleteUserNotification,
  ensureDesignatedSupremeAdminAccountState,
  fetchOlderUserNotificationsPage,
  fetchPrivateUserData,
  fetchPublicMemberProfile,
  fetchUserRoleRecord,
  followMemberByUsername,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribePublicMemberProfile,
  subscribeUserNotifications,
  subscribeUserRoleRecord,
  subscribeViewerFollowUsernames,
  syncOwnAnonymousReplyNotifications,
  syncOwnExpiredMarketplaceNotifications,
  unfollowMemberByUsername,
  updateNotificationPreferences,
  updatePrivateUserInterests,
} from '../services/firestoreFoundation';
import { syncOwnAnonymousLikesReceivedCount } from '../services/socialPosts';
import type {
  NotificationItem,
  PublicUserProfile,
  UserRoleRecord,
} from '../types/database';
import {
  formatFirestoreOrAppError,
  isAccountSuspended,
  isDesignatedSupremeAdminUser,
  resolveEffectiveAccountTier,
} from '../utils/authValidation';
import {
  applyOptimisticFollowUpdate,
  normalizeFollowUsername,
  resolveFollowRelationshipState,
  type FollowRelationshipState,
} from '../utils/followRelations';
import {
  DEFAULT_NOTIFICATION_PREFS,
  applyOptimisticDeleteNotification,
  applyOptimisticMarkAllRead,
  applyOptimisticMarkRead,
  computeUnreadNotificationsCount,
  mergeNotifications,
  normalizeNotificationPrefs,
  restoreDeletedNotification,
  rollbackOptimisticMarkReadIds,
  type NotificationPreferences,
} from '../utils/notifications';
import { normalizeInterestList } from '../utils/feedRanking';
import { FirebaseContext } from './firebaseContext';

interface FirebaseProviderProps {
  children: ReactNode;
}

export function FirebaseProvider({ children }: FirebaseProviderProps) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [roleRecord, setRoleRecord] = useState<UserRoleRecord | null>(null);
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>(
    []
  );
  const [olderNotifications, setOlderNotifications] = useState<
    NotificationItem[]
  >([]);
  const [notificationsStatus, setNotificationsStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingOlderNotifications, setLoadingOlderNotifications] =
    useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(
    null
  );
  const [notificationPrefs, setNotificationPrefs] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [interestCategories, setInterestCategories] = useState<string[]>([]);
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
  const oldestNotificationCursorRef =
    useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const hasLoadedOlderNotificationsRef = useRef(false);
  const syncedBackgroundUidRef = useRef<string | null>(null);

  const notifications = useMemo(
    () => mergeNotifications(liveNotifications, olderNotifications),
    [liveNotifications, olderNotifications]
  );

  const unreadNotificationsCount = useMemo(
    () => computeUnreadNotificationsCount(notifications, notificationPrefs),
    [notifications, notificationPrefs]
  );

  useEffect(() => {
    if (!authReady) return;
    void syncAppBadgeWithServiceWorker(user ? unreadNotificationsCount : 0);
  }, [authReady, user, unreadNotificationsCount]);

  useEffect(() => {
    let active = true;
    void testConnection().then((result) => {
      if (active) {
        setFirestoreConnected(result.connected);
      }
    });

    const prevUidRef = { current: null as string | null };
    const unsubscribeAuth = subscribeToAuthChanges((nextUser) => {
      if (!active) return;
      const previousUid = prevUidRef.current;
      prevUidRef.current = nextUser?.uid ?? null;
      if (previousUid && previousUid !== nextUser?.uid) {
        clearViewerScopedMediaCache(previousUid);
        clearSearchBundleCache();
        void notifyViewerSessionReset(previousUid);
      }
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        clearViewerScopedMediaCache(null);
        clearSearchBundleCache();
        void notifyViewerSessionReset(previousUid);
        setProfile(null);
        setRoleRecord(null);
        setLiveNotifications([]);
        setOlderNotifications([]);
        setNotificationsStatus('ready');
        setHasMoreNotifications(false);
        setLoadingOlderNotifications(false);
        setNotificationError(null);
        setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
        setInterestCategories([]);
        oldestNotificationCursorRef.current = null;
        hasLoadedOlderNotificationsRef.current = false;
        syncedBackgroundUidRef.current = null;
        setFollowingUsernames(new Set());
        setFollowerUsernames(new Set());
        setPendingFollowUsernames(new Set());
      } else {
        if (isDesignatedSupremeAdminUser(nextUser)) {
          void ensureDesignatedSupremeAdminAccountState(nextUser);
        }
        setNotificationsStatus('loading');
        setOlderNotifications([]);
        oldestNotificationCursorRef.current = null;
        hasLoadedOlderNotificationsRef.current = false;
        setHasMoreNotifications(false);
        setNotificationError(null);
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

    let cancelled = false;
    void fetchPrivateUserData(user.uid)
      .then((priv) => {
        if (cancelled || !priv) return;
        if (priv.notificationPrefs) {
          setNotificationPrefs(
            normalizeNotificationPrefs(priv.notificationPrefs)
          );
        }
        if (Array.isArray(priv.interestCategories)) {
          setInterestCategories(normalizeInterestList(priv.interestCategories));
        }
      })
      .catch(() => undefined);

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
      (snapshot) => {
        setLiveNotifications(snapshot.items);
        if (!hasLoadedOlderNotificationsRef.current) {
          oldestNotificationCursorRef.current = snapshot.oldestDoc;
          setHasMoreNotifications(snapshot.hasMore);
        }
        setNotificationsStatus('ready');
        setNotificationError(null);
      },
      (err) => {
        setNotificationsStatus('error');
        setNotificationError(
          formatFirestoreOrAppError(
            err,
            'Unable to sync notifications right now.'
          )
        );
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
      cancelled = true;
      unsubscribeRole();
      unsubscribeProfile();
      unsubscribeNotifications();
      unsubscribeFollows();
    };
  }, [authReady, user]);

  useEffect(() => {
    if (
      !authReady ||
      !user ||
      !profile ||
      isAccountSuspended(profile) ||
      notificationsStatus !== 'ready' ||
      syncedBackgroundUidRef.current === user.uid
    ) {
      return;
    }

    syncedBackgroundUidRef.current = user.uid;
    const existingIds = new Set(liveNotifications.map((item) => item.id));
    void syncOwnAnonymousReplyNotifications(user.uid, existingIds);
    void syncOwnExpiredMarketplaceNotifications(user.uid, existingIds);
    void syncOwnAnonymousLikesReceivedCount(user.uid);
  }, [authReady, user, profile, notificationsStatus, liveNotifications]);

  const refreshAccountState = useCallback(async () => {
    if (!user) return;
    const [nextProfile, nextRole, nextPrivate] = await Promise.all([
      fetchPublicMemberProfile(user.uid),
      fetchUserRoleRecord(user.uid),
      fetchPrivateUserData(user.uid).catch(() => null),
    ]);
    setProfile(nextProfile);
    setRoleRecord(nextRole);
    if (nextPrivate?.notificationPrefs) {
      setNotificationPrefs(
        normalizeNotificationPrefs(nextPrivate.notificationPrefs)
      );
    }
    if (Array.isArray(nextPrivate?.interestCategories)) {
      setInterestCategories(
        normalizeInterestList(nextPrivate.interestCategories)
      );
    }
  }, [user]);

  const markNotificationReadOptimistic = useCallback(
    async (notificationId: string) => {
      if (!user || isAccountSuspended(profile)) return;
      const liveApplied = applyOptimisticMarkRead(
        liveNotifications,
        notificationId
      );
      const olderApplied = applyOptimisticMarkRead(
        olderNotifications,
        notificationId
      );

      if (!liveApplied.changed && !olderApplied.changed) {
        return;
      }

      if (liveApplied.changed) {
        setLiveNotifications(liveApplied.nextItems);
      }
      if (olderApplied.changed) {
        setOlderNotifications(olderApplied.nextItems);
      }
      setNotificationError(null);

      try {
        await markNotificationAsRead(notificationId);
      } catch (err) {
        if (liveApplied.changed) {
          setLiveNotifications((prev) =>
            rollbackOptimisticMarkReadIds(prev, [notificationId])
          );
        }
        if (olderApplied.changed) {
          setOlderNotifications((prev) =>
            rollbackOptimisticMarkReadIds(prev, [notificationId])
          );
        }
        setNotificationError(
          formatFirestoreOrAppError(
            err,
            'Could not mark notification as read. Restored state.'
          )
        );
      }
    },
    [user, profile, liveNotifications, olderNotifications]
  );

  const markAllNotificationsReadOptimistic = useCallback(async () => {
    if (!user || isAccountSuspended(profile)) return;
    const unreadTargets = notifications.filter((item) => !item.isRead);
    if (unreadTargets.length === 0) return;

    const liveApplied = applyOptimisticMarkAllRead(liveNotifications);
    const olderApplied = applyOptimisticMarkAllRead(olderNotifications);

    setLiveNotifications(liveApplied.nextItems);
    setOlderNotifications(olderApplied.nextItems);
    setNotificationError(null);

    try {
      await markAllNotificationsAsRead(unreadTargets);
    } catch (err) {
      if (liveApplied.changedIds.length > 0) {
        setLiveNotifications((prev) =>
          rollbackOptimisticMarkReadIds(prev, liveApplied.changedIds)
        );
      }
      if (olderApplied.changedIds.length > 0) {
        setOlderNotifications((prev) =>
          rollbackOptimisticMarkReadIds(prev, olderApplied.changedIds)
        );
      }
      setNotificationError(
        formatFirestoreOrAppError(
          err,
          'Unable to mark all notifications as read right now.'
        )
      );
    }
  }, [user, profile, notifications, liveNotifications, olderNotifications]);

  const deleteNotificationOptimistic = useCallback(
    async (notificationId: string) => {
      if (!user || isAccountSuspended(profile)) return;
      const liveRemoved = applyOptimisticDeleteNotification(
        liveNotifications,
        notificationId
      );
      const olderRemoved = applyOptimisticDeleteNotification(
        olderNotifications,
        notificationId
      );

      if (!liveRemoved.removedItem && !olderRemoved.removedItem) {
        return;
      }

      if (liveRemoved.removedItem) {
        setLiveNotifications(liveRemoved.nextItems);
      }
      if (olderRemoved.removedItem) {
        setOlderNotifications(olderRemoved.nextItems);
      }
      setNotificationError(null);

      try {
        await deleteUserNotification(notificationId);
      } catch (err) {
        if (liveRemoved.removedItem) {
          const item = liveRemoved.removedItem;
          const idx = liveRemoved.removedIndex;
          setLiveNotifications((prev) => restoreDeletedNotification(prev, item, idx));
        }
        if (olderRemoved.removedItem) {
          const item = olderRemoved.removedItem;
          const idx = olderRemoved.removedIndex;
          setOlderNotifications((prev) =>
            restoreDeletedNotification(prev, item, idx)
          );
        }
        setNotificationError(
          formatFirestoreOrAppError(
            err,
            'Could not remove that notification. It has been restored.'
          )
        );
      }
    },
    [user, profile, liveNotifications, olderNotifications]
  );

  const loadOlderNotifications = useCallback(async () => {
    if (
      !user ||
      loadingOlderNotifications ||
      !hasMoreNotifications ||
      !oldestNotificationCursorRef.current
    ) {
      return;
    }

    setLoadingOlderNotifications(true);
    setNotificationError(null);
    try {
      const page = await fetchOlderUserNotificationsPage(
        user.uid,
        oldestNotificationCursorRef.current,
        30
      );
      if (page.items.length > 0) {
        hasLoadedOlderNotificationsRef.current = true;
      }
      setOlderNotifications((prev) => mergeNotifications(prev, page.items));
      oldestNotificationCursorRef.current = page.oldestDoc;
      setHasMoreNotifications(page.hasMore);
    } catch (err) {
      setNotificationError(
        formatFirestoreOrAppError(
          err,
          'Unable to load older notifications right now.'
        )
      );
    } finally {
      setLoadingOlderNotifications(false);
    }
  }, [user, loadingOlderNotifications, hasMoreNotifications]);

  const updateNotificationPrefsOptimistic = useCallback(
    async (nextPrefs: NotificationPreferences) => {
      if (!user || isAccountSuspended(profile)) return;
      const previousPrefs = notificationPrefs;
      const normalized = normalizeNotificationPrefs(nextPrefs);
      setNotificationPrefs(normalized);
      setNotificationError(null);

      try {
        await updateNotificationPreferences(user.uid, normalized);
      } catch (err) {
        setNotificationPrefs(previousPrefs);
        const msg = formatFirestoreOrAppError(
          err,
          'Could not save notification preferences. Previous settings restored.'
        );
        setNotificationError(msg);
        throw new Error(msg, { cause: err });
      }
    },
    [user, profile, notificationPrefs]
  );

  const updateInterestCategoriesOptimistic = useCallback(
    async (nextInterests: readonly string[]) => {
      if (!user || isAccountSuspended(profile)) return;
      const previousInterests = interestCategories;
      const normalized = normalizeInterestList(nextInterests);
      setInterestCategories(normalized);

      try {
        const saved = await updatePrivateUserInterests(
          user.uid,
          normalized,
          user.email
        );
        setInterestCategories(saved);
      } catch (err) {
        setInterestCategories(previousInterests);
        const msg = formatFirestoreOrAppError(
          err,
          'Could not save feed topic interests right now.'
        );
        throw new Error(msg, { cause: err });
      }
    },
    [user, profile, interestCategories]
  );

  const clearNotificationError = useCallback(() => {
    setNotificationError(null);
  }, []);

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
        notifications,
        notificationsStatus,
        hasMoreNotifications,
        loadingOlderNotifications,
        notificationError,
        notificationPrefs,
        interestCategories,
        firestoreConnected,
        followingUsernames,
        followerUsernames,
        pendingFollowUsernames,
        getRelationshipState,
        toggleFollow,
        markNotificationReadOptimistic,
        markAllNotificationsReadOptimistic,
        deleteNotificationOptimistic,
        loadOlderNotifications,
        updateNotificationPrefsOptimistic,
        updateInterestCategoriesOptimistic,
        clearNotificationError,
        refreshAccountState,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

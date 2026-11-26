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
import {
  auth,
  ensureVerifiedEmailTokenClaim,
  reconnectFirestoreNetwork,
  testConnection,
} from '../lib/firebase';
import { clearViewerScopedMediaCache } from '../services/mediaStorage';
import { notifyViewerSessionReset } from '../services/cacheInvalidation';
import { clearSearchBundleCache } from '../services/searchDiscovery';
import { subscribeToAuthChanges } from '../services/auth';
import {
  dispatchLocalAllowedNotificationsBatch,
  markPushReceivedFromServiceWorker,
  syncAppBadgeWithServiceWorker,
  verifyStoredPushSubscriptionForUser,
} from '../services/webPush';
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
  markNotificationAsUnread,
  subscribePublicMemberProfile,
  subscribeUnreadNotificationsSummary,
  subscribeUserNotifications,
  subscribeUserRoleRecord,
  subscribeViewerFollowUsernames,
  syncOwnAnonymousReplyNotifications,
  syncOwnExpiredMarketplaceNotifications,
  unfollowMemberByUsername,
  updateNotificationPreferences,
  updatePrivateUserInterests,
  type UnreadNotificationSummaryItem,
} from '../services/firestoreFoundation';
import { syncOwnAnonymousLikesReceivedCount } from '../services/socialPosts';
import {
  isValidFirestoreId,
  type NotificationEventType,
  type NotificationItem,
  type PublicUserProfile,
  type UserRoleRecord,
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
  applyOptimisticMarkUnread,
  computeUnreadNotificationsCount,
  isNotificationAllowedByPrefs,
  mergeNotifications,
  normalizeNotificationPrefs,
  restoreDeletedNotification,
  rollbackOptimisticMarkReadIds,
  rollbackOptimisticMarkUnreadIds,
  type NotificationPreferences,
} from '../utils/notifications';
import {
  playNotificationSound,
  unlockNotificationAudio,
} from '../utils/notificationSound';
import { normalizeInterestList } from '../utils/feedRanking';
import {
  FirebaseContext,
  type SyncedAccountSnapshot,
} from './firebaseContext';

interface FirebaseProviderProps {
  children: ReactNode;
}

export function FirebaseProvider({ children }: FirebaseProviderProps) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [, setAuthUserVersion] = useState(0);
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [roleRecord, setRoleRecord] = useState<UserRoleRecord | null>(null);
  const [roleSyncedUid, setRoleSyncedUid] = useState<string | null>(null);
  const [profileSyncedUid, setProfileSyncedUid] = useState<string | null>(null);
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
  const seenLiveNotifIdsRef = useRef<Set<string>>(new Set());
  const notifBaselineReadyForUidRef = useRef<string | null>(null);
  const notificationPrefsRef = useRef<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const profileRef = useRef<PublicUserProfile | null>(null);
  const liveNotificationsRef = useRef<NotificationItem[]>([]);
  const [unreadNotificationRefs, setUnreadNotificationRefs] = useState<
    UnreadNotificationSummaryItem[] | null
  >(null);
  const [foregroundNotificationToast, setForegroundNotificationToast] =
    useState<NotificationItem | null>(null);

  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    liveNotificationsRef.current = liveNotifications;
  }, [liveNotifications]);

  const notifications = useMemo(
    () => mergeNotifications(liveNotifications, olderNotifications),
    [liveNotifications, olderNotifications]
  );

  const unreadNotificationsCount = useMemo(() => {
    if (unreadNotificationRefs !== null) {
      let count = 0;
      for (const item of unreadNotificationRefs) {
        if (isNotificationAllowedByPrefs(item, notificationPrefs)) {
          count += 1;
        }
      }
      return count;
    }
    return computeUnreadNotificationsCount(notifications, notificationPrefs);
  }, [unreadNotificationRefs, notifications, notificationPrefs]);

  useEffect(() => {
    if (!authReady) return;
    void syncAppBadgeWithServiceWorker(user ? unreadNotificationsCount : 0);
  }, [authReady, user, unreadNotificationsCount]);

  useEffect(() => {
    let active = true;
    let connectedState: boolean | null = null;
    const applyConnectionResult = (connected: boolean) => {
      connectedState = connected;
      if (active) {
        setFirestoreConnected(connected);
      }
    };

    void testConnection().then((result) => {
      applyConnectionResult(result.connected);
    });

    const handleOnline = () => {
      void reconnectFirestoreNetwork().then((result) => {
        applyConnectionResult(result.connected);
      });
      const currentUid = auth.currentUser?.uid;
      if (
        currentUid &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        void verifyStoredPushSubscriptionForUser(currentUid);
      }
    };
    const handleOffline = () => {
      applyConnectionResult(false);
    };
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        connectedState === false &&
        typeof navigator !== 'undefined' &&
        navigator.onLine !== false
      ) {
        void reconnectFirestoreNetwork().then((result) => {
          applyConnectionResult(result.connected);
        });
      }
    };

    const handleUserAudioUnlock = () => {
      unlockNotificationAudio();
    };
    window.addEventListener('pointerdown', handleUserAudioUnlock, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', handleUserAudioUnlock, {
      once: true,
      passive: true,
    });

    const handlePushReceiptMessage = (rawData: unknown) => {
      if (!rawData || typeof rawData !== 'object') return;
      const data = rawData as Record<string, unknown>;
      if (data.type !== 'LASUED_PUSH_RECEIVED') return;
      const notificationId =
        typeof data.notificationId === 'string' ? data.notificationId : null;
      const tag = typeof data.tag === 'string' ? data.tag : null;
      markPushReceivedFromServiceWorker({ notificationId, tag });

      if (
        auth.currentUser &&
        !isAccountSuspended(profileRef.current) &&
        document.visibilityState === 'visible'
      ) {
        const eventType =
          typeof data.eventType === 'string'
            ? (data.eventType as NotificationEventType)
            : null;
        if (
          !eventType ||
          isNotificationAllowedByPrefs({ eventType }, notificationPrefsRef.current)
        ) {
          playNotificationSound(notificationId);
        }
      }
    };

    let pushBroadcastChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        pushBroadcastChannel = new BroadcastChannel('lasued-push-events');
        pushBroadcastChannel.onmessage = (event) => {
          handlePushReceiptMessage(event.data);
        };
      } catch {
        pushBroadcastChannel = null;
      }
    }

    const handleSwMessage = (event: MessageEvent) => {
      handlePushReceiptMessage(event.data);
    };
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
        setRoleSyncedUid(null);
        setProfileSyncedUid(null);
        setLiveNotifications([]);
        setOlderNotifications([]);
        setUnreadNotificationRefs(null);
        setNotificationsStatus('ready');
        setHasMoreNotifications(false);
        setLoadingOlderNotifications(false);
        setNotificationError(null);
        setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
        setInterestCategories([]);
        oldestNotificationCursorRef.current = null;
        hasLoadedOlderNotificationsRef.current = false;
        syncedBackgroundUidRef.current = null;
        seenLiveNotifIdsRef.current = new Set();
        notifBaselineReadyForUidRef.current = null;
        setForegroundNotificationToast(null);
        setFollowingUsernames(new Set());
        setFollowerUsernames(new Set());
        setPendingFollowUsernames(new Set());
      } else {
        if (isDesignatedSupremeAdminUser(nextUser)) {
          void ensureVerifiedEmailTokenClaim(nextUser).then(() =>
            ensureDesignatedSupremeAdminAccountState(nextUser)
          );
        }
        if (previousUid !== nextUser.uid) {
          setRoleSyncedUid(null);
          setProfileSyncedUid(null);
          setUnreadNotificationRefs(null);
          seenLiveNotifIdsRef.current = new Set();
          notifBaselineReadyForUidRef.current = null;
          setForegroundNotificationToast(null);
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
      pushBroadcastChannel?.close();
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      window.removeEventListener('pointerdown', handleUserAudioUnlock);
      window.removeEventListener('keydown', handleUserAudioUnlock);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const activeUid = user?.uid ?? null;

  useEffect(() => {
    if (!authReady || !activeUid) {
      return;
    }

    let cancelled = false;
    void fetchPrivateUserData(activeUid)
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

    const unsubscribeRole = subscribeUserRoleRecord(
      activeUid,
      (record) => {
        setRoleRecord(record);
        setRoleSyncedUid(activeUid);
      },
      () => {
        setRoleSyncedUid(activeUid);
      }
    );

    const unsubscribeProfile = subscribePublicMemberProfile(
      activeUid,
      (nextProfile) => {
        setProfile(nextProfile);
        setProfileSyncedUid(activeUid);
        if (nextProfile?.username) {
          uidToUsernameCacheRef.current.set(
            nextProfile.uid,
            nextProfile.username.toLowerCase()
          );
        }
      },
      () => {
        setProfileSyncedUid(activeUid);
      }
    );

    const unsubscribeNotifications = subscribeUserNotifications(
      activeUid,
      (snapshot) => {
        if (notifBaselineReadyForUidRef.current !== activeUid) {
          seenLiveNotifIdsRef.current = new Set(
            snapshot.items.map((item) => item.id)
          );
          notifBaselineReadyForUidRef.current = activeUid;
        } else {
          const incomingAllowed = snapshot.items.filter(
            (item) =>
              !seenLiveNotifIdsRef.current.has(item.id) &&
              !item.isRead &&
              isNotificationAllowedByPrefs(item, notificationPrefsRef.current)
          );
          for (const item of snapshot.items) {
            seenLiveNotifIdsRef.current.add(item.id);
          }
          if (incomingAllowed.length > 0) {
            setForegroundNotificationToast(incomingAllowed[0]);
            if (!isAccountSuspended(profileRef.current)) {
              playNotificationSound(incomingAllowed[0].id);
              void dispatchLocalAllowedNotificationsBatch(incomingAllowed, {
                uid: activeUid,
                prefs: notificationPrefsRef.current,
              });
            }
          }
        }
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

    const unsubscribeUnreadSummary = subscribeUnreadNotificationsSummary(
      activeUid,
      (summary) => {
        if (!cancelled) {
          setUnreadNotificationRefs(summary);
        }
      }
    );

    const unsubscribeFollows = subscribeViewerFollowUsernames(
      activeUid,
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
      unsubscribeUnreadSummary();
      unsubscribeFollows();
    };
  }, [authReady, activeUid]);

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
    const runBackgroundSync = () => {
      const existingIds = new Set(
        liveNotificationsRef.current.map((item) => item.id)
      );
      void syncOwnAnonymousReplyNotifications(user.uid, existingIds);
      void syncOwnExpiredMarketplaceNotifications(user.uid, existingIds);
      void syncOwnAnonymousLikesReceivedCount(user.uid);
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        void verifyStoredPushSubscriptionForUser(user.uid);
      }
    };

    runBackgroundSync();

    let lastSyncAt = Date.now();
    const maybeResync = () => {
      const now = Date.now();
      if (now - lastSyncAt < 20_000) return;
      lastSyncAt = now;
      runBackgroundSync();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        maybeResync();
      }
    };

    window.addEventListener('focus', maybeResync);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', maybeResync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [authReady, user, profile, notificationsStatus]);

  const refreshAccountState = useCallback(async () => {
    const activeUser = auth.currentUser ?? user;
    if (!activeUser) return;
    const [nextProfile, nextRole, nextPrivate] = await Promise.all([
      fetchPublicMemberProfile(activeUser.uid),
      fetchUserRoleRecord(activeUser.uid),
      fetchPrivateUserData(activeUser.uid).catch(() => null),
    ]);
    setProfile(nextProfile);
    setRoleRecord(nextRole);
    setProfileSyncedUid(activeUser.uid);
    setRoleSyncedUid(activeUser.uid);
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

  const refreshVerificationStatus = useCallback(async (): Promise<SyncedAccountSnapshot> => {
    const current = auth.currentUser ?? user;
    if (!current) {
      return {
        verified: false,
        user: null,
        profile: null,
        roleRecord: null,
      };
    }

    await current.reload().catch(() => undefined);
    const reloaded = auth.currentUser ?? current;
    if (reloaded.emailVerified) {
      await reloaded.getIdToken(true).catch(() => undefined);
      if (isDesignatedSupremeAdminUser(reloaded)) {
        await ensureDesignatedSupremeAdminAccountState(reloaded).catch(
          () => undefined
        );
      }
    }

    const [nextProfile, nextRole, nextPrivate] = await Promise.all([
      fetchPublicMemberProfile(reloaded.uid),
      fetchUserRoleRecord(reloaded.uid),
      fetchPrivateUserData(reloaded.uid).catch(() => null),
    ]);

    setUser(reloaded);
    setAuthUserVersion((prev) => prev + 1);
    setProfile(nextProfile);
    setRoleRecord(nextRole);
    setProfileSyncedUid(reloaded.uid);
    setRoleSyncedUid(reloaded.uid);
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

    return {
      verified: reloaded.emailVerified === true,
      user: reloaded,
      profile: nextProfile,
      roleRecord: nextRole,
    };
  }, [user]);

  useEffect(() => {
    if (!authReady || !user || user.emailVerified) {
      return;
    }

    let lastCheckedAt = 0;
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastCheckedAt < 2000) return;
      lastCheckedAt = now;
      void refreshVerificationStatus().catch(() => undefined);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        maybeRefresh();
      }
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authReady, user, refreshVerificationStatus]);

  const markNotificationReadOptimistic = useCallback(
    async (notificationId: string) => {
      if (!user || isAccountSuspended(profile) || !isValidFirestoreId(notificationId)) {
        return;
      }
      const liveApplied = applyOptimisticMarkRead(
        liveNotifications,
        notificationId
      );
      const olderApplied = applyOptimisticMarkRead(
        olderNotifications,
        notificationId
      );
      const alreadyMarkedRead =
        (!liveApplied.changed && !olderApplied.changed) &&
        (liveNotifications.some((n) => n.id === notificationId && n.isRead) ||
          olderNotifications.some((n) => n.id === notificationId && n.isRead));

      if (alreadyMarkedRead) {
        return;
      }

      if (liveApplied.changed) {
        setLiveNotifications(liveApplied.nextItems);
      }
      if (olderApplied.changed) {
        setOlderNotifications(olderApplied.nextItems);
      }
      setUnreadNotificationRefs((prev) =>
        prev ? prev.filter((entry) => entry.id !== notificationId) : prev
      );
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

  const markNotificationUnreadOptimistic = useCallback(
    async (notificationId: string) => {
      if (!user || isAccountSuspended(profile)) return;
      const liveApplied = applyOptimisticMarkUnread(
        liveNotifications,
        notificationId
      );
      const olderApplied = applyOptimisticMarkUnread(
        olderNotifications,
        notificationId
      );

      if (!liveApplied.changed && !olderApplied.changed) {
        return;
      }

      // Keep existing ID marked as seen so marking unread doesn't re-pop foreground toast
      seenLiveNotifIdsRef.current.add(notificationId);

      if (liveApplied.changed) {
        setLiveNotifications(liveApplied.nextItems);
      }
      if (olderApplied.changed) {
        setOlderNotifications(olderApplied.nextItems);
      }
      const targetNotif =
        liveNotifications.find((n) => n.id === notificationId) ??
        olderNotifications.find((n) => n.id === notificationId);
      if (targetNotif) {
        setUnreadNotificationRefs((prev) => {
          if (!prev) return prev;
          if (prev.some((entry) => entry.id === notificationId)) return prev;
          return [...prev, { id: notificationId, eventType: targetNotif.eventType }];
        });
      }
      setNotificationError(null);

      try {
        await markNotificationAsUnread(notificationId);
      } catch (err) {
        if (liveApplied.changed) {
          setLiveNotifications((prev) =>
            rollbackOptimisticMarkUnreadIds(prev, [notificationId])
          );
        }
        if (olderApplied.changed) {
          setOlderNotifications((prev) =>
            rollbackOptimisticMarkUnreadIds(prev, [notificationId])
          );
        }
        setNotificationError(
          formatFirestoreOrAppError(
            err,
            'Could not mark notification as unread. Restored state.'
          )
        );
      }
    },
    [user, profile, liveNotifications, olderNotifications]
  );

  const markAllNotificationsReadOptimistic = useCallback(async () => {
    if (!user || isAccountSuspended(profile)) return;
    const unreadTargets = notifications.filter((item) => !item.isRead);
    const extraUnreadIds = (unreadNotificationRefs ?? []).map((entry) => entry.id);
    if (unreadTargets.length === 0 && extraUnreadIds.length === 0) return;

    const liveApplied = applyOptimisticMarkAllRead(liveNotifications);
    const olderApplied = applyOptimisticMarkAllRead(olderNotifications);

    setLiveNotifications(liveApplied.nextItems);
    setOlderNotifications(olderApplied.nextItems);
    setUnreadNotificationRefs((prev) => (prev ? [] : prev));
    setNotificationError(null);

    try {
      await markAllNotificationsAsRead(unreadTargets, extraUnreadIds);
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
  }, [
    user,
    profile,
    notifications,
    unreadNotificationRefs,
    liveNotifications,
    olderNotifications,
  ]);

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
      setUnreadNotificationRefs((prev) =>
        prev ? prev.filter((entry) => entry.id !== notificationId) : prev
      );
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
        await updateNotificationPreferences(user.uid, normalized, user.email);
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

  const dismissForegroundNotificationToast = useCallback(() => {
    setForegroundNotificationToast(null);
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

  const accountSyncReady =
    authReady &&
    (!user || (roleSyncedUid === user.uid && profileSyncedUid === user.uid));
  const effectiveTier = resolveEffectiveAccountTier(user, roleRecord);
  const isSuspended = isAccountSuspended(profile);

  return (
    <FirebaseContext.Provider
      value={{
        authReady,
        accountSyncReady,
        user,
        profile,
        roleRecord,
        effectiveTier,
        isSuspended,
        unreadNotificationsCount,
        notifications,
        foregroundNotificationToast,
        dismissForegroundNotificationToast,
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
        markNotificationUnreadOptimistic,
        markAllNotificationsReadOptimistic,
        deleteNotificationOptimistic,
        loadOlderNotifications,
        updateNotificationPrefsOptimistic,
        updateInterestCategoriesOptimistic,
        clearNotificationError,
        refreshAccountState,
        refreshVerificationStatus,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useFirebase } from '../context/firebaseContext';
import {
  disableCurrentDevicePushSubscription,
  fetchConfiguredVapidPublicKey,
  readDevicePushOptOut,
  subscribeDeviceToWebPush,
  verifyStoredPushSubscriptionForUser,
  writeDevicePushOptOut,
} from '../services/webPush';
import {
  detectDeviceEnvironment,
  evaluatePushCapabilities,
  resolveWebPushUiStatus,
  type PushCapabilityAssessment,
  type WebPushButtonStatus,
} from '../utils/pwa';

export type { WebPushButtonStatus };
export { resolveWebPushUiStatus };

export interface UseWebPushNotificationsResult {
  capability: PushCapabilityAssessment;
  status: WebPushButtonStatus;
  permission: NotificationPermission | 'unsupported';
  vapidConfigured: boolean | null;
  errorMessage: string | null;
  enableNotifications: () => Promise<boolean>;
  disableNotifications: () => Promise<void>;
  clearError: () => void;
}

export function useWebPushNotifications(): UseWebPushNotificationsResult {
  const { user, isSuspended } = useFirebase();

  const [capability, setCapability] = useState<PushCapabilityAssessment>(() =>
    evaluatePushCapabilities(detectDeviceEnvironment())
  );
  const [permission, setPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [verifiedForUid, setVerifiedForUid] = useState<string | null>(null);
  const [optedOutOverride, setOptedOutOverride] = useState<{
    uid: string;
    optedOut: boolean;
  } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [vapidConfigured, setVapidConfigured] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshCapability = () => {
      setCapability(evaluatePushCapabilities(detectDeviceEnvironment()));
      if ('Notification' in window) {
        setPermission(Notification.permission);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshCapability();
      }
    };

    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', refreshCapability);
    window.addEventListener('focus', refreshCapability);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let permissionStatus: PermissionStatus | null = null;
    let cancelled = false;
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((result) => {
          if (cancelled) return;
          permissionStatus = result;
          result.onchange = refreshCapability;
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      media?.removeEventListener?.('change', refreshCapability);
      window.removeEventListener('focus', refreshCapability);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!capability.canShowEnableButton || !user || isSuspended) {
      return;
    }

    void fetchConfiguredVapidPublicKey().then((key) => {
      if (!cancelled) {
        setVapidConfigured(Boolean(key));
      }
    });

    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      void verifyStoredPushSubscriptionForUser(user.uid).then((verified) => {
        if (!cancelled) {
          setVerifiedForUid(verified ? user.uid : null);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [capability.canShowEnableButton, user, isSuspended, permission]);

  const enableNotifications = useCallback(async (): Promise<boolean> => {
    if (!user || isSuspended || !capability.canShowEnableButton) {
      return false;
    }
    if (enabling) return false;
    setErrorMessage(null);
    writeDevicePushOptOut(user.uid, false);
    setOptedOutOverride({ uid: user.uid, optedOut: false });

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setErrorMessage('Browser notifications are not supported on this device.');
      return false;
    }

    const currentPermission = Notification.permission;
    setPermission(currentPermission);

    // Never repeatedly prompt users who already blocked notifications
    if (currentPermission === 'denied') {
      return false;
    }

    setEnabling(true);
    try {
      let resolvedPermission: NotificationPermission = currentPermission;
      if (currentPermission === 'default') {
        resolvedPermission = await Notification.requestPermission();
        setPermission(resolvedPermission);
      }

      if (resolvedPermission !== 'granted') {
        setVerifiedForUid(null);
        return false;
      }

      const configuredKey = await fetchConfiguredVapidPublicKey().catch(
        () => null
      );
      setVapidConfigured(Boolean(configuredKey));
      if (!configuredKey) {
        setVerifiedForUid(null);
        setErrorMessage(
          'Browser notifications are allowed. Background alerts when the app is closed will finish activating once server push keys are configured.'
        );
        return false;
      }

      await subscribeDeviceToWebPush(user.uid, configuredKey);
      setVerifiedForUid(user.uid);
      setVapidConfigured(true);
      return true;
    } catch (err) {
      setVerifiedForUid(null);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to activate push notifications on this device right now.';
      setErrorMessage(message);
      return false;
    } finally {
      setEnabling(false);
    }
  }, [user, isSuspended, capability.canShowEnableButton, enabling]);

  const disableNotifications = useCallback(async (): Promise<void> => {
    if (!user) return;
    setErrorMessage(null);
    writeDevicePushOptOut(user.uid, true);
    setOptedOutOverride({ uid: user.uid, optedOut: true });
    await disableCurrentDevicePushSubscription(user.uid, { markOptedOut: true });
    setVerifiedForUid(null);
  }, [user]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const isSubscribedForUser = Boolean(
    user &&
      !isSuspended &&
      capability.canShowEnableButton &&
      permission === 'granted' &&
      verifiedForUid === user.uid
  );

  const isOptedOut = Boolean(
    user &&
      (optedOutOverride?.uid === user.uid
        ? optedOutOverride.optedOut
        : readDevicePushOptOut(user.uid))
  );

  const status = resolveWebPushUiStatus({
    isSignedIn: Boolean(user),
    isSuspended,
    capability,
    permission,
    vapidConfigured,
    enabling,
    isSubscribedForUser,
    isOptedOut,
  });

  return {
    capability,
    status,
    permission,
    vapidConfigured,
    errorMessage,
    enableNotifications,
    disableNotifications,
    clearError,
  };
}


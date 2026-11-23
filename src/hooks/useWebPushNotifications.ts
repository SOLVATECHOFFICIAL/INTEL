import { useCallback, useEffect, useState } from 'react';
import { useFirebase } from '../context/firebaseContext';
import {
  disableCurrentDevicePushSubscription,
  fetchConfiguredVapidPublicKey,
  subscribeDeviceToWebPush,
  verifyStoredPushSubscriptionForUser,
} from '../services/webPush';
import {
  detectDeviceEnvironment,
  evaluatePushCapabilities,
  type PushCapabilityAssessment,
} from '../utils/pwa';

export type WebPushButtonStatus =
  | 'hidden'
  | 'ready_to_enable'
  | 'enabling'
  | 'enabled'
  | 'denied';

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
  const [isSubscribedForUser, setIsSubscribedForUser] = useState(false);
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
    refreshCapability();
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', refreshCapability);
    return () => {
      media?.removeEventListener?.('change', refreshCapability);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!capability.canShowEnableButton || !user || isSuspended) {
      setIsSubscribedForUser(false);
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
          setIsSubscribedForUser(verified);
        }
      });
    } else {
      setIsSubscribedForUser(false);
    }

    return () => {
      cancelled = true;
    };
  }, [capability.canShowEnableButton, user, isSuspended]);

  const enableNotifications = useCallback(async (): Promise<boolean> => {
    if (!user || isSuspended || !capability.canShowEnableButton) {
      return false;
    }
    if (enabling) return false;
    setErrorMessage(null);

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
        setIsSubscribedForUser(false);
        return false;
      }

      await subscribeDeviceToWebPush(user.uid);
      setIsSubscribedForUser(true);
      setVapidConfigured(true);
      return true;
    } catch (err) {
      setIsSubscribedForUser(false);
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
    await disableCurrentDevicePushSubscription(user.uid);
    setIsSubscribedForUser(false);
  }, [user]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  let status: WebPushButtonStatus = 'hidden';
  if (user && !isSuspended && capability.canShowEnableButton) {
    if (permission === 'denied') {
      status = 'denied';
    } else if (enabling) {
      status = 'enabling';
    } else if (permission === 'granted' && isSubscribedForUser) {
      status = 'enabled';
    } else {
      status = 'ready_to_enable';
    }
  }

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

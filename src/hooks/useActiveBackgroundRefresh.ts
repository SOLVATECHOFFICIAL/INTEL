import { useEffect, useRef } from 'react';
import {
  computeActivePollDelayMs,
  isConstrainedDeviceOrNetwork,
} from '../utils/cacheSync';
import { isDataSaverConnection } from '../utils/mediaCache';

export interface UseActiveBackgroundRefreshOptions {
  enabled: boolean;
  onRefresh: () => Promise<void> | void;
  baseIntervalMs?: number;
  refreshOnVisible?: boolean;
  refreshOnReconnect?: boolean;
}

/**
 * Schedules low-impact ~5s background delta syncs ONLY when the page is visible
 * and online. Pauses immediately when hidden/offline, prevents overlapping runs,
 * and triggers a single catch-up refresh when returning visible or back online.
 */
export function useActiveBackgroundRefresh(
  options: UseActiveBackgroundRefreshOptions
): void {
  const {
    enabled,
    onRefresh,
    baseIntervalMs = 5000,
    refreshOnVisible = true,
    refreshOnReconnect = true,
  } = options;

  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    let disposed = false;
    let inFlight = false;
    let consecutiveErrors = 0;
    let timerId: number | null = null;
    let lastCompletedAt = Date.now();

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNext = () => {
      clearTimer();
      if (disposed) return;
      const isVisible =
        typeof document === 'undefined' ||
        document.visibilityState === 'visible';
      const isOnline =
        typeof navigator === 'undefined' || navigator.onLine !== false;

      const delay = computeActivePollDelayMs({
        isVisible,
        isOnline,
        isDataSaver: isDataSaverConnection(),
        isConstrainedDevice: isConstrainedDeviceOrNetwork(),
        consecutiveErrors,
        baseIntervalMs,
      });

      if (delay === null) {
        return;
      }

      timerId = window.setTimeout(() => {
        void runCycle();
      }, delay);
    };

    const runCycle = async () => {
      if (disposed || inFlight) return;
      const isVisible =
        typeof document === 'undefined' ||
        document.visibilityState === 'visible';
      const isOnline =
        typeof navigator === 'undefined' || navigator.onLine !== false;

      if (!isVisible || !isOnline) {
        return;
      }

      inFlight = true;
      try {
        await onRefreshRef.current();
        consecutiveErrors = 0;
        lastCompletedAt = Date.now();
      } catch {
        consecutiveErrors += 1;
      } finally {
        inFlight = false;
        scheduleNext();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearTimer();
        return;
      }
      if (
        refreshOnVisible &&
        Date.now() - lastCompletedAt >= Math.max(2500, baseIntervalMs)
      ) {
        void runCycle();
      } else {
        scheduleNext();
      }
    };

    const handleOnline = () => {
      consecutiveErrors = 0;
      if (refreshOnReconnect) {
        void runCycle();
      } else {
        scheduleNext();
      }
    };

    const handleOffline = () => {
      clearTimer();
    };

    scheduleNext();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled, baseIntervalMs, refreshOnVisible, refreshOnReconnect]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDataSaverConnection } from '../utils/mediaCache';

export interface NetworkStatusState {
  isOnline: boolean;
  isDataSaver: boolean;
  justReconnected: boolean;
  syncErrorMessage: string | null;
  reportSyncError: (message?: string | null) => void;
  clearSyncError: () => void;
}

export function useNetworkStatus(): NetworkStatusState {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [isDataSaver, setIsDataSaver] = useState<boolean>(() =>
    isDataSaverConnection()
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const wasOfflineRef = useRef(!isOnline);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setIsDataSaver(isDataSaverConnection());
      setSyncErrorMessage(null);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setJustReconnected(true);
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          setJustReconnected(false);
          reconnectTimerRef.current = null;
        }, 3500);
      }
    };

    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
      setJustReconnected(false);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const nav = navigator as Navigator & {
      connection?: {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
    };
    const handleConnectionChange = () => {
      setIsDataSaver(isDataSaverConnection());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    nav?.connection?.addEventListener?.('change', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      nav?.connection?.removeEventListener?.('change', handleConnectionChange);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []);

  const reportSyncError = useCallback((message?: string | null) => {
    setSyncErrorMessage(message?.trim() || 'Could not sync latest updates.');
  }, []);

  const clearSyncError = useCallback(() => {
    setSyncErrorMessage(null);
  }, []);

  return {
    isOnline,
    isDataSaver,
    justReconnected,
    syncErrorMessage,
    reportSyncError,
    clearSyncError,
  };
}

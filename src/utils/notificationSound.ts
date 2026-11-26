const NOTIF_SOUND_STORAGE_KEY = 'lasued_intel_notif_sound_enabled';
const CHIMED_NOTIFICATION_IDS = new Set<string>();
const MAX_CHIMED_IDS = 400;

let sharedAudioCtx: AudioContext | null = null;
let lastChimeAtMs = 0;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function getOrCreateAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(NOTIF_SOUND_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.localStorage.removeItem(NOTIF_SOUND_STORAGE_KEY);
    } else {
      window.localStorage.setItem(NOTIF_SOUND_STORAGE_KEY, '0');
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function unlockNotificationAudio(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

export function markNotificationSoundPlayed(notificationId?: string | null): boolean {
  if (!notificationId) return true;
  if (CHIMED_NOTIFICATION_IDS.has(notificationId)) {
    return false;
  }
  CHIMED_NOTIFICATION_IDS.add(notificationId);
  if (CHIMED_NOTIFICATION_IDS.size > MAX_CHIMED_IDS) {
    const oldest = CHIMED_NOTIFICATION_IDS.values().next().value;
    if (oldest) CHIMED_NOTIFICATION_IDS.delete(oldest);
  }
  return true;
}

function scheduleTwoNoteChime(ctx: AudioContext): boolean {
  try {
    const start = ctx.currentTime;
    const playTone = (
      freq: number,
      offsetSec: number,
      durationSec: number,
      peakGain: number
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start + offsetSec);

      gain.gain.setValueAtTime(0.0001, start + offsetSec);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + offsetSec + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + offsetSec + durationSec
      );

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offsetSec);
      osc.stop(start + offsetSec + durationSec + 0.02);
    };

    // Crisp two-note chime (D5 -> A5)
    playTone(587.33, 0, 0.14, 0.14);
    playTone(880.0, 0.1, 0.22, 0.16);
    return true;
  } catch {
    return false;
  }
}

export function playNotificationSound(
  notificationId?: string | null,
  options?: { force?: boolean; vibrate?: boolean }
): boolean {
  if (typeof window === 'undefined') return false;
  if (!options?.force && !isNotificationSoundEnabled()) {
    return false;
  }

  const nowMs = Date.now();
  if (!options?.force && nowMs - lastChimeAtMs < 450) {
    if (notificationId) {
      markNotificationSoundPlayed(notificationId);
    }
    return false;
  }

  if (notificationId && !markNotificationSoundPlayed(notificationId)) {
    return false;
  }

  lastChimeAtMs = nowMs;

  if (
    options?.vibrate !== false &&
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function'
  ) {
    try {
      navigator.vibrate([140, 60, 140]);
    } catch {
      // Ignore vibration permission blocks before user gesture
    }
  }

  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'running') {
    return scheduleTwoNoteChime(ctx);
  }

  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') {
          scheduleTwoNoteChime(ctx);
        }
      })
      .catch(() => undefined);
    return Boolean(options?.force);
  }

  return false;
}

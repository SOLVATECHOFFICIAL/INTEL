export const THEME_STORAGE_KEY = 'lasued-intel-theme';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export function isValidThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === 'dark') {
    return 'dark';
  }
  if (preference === 'light') {
    return 'light';
  }
  return systemPrefersDark ? 'dark' : 'light';
}

export function getNextThemeToggle(resolved: ResolvedTheme): ThemePreference {
  return resolved === 'dark' ? 'light' : 'dark';
}

export function readStoredThemePreference(
  storage: Pick<Storage, 'getItem'> | null | undefined
): ThemePreference {
  if (!storage) return 'light';
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isValidThemePreference(raw) ? raw : 'light';
  } catch {
    return 'light';
  }
}

export function writeStoredThemePreference(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  preference: ThemePreference
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage quota or private-mode restriction
  }
}

export function applyThemeToDocument(
  resolved: ResolvedTheme,
  doc: Document | null | undefined = typeof document !== 'undefined' ? document : null
): void {
  if (!doc) return;
  const root = doc.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.colorScheme = resolved;

  const themeMeta = doc.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', resolved === 'dark' ? '#07101F' : '#0B1A2E');
  }
}

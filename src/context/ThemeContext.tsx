import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeToDocument,
  getNextThemeToggle,
  readStoredThemePreference,
  resolveEffectiveTheme,
  writeStoredThemePreference,
  type ThemePreference,
} from '../utils/theme';
import { ThemeContext, type ThemeContextValue } from './themeContext';

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredThemePreference(typeof window !== 'undefined' ? window.localStorage : null)
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    getSystemPrefersDark()
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveEffectiveTheme(preference, systemPrefersDark),
    [preference, systemPrefersDark]
  );

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const setThemePreference = useCallback((nextPref: ThemePreference) => {
    setPreferenceState(nextPref);
    writeStoredThemePreference(
      typeof window !== 'undefined' ? window.localStorage : null,
      nextPref
    );
  }, []);

  const toggleTheme = useCallback(() => {
    setPreferenceState((currentPref) => {
      const currentlyDark = resolveEffectiveTheme(currentPref, systemPrefersDark);
      const next = getNextThemeToggle(currentlyDark);
      writeStoredThemePreference(
        typeof window !== 'undefined' ? window.localStorage : null,
        next
      );
      return next;
    });
  }, [systemPrefersDark]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      isDark: resolvedTheme === 'dark',
      setThemePreference,
      toggleTheme,
    }),
    [preference, resolvedTheme, setThemePreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

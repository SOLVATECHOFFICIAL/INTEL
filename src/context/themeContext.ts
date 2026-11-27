import { createContext, useContext } from 'react';
import type { ResolvedTheme, ThemePreference } from '../utils/theme';

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  isDark: boolean;
  setThemePreference: (pref: ThemePreference) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  preference: 'light',
  resolvedTheme: 'light',
  isDark: false,
  setThemePreference: () => undefined,
  toggleTheme: () => undefined,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

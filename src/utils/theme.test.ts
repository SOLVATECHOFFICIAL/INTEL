import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  THEME_STORAGE_KEY,
  getNextThemeToggle,
  isValidThemePreference,
  readStoredThemePreference,
  resolveEffectiveTheme,
  writeStoredThemePreference,
} from './theme';

describe('theme utilities', () => {
  it('validates allowed theme preferences', () => {
    assert.equal(isValidThemePreference('light'), true);
    assert.equal(isValidThemePreference('dark'), true);
    assert.equal(isValidThemePreference('system'), true);
    assert.equal(isValidThemePreference('midnight'), false);
    assert.equal(isValidThemePreference(null), false);
  });

  it('resolves explicit and system theme preferences accurately', () => {
    assert.equal(resolveEffectiveTheme('light', true), 'light');
    assert.equal(resolveEffectiveTheme('dark', false), 'dark');
    assert.equal(resolveEffectiveTheme('system', true), 'dark');
    assert.equal(resolveEffectiveTheme('system', false), 'light');
  });

  it('computes quick toggle transitions cleanly', () => {
    assert.equal(getNextThemeToggle('light'), 'dark');
    assert.equal(getNextThemeToggle('dark'), 'light');
  });

  it('reads and writes theme preference safely from storage', () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    assert.equal(readStoredThemePreference(mockStorage), 'light');
    writeStoredThemePreference(mockStorage, 'dark');
    assert.equal(store.get(THEME_STORAGE_KEY), 'dark');
    assert.equal(readStoredThemePreference(mockStorage), 'dark');

    store.set(THEME_STORAGE_KEY, 'invalid-value');
    assert.equal(readStoredThemePreference(mockStorage), 'light');
  });
});

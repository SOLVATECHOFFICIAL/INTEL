import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS_BACKGROUND_THEMES,
  TEXT_POST_BACKGROUND_THEMES,
  getAnonymousBackgroundTheme,
  getTextPostBackgroundTheme,
} from './anonymousBackgrounds';
import {
  ALLOWED_ANONYMOUS_BACKGROUND_IDS,
  ALLOWED_TEXT_POST_BACKGROUND_IDS,
} from '../types/database';

test('anonymous background themes align with schema IDs and enforce high-contrast text classes', () => {
  assert.equal(
    ANONYMOUS_BACKGROUND_THEMES.length,
    ALLOWED_ANONYMOUS_BACKGROUND_IDS.length
  );

  for (const allowedId of ALLOWED_ANONYMOUS_BACKGROUND_IDS) {
    const theme = getAnonymousBackgroundTheme(allowedId);
    assert.equal(theme.id, allowedId);
    assert.ok(theme.label.length > 0);
    assert.ok(theme.backgroundCss.length > 0);
    if (theme.isDark) {
      assert.equal(theme.textColorClass, 'text-white');
    } else {
      assert.equal(theme.textColorClass, 'text-[#0B1A2E]');
    }
  }
});

test('text post background themes exclude plain and align with ALLOWED_TEXT_POST_BACKGROUND_IDS', () => {
  assert.equal(
    TEXT_POST_BACKGROUND_THEMES.length,
    ALLOWED_TEXT_POST_BACKGROUND_IDS.length
  );
  assert.equal(
    TEXT_POST_BACKGROUND_THEMES.some((theme) => (theme.id as string) === 'plain'),
    false
  );
  for (const id of ALLOWED_TEXT_POST_BACKGROUND_IDS) {
    const theme = getTextPostBackgroundTheme(id);
    assert.equal(theme.id, id);
    assert.equal(theme.textColorClass, 'text-white');
  }
  assert.equal(
    getTextPostBackgroundTheme(undefined).id,
    TEXT_POST_BACKGROUND_THEMES[0].id
  );
});

test('getAnonymousBackgroundTheme falls back cleanly to plain for unknown IDs', () => {
  assert.equal(getAnonymousBackgroundTheme(undefined).id, 'plain');
  assert.equal(getAnonymousBackgroundTheme(null).id, 'plain');
  assert.equal(getAnonymousBackgroundTheme('unknown_style').id, 'plain');
});

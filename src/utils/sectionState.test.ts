import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_SECTIONS } from '../config/sections';
import {
  createInitialSectionStates,
  getSectionById,
  getSectionsByGroup,
  transitionViewState,
} from './sectionState';

test('defines all 9 required LASUED Intel sections with Updates and Anonymous naming', () => {
  assert.equal(PLATFORM_SECTIONS.length, 9);
  assert.deepEqual(
    PLATFORM_SECTIONS.map((s) => s.title),
    [
      'For You',
      'Following',
      'Latest',
      'Updates',
      'Anonymous',
      'Marketplace',
      'Trusted Circle',
      'Opportunities',
      'Events',
    ]
  );
  assert.equal(
    PLATFORM_SECTIONS.some((s) => s.title.toLowerCase().includes('unfiltered')),
    false
  );
});

test('groups sections into Feeds and Campus Hub', () => {
  const feeds = getSectionsByGroup('Feeds');
  const hub = getSectionsByGroup('Campus Hub');
  assert.equal(feeds.length, 5);
  assert.equal(hub.length, 4);
});

test('getSectionById returns exact matching section', () => {
  const section = getSectionById('trusted-circle');
  assert.equal(section.title, 'Trusted Circle');
  assert.equal(section.group, 'Campus Hub');

  const updatesSection = getSectionById('updates');
  assert.equal(updatesSection.title, 'Updates');
  assert.equal(updatesSection.group, 'Feeds');
});

test('createInitialSectionStates initializes all 9 section states', () => {
  const states = createInitialSectionStates('empty');
  assert.equal(Object.keys(states).length, 9);
  assert.equal(states['for-you'], 'empty');
  assert.equal(states['updates'], 'empty');
  assert.equal(states['upcoming-events'], 'empty');
});

test('transitionViewState handles retry and state switches cleanly', () => {
  assert.equal(transitionViewState('empty', 'SET_LOADING'), 'loading');
  assert.equal(transitionViewState('loading', 'SET_ERROR'), 'error');
  assert.equal(transitionViewState('error', 'RETRY'), 'loading');
  assert.equal(transitionViewState('empty', 'RETRY'), 'empty');
  assert.equal(transitionViewState('loading', 'SET_EMPTY'), 'empty');
});

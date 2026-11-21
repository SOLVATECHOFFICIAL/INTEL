import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_SECTIONS } from '../config/sections';
import {
  createInitialSectionStates,
  getSectionById,
  getSectionsByGroup,
  transitionViewState,
} from './sectionState';

test('defines all 8 required LASUED Intel placeholder sections in order', () => {
  assert.equal(PLATFORM_SECTIONS.length, 8);
  assert.deepEqual(
    PLATFORM_SECTIONS.map((s) => s.title),
    [
      'For You',
      'Following',
      'Latest',
      'The Unfiltered',
      'Marketplace',
      'Trusted Circle',
      'Opportunities',
      'Upcoming Events',
    ]
  );
});

test('groups sections evenly into Feeds and Campus Hub', () => {
  const feeds = getSectionsByGroup('Feeds');
  const hub = getSectionsByGroup('Campus Hub');
  assert.equal(feeds.length, 4);
  assert.equal(hub.length, 4);
});

test('getSectionById returns exact matching section', () => {
  const section = getSectionById('trusted-circle');
  assert.equal(section.title, 'Trusted Circle');
  assert.equal(section.group, 'Campus Hub');
});

test('createInitialSectionStates initializes all 8 section states', () => {
  const states = createInitialSectionStates('empty');
  assert.equal(Object.keys(states).length, 8);
  assert.equal(states['for-you'], 'empty');
  assert.equal(states['upcoming-events'], 'empty');
});

test('transitionViewState handles retry and state switches cleanly', () => {
  assert.equal(transitionViewState('empty', 'SET_LOADING'), 'loading');
  assert.equal(transitionViewState('loading', 'SET_ERROR'), 'error');
  assert.equal(transitionViewState('error', 'RETRY'), 'loading');
  assert.equal(transitionViewState('empty', 'RETRY'), 'empty');
  assert.equal(transitionViewState('loading', 'SET_EMPTY'), 'empty');
});

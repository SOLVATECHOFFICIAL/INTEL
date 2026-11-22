import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areDestinationsEqual,
  createInitialHistoryStack,
  findMostRecentSearchEntry,
  getBackTarget,
  moveToHistoryEntryKey,
  pushHistoryStackEntry,
  replaceCurrentHistoryDestination,
  resolveGuestSafeDestination,
  updateHistoryEntryScroll,
} from './navigationHistory';

test('pushHistoryStackEntry deduplicates identical consecutive destinations', () => {
  const stack = createInitialHistoryStack({ route: 'for-you' }, 120, 'k0');
  const firstPush = pushHistoryStackEntry(stack, { route: 'for-you' }, 340);

  assert.equal(firstPush.pushed, false);
  assert.equal(firstPush.stack.entries.length, 1);
  assert.equal(firstPush.stack.entries[0].scrollY, 340);
  assert.equal(firstPush.entry.key, 'k0');
});

test('multi-hop navigation records departing scroll positions and pops cleanly via getBackTarget', () => {
  const s0 = createInitialHistoryStack({ route: 'latest' }, 0, 'e0');
  const s1 = pushHistoryStackEntry(
    s0,
    { route: 'profile', username: 'Ada_Campus' },
    640
  ).stack;
  const s2 = pushHistoryStackEntry(
    s1,
    { route: 'profile', username: 'Tunde_Media' },
    210
  ).stack;

  assert.equal(s2.entries.length, 3);
  assert.equal(s2.entries[0].scrollY, 640);
  assert.equal(s2.entries[1].destination.username, 'ada_campus');
  assert.equal(s2.entries[1].scrollY, 210);
  assert.equal(s2.entries[2].destination.username, 'tunde_media');

  const back1 = getBackTarget(s2);
  assert.equal(back1.kind, 'history_back');
  if (back1.kind === 'history_back') {
    assert.equal(back1.steps, 1);
    assert.equal(back1.targetEntry.destination.username, 'ada_campus');
    assert.equal(back1.targetEntry.scrollY, 210);
  }

  const popped = moveToHistoryEntryKey(
    s2,
    s2.entries[1].key,
    s2.entries[1].destination
  );
  assert.equal(popped.found, true);
  assert.equal(popped.stack.index, 1);

  const back2 = getBackTarget(popped.stack);
  assert.equal(back2.kind, 'history_back');
  if (back2.kind === 'history_back') {
    assert.equal(back2.targetEntry.destination.route, 'latest');
    assert.equal(back2.targetEntry.scrollY, 640);
  }
});

test('forward history truncates cleanly after navigating to a new branch from a popped entry', () => {
  const s0 = createInitialHistoryStack({ route: 'marketplace' }, 0, 'm0');
  const s1 = pushHistoryStackEntry(
    s0,
    { route: 'marketplace', listingId: 'item_1' },
    512
  ).stack;
  const s2 = pushHistoryStackEntry(
    s1,
    { route: 'profile', username: 'seller_one' },
    90
  ).stack;

  const backToProduct = moveToHistoryEntryKey(
    s2,
    s2.entries[1].key,
    s2.entries[1].destination
  ).stack;
  const branchToEvents = pushHistoryStackEntry(
    backToProduct,
    { route: 'upcoming-events' },
    140
  ).stack;

  assert.equal(branchToEvents.entries.length, 3);
  assert.equal(branchToEvents.entries[1].destination.listingId, 'item_1');
  assert.equal(branchToEvents.entries[2].destination.route, 'upcoming-events');
});

test('direct deep links resolve to logical in-site parent fallbacks when history stack index is 0', () => {
  const listingDirect = createInitialHistoryStack({
    route: 'marketplace',
    listingId: 'mkt_99',
  });
  const listingBack = getBackTarget(listingDirect);
  assert.equal(listingBack.kind, 'fallback');
  if (listingBack.kind === 'fallback') {
    assert.equal(listingBack.destination.route, 'marketplace');
    assert.equal(listingBack.destination.listingId, null);
  }

  const eventDirect = createInitialHistoryStack({
    route: 'upcoming-events',
    eventId: 'evt_55',
  });
  const eventBack = getBackTarget(eventDirect);
  assert.equal(eventBack.kind, 'fallback');
  if (eventBack.kind === 'fallback') {
    assert.equal(eventBack.destination.route, 'upcoming-events');
    assert.equal(eventBack.destination.eventId, null);
  }

  const oppDirect = createInitialHistoryStack({
    route: 'opportunities',
    opportunityId: 'opp_44',
  });
  const oppBack = getBackTarget(oppDirect);
  assert.equal(oppBack.kind, 'fallback');
  if (oppBack.kind === 'fallback') {
    assert.equal(oppBack.destination.route, 'opportunities');
    assert.equal(oppBack.destination.opportunityId, null);
  }

  const profileDirect = createInitialHistoryStack({
    route: 'profile',
    username: 'someone',
  });
  const profileBack = getBackTarget(profileDirect);
  assert.equal(profileBack.kind, 'fallback');
  if (profileBack.kind === 'fallback') {
    assert.equal(profileBack.destination.route, 'for-you');
  }
});

test('replaceCurrentHistoryDestination updates sub-tabs without growing history length', () => {
  const s0 = createInitialHistoryStack({ route: 'profile', username: 'me' }, 50);
  const replaced = replaceCurrentHistoryDestination(s0, {
    route: 'profile',
    username: 'me',
    profileTab: 'saved',
  });

  assert.equal(replaced.stack.entries.length, 1);
  assert.equal(replaced.entry.destination.profileTab, 'saved');
  assert.equal(replaced.entry.scrollY, 50);
  assert.equal(
    areDestinationsEqual(
      { route: 'profile', username: 'me', profileTab: 'posts' },
      { route: 'profile', username: 'me', profileTab: null }
    ),
    true
  );
});

test('findMostRecentSearchEntry locates search state behind visited result pages', () => {
  const s0 = createInitialHistoryStack(
    {
      route: 'search',
      searchScope: 'marketplace',
      searchQuery: 'textbook',
    },
    0
  );
  const s1 = pushHistoryStackEntry(
    s0,
    { route: 'marketplace', listingId: 'book_12' },
    420
  ).stack;

  const updated = updateHistoryEntryScroll(s1, 420, 0);
  const foundSearch = findMostRecentSearchEntry(updated);
  assert.ok(foundSearch);
  assert.equal(foundSearch?.destination.searchQuery, 'textbook');
  assert.equal(foundSearch?.destination.searchScope, 'marketplace');
  assert.equal(foundSearch?.scrollY, 420);
});

test('resolveGuestSafeDestination strips protected routes and tabs when logged out', () => {
  assert.equal(
    resolveGuestSafeDestination({ route: 'account' }, false).route,
    'for-you'
  );
  assert.equal(
    resolveGuestSafeDestination({ route: 'following' }, false).route,
    'for-you'
  );
  assert.equal(
    resolveGuestSafeDestination(
      { route: 'profile', username: 'ada', profileTab: 'saved' },
      false
    ).profileTab,
    null
  );
  assert.equal(
    resolveGuestSafeDestination(
      { route: 'marketplace', marketplaceTab: 'my_listings' },
      false
    ).marketplaceTab,
    'browse'
  );
  assert.equal(
    resolveGuestSafeDestination({ route: 'login' }, true).route,
    'for-you'
  );
});

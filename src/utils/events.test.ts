import test from 'node:test';
import assert from 'node:assert/strict';
import type { CampusEvent } from '../types/database';
import { filterCampusEvents } from './contextualSearch';
import {
  buildEventNotificationDocId,
  buildEventShareUrl,
  canSendNewEventNotice,
  DAY_MS,
  EVENT_CATEGORIES,
  extractUniqueEventVenues,
  filterAndSortEvents,
  formatEventDateTimeRange,
  getEventCategoryLabel,
  getSafeEventUrl,
  matchesEventSearchQuery,
  resolveEventLifecycle,
} from './events';

const NOW = new Date(2026, 10, 22, 12, 0, 0, 0).getTime(); // Nov 22, 2026 12:00 local

function makeEvent(overrides: Partial<CampusEvent> = {}): CampusEvent {
  return {
    id: 'evt_1',
    ownerUID: 'admin_1',
    category: 'seminar_workshop',
    title: 'LASUED Career & Tech Symposium',
    description: 'Annual student tech and career seminar at main campus.',
    eventDate: NOW + 2 * DAY_MS,
    endDate: NOW + 2 * DAY_MS + 3 * 3600_000,
    venue: 'Main Auditorium',
    organiser: 'Faculty of Science',
    status: 'upcoming',
    published: true,
    likesCount: 4,
    commentsCount: 2,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...overrides,
  };
}

test('EVENT_CATEGORIES exposes all 10 required LASUED event categories', () => {
  assert.equal(EVENT_CATEGORIES.length, 10);
  const ids = EVENT_CATEGORIES.map((c) => c.id);
  for (const expected of [
    'departmental',
    'faculty',
    'student_association',
    'seminar_workshop',
    'conference',
    'orientation',
    'public_lecture',
    'competition',
    'social_cultural',
    'other',
  ]) {
    assert.ok(ids.includes(expected as CampusEvent['category'] & string));
  }
  assert.equal(getEventCategoryLabel('public_lecture'), 'Public Lectures');
  assert.equal(getEventCategoryLabel(undefined), 'University Event');
});

test('resolveEventLifecycle transitions upcoming -> ongoing -> completed automatically and honors draft/cancelled/past', () => {
  const upcoming = makeEvent({
    eventDate: NOW + 3600_000,
    endDate: NOW + 3 * 3600_000,
  });
  assert.equal(resolveEventLifecycle(upcoming, NOW).state, 'upcoming');
  assert.equal(resolveEventLifecycle(upcoming, NOW).label, 'Upcoming');

  const ongoing = makeEvent({
    eventDate: NOW - 1800_000,
    endDate: NOW + 1800_000,
  });
  assert.equal(resolveEventLifecycle(ongoing, NOW).state, 'ongoing');
  assert.equal(resolveEventLifecycle(ongoing, NOW).label, 'Ongoing');

  const completedByTime = makeEvent({
    eventDate: NOW - 4 * 3600_000,
    endDate: NOW - 1800_000,
  });
  assert.equal(resolveEventLifecycle(completedByTime, NOW).state, 'completed');
  assert.equal(resolveEventLifecycle(completedByTime, NOW).isCompleted, true);
  assert.equal(resolveEventLifecycle(completedByTime, NOW).isUpcoming, false);

  const legacyPast = makeEvent({
    status: 'past',
    eventDate: NOW - 10 * DAY_MS,
    endDate: undefined,
  });
  assert.equal(resolveEventLifecycle(legacyPast, NOW).state, 'completed');

  const cancelled = makeEvent({ status: 'cancelled' });
  assert.equal(resolveEventLifecycle(cancelled, NOW).state, 'cancelled');

  const draft = makeEvent({ published: false });
  assert.equal(resolveEventLifecycle(draft, NOW).state, 'unpublished');
  assert.equal(resolveEventLifecycle(draft, NOW).isPublished, false);
});

test('filterAndSortEvents hides drafts by default, filters by keyword/category/status/dateWindow/venue/savedOnly, and orders ongoing -> upcoming -> completed', () => {
  const todayLater = makeEvent({
    id: 'evt_today',
    title: 'Departmental Orientation Briefing',
    category: 'orientation',
    venue: 'Hall A',
    eventDate: NOW + 2 * 3600_000,
    endDate: NOW + 4 * 3600_000,
  });
  const ongoing = makeEvent({
    id: 'evt_live',
    title: 'Live Coding Hackathon',
    category: 'competition',
    venue: 'ICT Hub',
    eventDate: NOW - 3600_000,
    endDate: NOW + 3600_000,
  });
  const nextMonth = makeEvent({
    id: 'evt_next_month',
    title: 'Convocation Public Lecture',
    category: 'public_lecture',
    venue: 'Senate Chambers',
    eventDate: NOW + 25 * DAY_MS,
    endDate: NOW + 25 * DAY_MS + 2 * 3600_000,
  });
  const completed = makeEvent({
    id: 'evt_done',
    title: 'Past Cultural Night',
    category: 'social_cultural',
    venue: 'Main Auditorium',
    eventDate: NOW - 3 * DAY_MS,
    endDate: NOW - 3 * DAY_MS + 3 * 3600_000,
  });
  const draft = makeEvent({
    id: 'evt_draft',
    title: 'Secret Unpublished Event',
    published: false,
  });

  const all = [completed, nextMonth, draft, todayLater, ongoing];

  // Public list hides draft and orders ongoing -> upcoming soonest -> next month -> completed
  const sortedPublic = filterAndSortEvents(all, {}, new Set(), NOW);
  assert.deepEqual(
    sortedPublic.map((e) => e.id),
    ['evt_live', 'evt_today', 'evt_next_month', 'evt_done']
  );

  // Admin can include drafts
  const withDrafts = filterAndSortEvents(
    all,
    { includeUnpublished: true },
    new Set(),
    NOW
  );
  assert.equal(withDrafts.length, 5);

  // Date window: today
  const todayMatches = filterAndSortEvents(
    all,
    { dateWindow: 'today' },
    new Set(),
    NOW
  );
  assert.deepEqual(
    todayMatches.map((e) => e.id),
    ['evt_live', 'evt_today']
  );

  // Category & venue
  assert.deepEqual(
    filterAndSortEvents(all, { category: 'public_lecture' }, new Set(), NOW).map(
      (e) => e.id
    ),
    ['evt_next_month']
  );
  assert.deepEqual(
    filterAndSortEvents(all, { venue: 'hall a' }, new Set(), NOW).map((e) => e.id),
    ['evt_today']
  );

  // Saved only
  assert.deepEqual(
    filterAndSortEvents(
      all,
      { savedOnly: true },
      new Set(['evt_today', 'evt_draft']),
      NOW
    ).map((e) => e.id),
    ['evt_today']
  );

  // Unique venues sorted alphabetically
  assert.deepEqual(extractUniqueEventVenues([todayLater, ongoing, todayLater]), [
    'Hall A',
    'ICT Hub',
  ]);
});

test('share URLs, safe URLs, local time formatting, and notification dedupe guards behave deterministically', () => {
  assert.equal(
    buildEventShareUrl('evt_abc', 'https://lasued.example/'),
    'https://lasued.example/?view=upcoming-events&eventId=evt_abc'
  );
  assert.equal(getSafeEventUrl('javascript:alert(1)'), null);
  assert.equal(getSafeEventUrl('https://lasued.edu.ng/rsvp'), 'https://lasued.edu.ng/rsvp');

  const id1 = buildEventNotificationDocId('new', 'evt_1', 'user_1');
  const id2 = buildEventNotificationDocId('new', 'evt_1', 'user_1');
  assert.equal(id1, id2);
  assert.ok(id1.length <= 128);

  const evt = makeEvent({ eventDate: NOW + DAY_MS, endDate: NOW + DAY_MS + 3600_000 });
  assert.equal(canSendNewEventNotice(evt, NOW), true);
  assert.equal(canSendNewEventNotice({ ...evt, notifiedNewAt: NOW }, NOW), false);
  assert.equal(canSendNewEventNotice({ ...evt, published: false }, NOW), false);
  assert.equal(canSendNewEventNotice({ ...evt, status: 'cancelled' }, NOW), false);

  const range = formatEventDateTimeRange(evt);
  assert.ok(range.includes('2026'));
});

test('contextual search matches event title, organiser, venue, category label, and hides drafts or cancelled events', () => {
  const pub = makeEvent({
    id: 'evt_pub',
    title: 'SUG Town Hall',
    organiser: 'Students Union Government',
    category: 'student_association',
    venue: 'Oluremi Tinubu Hall',
  });
  const draft = makeEvent({
    id: 'evt_draft',
    title: 'SUG Draft Town Hall',
    published: false,
  });
  const cancelled = makeEvent({
    id: 'evt_cancelled',
    title: 'SUG Cancelled Rally',
    status: 'cancelled',
  });

  assert.equal(matchesEventSearchQuery(pub, 'Student Association'), true);
  assert.equal(matchesEventSearchQuery(pub, 'Oluremi Tinubu'), true);

  const searchHits = filterCampusEvents([pub, draft, cancelled], 'SUG');
  assert.deepEqual(
    searchHits.map((e) => e.id),
    ['evt_pub']
  );
});

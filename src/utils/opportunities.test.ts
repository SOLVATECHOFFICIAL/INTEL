import test from 'node:test';
import assert from 'node:assert/strict';
import type { Opportunity } from '../types/database';
import {
  buildOpportunityNotificationDocId,
  canSendDeadlineUpdateNotice,
  canSendNewOpportunityNotice,
  CLOSING_SOON_WINDOW_MS,
  DAY_MS,
  extractUniqueOrganisations,
  filterAndSortOpportunities,
  getOpportunityCategoryLabel,
  getSafeApplicationUrl,
  matchesDeadlineFilter,
  OPPORTUNITY_CATEGORIES,
  resolveOpportunityLifecycle,
} from './opportunities';

const NOW = 1_800_000_000_000;

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp_1',
    ownerUID: 'admin_1',
    category: 'scholarship',
    title: 'LASUED STEM Undergraduate Scholarship',
    organisation: 'Lagos Education Trust',
    description: 'Annual tuition and textbook grant for science and education students.',
    whoCanApply: '200L–400L full-time students',
    eligibility: 'Minimum 3.5 CGPA',
    benefits: '₦250,000 tuition support',
    requiredDocuments: 'Student ID card and transcript',
    applicationInstructions: 'Submit scanned documents online.',
    applicationUrl: 'https://scholarship.example.edu.ng/apply',
    contactInfo: 'scholarships@example.edu.ng',
    status: 'active',
    isVerified: true,
    expiresAt: NOW + 20 * DAY_MS,
    createdAt: NOW - 3 * DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...overrides,
  };
}

test('OPPORTUNITY_CATEGORIES exposes all 9 required academic and career categories', () => {
  assert.equal(OPPORTUNITY_CATEGORIES.length, 9);
  assert.deepEqual(
    OPPORTUNITY_CATEGORIES.map((c) => c.id),
    [
      'scholarship',
      'grant',
      'internship',
      'job',
      'competition',
      'programme',
      'training',
      'conference',
      'other',
    ]
  );
  assert.equal(
    getOpportunityCategoryLabel('conference'),
    'Conferences & Educational'
  );
  assert.equal(
    getOpportunityCategoryLabel('grant'),
    'Grants & Financial Support'
  );
});

test('resolveOpportunityLifecycle distinguishes open, closing_soon, upcoming, closed, and unpublished accurately', () => {
  const openOpp = makeOpp({ expiresAt: NOW + 15 * DAY_MS });
  assert.equal(resolveOpportunityLifecycle(openOpp, NOW).state, 'open');
  assert.equal(resolveOpportunityLifecycle(openOpp, NOW).label, 'Open');

  const closingSoonOpp = makeOpp({
    expiresAt: NOW + CLOSING_SOON_WINDOW_MS - 1000,
  });
  assert.equal(
    resolveOpportunityLifecycle(closingSoonOpp, NOW).state,
    'closing_soon'
  );
  assert.equal(
    resolveOpportunityLifecycle(closingSoonOpp, NOW).label,
    'Closing Soon'
  );

  const upcomingOpp = makeOpp({
    opensAt: NOW + 2 * DAY_MS,
    expiresAt: NOW + 20 * DAY_MS,
  });
  assert.equal(
    resolveOpportunityLifecycle(upcomingOpp, NOW).state,
    'upcoming'
  );

  // Past deadline automatically transitions active opportunity to Closed without deletion
  const pastDeadlineOpp = makeOpp({ status: 'active', expiresAt: NOW - 1000 });
  const closedInfo = resolveOpportunityLifecycle(pastDeadlineOpp, NOW);
  assert.equal(closedInfo.state, 'closed');
  assert.equal(closedInfo.label, 'Closed');
  assert.equal(closedInfo.isPastDeadline, true);

  const unpublishedOpp = makeOpp({ status: 'unpublished' });
  assert.equal(
    resolveOpportunityLifecycle(unpublishedOpp, NOW).state,
    'unpublished'
  );
});

test('filterAndSortOpportunities supports search, category, status, deadline, organisation, and savedOnly without exposing unpublished drafts', () => {
  const opps: Opportunity[] = [
    makeOpp({
      id: 'closing_soon',
      category: 'grant',
      title: 'Emergency Bursary Support',
      organisation: 'LASUED Foundation',
      expiresAt: NOW + 3 * DAY_MS,
      createdAt: NOW - 5 * DAY_MS,
    }),
    makeOpp({
      id: 'open_later',
      category: 'conference',
      title: 'West Africa Education Conference',
      organisation: 'EdTech Nigeria',
      expiresAt: NOW + 45 * DAY_MS,
      createdAt: NOW - DAY_MS,
    }),
    makeOpp({
      id: 'closed_past',
      category: 'internship',
      title: 'Summer Software Internship',
      organisation: 'EdTech Nigeria',
      status: 'active',
      expiresAt: NOW - 2 * DAY_MS,
      createdAt: NOW - 10 * DAY_MS,
    }),
    makeOpp({
      id: 'draft_hidden',
      status: 'unpublished',
      title: 'Internal Draft Opportunity',
      organisation: 'LASUED Foundation',
      expiresAt: NOW + 10 * DAY_MS,
    }),
  ];

  // Public default hides unpublished, puts open/closing soon before closed, nearest deadline first
  const publicAll = filterAndSortOpportunities(opps, {}, new Set(), NOW);
  assert.deepEqual(
    publicAll.map((item) => item.id),
    ['closing_soon', 'open_later', 'closed_past']
  );

  // Category & search match across fields & category labels
  const confMatch = filterAndSortOpportunities(
    opps,
    { query: 'Conferences & Educational' },
    new Set(),
    NOW
  );
  assert.deepEqual(
    confMatch.map((item) => item.id),
    ['open_later']
  );

  // Status filter
  const closingOnly = filterAndSortOpportunities(
    opps,
    { status: 'closing_soon' },
    new Set(),
    NOW
  );
  assert.deepEqual(
    closingOnly.map((item) => item.id),
    ['closing_soon']
  );

  const closedOnly = filterAndSortOpportunities(
    opps,
    { status: 'closed' },
    new Set(),
    NOW
  );
  assert.deepEqual(
    closedOnly.map((item) => item.id),
    ['closed_past']
  );

  // Deadline filter
  assert.equal(matchesDeadlineFilter(opps[0], '7d', NOW), true);
  assert.equal(matchesDeadlineFilter(opps[1], '30d', NOW), false);
  assert.equal(matchesDeadlineFilter(opps[1], 'later', NOW), true);
  assert.equal(matchesDeadlineFilter(opps[2], '7d', NOW), false);

  // Organisation extraction & filter
  assert.deepEqual(extractUniqueOrganisations(opps), [
    'EdTech Nigeria',
    'LASUED Foundation',
  ]);
  const orgFiltered = filterAndSortOpportunities(
    opps,
    { organisation: 'EdTech Nigeria' },
    new Set(),
    NOW
  );
  assert.deepEqual(
    orgFiltered.map((item) => item.id),
    ['open_later', 'closed_past']
  );

  // Saved-only filter
  const saved = new Set(['open_later']);
  const savedOnly = filterAndSortOpportunities(
    opps,
    { savedOnly: true },
    saved,
    NOW
  );
  assert.deepEqual(
    savedOnly.map((item) => item.id),
    ['open_later']
  );
});

test('getSafeApplicationUrl validates http(s) URLs strictly and never fabricates missing links', () => {
  assert.equal(getSafeApplicationUrl(''), null);
  assert.equal(getSafeApplicationUrl('   '), null);
  assert.equal(getSafeApplicationUrl('javascript:alert(1)'), null);
  assert.equal(
    getSafeApplicationUrl('https://portal.lasued.edu.ng/apply'),
    'https://portal.lasued.edu.ng/apply'
  );
});

test('notification doc IDs and dedupe guards prevent duplicate or unnecessary alerts', () => {
  const idA = buildOpportunityNotificationDocId('new', 'opp_123', 'user_abc');
  const idB = buildOpportunityNotificationDocId('new', 'opp_123', 'user_abc');
  assert.equal(idA, idB);
  assert.match(idA, /^[a-zA-Z0-9_-]{1,128}$/);

  const dlDay1 = buildOpportunityNotificationDocId(
    'deadline',
    'opp_123',
    'user_abc',
    NOW + 5 * DAY_MS
  );
  const dlSameDay = buildOpportunityNotificationDocId(
    'deadline',
    'opp_123',
    'user_abc',
    NOW + 5 * DAY_MS + 3600_000
  );
  assert.equal(dlDay1, dlSameDay);
  assert.match(dlDay1, /^[a-zA-Z0-9_-]{1,128}$/);

  // New opportunity notice allowed only for active non-expired and unnotified entries
  assert.equal(
    canSendNewOpportunityNotice(makeOpp({ notifiedNewAt: undefined }), NOW),
    true
  );
  assert.equal(
    canSendNewOpportunityNotice(makeOpp({ notifiedNewAt: NOW - 1000 }), NOW),
    false
  );
  assert.equal(
    canSendNewOpportunityNotice(makeOpp({ status: 'unpublished' }), NOW),
    false
  );

  // Deadline notice prevented when same day already notified
  const sameDayDeadline = NOW + 10 * DAY_MS;
  assert.equal(
    canSendDeadlineUpdateNotice(
      makeOpp({ lastDeadlineNotifiedMs: sameDayDeadline }),
      sameDayDeadline,
      NOW
    ),
    false
  );
  assert.equal(
    canSendDeadlineUpdateNotice(
      makeOpp({ lastDeadlineNotifiedMs: sameDayDeadline }),
      sameDayDeadline + 3 * DAY_MS,
      NOW
    ),
    true
  );
});

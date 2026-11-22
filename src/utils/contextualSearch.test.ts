import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CampusEvent,
  CommunityPost,
  MarketplaceListing,
  Opportunity,
  PublicUserProfile,
  TrustedContact,
} from '../types/database';
import {
  applyEventSearchFilters,
  applyMarketplaceSearchFilters,
  applyOpportunitySearchFilters,
  applyPostSearchFilters,
  buildSearchSuggestions,
  DEFAULT_SEARCH_FILTERS,
  filterAnonymousPosts,
  filterCampusEvents,
  filterCommunityPosts,
  filterMarketplaceListings,
  filterMemberMatches,
  filterOpportunities,
  filterTrustedContacts,
  formatSearchUserError,
  sanitizeAnonymousPostForSearch,
  scoreSearchFields,
  tokenizeSearchQuery,
  validateSearchQuery,
} from './contextualSearch';

const sampleProfiles: PublicUserProfile[] = [
  {
    uid: 'uid_solomon',
    memberId: 'LI-solomon',
    fullName: 'Solomon Adeyemi',
    username: 'solomon',
    department: 'Computer Science',
    faculty: 'Science',
    level: '400 Level',
    publicWhatsapp: '+2348011111111',
    showWhatsappPublicly: true,
    badge: 'verified',
    accountStatus: 'active',
    isHiddenFromDirectory: false,
    followersCount: 15,
    followingCount: 8,
    createdAt: 1000,
    updatedAt: 2000,
  },
  {
    uid: 'uid_chidinma',
    memberId: 'LI-chidinma',
    fullName: 'Chidinma Okafor',
    username: 'chidinma_edu',
    department: 'English Education',
    faculty: 'Education',
    level: '300 Level',
    publicWhatsapp: '+2348044444444',
    showWhatsappPublicly: true,
    badge: 'moderator',
    accountStatus: 'active',
    isHiddenFromDirectory: false,
    followersCount: 42,
    followingCount: 12,
    createdAt: 2500,
    updatedAt: 2600,
  },
  {
    uid: 'uid_hidden_owner',
    memberId: 'LI-owner',
    fullName: 'Hidden Owner',
    username: 'hidden_owner',
    publicWhatsapp: '+2348022222222',
    showWhatsappPublicly: false,
    badge: 'supreme_admin',
    accountStatus: 'active',
    isHiddenFromDirectory: true,
    followersCount: 0,
    followingCount: 0,
    createdAt: 1000,
    updatedAt: 2000,
  },
  {
    uid: 'uid_suspended',
    memberId: 'LI-susp',
    fullName: 'Suspended Solomon',
    username: 'suspended_sol',
    publicWhatsapp: '+2348033333333',
    showWhatsappPublicly: true,
    badge: 'none',
    accountStatus: 'suspended',
    isHiddenFromDirectory: false,
    followersCount: 0,
    followingCount: 0,
    createdAt: 1000,
    updatedAt: 2000,
  },
];

test('validateSearchQuery rejects empty and 1-char queries, normalizes whitespace, and tokenizes multi-word phrases', () => {
  assert.equal(validateSearchQuery('   ').reason, 'empty');
  assert.equal(validateSearchQuery('a').reason, 'too_short');
  assert.equal(validateSearchQuery('@a').reason, 'too_short');

  const ok = validateSearchQuery('  @solomon   computer   science  ');
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.tokens, ['solomon', 'computer', 'science']);
  assert.deepEqual(
    tokenizeSearchQuery('CSC 401 CSC'),
    ['csc', '401']
  );
});

test('scoreSearchFields requires ALL query tokens to match and ranks title/exact hits above body matches', () => {
  const exactTitleScore = scoreSearchFields(
    [
      { text: 'CSC 401 Seminar Schedule', weight: 3 },
      { text: 'Main Auditorium', weight: 1 },
    ],
    'csc 401'
  );
  const bodyOnlyScore = scoreSearchFields(
    [
      { text: 'Weekly Faculty Update', weight: 3 },
      { text: 'Includes notes on csc 401 timetable.', weight: 1 },
    ],
    'csc 401'
  );
  const partialMismatchScore = scoreSearchFields(
    [{ text: 'CSC 201 Practical Notes', weight: 3 }],
    'csc 401'
  );

  assert.ok(exactTitleScore > bodyOnlyScore);
  assert.equal(partialMismatchScore, 0);
});

test('filterMemberMatches performs partial case-insensitive search, excludes hidden/suspended accounts, and omits UIDs', () => {
  const results = filterMemberMatches(sampleProfiles, '@Solo');
  assert.equal(results.length, 1);
  assert.equal(results[0].username, 'solomon');
  assert.equal('uid' in results[0], false);
  assert.equal('memberId' in results[0], false);

  const multiToken = filterMemberMatches(sampleProfiles, 'computer science');
  assert.equal(multiToken.length, 1);
  assert.equal(multiToken[0].username, 'solomon');
});

test('filterCommunityPosts matches published public ordinary posts only and applies category/department/sort filters', () => {
  const posts: CommunityPost[] = [
    {
      id: 'p1',
      ownerUID: 'uid_solomon',
      authorRole: 'verified',
      category: 'Academic',
      title: 'CSC 401 Seminar Schedule',
      body: 'Room 204 at 10am.',
      isOfficial: true,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 2,
      commentsCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'p3',
      ownerUID: 'uid_chidinma',
      authorRole: 'moderator',
      category: 'Campus News',
      title: 'Seminar on Academic Writing',
      body: 'Education faculty hall tomorrow.',
      isOfficial: false,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 5,
      commentsCount: 1,
      createdAt: 3000,
      updatedAt: 3000,
    },
    {
      id: 'p2',
      ownerUID: 'uid_solomon',
      authorRole: 'verified',
      category: 'Academic',
      title: 'Deleted Seminar Schedule',
      body: 'Cancelled',
      isOfficial: false,
      isPinned: false,
      status: 'deleted',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];

  const searchable = posts.map((post) => ({
    post,
    author:
      post.ownerUID === 'uid_solomon'
        ? {
            fullName: 'Solomon Adeyemi',
            username: 'solomon',
            department: 'Computer Science',
            faculty: 'Science',
            badge: 'verified' as const,
            accountStatus: 'active' as const,
            followersCount: 15,
            followingCount: 8,
            createdAt: 1000,
          }
        : {
            fullName: 'Chidinma Okafor',
            username: 'chidinma_edu',
            department: 'English Education',
            faculty: 'Education',
            badge: 'moderator' as const,
            accountStatus: 'active' as const,
            followersCount: 42,
            followingCount: 12,
            createdAt: 2500,
          },
  }));

  const matched = filterCommunityPosts(searchable, 'seminar');
  assert.equal(matched.length, 2);

  const byCategory = applyPostSearchFilters(matched, {
    ...DEFAULT_SEARCH_FILTERS,
    category: 'Academic',
  });
  assert.equal(byCategory.length, 1);
  assert.equal(byCategory[0].post.id, 'p1');

  const newestFirst = applyPostSearchFilters(matched, {
    ...DEFAULT_SEARCH_FILTERS,
    sortBy: 'newest',
  });
  assert.equal(newestFirst[0].post.id, 'p3');

  const oldestFirst = applyPostSearchFilters(matched, {
    ...DEFAULT_SEARCH_FILTERS,
    sortBy: 'oldest',
  });
  assert.equal(oldestFirst[0].post.id, 'p1');
});

test('filterAnonymousPosts strictly strips any rogue identity metadata and excludes deleted entries', () => {
  const rawDocs: Record<string, unknown>[] = [
    {
      id: 'anon_1',
      postType: 'text',
      category: 'Campus Life',
      body: 'Hostel water pump needs urgent maintenance.',
      status: 'published',
      visibility: 'public',
      likesCount: 5,
      commentsCount: 1,
      createdAt: 1000,
      updatedAt: 1000,
      authorUid: 'leak_attempt',
      ownerUID: 'leak_attempt_2',
      username: 'leak_username',
    },
    {
      id: 'anon_2',
      category: 'Campus Life',
      body: 'Hidden deleted hostel post',
      status: 'deleted',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const sanitized = sanitizeAnonymousPostForSearch(rawDocs[0]);
  assert.equal(sanitized.postType, 'text');
  assert.equal('ownerUID' in sanitized, false);

  const matched = filterAnonymousPosts(rawDocs, 'hostel');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'anon_1');
  assert.equal('authorUid' in matched[0], false);
  assert.equal('ownerUID' in matched[0], false);
  assert.equal('username' in matched[0], false);
});

test('filterMarketplaceListings excludes pending, rejected, sold, and expired listings and supports filters', () => {
  const now = 1_700_000_000_000;
  const listings: MarketplaceListing[] = [
    {
      id: 'm1',
      ownerUID: 'u1',
      listingKind: 'product',
      title: 'Engineering Mathematics Textbook',
      description: 'Clean second-hand copy',
      category: 'Books and Educational Materials',
      price: 4500,
      quantity: 1,
      whatsappNumber: '+2348011111111',
      approvalStatus: 'approved',
      status: 'active',
      visibility: 'public',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      expiresAt: now + 86_400_000,
    },
    {
      id: 'm3',
      ownerUID: 'u1',
      listingKind: 'service',
      title: 'Textbook Binding Service',
      description: 'Fast binding at Student Centre',
      category: 'Services',
      price: 1500,
      quantity: 5,
      whatsappNumber: '+2348011111111',
      approvalStatus: 'approved',
      status: 'active',
      visibility: 'public',
      createdAt: now - 500,
      updatedAt: now - 500,
      expiresAt: now + 86_400_000,
    },
    {
      id: 'm2',
      ownerUID: 'u1',
      listingKind: 'product',
      title: 'Expired Textbook',
      description: 'Old edition',
      category: 'Books and Educational Materials',
      price: 2500,
      quantity: 1,
      whatsappNumber: '+2348011111111',
      approvalStatus: 'approved',
      status: 'active',
      visibility: 'public',
      createdAt: now - 10000,
      updatedAt: now - 10000,
      expiresAt: now - 100,
    },
  ];

  const matched = filterMarketplaceListings(listings, 'textbook', now);
  assert.equal(matched.length, 2);

  const lowStockOnly = applyMarketplaceSearchFilters(matched, {
    ...DEFAULT_SEARCH_FILTERS,
    availability: 'low_stock',
  });
  assert.equal(lowStockOnly.length, 1);
  assert.equal(lowStockOnly[0].id, 'm1');

  const servicesOnly = applyMarketplaceSearchFilters(matched, {
    ...DEFAULT_SEARCH_FILTERS,
    category: 'kind:service',
  });
  assert.equal(servicesOnly.length, 1);
  assert.equal(servicesOnly[0].id, 'm3');
});

test('filterTrustedContacts, filterOpportunities, filterCampusEvents, and lifecycle filters work cleanly', () => {
  const now = 1_700_000_000_000;
  const contacts: TrustedContact[] = [
    {
      id: 'tc1',
      entryType: 'admin_listed_contact',
      isUserAccount: false,
      fullName: 'Dr. Amina Bello',
      category: 'lecturer',
      roleTitle: 'Departmental Adviser',
      department: 'Computer Science',
      faculty: 'Science',
      createdByUid: 'admin1',
      createdAt: now,
      updatedAt: now,
    },
  ];
  assert.equal(filterTrustedContacts(contacts, 'bello').length, 1);

  const opps: Opportunity[] = [
    {
      id: 'o1',
      ownerUID: 'admin1',
      category: 'scholarship',
      title: 'LASUED STEM Scholarship',
      organisation: 'Lagos Education Trust',
      description: 'Undergraduate tuition support',
      applicationUrl: 'https://example.com/apply',
      status: 'active',
      expiresAt: now + 3 * 86_400_000,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'o2',
      ownerUID: 'admin1',
      category: 'scholarship',
      title: 'Expired Scholarship',
      organisation: 'Old Trust',
      description: 'Closed',
      applicationUrl: 'https://example.com/old',
      status: 'active',
      expiresAt: now - 100,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const matchedOpps = filterOpportunities(opps, 'scholarship', now);
  assert.equal(matchedOpps.length, 1);
  assert.equal(
    applyOpportunitySearchFilters(
      matchedOpps,
      { ...DEFAULT_SEARCH_FILTERS, availability: 'closing_soon' },
      now
    ).length,
    1
  );

  const events: CampusEvent[] = [
    {
      id: 'e1',
      ownerUID: 'admin1',
      category: 'orientation',
      title: 'Freshers Welcome Programme',
      description: 'Main auditorium welcome',
      eventDate: now + 500_000,
      venue: 'Main Auditorium',
      organiser: 'Student Affairs',
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'e2',
      ownerUID: 'admin1',
      category: 'orientation',
      title: 'Cancelled Orientation',
      description: 'Postponed',
      eventDate: now + 500_000,
      venue: 'Hall B',
      organiser: 'Student Affairs',
      status: 'cancelled',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const matchedEvents = filterCampusEvents(events, 'orientation');
  assert.equal(matchedEvents.length, 1);
  assert.equal(matchedEvents[0].id, 'e1');
  assert.equal(
    applyEventSearchFilters(
      matchedEvents,
      { ...DEFAULT_SEARCH_FILTERS, availability: 'upcoming' },
      now
    ).length,
    1
  );
});

test('buildSearchSuggestions excludes member profiles in anonymous scope and omits empty matches', () => {
  const members = sampleProfiles
    .filter((p) => !p.isHiddenFromDirectory && p.accountStatus === 'active')
    .map((p) => ({
      fullName: p.fullName,
      username: p.username,
      department: p.department,
      faculty: p.faculty,
      badge: p.badge,
      accountStatus: p.accountStatus,
      followersCount: p.followersCount,
      followingCount: p.followingCount,
      createdAt: p.createdAt,
    }));

  const suggestions = buildSearchSuggestions({
    rawQuery: 'solo',
    recentSearches: ['solomon notes'],
    members,
    scope: 'all',
  });
  assert.ok(suggestions.some((s) => s.kind === 'person' && s.username === 'solomon'));
  assert.ok(suggestions.some((s) => s.kind === 'recent'));

  const anonSuggestions = buildSearchSuggestions({
    rawQuery: 'solo',
    recentSearches: [],
    members,
    scope: 'anonymous',
  });
  assert.equal(
    anonSuggestions.some((s) => s.kind === 'person'),
    false
  );

  const noMatches = buildSearchSuggestions({
    rawQuery: 'zzzzzzzzq',
    recentSearches: ['scholarship'],
    members,
    scope: 'all',
  });
  assert.equal(noMatches.length, 0);

  const homeOppSuggestions = buildSearchSuggestions({
    rawQuery: 'scholarship',
    recentSearches: [],
    members,
    scope: 'home',
  });
  assert.equal(homeOppSuggestions.length, 0);

  const allOppSuggestions = buildSearchSuggestions({
    rawQuery: 'scholarship',
    recentSearches: [],
    members,
    scope: 'all',
  });
  assert.ok(allOppSuggestions.some((s) => s.targetScope === 'opportunities'));
});

test('formatSearchUserError never exposes Firebase, Firestore, index, or internal jargon', () => {
  const firebaseErr = new Error(
    'FirebaseError: The query requires an index on firestore collection posts'
  );
  const formatted = formatSearchUserError(firebaseErr);
  assert.equal(formatted.toLowerCase().includes('firebase'), false);
  assert.equal(formatted.toLowerCase().includes('firestore'), false);
  assert.equal(formatted.toLowerCase().includes('index'), false);
});

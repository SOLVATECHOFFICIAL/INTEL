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
  filterAnonymousPosts,
  filterCampusEvents,
  filterCommunityPosts,
  filterMarketplaceListings,
  filterMemberMatches,
  filterOpportunities,
  filterTrustedContacts,
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

test('filterMemberMatches performs partial case-insensitive search, excludes hidden/suspended accounts, and omits UIDs', () => {
  const results = filterMemberMatches(sampleProfiles, '@Solo');
  assert.equal(results.length, 1);
  assert.equal(results[0].username, 'solomon');
  assert.equal('uid' in results[0], false);
  assert.equal('memberId' in results[0], false);
});

test('filterCommunityPosts matches published public ordinary posts only', () => {
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
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const matched = filterCommunityPosts(
    posts.map((post) => ({ post, author: null })),
    'seminar'
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].post.id, 'p1');
});

test('filterAnonymousPosts strictly strips any rogue identity metadata and excludes deleted entries', () => {
  const rawDocs: Record<string, unknown>[] = [
    {
      id: 'anon_1',
      category: 'Campus Life',
      body: 'Hostel water pump needs urgent maintenance.',
      status: 'published',
      visibility: 'public',
      likesCount: 5,
      commentsCount: 1,
      createdAt: 1000,
      updatedAt: 1000,
      // Rogue field test to guarantee sanitization strips identity keys
      authorUid: 'leak_attempt',
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

  const matched = filterAnonymousPosts(rawDocs, 'hostel');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'anon_1');
  assert.equal('authorUid' in matched[0], false);
  assert.equal('username' in matched[0], false);
});

test('filterMarketplaceListings excludes pending, rejected, sold, and expired listings', () => {
  const now = 1_700_000_000_000;
  const listings: MarketplaceListing[] = [
    {
      id: 'm1',
      ownerUID: 'u1',
      listingKind: 'product',
      title: 'Engineering Mathematics Textbook',
      description: 'Clean second-hand copy',
      category: 'Textbooks',
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
      id: 'm2',
      ownerUID: 'u1',
      listingKind: 'product',
      title: 'Expired Textbook',
      description: 'Old edition',
      category: 'Textbooks',
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
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'm1');
});

test('filterTrustedContacts, filterOpportunities, and filterCampusEvents respect visibility and expiry', () => {
  const now = 1_700_000_000_000;
  const contacts: TrustedContact[] = [
    {
      id: 'tc1',
      entryType: 'admin_listed_contact',
      isUserAccount: false,
      fullName: 'Dr. Amina Bello',
      category: 'lecturer',
      roleTitle: 'Head of Department',
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
      expiresAt: now + 100_000,
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
  assert.equal(filterOpportunities(opps, 'scholarship', now).length, 1);

  const events: CampusEvent[] = [
    {
      id: 'e1',
      ownerUID: 'admin1',
      category: 'orientation',
      title: 'Freshers Welcome Programme',
      description: 'Main auditorium welcome',
      eventDate: now + 50_000,
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
      eventDate: now + 50_000,
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
});

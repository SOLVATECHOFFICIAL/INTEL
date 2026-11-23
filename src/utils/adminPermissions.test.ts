import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canActorAccessAdminSection,
  canActorDeleteCommentByBadge,
  canActorDeleteMarketplaceListing,
  canActorModerateMarketplaceListing,
  computePlatformOverviewStats,
  formatAdminAuditActionLabel,
  getVisibleAdminSections,
  validateCampusEventFormInput,
  validateOpportunityFormInput,
} from './adminPermissions';
import type {
  CampusEvent,
  MarketplaceListing,
  Opportunity,
  PublicUserProfile,
} from '../types/database';

function makeProfile(
  uid: string,
  badge: PublicUserProfile['badge'],
  accountStatus: PublicUserProfile['accountStatus'] = 'active'
): PublicUserProfile {
  return {
    uid,
    memberId: `LI-${uid}`,
    fullName: `User ${uid}`,
    username: `user_${uid}`,
    showWhatsappPublicly: true,
    badge,
    accountStatus,
    isHiddenFromDirectory: false,
    followersCount: 0,
    followingCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeListing(
  id: string,
  approvalStatus: MarketplaceListing['approvalStatus'],
  status: MarketplaceListing['status'],
  expiresAt: number
): MarketplaceListing {
  return {
    id,
    ownerUID: 'seller_1',
    title: `Listing ${id}`,
    description: 'Clean campus textbook listing for LASUED students.',
    price: 5000,
    quantity: status === 'sold' ? 0 : 1,
    category: 'books',
    status,
    approvalStatus,
    visibility: approvalStatus === 'approved' ? 'public' : 'owner_and_admins',
    expiresAt,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

test('getVisibleAdminSections enforces strict 10-section vs 3-section vs 0-section access by role and suspension', () => {
  assert.deepEqual(getVisibleAdminSections('guest', false), []);
  assert.deepEqual(getVisibleAdminSections('member', false), []);
  assert.deepEqual(getVisibleAdminSections('verified', false), []);
  assert.deepEqual(getVisibleAdminSections('moderator', true), []);
  assert.deepEqual(getVisibleAdminSections('supreme_admin', true), []);
  assert.deepEqual(getVisibleAdminSections('owner', true), []);

  const moderatorSections = getVisibleAdminSections('moderator', false).map(
    (s) => s.id
  );
  assert.deepEqual(moderatorSections, ['overview', 'marketplace', 'content']);

  const supremeSections = getVisibleAdminSections('supreme_admin', false).map(
    (s) => s.id
  );
  assert.equal(supremeSections.length, 10);
  assert.deepEqual(supremeSections, [
    'overview',
    'members',
    'badges',
    'marketplace',
    'content',
    'opportunities',
    'events',
    'trusted-circle',
    'audit-log',
    'settings',
  ]);

  const ownerSections = getVisibleAdminSections('owner', false).map((s) => s.id);
  assert.equal(ownerSections.length, 10);

  assert.equal(canActorAccessAdminSection('moderator', false, 'marketplace'), true);
  assert.equal(canActorAccessAdminSection('moderator', false, 'members'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'badges'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'opportunities'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'events'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'trusted-circle'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'audit-log'), false);
  assert.equal(canActorAccessAdminSection('moderator', false, 'settings'), false);
  assert.equal(canActorAccessAdminSection('supreme_admin', false, 'audit-log'), true);
});

test('moderation boundary helpers prevent moderators from altering privileged sellers, double-approving, or deleting listings', () => {
  // Pending ordinary listing -> Moderator allowed
  assert.equal(
    canActorModerateMarketplaceListing('moderator', 'none', 'pending_approval'),
    true
  );
  // Already approved -> NO double approval
  assert.equal(
    canActorModerateMarketplaceListing('moderator', 'none', 'approved'),
    false
  );
  assert.equal(
    canActorModerateMarketplaceListing('supreme_admin', 'none', 'approved'),
    false
  );
  // Privileged owners -> Moderator blocked, Supreme Admin / Owner allowed
  assert.equal(
    canActorModerateMarketplaceListing('moderator', 'verified', 'pending_approval'),
    false
  );
  assert.equal(
    canActorModerateMarketplaceListing('moderator', 'moderator', 'pending_approval'),
    false
  );
  assert.equal(
    canActorModerateMarketplaceListing(
      'moderator',
      'supreme_admin',
      'pending_approval'
    ),
    false
  );
  assert.equal(
    canActorModerateMarketplaceListing(
      'supreme_admin',
      'verified',
      'pending_approval'
    ),
    true
  );

  // Listing deletion reserved for Supreme Admin / Owner only
  assert.equal(canActorDeleteMarketplaceListing('moderator'), false);
  assert.equal(canActorDeleteMarketplaceListing('verified'), false);
  assert.equal(canActorDeleteMarketplaceListing('member'), false);
  assert.equal(canActorDeleteMarketplaceListing('supreme_admin'), true);
  assert.equal(canActorDeleteMarketplaceListing('owner'), true);

  // Comment deletion hierarchy
  assert.equal(canActorDeleteCommentByBadge('moderator', 'none'), true);
  assert.equal(canActorDeleteCommentByBadge('moderator', undefined), true);
  assert.equal(canActorDeleteCommentByBadge('moderator', 'verified'), false);
  assert.equal(canActorDeleteCommentByBadge('moderator', 'moderator'), false);
  assert.equal(canActorDeleteCommentByBadge('moderator', 'supreme_admin'), false);
  assert.equal(canActorDeleteCommentByBadge('supreme_admin', 'verified'), true);
  assert.equal(canActorDeleteCommentByBadge('owner', 'supreme_admin'), true);
});

test('computePlatformOverviewStats aggregates all real member, post, marketplace bucket, opportunity, and event counts accurately', () => {
  const now = 1_800_000_000_000;
  const future = now + 86_400_000 * 3;
  const past = now - 86_400_000;

  const profiles: PublicUserProfile[] = [
    makeProfile('1', 'supreme_admin', 'active'),
    makeProfile('2', 'moderator', 'active'),
    makeProfile('3', 'verified', 'active'),
    makeProfile('4', 'verified', 'active'),
    makeProfile('5', 'none', 'active'),
    makeProfile('6', 'none', 'suspended'),
  ];

  const listings: MarketplaceListing[] = [
    makeListing('l1', 'pending_approval', 'pending_approval', future),
    makeListing('l2', 'approved', 'active', future),
    makeListing('l3', 'approved', 'active', past), // expired automatically by time
    makeListing('l4', 'rejected', 'rejected', future),
    makeListing('l5', 'approved', 'sold', future),
  ];

  const opportunities: Opportunity[] = [
    {
      id: 'o1',
      ownerUID: '1',
      category: 'scholarship',
      title: 'STEM Excellence Grant',
      organisation: 'LASUED Foundation',
      description: 'Tuition support for high-achieving students.',
      applicationUrl: 'https://lasued.edu.ng',
      status: 'active',
      expiresAt: future,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'o2',
      ownerUID: '1',
      category: 'internship',
      title: 'Closed Internship',
      organisation: 'Campus Tech Hub',
      description: 'Past cohort opportunity.',
      applicationUrl: 'https://lasued.edu.ng',
      status: 'active',
      expiresAt: past, // expired by deadline
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const events: CampusEvent[] = [
    {
      id: 'e1',
      ownerUID: '1',
      title: 'Matriculation Orientation',
      description: 'Orientation for fresh students.',
      eventDate: future,
      venue: 'Main Auditorium',
      organiser: 'Student Affairs',
      status: 'upcoming',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'e2',
      ownerUID: '1',
      title: 'Cancelled Townhall',
      description: 'Postponed session.',
      eventDate: future,
      venue: 'Senate Chambers',
      organiser: 'Registry',
      status: 'cancelled',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'e3',
      ownerUID: '1',
      title: 'Completed Seminar',
      description: 'Past academic seminar.',
      eventDate: past,
      venue: 'Faculty Hall',
      organiser: 'CSC Dept',
      status: 'upcoming',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const reports = [
    {
      id: 'anonymousPost_ap1_u1',
      targetType: 'anonymousPost' as const,
      targetId: 'ap1',
      postId: 'ap1',
      reporterUid: 'u1',
      reason: 'harassment' as const,
      excerpt: 'Abusive anonymous remark',
      status: 'pending' as const,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'anonymousComment_ac1_u2',
      targetType: 'anonymousComment' as const,
      targetId: 'ac1',
      postId: 'ap2',
      reporterUid: 'u2',
      reason: 'privacy_leak' as const,
      excerpt: 'Leaked phone number',
      status: 'reviewed_removed' as const,
      createdAt: 1200,
      updatedAt: 1300,
    },
    {
      id: 'anonymousPost_ap3_u3',
      targetType: 'anonymousPost' as const,
      targetId: 'ap3',
      postId: 'ap3',
      reporterUid: 'u3',
      reason: 'spam' as const,
      excerpt: 'Duplicate link post',
      status: 'dismissed' as const,
      createdAt: 1400,
      updatedAt: 1500,
    },
    {
      id: 'anonymousComment_ac2_u4',
      targetType: 'anonymousComment' as const,
      targetId: 'ac2',
      postId: 'ap4',
      reporterUid: 'u4',
      reason: 'harassment' as const,
      excerpt: 'Targeted insult reply',
      status: 'pending' as const,
      createdAt: 1600,
      updatedAt: 1600,
    },
  ];

  const stats = computePlatformOverviewStats({
    profiles,
    ordinaryPostsCount: 14,
    anonymousPostsCount: 9,
    listings,
    opportunities,
    events,
    reports,
    nowMs: now,
  });

  assert.equal(stats.totalMembers, 6);
  assert.equal(stats.activeMembers, 5);
  assert.equal(stats.verifiedMembers, 2);
  assert.equal(stats.moderators, 1);
  assert.equal(stats.ordinaryMembers, 2);
  assert.equal(stats.supremeAdmins, 1);
  assert.equal(stats.suspendedMembers, 1);
  assert.equal(stats.totalActivePosts, 23);
  assert.equal(stats.publishedOrdinaryPosts, 14);
  assert.equal(stats.publishedAnonymousPosts, 9);
  assert.equal(stats.totalMarketplaceListings, 5);
  assert.equal(stats.pendingMarketplaceApprovals, 1);
  assert.equal(stats.approvedMarketplaceListings, 1);
  assert.equal(stats.rejectedMarketplaceListings, 1);
  assert.equal(stats.expiredMarketplaceListings, 1);
  assert.equal(stats.soldMarketplaceListings, 1);
  assert.equal(stats.totalOpportunities, 2);
  assert.equal(stats.activeOpportunities, 1);
  assert.equal(stats.totalEvents, 3);
  assert.equal(stats.upcomingEvents, 1);
  assert.equal(stats.totalFlaggedReports, 4);
  assert.equal(stats.pendingFlaggedReports, 2);
  assert.equal(stats.removedFlaggedReports, 1);
  assert.equal(stats.dismissedFlaggedReports, 1);
  assert.equal(stats.flaggedReportsByReason.harassment, 2);
  assert.equal(stats.flaggedReportsByReason.privacy_leak, 1);
  assert.equal(stats.flaggedReportsByReason.spam, 1);
  assert.equal(stats.flaggedReportsByReason.hate_speech, 0);
  assert.equal(stats.flaggedReportsByTarget.anonymousPost, 2);
  assert.equal(stats.flaggedReportsByTarget.anonymousComment, 2);
});

test('validateOpportunityFormInput and validateCampusEventFormInput reject invalid URLs, short copy, or bad dates', () => {
  assert.equal(
    validateOpportunityFormInput({
      category: 'scholarship',
      title: 'LASUED Merit Scholarship 2026',
      organisation: 'LASUED Bursary',
      description: 'Merit scholarship open to 200-level students across faculties.',
      applicationUrl: 'https://lasued.edu.ng/scholarships',
      expiresAtIso: '2027-01-15T12:00:00Z',
    }),
    null
  );

  assert.ok(
    validateOpportunityFormInput({
      category: 'grant',
      title: 'Hi',
      organisation: 'LASUED',
      description: 'Valid description length',
      applicationUrl: 'https://lasued.edu.ng',
      expiresAtIso: '2027-01-15T12:00:00Z',
    })
  );

  assert.ok(
    validateOpportunityFormInput({
      category: 'job',
      title: 'Graduate Assistant Role',
      organisation: 'LASUED',
      description: 'Graduate assistant role in the faculty.',
      applicationUrl: 'javascript:alert(1)',
      expiresAtIso: '2027-01-15T12:00:00Z',
    })
  );

  assert.equal(
    validateCampusEventFormInput({
      title: 'Annual Tech Symposium',
      description: 'Student innovation showcase at LASUED main auditorium.',
      eventDateIso: '2027-02-20T10:00:00Z',
      venue: 'Main Auditorium',
      organiser: 'Faculty of Science',
      registrationUrl: 'https://lasued.edu.ng/register',
      onlineMeetingUrl: 'https://meet.google.com/abc-defg-hij',
    }),
    null
  );

  assert.ok(
    validateCampusEventFormInput({
      title: 'Annual Tech Symposium',
      description: 'Student innovation showcase at LASUED main auditorium.',
      eventDateIso: 'not-a-date',
      venue: 'A',
      organiser: 'Faculty of Science',
    })
  );

  assert.equal(
    formatAdminAuditActionLabel('marketplace_approved'),
    'Approved marketplace listing'
  );
  assert.equal(
    formatAdminAuditActionLabel('settings_updated'),
    'Updated platform settings'
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINT_LIMITS,
  canActorDeleteOrdinaryPost,
  canActorUpdateTargetRoleRecord,
  canApproveMarketplaceListing,
  canModeratorDeleteByBadge,
  canModeratorDeleteTargetRole,
  canRolePublishCommunityFeed,
  categorizeEventByDate,
  collectCommentTreeIds,
  computeMarketplaceExpiryDate,
  computeTotalOrdinaryPostLikes,
  getBadgeVisualMeta,
  isMarketplaceListingExpired,
  isSafeMediaUrl,
  isValidFirestoreId,
  isValidUsername,
  resolveBadgeAuditAction,
  resolveBadgeForRole,
  resolveMarketplaceUpdateFromQuantity,
  validateAnonymousPostPayload,
  validateCommunityPostPayload,
  validateMediaImagePayload,
  validatePostMediaItems,
  validateTrustedContactPayload,
} from './database';

test('blueprint ID and username validation enforces security bounds', () => {
  assert.equal(isValidFirestoreId('user_123-abc'), true);
  assert.equal(isValidFirestoreId('bad/path'), false);
  assert.equal(isValidFirestoreId('a'.repeat(BLUEPRINT_LIMITS.idMax + 1)), false);

  assert.equal(isValidUsername('lasued_student_01'), true);
  assert.equal(isValidUsername('Upper_Case'), false);
  assert.equal(isValidUsername('ab'), false);
});

test('media URL guard rejects Base64 data URIs and oversized URLs', () => {
  assert.equal(isSafeMediaUrl('https://cdn.example.com/photo.webp'), true);
  assert.equal(isSafeMediaUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isSafeMediaUrl('blob:http://localhost:3000/123'), false);
  assert.equal(
    isSafeMediaUrl(`https://example.com/${'a'.repeat(520)}`),
    false
  );
});

test('role and badge hierarchy matches Part 5 & Part 6 specification', () => {
  assert.equal(canRolePublishCommunityFeed('member'), false);
  assert.equal(canRolePublishCommunityFeed('verified'), true);
  assert.equal(canRolePublishCommunityFeed('moderator'), true);
  assert.equal(canRolePublishCommunityFeed('supreme_admin'), true);
  assert.equal(canRolePublishCommunityFeed('owner'), true);

  // Moderator conflict rule: cannot delete Verified, Moderator, Supreme Admin, or Owner
  assert.equal(canModeratorDeleteTargetRole('member'), true);
  assert.equal(canModeratorDeleteTargetRole('verified'), false);
  assert.equal(canModeratorDeleteTargetRole('moderator'), false);
  assert.equal(canModeratorDeleteTargetRole('supreme_admin'), false);
  assert.equal(canModeratorDeleteTargetRole('owner'), false);

  // Customer Supreme Admin cannot demote/alter Permanent Owner, other Supreme Admins, or themselves
  assert.equal(
    canActorUpdateTargetRoleRecord('supreme_admin', true, 'owner'),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('supreme_admin', false, 'supreme_admin'),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord(
      'supreme_admin',
      false,
      'verified',
      'moderator',
      'admin_1',
      'admin_1'
    ),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord(
      'supreme_admin',
      false,
      'verified',
      'moderator',
      'admin_1',
      'user_2'
    ),
    true
  );
  assert.equal(
    canActorUpdateTargetRoleRecord(
      'supreme_admin',
      false,
      'member',
      'supreme_admin',
      'admin_1',
      'user_2'
    ),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('owner', false, 'verified', 'supreme_admin', 'owner_1', 'user_2'),
    true
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('owner', true, 'owner', 'verified', 'owner_1', 'owner_1'),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('moderator', false, 'member', 'verified', 'mod_1', 'user_2'),
    false
  );

  // Strictly 3 badges + none
  assert.equal(resolveBadgeForRole('owner'), 'supreme_admin');
  assert.equal(resolveBadgeForRole('supreme_admin'), 'supreme_admin');
  assert.equal(resolveBadgeForRole('moderator'), 'moderator');
  assert.equal(resolveBadgeForRole('verified'), 'verified');
  assert.equal(resolveBadgeForRole('member'), 'none');

  // Badge transition audit actions
  assert.equal(resolveBadgeAuditAction('member', 'verified'), 'grant_verified');
  assert.equal(resolveBadgeAuditAction('verified', 'member'), 'remove_verified');
  assert.equal(resolveBadgeAuditAction('member', 'moderator'), 'grant_moderator');
  assert.equal(
    resolveBadgeAuditAction('verified', 'moderator'),
    'promote_verified_to_moderator'
  );
  assert.equal(
    resolveBadgeAuditAction('moderator', 'verified'),
    'demote_moderator_to_verified'
  );
  assert.equal(
    resolveBadgeAuditAction('moderator', 'member'),
    'demote_moderator_to_member'
  );

  // Moderator delete guards by badge & post ownership
  assert.equal(canModeratorDeleteByBadge('none'), true);
  assert.equal(canModeratorDeleteByBadge('verified'), false);
  assert.equal(
    canActorDeleteOrdinaryPost({
      viewerUid: 'mod_1',
      viewerTier: 'moderator',
      viewerSuspended: false,
      postOwnerUid: 'verified_1',
      authorBadge: 'verified',
    }),
    false
  );
  assert.equal(
    canActorDeleteOrdinaryPost({
      viewerUid: 'mod_1',
      viewerTier: 'moderator',
      viewerSuspended: false,
      postOwnerUid: 'member_1',
      authorBadge: 'none',
    }),
    true
  );
  assert.equal(
    canActorDeleteOrdinaryPost({
      viewerUid: 'admin_1',
      viewerTier: 'supreme_admin',
      viewerSuspended: false,
      postOwnerUid: 'verified_1',
      authorBadge: 'verified',
    }),
    true
  );

  assert.equal(getBadgeVisualMeta('supreme_admin').colorDescription, 'Purple, thick, shiny');
  assert.equal(getBadgeVisualMeta('moderator').colorDescription, 'Red');
  assert.equal(getBadgeVisualMeta('verified').colorDescription, 'Green');
});

test('anonymous post validator rejects any identity leakage fields and supports styled text-only & photo posts', () => {
  assert.doesNotThrow(() =>
    validateAnonymousPostPayload({
      id: 'anon_001',
      category: 'Academics',
      body: 'Library power update on Epe campus.',
      backgroundStyle: 'navy_slate',
    })
  );

  assert.doesNotThrow(() =>
    validateAnonymousPostPayload({
      id: 'anon_002',
      category: 'Campus Life',
      body: '',
      mediaItems: [
        {
          imageId: 'img_01',
          width: 800,
          height: 800,
          byteSize: 92000,
          mimeType: 'image/webp',
          order: 0,
          caption: 'Evening sunset near lecture hall.',
        },
      ],
    })
  );

  assert.throws(
    () =>
      validateAnonymousPostPayload({
        id: 'anon_003',
        category: 'Campus',
        body: 'Test',
        ownerUID: 'user_123',
      }),
    /ownerUID/
  );

  assert.throws(
    () =>
      validateAnonymousPostPayload({
        id: 'anon_004',
        category: 'Campus',
        body: 'Test',
        filename: 'IMG_2026.jpg',
      }),
    /filename/
  );

  assert.throws(
    () =>
      validateAnonymousPostPayload({
        id: 'anon_005',
        category: 'Campus',
        body: '',
      }),
    /attach at least one photograph/i
  );
});

test('mediaImages and 4-image post metadata validators enforce Firestore size and anonymous safety rules', () => {
  const sampleMediaItems = [0, 1, 2, 3].map((order) => ({
    imageId: `img_${order}`,
    width: 900,
    height: 900,
    byteSize: 98_000,
    mimeType: 'image/webp' as const,
    order,
    caption: `Slide ${order + 1}`,
  }));

  assert.doesNotThrow(() => validatePostMediaItems(sampleMediaItems));
  assert.throws(
    () =>
      validatePostMediaItems([
        ...sampleMediaItems,
        { ...sampleMediaItems[0], imageId: 'img_5', order: 4 },
      ]),
    /Maximum 4 images/i
  );

  assert.doesNotThrow(() =>
    validateMediaImagePayload({
      id: 'img_anon_1',
      targetCollection: 'anonymousPosts',
      targetId: 'anon_1',
      mimeType: 'image/jpeg',
      width: 1000,
      height: 750,
      byteSize: 102400,
      base64Data: 'A'.repeat(64),
    })
  );

  assert.throws(
    () =>
      validateMediaImagePayload({
        id: 'img_anon_bad',
        targetCollection: 'anonymousPosts',
        targetId: 'anon_1',
        ownerUID: 'uid_secret',
        mimeType: 'image/webp',
        width: 100,
        height: 100,
        byteSize: 500,
        base64Data: 'A'.repeat(64),
      }),
    /ownerUID/
  );

  assert.throws(
    () =>
      validateMediaImagePayload({
        id: 'img_huge',
        targetCollection: 'posts',
        targetId: 'post_1',
        ownerUID: 'uid_1',
        mimeType: 'image/webp',
        width: 100,
        height: 100,
        byteSize: 1000,
        base64Data: 'A'.repeat(BLUEPRINT_LIMITS.mediaBase64MaxChars + 1),
      }),
    /safe Firestore Base64 document ceiling/i
  );

  assert.doesNotThrow(() =>
    validateCommunityPostPayload({
      id: 'post_photo_only',
      ownerUID: 'uid_verified',
      category: 'Campus Update',
      body: '',
      mediaItems: [sampleMediaItems[0]],
    })
  );
});

test('marketplace approval, 7-day expiry, and quantity=0 sold transition work accurately', () => {
  assert.equal(
    canApproveMarketplaceListing('moderator', 'pending_approval'),
    true
  );
  assert.equal(canApproveMarketplaceListing('moderator', 'approved'), false);
  assert.equal(
    canApproveMarketplaceListing('verified', 'pending_approval'),
    false
  );

  const start = new Date('2026-11-21T00:00:00.000Z');
  const expiry = computeMarketplaceExpiryDate(start);
  assert.equal(
    expiry.getTime() - start.getTime(),
    BLUEPRINT_LIMITS.sevenDaysMs
  );
  assert.equal(
    isMarketplaceListingExpired(expiry.getTime(), start.getTime() + 1000),
    false
  );
  assert.equal(
    isMarketplaceListingExpired(expiry.getTime(), expiry.getTime() + 1),
    true
  );

  assert.deepEqual(resolveMarketplaceUpdateFromQuantity(0), {
    quantity: 0,
    status: 'sold',
  });
  assert.deepEqual(resolveMarketplaceUpdateFromQuantity(3), {
    quantity: 3,
    status: 'active',
  });
});

test('trusted contact validator enforces admin-listed contact non-account status', () => {
  assert.doesNotThrow(() =>
    validateTrustedContactPayload({
      id: 'contact_01',
      entryType: 'admin_listed_contact',
      isUserAccount: false,
      fullName: 'Dr. Adebayo',
      category: 'lecturer',
      roleTitle: 'Senior Lecturer',
      createdByUid: 'admin_01',
      createdAt: null,
      updatedAt: null,
    })
  );
});

test('event categorization automatically transitions past events', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  assert.equal(categorizeEventByDate(now + 3600_000, now, 'upcoming'), 'upcoming');
  assert.equal(categorizeEventByDate(now - 3600_000, now, 'upcoming'), 'past');
  assert.equal(categorizeEventByDate(now - 3600_000, now, 'cancelled'), 'cancelled');
});

test('computeTotalOrdinaryPostLikes totals published public post likes accurately', () => {
  assert.equal(
    computeTotalOrdinaryPostLikes([
      { likesCount: 14, status: 'published' },
      { likesCount: 6, status: 'published' },
      { likesCount: 100, status: 'deleted' },
      { likesCount: -3, status: 'published' },
    ]),
    20
  );
  assert.equal(computeTotalOrdinaryPostLikes([]), 0);
});

test('collectCommentTreeIds recursively collects a comment and all nested descendants', () => {
  const tree = [
    { id: 'c1' },
    { id: 'r1', parentCommentId: 'c1' },
    { id: 'r2', parentCommentId: 'c1' },
    { id: 'r1_nested', parentCommentId: 'r1' },
    { id: 'c2' },
    { id: 'r3', parentCommentId: 'c2' },
  ];

  assert.deepEqual(collectCommentTreeIds(tree, 'c1'), [
    'c1',
    'r1',
    'r2',
    'r1_nested',
  ]);
  assert.deepEqual(collectCommentTreeIds(tree, 'c2'), ['c2', 'r3']);
  assert.deepEqual(collectCommentTreeIds(tree, 'r1_nested'), ['r1_nested']);
});


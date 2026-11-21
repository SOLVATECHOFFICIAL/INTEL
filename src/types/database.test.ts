import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINT_LIMITS,
  canActorUpdateTargetRoleRecord,
  canApproveMarketplaceListing,
  canModeratorDeleteTargetRole,
  canRolePublishCommunityFeed,
  categorizeEventByDate,
  computeMarketplaceExpiryDate,
  getBadgeVisualMeta,
  isMarketplaceListingExpired,
  isSafeMediaUrl,
  isValidFirestoreId,
  isValidUsername,
  resolveMarketplaceUpdateFromQuantity,
  validateAnonymousPostPayload,
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

  // Customer Supreme Admin cannot demote/alter Permanent Owner or other Supreme Admins
  assert.equal(
    canActorUpdateTargetRoleRecord('supreme_admin', true, 'owner'),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('supreme_admin', false, 'supreme_admin'),
    false
  );
  assert.equal(
    canActorUpdateTargetRoleRecord('supreme_admin', false, 'verified'),
    true
  );
  assert.equal(canActorUpdateTargetRoleRecord('owner', true, 'owner'), true);

  assert.equal(getBadgeVisualMeta('supreme_admin').colorDescription, 'Purple, thick, shiny');
  assert.equal(getBadgeVisualMeta('moderator').colorDescription, 'Red');
  assert.equal(getBadgeVisualMeta('verified').colorDescription, 'Green');
});

test('anonymous post validator rejects any identity leakage fields', () => {
  assert.doesNotThrow(() =>
    validateAnonymousPostPayload({
      id: 'anon_001',
      category: 'Academics',
      body: 'Library power update on Epe campus.',
    })
  );

  assert.throws(
    () =>
      validateAnonymousPostPayload({
        id: 'anon_002',
        category: 'Campus',
        body: 'Test',
        ownerUID: 'user_123',
      }),
    /ownerUID/
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

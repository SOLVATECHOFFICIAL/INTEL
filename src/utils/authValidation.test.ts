import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import {
  buildWhatsAppChatUrl,
  CAMPUS_STATUS_OPTIONS,
  canAccessAdminDashboard,
  canCreateAnonymousEntry,
  canPublishOrdinaryFeedUpdate,
  formatFirestoreOrAppError,
  isAccountSuspended,
  isReservedUsername,
  isValidEmailAddress,
  mapFirebaseAuthError,
  normalizeUsername,
  resolveEffectiveAccountTier,
  toPublicProfileProjection,
  validatePasswordChangeForm,
  validateProfileSettingsForm,
  validateRegistrationForm,
  validateUsernameCandidate,
  type RegistrationFormInput,
} from './authValidation';

function makeValidRegistration(): RegistrationFormInput {
  return {
    fullName: 'Adebayo Oluwaseun',
    username: 'Adebayo_01',
    email: 'adebayo@student.lasued.edu.ng',
    whatsappNumber: '+2348012345678',
    password: 'StrongPassword123',
    confirmPassword: 'StrongPassword123',
    department: 'Computer Science',
    level: 'Finalist',
    acceptedTerms: true,
  };
}

test('validateRegistrationForm requires all compulsory fields and enforces unique/non-reserved case-insensitive usernames', () => {
  assert.deepEqual(validateRegistrationForm(makeValidRegistration()), {});

  const invalid = validateRegistrationForm({
    fullName: 'A',
    username: 'x!',
    email: 'not-an-email',
    whatsappNumber: 'abc',
    department: '',
    level: '',
    password: '123',
    confirmPassword: '456',
    acceptedTerms: false,
  });

  assert.ok(invalid.fullName);
  assert.ok(invalid.username);
  assert.ok(invalid.email);
  assert.ok(invalid.whatsappNumber);
  assert.ok(invalid.department);
  assert.ok(invalid.level);
  assert.ok(invalid.password);
  assert.ok(invalid.confirmPassword);
  assert.ok(invalid.acceptedTerms);
  assert.equal(normalizeUsername('  Solomon '), normalizeUsername('SOLOMON'));
  assert.equal(isReservedUsername('ADMIN'), true);
  assert.equal(isReservedUsername('lasued_intel'), true);
  assert.ok(validateUsernameCandidate('admin'));
  assert.equal(validateUsernameCandidate('Solomon_2026'), null);

  // Supports students, finalists, graduates/alumni, and lecturers
  assert.ok(CAMPUS_STATUS_OPTIONS.includes('Finalist'));
  assert.ok(CAMPUS_STATUS_OPTIONS.includes('Graduate / Alumni'));
  assert.ok(CAMPUS_STATUS_OPTIONS.includes('Lecturer / Academic Staff'));
});

test('validateProfileSettingsForm validates username, bio, department, faculty, media URLs, level, and public WhatsApp updates', () => {
  assert.deepEqual(
    validateProfileSettingsForm({
      fullName: 'Dr. Tunde Bakare',
      username: 'tunde_bakare',
      bio: 'Senior Lecturer in Computer Science and campus advisor.',
      department: 'Computer Science',
      faculty: 'Science and Technology Education',
      level: 'Lecturer / Academic Staff',
      publicWhatsapp: '08012345678',
      photoUrl: 'https://example.com/avatar.jpg',
      coverUrl: 'https://example.com/cover.jpg',
    }),
    {}
  );

  const invalid = validateProfileSettingsForm({
    fullName: 'A',
    username: 'owner',
    bio: 'a'.repeat(501),
    department: '',
    faculty: 'f'.repeat(121),
    level: '',
    publicWhatsapp: '12',
    photoUrl: 'data:image/png;base64,AAA',
    coverUrl: 'blob:https://example.com/123',
  });

  assert.ok(invalid.fullName);
  assert.ok(invalid.username);
  assert.ok(invalid.bio);
  assert.ok(invalid.department);
  assert.ok(invalid.faculty);
  assert.ok(invalid.level);
  assert.ok(invalid.publicWhatsapp);
  assert.ok(invalid.photoUrl);
  assert.ok(invalid.coverUrl);
});

test('validatePasswordChangeForm enforces current password, length, and confirmation', () => {
  assert.deepEqual(
    validatePasswordChangeForm({
      currentPassword: 'oldPassword1',
      newPassword: 'newStrongPassword2',
      confirmNewPassword: 'newStrongPassword2',
    }),
    {}
  );

  const invalid = validatePasswordChangeForm({
    currentPassword: 'samePassword',
    newPassword: 'samePassword',
    confirmNewPassword: 'differentPassword',
  });
  assert.ok(invalid.newPassword);
  assert.ok(invalid.confirmNewPassword);
});

test('toPublicProfileProjection strictly strips uid, memberId, publicEmail, and directory visibility flags', () => {
  const projected = toPublicProfileProjection({
    uid: 'secret_firebase_uid_999',
    memberId: 'LI-secret_member',
    fullName: 'Solomon Adeyemi',
    username: 'solomon',
    bio: 'CSC Finalist',
    department: 'Computer Science',
    faculty: 'Science',
    level: 'Finalist',
    publicEmail: 'private@lasued.edu.ng',
    publicWhatsapp: '+2348012345678',
    showWhatsappPublicly: true,
    badge: 'verified',
    accountStatus: 'active',
    isHiddenFromDirectory: false,
    followersCount: 12,
    followingCount: 4,
    createdAt: 1000,
    updatedAt: 2000,
  });

  assert.equal('uid' in projected, false);
  assert.equal('memberId' in projected, false);
  assert.equal('publicEmail' in projected, false);
  assert.equal('isHiddenFromDirectory' in projected, false);
  assert.equal(projected.username, 'solomon');
  assert.equal(projected.followersCount, 12);
});

test('buildWhatsAppChatUrl formats Nigerian local and international numbers cleanly', () => {
  assert.equal(
    buildWhatsAppChatUrl('08012345678'),
    'https://wa.me/2348012345678'
  );
  assert.equal(
    buildWhatsAppChatUrl('+234 801 234 5678'),
    'https://wa.me/2348012345678'
  );
  assert.equal(buildWhatsAppChatUrl('123'), null);
  assert.equal(isValidEmailAddress('student@lasued.edu.ng'), true);
  assert.equal(isValidEmailAddress('bad-email'), false);
});

test('resolveEffectiveAccountTier distinguishes all 6 account states and blocks suspended access', () => {
  const fakeUser = { uid: 'uid_123' } as User;

  assert.equal(resolveEffectiveAccountTier(null, null), 'guest');
  assert.equal(resolveEffectiveAccountTier(fakeUser, null), 'member');
  assert.equal(
    resolveEffectiveAccountTier(fakeUser, {
      uid: 'uid_123',
      role: 'verified',
      badge: 'verified',
      isPermanentOwner: false,
      isHiddenFromDirectory: false,
      updatedAt: null,
    }),
    'verified'
  );
  assert.equal(
    resolveEffectiveAccountTier(fakeUser, {
      uid: 'uid_123',
      role: 'moderator',
      badge: 'moderator',
      isPermanentOwner: false,
      isHiddenFromDirectory: false,
      updatedAt: null,
    }),
    'moderator'
  );
  assert.equal(
    resolveEffectiveAccountTier(fakeUser, {
      uid: 'uid_123',
      role: 'supreme_admin',
      badge: 'supreme_admin',
      isPermanentOwner: false,
      isHiddenFromDirectory: false,
      updatedAt: null,
    }),
    'supreme_admin'
  );
  assert.equal(
    resolveEffectiveAccountTier(fakeUser, {
      uid: 'uid_123',
      role: 'owner',
      badge: 'supreme_admin',
      isPermanentOwner: true,
      isHiddenFromDirectory: true,
      updatedAt: null,
    }),
    'owner'
  );

  // Admin dashboard guard
  assert.equal(canAccessAdminDashboard('guest', false), false);
  assert.equal(canAccessAdminDashboard('member', false), false);
  assert.equal(canAccessAdminDashboard('verified', false), false);
  assert.equal(canAccessAdminDashboard('moderator', false), false);
  assert.equal(canAccessAdminDashboard('supreme_admin', false), true);
  assert.equal(canAccessAdminDashboard('owner', false), true);
  assert.equal(canAccessAdminDashboard('owner', true), false);

  // Ordinary feed publish vs anonymous creation
  assert.equal(canPublishOrdinaryFeedUpdate('member', false), false);
  assert.equal(canPublishOrdinaryFeedUpdate('verified', false), true);
  assert.equal(canCreateAnonymousEntry('guest', false), false);
  assert.equal(canCreateAnonymousEntry('member', false), true);
  assert.equal(canCreateAnonymousEntry('member', true), false);

  assert.equal(
    isAccountSuspended({
      uid: 'uid_123',
      memberId: 'LI-1234',
      fullName: 'Test',
      username: 'test_user',
      showWhatsappPublicly: true,
      publicWhatsapp: '+2348012345678',
      badge: 'none',
      accountStatus: 'suspended',
      isHiddenFromDirectory: false,
      followersCount: 0,
      followingCount: 0,
      createdAt: null,
      updatedAt: null,
    }),
    true
  );
});

test('mapFirebaseAuthError handles auth error codes gracefully', () => {
  assert.match(
    mapFirebaseAuthError({ code: 'auth/invalid-email' }),
    /invalid/i
  );
  assert.match(
    mapFirebaseAuthError({ code: 'auth/email-already-in-use' }),
    /already exists/i
  );
  assert.match(
    mapFirebaseAuthError({ code: 'auth/requires-recent-login' }),
    /current password/i
  );
});

test('formatFirestoreOrAppError extracts clean error strings from structured Firestore JSON errors', () => {
  const jsonWrapped = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'update',
      path: 'users/abc',
    })
  );
  assert.match(
    formatFirestoreOrAppError(jsonWrapped, 'Fallback'),
    /Permission denied by database security rules/i
  );

  const customJson = new Error(
    JSON.stringify({ error: 'Username @solomon is already claimed.' })
  );
  assert.equal(
    formatFirestoreOrAppError(customJson, 'Fallback'),
    'Username @solomon is already claimed.'
  );

  assert.equal(
    formatFirestoreOrAppError(new Error('Plain readable message'), 'Fallback'),
    'Plain readable message'
  );
});

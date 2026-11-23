import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import {
  ACCOUNT_CATEGORY_OPTIONS,
  buildWhatsAppChatUrl,
  CAMPUS_STATUS_OPTIONS,
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
  canCreateAnonymousEntry,
  canPublishOrdinaryFeedUpdate,
  canPublishOrdinaryPostStrict,
  canRevealAnonymousAuthor,
  DESIGNATED_SUPREME_ADMIN_EMAILS,
  formatFirestoreOrAppError,
  isAccountSuspended,
  isDesignatedSupremeAdminUser,
  isPermanentOwnerUser,
  isProfileAccessibleByDirectInteraction,
  isProfilePubliclyDiscoverableInDirectory,
  isPublicSupremeAdminUser,
  isReservedUsername,
  isUndergroundSupremeAdminUser,
  isValidEmailAddress,
  mapFirebaseAuthError,
  normalizeUsername,
  PERMANENT_OWNER_EMAIL,
  PUBLIC_SUPREME_ADMIN_EMAIL,
  resolveAuthoritativeMappingRole,
  resolveEffectiveAccountTier,
  toPublicProfileProjection,
  UNDERGROUND_SUPREME_ADMIN_EMAIL,
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

test('validateProfileSettingsForm validates username, bio, department, faculty, accountCategory, media URLs, level, and public WhatsApp updates', () => {
  assert.ok(ACCOUNT_CATEGORY_OPTIONS.includes('Undergraduate Student'));
  assert.ok(ACCOUNT_CATEGORY_OPTIONS.includes('Lecturer / Academic Staff'));

  assert.deepEqual(
    validateProfileSettingsForm({
      fullName: 'Dr. Tunde Bakare',
      username: 'tunde_bakare',
      bio: 'Senior Lecturer in Computer Science and campus advisor.',
      department: 'Computer Science',
      faculty: 'Science and Technology Education',
      level: 'Lecturer / Academic Staff',
      accountCategory: 'Lecturer / Academic Staff',
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
    accountCategory: 'c'.repeat(65),
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
  assert.ok(invalid.accountCategory);
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

test('toPublicProfileProjection strictly strips uid, memberId, publicEmail, hidden WhatsApp, and directory visibility flags while preserving accountCategory', () => {
  const projected = toPublicProfileProjection({
    uid: 'secret_firebase_uid_999',
    memberId: 'LI-secret_member',
    fullName: 'Solomon Adeyemi',
    username: 'solomon',
    bio: 'CSC Finalist',
    department: 'Computer Science',
    faculty: 'Science',
    level: 'Finalist',
    accountCategory: 'Finalist Student',
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
  assert.equal(projected.accountCategory, 'Finalist Student');
  assert.equal(projected.publicWhatsapp, '+2348012345678');
  assert.equal(projected.followersCount, 12);

  const hiddenWhatsapp = toPublicProfileProjection({
    uid: 'secret_2',
    memberId: 'LI-secret_2',
    fullName: 'Private Member',
    username: 'private_member',
    publicWhatsapp: '+2348012345678',
    showWhatsappPublicly: false,
    badge: 'none',
    accountStatus: 'active',
    isHiddenFromDirectory: false,
    followersCount: 0,
    followingCount: 0,
    createdAt: 1000,
    updatedAt: 2000,
  });
  assert.equal(hiddenWhatsapp.publicWhatsapp, undefined);
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

  assert.equal(
    resolveEffectiveAccountTier(
      { uid: 'owner_uid', email: PERMANENT_OWNER_EMAIL, emailVerified: true } as User,
      null
    ),
    'owner'
  );
  assert.equal(
    isPermanentOwnerUser({
      uid: 'owner_uid',
      email: PERMANENT_OWNER_EMAIL,
      emailVerified: false,
    } as User),
    false
  );
  assert.equal(
    isPermanentOwnerUser({
      uid: 'owner_uid',
      email: PERMANENT_OWNER_EMAIL.toUpperCase(),
      emailVerified: true,
    } as User),
    true
  );

  // Admin dashboard guard (Moderators enter scoped console; full admin requires Supreme Admin / Owner)
  assert.equal(canAccessAdminDashboard('guest', false), false);
  assert.equal(canAccessAdminDashboard('member', false), false);
  assert.equal(canAccessAdminDashboard('verified', false), false);
  assert.equal(canAccessAdminDashboard('moderator', false), true);
  assert.equal(canAccessAdminDashboard('moderator', true), false);
  assert.equal(canAccessAdminDashboard('supreme_admin', false), true);
  assert.equal(canAccessAdminDashboard('owner', false), true);
  assert.equal(canAccessAdminDashboard('owner', true), false);

  assert.equal(canAccessFullAdminDashboard('guest', false), false);
  assert.equal(canAccessFullAdminDashboard('member', false), false);
  assert.equal(canAccessFullAdminDashboard('verified', false), false);
  assert.equal(canAccessFullAdminDashboard('moderator', false), false);
  assert.equal(canAccessFullAdminDashboard('supreme_admin', false), true);
  assert.equal(canAccessFullAdminDashboard('owner', false), true);
  assert.equal(canAccessFullAdminDashboard('owner', true), false);

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

  // Mismatched role/badge defaults to ordinary member
  assert.equal(
    resolveEffectiveAccountTier(fakeUser, {
      uid: 'uid_123',
      role: 'verified',
      badge: 'none',
      isPermanentOwner: false,
      isHiddenFromDirectory: false,
      updatedAt: null,
    }),
    'member'
  );

  const activeVerifiedProfile = {
    uid: 'uid_123',
    memberId: 'LI-1234',
    fullName: 'Verified Student',
    username: 'verified_student',
    showWhatsappPublicly: true,
    publicWhatsapp: '+2348012345678',
    badge: 'verified' as const,
    accountStatus: 'active' as const,
    isHiddenFromDirectory: false,
    followersCount: 0,
    followingCount: 0,
    createdAt: null,
    updatedAt: null,
  };

  const validVerifiedRole = {
    uid: 'uid_123',
    role: 'verified' as const,
    badge: 'verified' as const,
    isPermanentOwner: false,
    isHiddenFromDirectory: false,
    updatedAt: null,
  };

  assert.equal(
    canPublishOrdinaryPostStrict({
      user: fakeUser,
      tier: 'verified',
      profile: activeVerifiedProfile,
      roleRecord: validVerifiedRole,
      suspended: false,
    }),
    true
  );

  // Deny by default when roleRecord is missing, mismatched, or profile badge disagrees
  assert.equal(
    canPublishOrdinaryPostStrict({
      user: fakeUser,
      tier: 'verified',
      profile: activeVerifiedProfile,
      roleRecord: null,
      suspended: false,
    }),
    false
  );
  assert.equal(
    canPublishOrdinaryPostStrict({
      user: fakeUser,
      tier: 'verified',
      profile: { ...activeVerifiedProfile, badge: 'none' },
      roleRecord: validVerifiedRole,
      suspended: false,
    }),
    false
  );
  assert.equal(
    canPublishOrdinaryPostStrict({
      user: fakeUser,
      tier: 'member',
      profile: { ...activeVerifiedProfile, badge: 'none' },
      roleRecord: { ...validVerifiedRole, role: 'member', badge: 'none' },
      suspended: false,
    }),
    false
  );
  assert.equal(
    canPublishOrdinaryPostStrict({
      user: fakeUser,
      tier: 'verified',
      profile: activeVerifiedProfile,
      roleRecord: validVerifiedRole,
      suspended: true,
    }),
    false
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

test('resolveAuthoritativeMappingRole mirrors firestore.rules currentRoleString() across owner, inconsistent role docs, and absent docs', () => {
  const ownerUser = {
    uid: 'owner_uid',
    email: PERMANENT_OWNER_EMAIL,
    emailVerified: true,
  } as unknown as User;
  const standardUser = {
    uid: 'user_uid',
    email: 'student@example.com',
    emailVerified: true,
  } as unknown as User;

  assert.equal(
    resolveAuthoritativeMappingRole(ownerUser, null, 'member'),
    'owner'
  );
  assert.equal(
    resolveAuthoritativeMappingRole(
      standardUser,
      { role: 'supreme_admin', badge: 'none' },
      'member'
    ),
    'supreme_admin'
  );
  assert.equal(
    resolveAuthoritativeMappingRole(
      standardUser,
      { role: 'owner', isPermanentOwner: false },
      'member'
    ),
    'owner'
  );
  assert.equal(
    resolveAuthoritativeMappingRole(standardUser, null, 'verified'),
    'member'
  );
  assert.equal(
    resolveAuthoritativeMappingRole(standardUser, undefined, 'moderator'),
    'moderator'
  );
});

test('Prompt 20 designated Supreme Admins, anonymous reveal restriction, and underground discoverability rules', () => {
  const publicAdmin = {
    uid: 'pub_admin',
    email: PUBLIC_SUPREME_ADMIN_EMAIL,
    emailVerified: true,
  } as User;
  const undergroundAdmin = {
    uid: 'ug_admin',
    email: 'Awoyinfasolomon1@gmail.com',
    emailVerified: true,
  } as User;
  const unverifiedAdmin = {
    uid: 'unv_admin',
    email: UNDERGROUND_SUPREME_ADMIN_EMAIL,
    emailVerified: false,
  } as User;
  const genericSupremeAdmin = {
    uid: 'other_admin',
    email: 'co_admin@lasued.edu.ng',
    emailVerified: true,
  } as User;

  assert.equal(DESIGNATED_SUPREME_ADMIN_EMAILS.length, 2);
  assert.equal(isPublicSupremeAdminUser(publicAdmin), true);
  assert.equal(isUndergroundSupremeAdminUser(undergroundAdmin), true);
  assert.equal(isUndergroundSupremeAdminUser(unverifiedAdmin), false);
  assert.equal(isDesignatedSupremeAdminUser(publicAdmin), true);
  assert.equal(isDesignatedSupremeAdminUser(undergroundAdmin), true);
  assert.equal(isDesignatedSupremeAdminUser(genericSupremeAdmin), false);

  assert.equal(canRevealAnonymousAuthor(publicAdmin), true);
  assert.equal(canRevealAnonymousAuthor(undergroundAdmin), true);
  assert.equal(canRevealAnonymousAuthor(unverifiedAdmin), false);
  assert.equal(canRevealAnonymousAuthor(genericSupremeAdmin), false);
  assert.equal(canRevealAnonymousAuthor(null), false);

  assert.equal(resolveEffectiveAccountTier(publicAdmin, null), 'supreme_admin');
  assert.equal(resolveEffectiveAccountTier(undergroundAdmin, null), 'supreme_admin');
  assert.equal(resolveAuthoritativeMappingRole(undergroundAdmin, null, 'member'), 'supreme_admin');

  // Underground Supreme Admin can still publish community updates with public badge toggled OFF ('none')
  assert.equal(
    canPublishOrdinaryPostStrict({
      user: undergroundAdmin,
      tier: 'supreme_admin',
      profile: {
        uid: 'ug_admin',
        memberId: 'LI-UG',
        fullName: 'Solomon',
        username: 'solomon_ug',
        showWhatsappPublicly: false,
        publicWhatsapp: '',
        badge: 'none',
        accountStatus: 'active',
        isHiddenFromDirectory: true,
        followersCount: 0,
        followingCount: 0,
        createdAt: null,
        updatedAt: null,
      },
      roleRecord: {
        uid: 'ug_admin',
        role: 'supreme_admin',
        badge: 'supreme_admin',
        isPermanentOwner: false,
        isHiddenFromDirectory: true,
        updatedAt: null,
      },
      suspended: false,
    }),
    true
  );

  // Underground discoverability rules
  assert.equal(
    isProfilePubliclyDiscoverableInDirectory({
      accountStatus: 'active',
      isHiddenFromDirectory: true,
    }),
    false
  );
  assert.equal(
    isProfilePubliclyDiscoverableInDirectory({
      accountStatus: 'active',
      isHiddenFromDirectory: false,
    }),
    true
  );
  assert.equal(
    isProfilePubliclyDiscoverableInDirectory({
      accountStatus: 'suspended',
      isHiddenFromDirectory: false,
    }),
    false
  );
  assert.equal(
    isProfileAccessibleByDirectInteraction(
      {
        uid: 'ug_admin',
        accountStatus: 'active',
        isHiddenFromDirectory: true,
        hasPublicActivity: false,
      },
      'guest_or_other'
    ),
    false
  );
  assert.equal(
    isProfileAccessibleByDirectInteraction(
      {
        uid: 'ug_admin',
        accountStatus: 'active',
        isHiddenFromDirectory: true,
        hasPublicActivity: true,
      },
      'guest_or_other'
    ),
    true
  );
  assert.equal(
    isProfileAccessibleByDirectInteraction(
      {
        uid: 'ug_admin',
        accountStatus: 'active',
        isHiddenFromDirectory: true,
        hasPublicActivity: false,
      },
      'ug_admin'
    ),
    true
  );
});

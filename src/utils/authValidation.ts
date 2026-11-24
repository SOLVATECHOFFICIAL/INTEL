import type { User } from 'firebase/auth';
import {
  BLUEPRINT_LIMITS,
  isValidUsername,
  resolveBadgeForRole,
  type PublicProfileProjection,
  type PublicUserProfile,
  type UserRole,
  type UserRoleRecord,
} from '../types/database';

export type EffectiveAccountTier = 'guest' | UserRole;

export const CAMPUS_STATUS_OPTIONS = [
  '100 Level',
  '200 Level',
  '300 Level',
  '400 Level',
  '500 Level',
  'Finalist',
  'Graduate / Alumni',
  'Postgraduate',
  'Lecturer / Academic Staff',
  'Non-Teaching Staff',
] as const;

export const ACCOUNT_CATEGORY_OPTIONS = [
  'Undergraduate Student',
  'Finalist Student',
  'Postgraduate Student',
  'Graduate / Alumni',
  'Lecturer / Academic Staff',
  'Non-Teaching Staff',
  'Course Rep / Student Leader',
  'Campus Creator / Vendor',
] as const;

export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'supreme_admin',
  'moderator',
  'owner',
  'lasued',
  'lasued_intel',
  'lasuedintel',
  'support',
  'help',
  'system',
  'official',
  'staff',
  'security',
  'verify',
  'verified',
  'anonymous',
  'unfiltered',
  'marketplace',
  'trusted_circle',
  'trustedcircle',
  'opportunities',
  'events',
  'notifications',
  'search',
  'settings',
  'account',
  'profile',
  'login',
  'register',
  'signup',
  'signin',
  'root',
  'null',
  'undefined',
  'api',
  'www',
] as const;

export function isReservedUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  return (RESERVED_USERNAMES as readonly string[]).includes(normalized);
}

export interface RegistrationFormInput {
  fullName: string;
  username: string;
  email: string;
  whatsappNumber: string;
  password: string;
  confirmPassword: string;
  department: string;
  level: string;
  acceptedTerms: boolean;
}

export type RegistrationField =
  | 'fullName'
  | 'username'
  | 'email'
  | 'whatsappNumber'
  | 'password'
  | 'confirmPassword'
  | 'department'
  | 'level'
  | 'acceptedTerms';

export type RegistrationValidationErrors = Partial<
  Record<RegistrationField, string>
>;

export interface ProfileSettingsFormInput {
  fullName: string;
  username: string;
  bio: string;
  department: string;
  faculty: string;
  level: string;
  accountCategory: string;
  publicWhatsapp: string;
  showWhatsappPublicly?: boolean;
  photoUrl: string;
  coverUrl: string;
}

export type ProfileSettingsField =
  | 'fullName'
  | 'username'
  | 'bio'
  | 'department'
  | 'faculty'
  | 'level'
  | 'accountCategory'
  | 'publicWhatsapp'
  | 'photoUrl'
  | 'coverUrl';

export type ProfileSettingsValidationErrors = Partial<
  Record<ProfileSettingsField, string>
>;

export interface PasswordChangeFormInput {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export type PasswordChangeField =
  | 'currentPassword'
  | 'newPassword'
  | 'confirmNewPassword';

export type PasswordChangeValidationErrors = Partial<
  Record<PasswordChangeField, string>
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+0-9\s()-]{7,24}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsernameCandidate(value: string): string | null {
  const normalized = normalizeUsername(value);
  if (!isValidUsername(normalized)) {
    return 'Username must be 3–32 characters using only lowercase letters, numbers, or underscores.';
  }
  if (isReservedUsername(normalized)) {
    return 'This username is reserved by LASUED Intel. Please choose another.';
  }
  return null;
}

export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  return EMAIL_PATTERN.test(trimmed) && trimmed.length <= BLUEPRINT_LIMITS.emailMax;
}

export function buildWhatsAppChatUrl(whatsappNumber: string): string | null {
  const trimmed = whatsappNumber.trim();
  if (!PHONE_PATTERN.test(trimmed)) {
    return null;
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `234${digits.slice(1)}`;
  }

  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  return `https://wa.me/${digits}`;
}

export function validateRegistrationForm(
  input: RegistrationFormInput
): RegistrationValidationErrors {
  const errors: RegistrationValidationErrors = {};

  const fullName = input.fullName.trim();
  if (
    fullName.length < BLUEPRINT_LIMITS.fullNameMin ||
    fullName.length > BLUEPRINT_LIMITS.fullNameMax
  ) {
    errors.fullName = `Full name must be between ${BLUEPRINT_LIMITS.fullNameMin} and ${BLUEPRINT_LIMITS.fullNameMax} characters.`;
  }

  const usernameError = validateUsernameCandidate(input.username);
  if (usernameError) {
    errors.username = usernameError;
  }

  if (!isValidEmailAddress(input.email)) {
    errors.email = 'Enter a valid email address (compulsory).';
  }

  const whatsapp = input.whatsappNumber.trim();
  if (!PHONE_PATTERN.test(whatsapp)) {
    errors.whatsappNumber =
      'Enter a valid WhatsApp number (7–24 characters). This will be public on your profile.';
  }

  const department = input.department.trim();
  if (department.length < 2 || department.length > BLUEPRINT_LIMITS.departmentMax) {
    errors.department = `Enter your department or unit (2–${BLUEPRINT_LIMITS.departmentMax} characters).`;
  }

  const level = input.level.trim();
  if (level.length < 2 || level.length > BLUEPRINT_LIMITS.levelMax) {
    errors.level = 'Select your academic level or campus status.';
  }

  if (input.password.length < 6 || input.password.length > 128) {
    errors.password = 'Password must be at least 6 characters long.';
  }

  if (input.confirmPassword !== input.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!input.acceptedTerms) {
    errors.acceptedTerms =
      'You must accept the LASUED Intel Terms and Privacy Policy to register.';
  }

  return errors;
}

export function validateProfileSettingsForm(
  input: ProfileSettingsFormInput
): ProfileSettingsValidationErrors {
  const errors: ProfileSettingsValidationErrors = {};

  const fullName = input.fullName.trim();
  if (
    fullName.length < BLUEPRINT_LIMITS.fullNameMin ||
    fullName.length > BLUEPRINT_LIMITS.fullNameMax
  ) {
    errors.fullName = `Full name must be between ${BLUEPRINT_LIMITS.fullNameMin} and ${BLUEPRINT_LIMITS.fullNameMax} characters.`;
  }

  const usernameError = validateUsernameCandidate(input.username);
  if (usernameError) {
    errors.username = usernameError;
  }

  if (input.bio.trim().length > BLUEPRINT_LIMITS.bioMax) {
    errors.bio = `Bio must be ${BLUEPRINT_LIMITS.bioMax} characters or fewer.`;
  }

  const department = input.department.trim();
  if (department.length < 2 || department.length > BLUEPRINT_LIMITS.departmentMax) {
    errors.department = `Department or unit must be between 2 and ${BLUEPRINT_LIMITS.departmentMax} characters.`;
  }

  const faculty = input.faculty.trim();
  if (faculty.length > BLUEPRINT_LIMITS.facultyMax) {
    errors.faculty = `Faculty must be ${BLUEPRINT_LIMITS.facultyMax} characters or fewer.`;
  }

  const level = input.level.trim();
  if (level.length < 2 || level.length > BLUEPRINT_LIMITS.levelMax) {
    errors.level = 'Select your academic level or campus status.';
  }

  const accountCategory = input.accountCategory.trim();
  if (accountCategory.length > BLUEPRINT_LIMITS.accountCategoryMax) {
    errors.accountCategory = `Account category must be ${BLUEPRINT_LIMITS.accountCategoryMax} characters or fewer.`;
  }

  const whatsapp = input.publicWhatsapp.trim();
  if (!PHONE_PATTERN.test(whatsapp)) {
    errors.publicWhatsapp =
      'Enter a valid public WhatsApp number (7–24 characters).';
  }

  const photoUrl = input.photoUrl.trim();
  if (photoUrl && !isSafeMediaUrlInput(photoUrl)) {
    errors.photoUrl =
      'Profile picture must be an external http(s) URL (max 512 chars), not a data/blob URI.';
  }

  const coverUrl = input.coverUrl.trim();
  if (coverUrl && !isSafeMediaUrlInput(coverUrl)) {
    errors.coverUrl =
      'Cover photo must be an external http(s) URL (max 512 chars), not a data/blob URI.';
  }

  return errors;
}

function isSafeMediaUrlInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > BLUEPRINT_LIMITS.urlMax) {
    return false;
  }
  if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return false;
  }
  return /^https?:\/\//i.test(trimmed);
}

export function validatePasswordChangeForm(
  input: PasswordChangeFormInput
): PasswordChangeValidationErrors {
  const errors: PasswordChangeValidationErrors = {};
  if (!input.currentPassword) {
    errors.currentPassword = 'Enter your current password to verify your identity.';
  }
  if (input.newPassword.length < 6 || input.newPassword.length > 128) {
    errors.newPassword = 'New password must be between 6 and 128 characters.';
  } else if (input.newPassword === input.currentPassword) {
    errors.newPassword = 'New password must differ from your current password.';
  }
  if (input.confirmNewPassword !== input.newPassword) {
    errors.confirmNewPassword = 'New passwords do not match.';
  }
  return errors;
}

export function isAccountSuspended(
  profile: PublicUserProfile | null | undefined
): boolean {
  return profile?.accountStatus === 'suspended';
}

export const PUBLIC_SUPREME_ADMIN_EMAIL = 'lasuedintel@gmail.com';
export const UNDERGROUND_SUPREME_ADMIN_EMAIL = 'awoyinfasolomon1@gmail.com';
export const DESIGNATED_SUPREME_ADMIN_EMAILS = [
  PUBLIC_SUPREME_ADMIN_EMAIL,
  UNDERGROUND_SUPREME_ADMIN_EMAIL,
] as const;

export function isPublicSupremeAdminUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.trim().toLowerCase() === PUBLIC_SUPREME_ADMIN_EMAIL
  );
}

export function isUndergroundSupremeAdminUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.trim().toLowerCase() === UNDERGROUND_SUPREME_ADMIN_EMAIL
  );
}

export function hasDesignatedSupremeAdminEmailMatch(
  user: Pick<User, 'email'> | null
): boolean {
  if (!user?.email) return false;
  const normalized = user.email.trim().toLowerCase();
  return (DESIGNATED_SUPREME_ADMIN_EMAILS as readonly string[]).includes(
    normalized
  );
}

export function isDesignatedSupremeAdminUser(user: User | null): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  return hasDesignatedSupremeAdminEmailMatch(user);
}

export function canRevealAnonymousAuthor(user: User | null): boolean {
  return isDesignatedSupremeAdminUser(user);
}

export function isProfilePubliclyDiscoverableInDirectory(
  profile:
    | Pick<PublicUserProfile, 'isHiddenFromDirectory' | 'accountStatus'>
    | null
    | undefined
): boolean {
  if (!profile) return false;
  return (
    profile.accountStatus === 'active' &&
    profile.isHiddenFromDirectory !== true
  );
}

export function isProfileAccessibleByDirectInteraction(
  profile:
    | Pick<
        PublicUserProfile,
        'uid' | 'isHiddenFromDirectory' | 'hasPublicActivity' | 'accountStatus'
      >
    | null
    | undefined,
  viewerUid?: string | null
): boolean {
  if (!profile) return false;
  if (viewerUid && profile.uid === viewerUid) return true;
  if (profile.accountStatus !== 'active') return false;
  return !profile.isHiddenFromDirectory || profile.hasPublicActivity === true;
}

const ASSIGNABLE_NON_ADMIN_ROLES: readonly UserRole[] = [
  'moderator',
  'verified',
  'member',
] as const;

export function isValidRoleRecordConsistency(
  roleRecord: UserRoleRecord | null | undefined
): roleRecord is UserRoleRecord {
  if (!roleRecord) return false;
  if (!ASSIGNABLE_NON_ADMIN_ROLES.includes(roleRecord.role)) return false;
  return roleRecord.badge === resolveBadgeForRole(roleRecord.role);
}

export function resolveEffectiveAccountTier(
  user: User | null,
  roleRecord: UserRoleRecord | null
): EffectiveAccountTier {
  if (!user) {
    return 'guest';
  }
  if (user.emailVerified !== true) {
    return 'member';
  }
  if (isDesignatedSupremeAdminUser(user)) {
    return 'supreme_admin';
  }
  const rawRole = (roleRecord as { role?: string } | null)?.role;
  if (
    !roleRecord ||
    roleRecord.isPermanentOwner ||
    rawRole === 'owner' ||
    roleRecord.role === 'supreme_admin'
  ) {
    return 'member';
  }
  if (!isValidRoleRecordConsistency(roleRecord)) {
    return 'member';
  }
  return roleRecord.role;
}

/**
 * Resolves the exact authorRole value expected by firestore.rules `currentRoleString()`
 * for anonymousIdentityMappings writes. Never grants `'owner'` or third-party `'supreme_admin'`
 * from stale userRoles documents.
 */
export function resolveAuthoritativeMappingRole(
  user: User | null,
  rawRoleDoc: Partial<UserRoleRecord> | null | undefined,
  fallbackRole: UserRole = 'member'
): UserRole {
  if (isDesignatedSupremeAdminUser(user)) {
    return 'supreme_admin';
  }
  if (
    rawRoleDoc &&
    !rawRoleDoc.isPermanentOwner &&
    typeof rawRoleDoc.role === 'string' &&
    ASSIGNABLE_NON_ADMIN_ROLES.includes(rawRoleDoc.role as UserRole)
  ) {
    return rawRoleDoc.role as UserRole;
  }
  if (rawRoleDoc === null) {
    return 'member';
  }
  return ASSIGNABLE_NON_ADMIN_ROLES.includes(fallbackRole)
    ? fallbackRole
    : 'member';
}

export function canAccessFullAdminDashboard(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return tier === 'supreme_admin';
}

export function canAccessAdminDashboard(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return tier === 'supreme_admin' || tier === 'moderator';
}

export function canPublishOrdinaryFeedUpdate(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return (
    tier === 'verified' ||
    tier === 'moderator' ||
    tier === 'supreme_admin'
  );
}

export function canPublishOrdinaryPostStrict(input: {
  user: User | null;
  tier: EffectiveAccountTier;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
  suspended: boolean;
}): boolean {
  if (!input.user || input.user.emailVerified !== true || input.suspended || input.tier === 'guest') {
    return false;
  }
  if (!canPublishOrdinaryFeedUpdate(input.tier, input.suspended)) {
    return false;
  }
  if (isDesignatedSupremeAdminUser(input.user)) {
    return !input.profile || input.profile.accountStatus === 'active';
  }
  if (!input.profile || input.profile.accountStatus !== 'active') {
    return false;
  }
  if (!isValidRoleRecordConsistency(input.roleRecord)) {
    return false;
  }
  if (input.roleRecord.role !== input.tier) {
    return false;
  }
  return input.profile.badge === input.roleRecord.badge;
}

export function hasPostingRolePendingEmailVerification(input: {
  user: Pick<User, 'email' | 'emailVerified'> | null;
  profile: PublicUserProfile | null;
  roleRecord: UserRoleRecord | null;
}): boolean {
  if (!input.user || input.user.emailVerified === true) {
    return false;
  }
  if (input.profile?.accountStatus === 'suspended') {
    return false;
  }
  if (hasDesignatedSupremeAdminEmailMatch(input.user)) {
    return true;
  }
  const role = input.roleRecord?.role;
  const badge = input.profile?.badge;
  return (
    role === 'verified' ||
    role === 'moderator' ||
    role === 'supreme_admin' ||
    badge === 'verified' ||
    badge === 'moderator' ||
    badge === 'supreme_admin'
  );
}

export function canCreateAnonymousEntry(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return tier !== 'guest';
}

export function getAccountTierDisplayLabel(tier: EffectiveAccountTier): string {
  switch (tier) {
    case 'guest':
      return 'Guest Visitor';
    case 'member':
      return 'Member';
    case 'verified':
      return 'Verified Member';
    case 'moderator':
      return 'Moderator';
    case 'supreme_admin':
      return 'Supreme Admin';
  }
}

export function toPublicProfileProjection(
  profile: PublicUserProfile
): PublicProfileProjection {
  return {
    fullName: profile.fullName,
    username: profile.username,
    bio: profile.bio,
    department: profile.department,
    faculty: profile.faculty,
    level: profile.level,
    accountCategory: profile.accountCategory,
    photoUrl: profile.photoUrl,
    coverUrl: profile.coverUrl,
    photoImageId: profile.photoImageId,
    coverImageId: profile.coverImageId,
    publicWhatsapp: profile.showWhatsappPublicly
      ? profile.publicWhatsapp
      : undefined,
    showWhatsappPublicly: profile.showWhatsappPublicly,
    badge: profile.badge,
    isVerified: profile.isVerified === true ? true : undefined,
    anonymousLikesReceivedCount:
      typeof profile.anonymousLikesReceivedCount === 'number' &&
      Number.isFinite(profile.anonymousLikesReceivedCount)
        ? Math.max(0, Math.floor(profile.anonymousLikesReceivedCount))
        : undefined,
    accountStatus: profile.accountStatus,
    followersCount: profile.followersCount,
    followingCount: profile.followingCount,
    createdAt: profile.createdAt,
  };
}

export function isFirebaseErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}

const FIRESTORE_CONNECTION_FAILURE_PATTERN =
  /Connection failed|the client is offline|Request time out|Failed to get document/i;

export function formatFirestoreOrAppError(
  error: unknown,
  fallbackMessage: string
): string {
  if (!(error instanceof Error) || !error.message) {
    return fallbackMessage;
  }

  const rawMessage = error.message.trim();
  if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawMessage) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        if (/Missing or insufficient permissions/i.test(parsed.error)) {
          return 'Permission denied by database security rules. Please verify your details and try again.';
        }
        if (FIRESTORE_CONNECTION_FAILURE_PATTERN.test(parsed.error)) {
          return 'Network connection interrupted while reaching campus servers. Please check your internet connection and try again.';
        }
        return parsed.error.trim();
      }
    } catch {
      // Fall through to raw message if not valid JSON.
    }
  }

  if (/Missing or insufficient permissions/i.test(rawMessage)) {
    return 'Permission denied by database security rules. Please verify your details and try again.';
  }

  if (FIRESTORE_CONNECTION_FAILURE_PATTERN.test(rawMessage)) {
    return 'Network connection interrupted while reaching campus servers. Please check your internet connection and try again.';
  }

  return rawMessage;
}

export function mapFirebaseAuthError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    switch (code) {
      case 'auth/email-already-in-use':
        return 'An account with this email address already exists. Sign in instead.';
      case 'auth/invalid-email':
        return 'The email address format is invalid.';
      case 'auth/weak-password':
        return 'Please choose a stronger password (at least 6 characters).';
      case 'auth/requires-recent-login':
        return 'For your security, enter your current password or sign in again before completing this change.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email address or password. Please check your details and try again.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact a platform administrator.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Network error detected. Check your internet connection and retry.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password).';
      default:
        break;
    }
  }

  return formatFirestoreOrAppError(
    error,
    'Authentication could not be completed. Please try again.'
  );
}

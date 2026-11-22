import type { User } from 'firebase/auth';
import {
  BLUEPRINT_LIMITS,
  isValidUsername,
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

export const PERMANENT_OWNER_EMAIL = 'estheriawoyinfa52@gmail.com';

export function isPermanentOwnerUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.trim().toLowerCase() === PERMANENT_OWNER_EMAIL
  );
}

export function resolveEffectiveAccountTier(
  user: User | null,
  roleRecord: UserRoleRecord | null
): EffectiveAccountTier {
  if (!user) {
    return 'guest';
  }
  if (isPermanentOwnerUser(user)) {
    return 'owner';
  }
  if (!roleRecord) {
    return 'member';
  }
  if (roleRecord.role === 'owner' && roleRecord.isPermanentOwner) {
    return 'owner';
  }
  return roleRecord.role;
}

export function canAccessFullAdminDashboard(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return tier === 'supreme_admin' || tier === 'owner';
}

export function canAccessAdminDashboard(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return tier === 'supreme_admin' || tier === 'owner' || tier === 'moderator';
}

export function canPublishOrdinaryFeedUpdate(
  tier: EffectiveAccountTier,
  suspended: boolean
): boolean {
  if (suspended) return false;
  return (
    tier === 'verified' ||
    tier === 'moderator' ||
    tier === 'supreme_admin' ||
    tier === 'owner'
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
    case 'owner':
      return 'Platform Owner';
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
        return parsed.error.trim();
      }
    } catch {
      // Fall through to raw message if not valid JSON.
    }
  }

  if (/Missing or insufficient permissions/i.test(rawMessage)) {
    return 'Permission denied by database security rules. Please verify your details and try again.';
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

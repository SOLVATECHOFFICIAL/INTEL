import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  refreshAuthSessionToken,
} from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  canActorUpdateTargetRoleRecord,
  canApproveMarketplaceListing,
  canRolePublishCommunityFeed,
  computeMarketplaceExpiryDate,
  isMarketplaceListingExpired,
  isSafeMediaUrl,
  isValidFirestoreId,
  resolveBadgeAuditAction,
  resolveBadgeForRole,
  resolveMarketplaceUpdateFromQuantity,
  validateMarketplaceListingInput,
  validateTrustedContactPayload,
} from '../types/database';
import type {
  AccountStatus,
  AnonymousAuditLog,
  BadgeAuditAction,
  BadgeAuditLog,
  MarketplaceListing,
  MarketplaceListingKind,
  MarketplaceUpdate,
  MarketplaceUpdateCategory,
  NotificationItem,
  PostMediaMeta,
  PublicProfileProjection,
  PublicUserProfile,
  TrustedContact,
  TrustedContactCategory,
  UserRole,
  UserRoleRecord,
} from '../types/database';
import {
  isFirebaseErrorCode,
  isUndergroundSupremeAdminUser,
  toPublicProfileProjection,
} from '../utils/authValidation';
import { validateTrustedContactWhatsapp } from '../utils/trustedDirectory';
import { extractTimestampMs } from '../utils/contextualSearch';
import type { CompressedImageResult } from '../utils/imageCompression';
import { buildMarketplaceReviewNotificationId } from '../utils/notifications';
import { SingleFlightRegistry } from '../utils/cacheSync';
import {
  notifyMarketplaceListingCreated,
  notifyMarketplaceListingDeleted,
  notifyMarketplaceListingUpdated,
  notifyMarketplaceUpdatesMutated,
  notifyTrustedContactMutated,
} from './cacheInvalidation';
import {
  createSafeMemberNotification,
  fetchPublicProfileProjectionsByUids,
} from './firestoreFoundation';
import { triggerBestEffortPushDispatch } from './webPush';
import {
  commitFreshWriteBatchWithPermissionRetry,
  runWithPermissionRetry,
} from '../utils/firestoreRetry';
import {
  buildMediaImageFirestoreRecord,
  evictMediaImageCache,
  evictMediaImageCacheBatch,
  generateFirestoreDocId,
  primeMediaImageCache,
  type UploadProgressState,
} from './mediaStorage';

export interface AdminManagedMember {
  profile: PublicUserProfile;
  roleRecord: UserRoleRecord | null;
  effectiveRole: UserRole;
}

export interface CreateMarketplaceListingInput {
  ownerUID: string;
  actorRole: UserRole;
  listingKind: MarketplaceListingKind;
  title: string;
  description: string;
  category: string;
  price: number;
  quantity: number;
  whatsappNumber: string;
  attachments?: Array<{ compressed: CompressedImageResult }>;
  onProgress?: (progress: UploadProgressState) => void;
}

export interface CreateTrustedContactInput {
  fullName: string;
  category: TrustedContactCategory;
  badgeLabel?: string;
  roleTitle: string;
  department?: string;
  faculty?: string;
  photoUrl?: string;
  compressedPhoto?: CompressedImageResult | null;
  contactNumber?: string;
  whatsappLink?: string;
  description?: string;
  createdByUid: string;
}

function sortByCreatedAtDesc<T extends { createdAt: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

function getAuditActorRole(): 'supreme_admin' {
  return 'supreme_admin';
}

export async function fetchAdminMemberDirectory(
  searchTerm = '',
  includeHiddenForUnderground = false
): Promise<AdminManagedMember[]> {
  const canQueryHidden =
    includeHiddenForUnderground &&
    isUndergroundSupremeAdminUser(auth.currentUser);
  try {
    const usersSnap = await getDocs(
      canQueryHidden
        ? query(collection(db, COLLECTION_NAMES.users), limit(150))
        : query(
            collection(db, COLLECTION_NAMES.users),
            where('isHiddenFromDirectory', '==', false),
            limit(150)
          )
    );
    const profiles = usersSnap.docs.map(
      (item) => item.data() as PublicUserProfile
    );

    const settledRoles = await Promise.allSettled(
      profiles.map(async (profile) => {
        const snap = await getDoc(doc(db, COLLECTION_NAMES.userRoles, profile.uid));
        return snap.exists() ? (snap.data() as UserRoleRecord) : null;
      })
    );

    const roleMap = new Map<string, UserRoleRecord>();
    profiles.forEach((profile, index) => {
      const result = settledRoles[index];
      if (result.status === 'fulfilled' && result.value) {
        roleMap.set(profile.uid, result.value);
      }
    });

    const term = searchTerm.trim().toLowerCase();
    const mapped: AdminManagedMember[] = profiles
      .map((profile) => {
        const roleRecord = roleMap.get(profile.uid) ?? null;
        const rawRole = (roleRecord as { role?: string } | null)?.role;
        const isStaleLegacyOwner = Boolean(
          roleRecord?.isPermanentOwner || rawRole === 'owner'
        );
        const effectiveRole: UserRole = isStaleLegacyOwner
          ? 'member'
          : roleRecord?.role === 'supreme_admin' ||
              roleRecord?.role === 'moderator' ||
              roleRecord?.role === 'verified' ||
              roleRecord?.role === 'member'
            ? roleRecord.role
            : profile.badge === 'verified'
              ? 'verified'
              : profile.badge === 'moderator'
                ? 'moderator'
                : profile.badge === 'supreme_admin'
                  ? 'supreme_admin'
                  : 'member';

        return {
          profile,
          roleRecord,
          effectiveRole,
        };
      })
      .filter((entry) => {
        if (!canQueryHidden && entry.profile.isHiddenFromDirectory) {
          return false;
        }
        if (!term) return true;
        const haystack = [
          entry.profile.fullName,
          entry.profile.username,
          entry.profile.department ?? '',
          entry.profile.faculty ?? '',
          entry.effectiveRole,
          entry.profile.badge,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      });

    const rankOrder: Record<UserRole, number> = {
      supreme_admin: 0,
      moderator: 1,
      verified: 2,
      member: 3,
    };

    return mapped.sort((a, b) => {
      const rankDiff = rankOrder[a.effectiveRole] - rankOrder[b.effectiveRole];
      if (rankDiff !== 0) return rankDiff;
      return a.profile.fullName.localeCompare(b.profile.fullName);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.users);
  }
}

export async function assignMemberRoleAndBadgeAtomically(input: {
  actorUid: string;
  actorRole: UserRole;
  targetUid: string;
  nextRole: 'member' | 'verified' | 'moderator';
  reason?: string;
}): Promise<{
  action: BadgeAuditAction;
  nextRole: 'member' | 'verified' | 'moderator';
  nextBadge: ReturnType<typeof resolveBadgeForRole>;
}> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.targetUid)) {
    throw new Error('Invalid administrator or member identifier.');
  }
  if (input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin accounts can manage badges.');
  }

  const cleanReason = input.reason?.trim().slice(0, BLUEPRINT_LIMITS.auditReasonMax);
  const userRef = doc(db, COLLECTION_NAMES.users, input.targetUid);
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, input.targetUid);
  const auditId = generateFirestoreDocId(COLLECTION_NAMES.badgeAuditLogs);
  const auditRef = doc(db, COLLECTION_NAMES.badgeAuditLogs, auditId);
  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);

  try {
    const result = await runWithPermissionRetry(
      () =>
        runTransaction(db, async (tx) => {
      const [userSnap, roleSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(roleRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error('Member profile document no longer exists.');
      }

      const targetProfile = userSnap.data() as PublicUserProfile;
      const existingRole = roleSnap.exists()
        ? (roleSnap.data() as UserRoleRecord)
        : null;
      const rawPreviousRole = (existingRole as { role?: string } | null)?.role;
      const isStaleLegacyOwner = Boolean(
        existingRole?.isPermanentOwner || rawPreviousRole === 'owner'
      );
      const previousRole: UserRole = isStaleLegacyOwner
        ? 'member'
        : (existingRole?.role ?? 'member');
      const previousBadge = isStaleLegacyOwner
        ? 'none'
        : (existingRole?.badge ?? targetProfile.badge ?? 'none');

      if (
        !canActorUpdateTargetRoleRecord(
          input.actorRole,
          false,
          previousRole,
          input.nextRole,
          input.actorUid,
          input.targetUid
        )
      ) {
        throw new Error(
          'Governance rules prohibit modifying this account or assigning that role.'
        );
      }

      if (previousRole === input.nextRole) {
        throw new Error(`@${targetProfile.username} already holds this role.`);
      }

      const nextBadge = resolveBadgeForRole(input.nextRole);
      const action = resolveBadgeAuditAction(previousRole, input.nextRole);
      const performedByRole = getAuditActorRole();

      const nextRolePayload = {
        uid: input.targetUid,
        role: input.nextRole,
        badge: nextBadge,
        isVerified: false,
        isPermanentOwner: false,
        isHiddenFromDirectory: existingRole?.isHiddenFromDirectory ?? false,
        grantedBy: input.actorUid,
        updatedAt: serverTimestamp(),
      };

      if (roleSnap.exists()) {
        tx.update(roleRef, nextRolePayload);
      } else {
        tx.set(roleRef, nextRolePayload);
      }

      tx.update(userRef, {
        badge: nextBadge,
        isVerified: false,
        updatedAt: serverTimestamp(),
      });

      const auditPayload: Record<string, unknown> = {
        id: auditId,
        targetUid: input.targetUid,
        targetUsername: targetProfile.username,
        action,
        previousRole,
        previousBadge,
        nextRole: input.nextRole,
        nextBadge,
        performedByUid: input.actorUid,
        performedByRole,
        createdAt: serverTimestamp(),
      };
      if (cleanReason) {
        auditPayload.reason = cleanReason;
      }
      tx.set(auditRef, auditPayload);

      const notificationPayload: Omit<NotificationItem, 'createdAt'> & {
        createdAt: unknown;
      } = {
        id: notifId,
        recipientUid: input.targetUid,
        eventType: 'badge_change',
        title:
          nextBadge === 'none'
            ? 'Your campus badge was removed'
            : `You received the ${nextBadge.replace('_', ' ').toUpperCase()} badge`,
        body: cleanReason || `Account tier updated to ${input.nextRole.replace('_', ' ')}.`,
        targetPath: '/?view=account',
        isRead: false,
        createdAt: serverTimestamp(),
      };
      tx.set(notifRef, notificationPayload);

      return { action, nextRole: input.nextRole, nextBadge };
    }),
      {
        actorUid: input.actorUid,
        refreshToken: () => refreshAuthSessionToken(input.actorUid),
      }
    );
    void triggerBestEffortPushDispatch({
      notificationId: notifId,
      recipientUid: input.targetUid,
    });
    return result;
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.userRoles}/${input.targetUid}`
    );
  }
}

export async function toggleModeratorVerifiedStatusAtomically(input: {
  actorUid: string;
  actorRole: UserRole;
  targetUid: string;
  isVerified: boolean;
  reason?: string;
}): Promise<boolean> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.targetUid)) {
    throw new Error('Invalid administrator or member identifier.');
  }
  if (input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin accounts can manage Verified badges.');
  }

  const cleanReason = input.reason?.trim().slice(0, BLUEPRINT_LIMITS.auditReasonMax);
  const userRef = doc(db, COLLECTION_NAMES.users, input.targetUid);
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, input.targetUid);
  const auditId = generateFirestoreDocId(COLLECTION_NAMES.badgeAuditLogs);
  const auditRef = doc(db, COLLECTION_NAMES.badgeAuditLogs, auditId);
  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);

  try {
    const changed = await runWithPermissionRetry(
      () =>
        runTransaction(db, async (tx) => {
      const [userSnap, roleSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(roleRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error('Member profile document no longer exists.');
      }

      const targetProfile = userSnap.data() as PublicUserProfile;
      const existingRole = roleSnap.exists()
        ? (roleSnap.data() as UserRoleRecord)
        : null;
      const currentRole: UserRole = existingRole?.role ?? 'member';

      if (
        existingRole?.isPermanentOwner ||
        input.actorUid === input.targetUid ||
        currentRole !== 'moderator'
      ) {
        throw new Error(
          'Dual Verified status toggling is only permitted for Moderator accounts.'
        );
      }

      const currentlyVerified = Boolean(
        existingRole?.isVerified ?? targetProfile.isVerified
      );
      if (currentlyVerified === input.isVerified) {
        return false;
      }

      tx.update(roleRef, {
        isVerified: input.isVerified,
        updatedAt: serverTimestamp(),
      });
      tx.update(userRef, {
        isVerified: input.isVerified,
        updatedAt: serverTimestamp(),
      });

      const auditPayload: Record<string, unknown> = {
        id: auditId,
        targetUid: input.targetUid,
        targetUsername: targetProfile.username,
        action: input.isVerified ? 'grant_verified' : 'remove_verified',
        previousRole: 'moderator',
        previousBadge: 'moderator',
        nextRole: 'moderator',
        nextBadge: 'moderator',
        performedByUid: input.actorUid,
        performedByRole: getAuditActorRole(),
        createdAt: serverTimestamp(),
      };
      if (cleanReason) {
        auditPayload.reason = cleanReason;
      }
      tx.set(auditRef, auditPayload);

      tx.set(notifRef, {
        id: notifId,
        recipientUid: input.targetUid,
        eventType: 'badge_change',
        title: input.isVerified
          ? 'Verified status added to your Moderator profile'
          : 'Verified status removed from your Moderator profile',
        body:
          cleanReason ||
          (input.isVerified
            ? 'Your Moderator profile now also displays the blue Verified badge in Trusted Circle.'
            : 'Your Moderator permissions remain unchanged.'),
        targetPath: '/?view=account',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      return true;
    }),
      {
        actorUid: input.actorUid,
        refreshToken: () => refreshAuthSessionToken(input.actorUid),
      }
    );

    if (changed) {
      void triggerBestEffortPushDispatch({
        notificationId: notifId,
        recipientUid: input.targetUid,
      });
    }
    return input.isVerified;
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.userRoles}/${input.targetUid}`
    );
  }
}

export async function toggleMemberAccountSuspensionAtomically(input: {
  actorUid: string;
  actorRole: UserRole;
  targetUid: string;
  nextStatus: AccountStatus;
  reason?: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.targetUid)) {
    throw new Error('Invalid administrator or member identifier.');
  }
  if (input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin accounts can suspend accounts.');
  }

  const cleanReason = input.reason?.trim().slice(0, BLUEPRINT_LIMITS.auditReasonMax);
  const userRef = doc(db, COLLECTION_NAMES.users, input.targetUid);
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, input.targetUid);
  const auditId = generateFirestoreDocId(COLLECTION_NAMES.badgeAuditLogs);
  const auditRef = doc(db, COLLECTION_NAMES.badgeAuditLogs, auditId);
  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);

  try {
    const statusChanged = await runWithPermissionRetry(
      () =>
        runTransaction(db, async (tx) => {
      const [userSnap, roleSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(roleRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error('Member profile not found.');
      }

      const targetProfile = userSnap.data() as PublicUserProfile;
      const existingRole = roleSnap.exists()
        ? (roleSnap.data() as UserRoleRecord)
        : null;
      const rawCurrentRole = (existingRole as { role?: string } | null)?.role;
      const currentRole: UserRole =
        existingRole?.isPermanentOwner || rawCurrentRole === 'owner'
          ? 'member'
          : (existingRole?.role ?? 'member');
      const currentBadge = resolveBadgeForRole(currentRole);

      if (
        !canActorUpdateTargetRoleRecord(
          input.actorRole,
          false,
          currentRole,
          undefined,
          input.actorUid,
          input.targetUid
        )
      ) {
        throw new Error(
          'Peer Supreme Admin or self-account suspension is forbidden.'
        );
      }

      if (targetProfile.accountStatus === input.nextStatus) {
        return false;
      }

      tx.update(userRef, {
        accountStatus: input.nextStatus,
        updatedAt: serverTimestamp(),
      });

      const auditPayload: Record<string, unknown> = {
        id: auditId,
        targetUid: input.targetUid,
        targetUsername: targetProfile.username,
        action:
          input.nextStatus === 'suspended'
            ? 'suspend_account'
            : 'restore_account',
        previousRole: currentRole,
        previousBadge: currentBadge,
        nextRole: currentRole,
        nextBadge: currentBadge,
        performedByUid: input.actorUid,
        performedByRole: getAuditActorRole(),
        createdAt: serverTimestamp(),
      };
      if (cleanReason) {
        auditPayload.reason = cleanReason;
      }
      tx.set(auditRef, auditPayload);

      tx.set(notifRef, {
        id: notifId,
        recipientUid: input.targetUid,
        eventType: 'account_change',
        title:
          input.nextStatus === 'suspended'
            ? 'Your account has been suspended'
            : 'Your account access has been restored',
        body:
          cleanReason ||
          (input.nextStatus === 'suspended'
            ? 'Posting and interactive permissions are restricted.'
            : 'You can resume participating on LASUED Intel.'),
        targetPath: '/?view=account',
        isRead: false,
        createdAt: serverTimestamp(),
      });
      return true;
    }),
      {
        actorUid: input.actorUid,
        refreshToken: () => refreshAuthSessionToken(input.actorUid),
      }
    );
    if (statusChanged) {
      void triggerBestEffortPushDispatch({
        notificationId: notifId,
        recipientUid: input.targetUid,
      });
    }
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.users}/${input.targetUid}`
    );
  }
}

export async function fetchBadgeAuditLogs(maxItems = 50): Promise<BadgeAuditLog[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.badgeAuditLogs), limit(maxItems))
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as BadgeAuditLog)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.badgeAuditLogs
    );
  }
}

export async function fetchAnonymousAuditLogs(
  maxItems = 40
): Promise<AnonymousAuditLog[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.anonymousAuditLogs), limit(maxItems))
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as AnonymousAuditLog)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.anonymousAuditLogs
    );
  }
}

/**
 * Trusted Circle Directory:
 * 1. Public Supreme Admins (`badge == 'supreme_admin'`, active, NOT hidden from directory)
 * 2. Verified community contributors (`badge == 'verified'`, active, NOT hidden from directory)
 * 3. Official Admin-listed campus & recommended profiles (`/trustedContacts`)
 * Hidden Permanent Owner accounts (`isHiddenFromDirectory: true`) NEVER appear here.
 */
const governanceSingleFlight = new SingleFlightRegistry();

export async function fetchTrustedCircleDirectory(): Promise<{
  supremeAdmins: PublicProfileProjection[];
  verifiedMembers: PublicProfileProjection[];
  officialContacts: TrustedContact[];
}> {
  return governanceSingleFlight.run('trusted-circle:directory', async () => {
    try {
      const [supremeSnap, verifiedSnap, moderatorSnap, contactsSnap] =
        await Promise.all([
          getDocs(
            query(
              collection(db, COLLECTION_NAMES.users),
              where('badge', '==', 'supreme_admin'),
              where('isHiddenFromDirectory', '==', false),
              limit(50)
            )
          ),
          getDocs(
            query(
              collection(db, COLLECTION_NAMES.users),
              where('badge', '==', 'verified'),
              where('isHiddenFromDirectory', '==', false),
              limit(100)
            )
          ),
          getDocs(
            query(
              collection(db, COLLECTION_NAMES.users),
              where('badge', '==', 'moderator'),
              where('isHiddenFromDirectory', '==', false),
              limit(100)
            )
          ),
          getDocs(query(collection(db, COLLECTION_NAMES.trustedContacts), limit(120))),
        ]);

      const supremeAdmins = supremeSnap.docs
        .map((item) => item.data() as PublicUserProfile)
        .filter(
          (profile) =>
            profile.badge === 'supreme_admin' &&
            profile.accountStatus === 'active' &&
            !profile.isHiddenFromDirectory
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map(toPublicProfileProjection);

      const verifiedMap = new Map<string, PublicUserProfile>();
      for (const item of verifiedSnap.docs) {
        const profile = item.data() as PublicUserProfile;
        if (
          profile.badge === 'verified' &&
          profile.accountStatus === 'active' &&
          !profile.isHiddenFromDirectory
        ) {
          verifiedMap.set(profile.uid, profile);
        }
      }
      for (const item of moderatorSnap.docs) {
        const profile = item.data() as PublicUserProfile;
        if (
          profile.badge === 'moderator' &&
          profile.isVerified === true &&
          profile.accountStatus === 'active' &&
          !profile.isHiddenFromDirectory
        ) {
          verifiedMap.set(profile.uid, profile);
        }
      }

      const verifiedMembers = Array.from(verifiedMap.values())
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map(toPublicProfileProjection);

      const officialContacts = contactsSnap.docs
        .map((item) => item.data() as TrustedContact)
        .filter(
          (contact) =>
            contact.entryType === 'admin_listed_contact' &&
            contact.isUserAccount === false
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      return { supremeAdmins, verifiedMembers, officialContacts };
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        COLLECTION_NAMES.trustedContacts
      );
    }
  });
}

export async function createTrustedContactRecord(
  input: CreateTrustedContactInput
): Promise<TrustedContact> {
  const contactId = generateFirestoreDocId(COLLECTION_NAMES.trustedContacts);
  const cleanName = input.fullName.trim();
  const cleanRoleTitle = input.roleTitle.trim();
  const cleanBadgeLabel = input.badgeLabel?.trim() || undefined;
  const cleanWhatsappInput = input.whatsappLink?.trim() || '';
  const cleanPhoneInput = input.contactNumber?.trim() || '';
  const cleanPhotoUrl = input.photoUrl?.trim() || undefined;

  if (cleanWhatsappInput && !isSafeMediaUrl(cleanWhatsappInput)) {
    throw new Error('WhatsApp link must start with https:// or http://.');
  }
  if (cleanPhotoUrl && !isSafeMediaUrl(cleanPhotoUrl)) {
    throw new Error('Photo URL must start with https:// or http://.');
  }

  let resolvedContactNumber: string | undefined = cleanPhoneInput || undefined;
  let resolvedWhatsappLink: string | undefined = cleanWhatsappInput || undefined;
  if (cleanPhoneInput) {
    const validated = validateTrustedContactWhatsapp(cleanPhoneInput);
    resolvedContactNumber = validated.contactNumber;
    resolvedWhatsappLink = validated.whatsappLink;
  } else if (
    cleanWhatsappInput &&
    /^https:\/\/(wa\.me|api\.whatsapp\.com)\/[0-9]{7,15}/i.test(cleanWhatsappInput)
  ) {
    resolvedWhatsappLink = cleanWhatsappInput;
  } else {
    validateTrustedContactWhatsapp('');
  }

  const photoImageId = input.compressedPhoto
    ? generateFirestoreDocId(COLLECTION_NAMES.mediaImages)
    : undefined;

  const record: TrustedContact = {
    id: contactId,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    badgeLabel: cleanBadgeLabel,
    roleTitle: cleanRoleTitle,
    department: input.department?.trim() || undefined,
    faculty: input.faculty?.trim() || undefined,
    photoUrl: photoImageId ? undefined : cleanPhotoUrl,
    photoImageId,
    contactNumber: resolvedContactNumber,
    whatsappLink: resolvedWhatsappLink,
    description: input.description?.trim() || undefined,
    createdByUid: input.createdByUid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  validateTrustedContactPayload(record);

  const firestorePayload: Record<string, unknown> = {
    id: contactId,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    createdByUid: input.createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (record.badgeLabel) firestorePayload.badgeLabel = record.badgeLabel;
  if (record.department) firestorePayload.department = record.department;
  if (record.faculty) firestorePayload.faculty = record.faculty;
  if (record.photoUrl) firestorePayload.photoUrl = record.photoUrl;
  if (record.photoImageId) firestorePayload.photoImageId = record.photoImageId;
  if (record.contactNumber) firestorePayload.contactNumber = record.contactNumber;
  if (record.whatsappLink) firestorePayload.whatsappLink = record.whatsappLink;
  if (record.description) firestorePayload.description = record.description;

  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.set(
          doc(db, COLLECTION_NAMES.trustedContacts, contactId),
          firestorePayload
        );
        if (input.compressedPhoto && photoImageId) {
          batch.set(
            doc(db, COLLECTION_NAMES.mediaImages, photoImageId),
            buildMediaImageFirestoreRecord({
              imageId: photoImageId,
              targetCollection: 'trustedContacts',
              targetId: contactId,
              ownerUID: input.createdByUid,
              compressed: input.compressedPhoto,
              createdAtValue: serverTimestamp(),
            })
          );
        }
      },
      {
        actorUid: input.createdByUid,
        refreshToken: () => refreshAuthSessionToken(input.createdByUid),
      }
    );
    if (input.compressedPhoto && photoImageId) {
      primeMediaImageCache(photoImageId, input.compressedPhoto.dataUrl);
    }
    notifyTrustedContactMutated();
    return record;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.trustedContacts}/${contactId}`
    );
  }
}

export async function deleteTrustedContactRecord(
  contactId: string,
  photoImageId?: string
): Promise<void> {
  if (!isValidFirestoreId(contactId)) return;
  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.delete(doc(db, COLLECTION_NAMES.trustedContacts, contactId));
        if (photoImageId && isValidFirestoreId(photoImageId)) {
          batch.delete(doc(db, COLLECTION_NAMES.mediaImages, photoImageId));
        }
      },
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );
    if (photoImageId) {
      evictMediaImageCache(photoImageId);
    }
    notifyTrustedContactMutated();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.trustedContacts}/${contactId}`
    );
  }
}

export async function fetchMarketplaceListingById(
  listingId: string
): Promise<MarketplaceListing | null> {
  if (!isValidFirestoreId(listingId)) return null;
  const path = `${COLLECTION_NAMES.marketplaceListings}/${listingId}`;
  try {
    const snap = await getDoc(
      doc(db, COLLECTION_NAMES.marketplaceListings, listingId)
    );
    return snap.exists() ? (snap.data() as MarketplaceListing) : null;
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchPublicMarketplaceListings(): Promise<
  MarketplaceListing[]
> {
  return governanceSingleFlight.run('marketplace:public', async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.marketplaceListings),
          where('status', '==', 'active'),
          limit(80)
        )
      );
      const nowMs = Date.now();
      return sortByCreatedAtDesc(
        snap.docs
          .map((item) => item.data() as MarketplaceListing)
          .filter((listing) => {
            if (listing.approvalStatus !== 'approved') return false;
            const exp = extractTimestampMs(listing.expiresAt);
            return exp === null || !isMarketplaceListingExpired(exp, nowMs);
          })
      );
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        COLLECTION_NAMES.marketplaceListings
      );
    }
  });
}

export async function fetchMyMarketplaceListings(
  ownerUID: string
): Promise<MarketplaceListing[]> {
  if (!isValidFirestoreId(ownerUID)) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.marketplaceListings),
        where('ownerUID', '==', ownerUID),
        limit(50)
      )
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as MarketplaceListing)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.marketplaceListings
    );
  }
}

export async function fetchPendingMarketplaceApprovals(): Promise<
  MarketplaceListing[]
> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.marketplaceListings),
        where('approvalStatus', '==', 'pending_approval'),
        limit(60)
      )
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as MarketplaceListing)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.marketplaceListings
    );
  }
}

export async function fetchMarketplaceSellersMap(
  listings: readonly Pick<MarketplaceListing, 'ownerUID'>[]
): Promise<Map<string, PublicProfileProjection>> {
  return fetchPublicProfileProjectionsByUids(
    listings.map((item) => item.ownerUID)
  );
}

export async function createMarketplaceListingItem(
  input: CreateMarketplaceListingInput
): Promise<MarketplaceListing> {
  if (!isValidFirestoreId(input.ownerUID)) {
    throw new Error('Sign in to publish marketplace listings.');
  }

  const cleanTitle = input.title.trim();
  const cleanDescription = input.description.trim();
  const cleanCategory = input.category.trim();
  const cleanWhatsapp = input.whatsappNumber.trim();
  const attachments = (input.attachments ?? []).slice(
    0,
    BLUEPRINT_LIMITS.mediaPostMaxCount
  );

  const validationError = validateMarketplaceListingInput({
    listingKind: input.listingKind,
    title: cleanTitle,
    description: cleanDescription,
    category: cleanCategory,
    price: Number(input.price),
    quantity: input.quantity,
    whatsappNumber: cleanWhatsapp,
    mediaCount: attachments.length,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  input.onProgress?.({
    percent: attachments.length > 0 ? 25 : 40,
    label:
      attachments.length > 0
        ? `Preparing ${attachments.length} product photo${attachments.length === 1 ? '' : 's'}...`
        : 'Preparing listing details...',
  });

  const autoApprove = canRolePublishCommunityFeed(input.actorRole);
  const listingId = generateFirestoreDocId(COLLECTION_NAMES.marketplaceListings);
  const expiryDate = computeMarketplaceExpiryDate();

  const mediaItems: PostMediaMeta[] = [];
  const stagedMediaWrites: Array<{
    imageId: string;
    record: ReturnType<typeof buildMediaImageFirestoreRecord>;
  }> = [];

  attachments.forEach((attachment, index) => {
    const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
    mediaItems.push({
      imageId,
      width: attachment.compressed.width,
      height: attachment.compressed.height,
      byteSize: attachment.compressed.byteSize,
      mimeType: attachment.compressed.mimeType,
      order: index,
    });
    stagedMediaWrites.push({
      imageId,
      record: buildMediaImageFirestoreRecord({
        imageId,
        targetCollection: 'marketplaceListings',
        targetId: listingId,
        ownerUID: input.ownerUID,
        compressed: attachment.compressed,
        createdAtValue: serverTimestamp(),
      }),
    });
  });

  const payload: Record<string, unknown> = {
    id: listingId,
    ownerUID: input.ownerUID,
    listingKind: input.listingKind,
    title: cleanTitle,
    description: cleanDescription,
    category: cleanCategory,
    price: Number(input.price),
    quantity: input.quantity,
    whatsappNumber: cleanWhatsapp,
    approvalStatus: autoApprove ? 'approved' : 'pending_approval',
    status: autoApprove ? 'active' : 'pending_approval',
    visibility: autoApprove ? 'public' : 'owner_and_admins',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiryDate),
  };

  if (mediaItems.length > 0) {
    payload.mediaItems = mediaItems;
  }

  input.onProgress?.({
    percent: 65,
    label:
      attachments.length > 0
        ? 'Uploading product photos & saving listing...'
        : 'Saving marketplace listing...',
  });

  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        for (const item of stagedMediaWrites) {
          batch.set(doc(db, COLLECTION_NAMES.mediaImages, item.imageId), item.record);
        }
        batch.set(doc(db, COLLECTION_NAMES.marketplaceListings, listingId), payload);
      },
      {
        actorUid: input.ownerUID,
        refreshToken: () => refreshAuthSessionToken(input.ownerUID),
      }
    );
    if (!isUndergroundSupremeAdminUser(auth.currentUser)) {
      void updateDoc(doc(db, COLLECTION_NAMES.users, input.ownerUID), {
        hasPublicActivity: true,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
    attachments.forEach((attachment, index) => {
      const meta = mediaItems[index];
      if (meta) {
        primeMediaImageCache(meta.imageId, attachment.compressed.dataUrl);
      }
    });
    input.onProgress?.({ percent: 100, label: 'Listing saved!' });

    const createdListing: MarketplaceListing = {
      id: listingId,
      ownerUID: input.ownerUID,
      listingKind: input.listingKind,
      title: cleanTitle,
      description: cleanDescription,
      category: cleanCategory,
      price: Number(input.price),
      quantity: input.quantity,
      ...(mediaItems.length > 0 ? { mediaItems } : {}),
      whatsappNumber: cleanWhatsapp,
      approvalStatus: autoApprove ? 'approved' : 'pending_approval',
      status: autoApprove ? 'active' : 'pending_approval',
      visibility: autoApprove ? 'public' : 'owner_and_admins',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: expiryDate.getTime(),
    };
    notifyMarketplaceListingCreated(createdListing);
    return createdListing;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.marketplaceListings}/${listingId}`
    );
  }
}

export async function reviewPendingMarketplaceListing(input: {
  listingId: string;
  actorUid: string;
  actorRole: UserRole;
  decision: 'approved' | 'rejected';
  emitNotification?: boolean;
}): Promise<MarketplaceListing> {
  if (!isValidFirestoreId(input.listingId) || !isValidFirestoreId(input.actorUid)) {
    throw new Error('Invalid marketplace review identifiers.');
  }

  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, input.listingId);
  const expiryDate = computeMarketplaceExpiryDate();

  try {
    const updated = await runWithPermissionRetry(
      () =>
        runTransaction(db, async (tx) => {
      const snap = await tx.get(listingRef);
      if (!snap.exists()) {
        throw new Error('Marketplace listing no longer exists.');
      }

      const existing = snap.data() as MarketplaceListing;
      if (!canApproveMarketplaceListing(input.actorRole, existing.approvalStatus)) {
        throw new Error(
          existing.approvalStatus !== 'pending_approval'
            ? `This listing was already ${existing.approvalStatus}; duplicate approvals are blocked.`
            : 'Only Moderators, Supreme Admins, or the Owner can approve listings.'
        );
      }

      const nextFields = {
        approvalStatus: input.decision,
        status: input.decision === 'approved' ? 'active' : 'rejected',
        visibility:
          input.decision === 'approved' ? 'public' : 'owner_and_admins',
        approvedByUid: input.actorUid,
        approvedAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiryDate),
        updatedAt: serverTimestamp(),
      } as const;

      tx.update(listingRef, nextFields);

      return {
        ...existing,
        approvalStatus: input.decision,
        status: nextFields.status,
        visibility: nextFields.visibility,
        approvedByUid: input.actorUid,
        approvedAt: Date.now(),
        expiresAt: expiryDate.getTime(),
        updatedAt: Date.now(),
      };
    }),
      {
        actorUid: input.actorUid,
        refreshToken: () => refreshAuthSessionToken(input.actorUid),
      }
    );

    if (input.emitNotification !== false) {
      void createSafeMemberNotification({
        id: buildMarketplaceReviewNotificationId(input.listingId, input.decision),
        recipientUid: updated.ownerUID,
        eventType:
          input.decision === 'approved'
            ? 'marketplace_approved'
            : 'marketplace_rejected',
        title:
          input.decision === 'approved'
            ? `Marketplace listing approved: ${updated.title}`
            : `Marketplace listing declined: ${updated.title}`,
        body:
          input.decision === 'approved'
            ? 'Your listing is now visible in Campus Marketplace for 7 days.'
            : 'Your submission did not pass marketplace moderation guidelines.',
        targetPath: `/?view=marketplace&listingId=${input.listingId}`,
        actorUid: input.actorUid,
        targetImageId: updated.mediaItems?.[0]?.imageId,
      });
    }

    notifyMarketplaceListingUpdated(updated);
    return updated;
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceListings}/${input.listingId}`
    );
  }
}

export async function updateOwnMarketplaceListingQuantity(input: {
  listing: MarketplaceListing;
  nextQuantity: number;
}): Promise<MarketplaceListing> {
  const resolved = resolveMarketplaceUpdateFromQuantity(input.nextQuantity);
  const nextVisibility =
    resolved.status === 'active' ? 'public' : input.listing.visibility;
  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, input.listing.id);

  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.update(listingRef, {
          quantity: resolved.quantity,
          status: resolved.status,
          visibility: nextVisibility,
          updatedAt: serverTimestamp(),
        });
      },
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );
    const updatedListing: MarketplaceListing = {
      ...input.listing,
      quantity: resolved.quantity,
      status: resolved.status,
      visibility: nextVisibility,
      updatedAt: Date.now(),
    };
    notifyMarketplaceListingUpdated(updatedListing);
    return updatedListing;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceListings}/${input.listing.id}`
    );
  }
}

export async function renewMarketplaceListing(
  listing: MarketplaceListing
): Promise<MarketplaceListing> {
  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, listing.id);
  const newExpiry = computeMarketplaceExpiryDate(new Date());
  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.update(listingRef, {
          status: 'active',
          visibility: 'public',
          expiresAt: Timestamp.fromDate(newExpiry),
          updatedAt: serverTimestamp(),
        });
      },
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );
    const renewedListing: MarketplaceListing = {
      ...listing,
      status: 'active',
      visibility: 'public',
      expiresAt: newExpiry.getTime(),
      updatedAt: Date.now(),
    };
    notifyMarketplaceListingUpdated(renewedListing);
    return renewedListing;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceListings}/${listing.id}`
    );
  }
}

export async function deleteMarketplaceListing(
  listingId: string,
  knownMediaIds?: readonly string[]
): Promise<void> {
  if (!isValidFirestoreId(listingId)) return;
  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, listingId);
  try {
    let mediaIds = (knownMediaIds ?? []).filter(isValidFirestoreId);
    if (mediaIds.length === 0) {
      const snap = await getDoc(listingRef).catch(() => null);
      if (snap?.exists()) {
        const existing = snap.data() as MarketplaceListing;
        mediaIds = (existing.mediaItems ?? [])
          .map((item) => item.imageId)
          .filter(isValidFirestoreId);
      }
    }

    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.delete(listingRef);
        for (const imgId of mediaIds) {
          batch.delete(doc(db, COLLECTION_NAMES.mediaImages, imgId));
        }
      },
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );

    if (mediaIds.length > 0) {
      evictMediaImageCacheBatch(mediaIds);
    }
    notifyMarketplaceListingDeleted(listingId);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.marketplaceListings}/${listingId}`
    );
  }
}

export async function fetchPublishedMarketplaceUpdates(): Promise<
  MarketplaceUpdate[]
> {
  return governanceSingleFlight.run('marketplace:updates:published', async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.marketplaceUpdates),
          where('published', '==', true),
          limit(50)
        )
      );
      return sortByCreatedAtDesc(
        snap.docs
          .map((item) => item.data() as MarketplaceUpdate)
          .filter((item) => item.published === true)
      );
    } catch (error) {
      if (isFirebaseErrorCode(error, 'permission-denied')) {
        return [];
      }
      handleFirestoreError(
        error,
        OperationType.LIST,
        COLLECTION_NAMES.marketplaceUpdates
      );
    }
  });
}

export async function fetchAllMarketplaceUpdates(): Promise<
  MarketplaceUpdate[]
> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.marketplaceUpdates), limit(80))
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as MarketplaceUpdate)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.marketplaceUpdates
    );
  }
}

function validateMarketplaceUpdateFields(input: {
  title: string;
  body: string;
  category: MarketplaceUpdateCategory;
}): { title: string; body: string; category: MarketplaceUpdateCategory } {
  const title = input.title.trim();
  const body = input.body.trim();
  const allowedCategories: readonly MarketplaceUpdateCategory[] = [
    'safety',
    'policy',
    'notice',
    'general',
  ];
  if (title.length < 3 || title.length > 140) {
    throw new Error('Marketplace notice title must be 3–140 characters.');
  }
  if (body.length < 5 || body.length > 1500) {
    throw new Error('Marketplace notice body must be 5–1500 characters.');
  }
  if (!allowedCategories.includes(input.category)) {
    throw new Error('Select a valid marketplace notice category.');
  }
  return { title, body, category: input.category };
}

export async function createMarketplaceUpdateRecord(input: {
  title: string;
  body: string;
  category: MarketplaceUpdateCategory;
  published: boolean;
  actorUid: string;
  actorRole: UserRole;
}): Promise<MarketplaceUpdate> {
  if (input.actorRole !== 'supreme_admin') {
    throw new Error(
      'Only Supreme Admin accounts can publish marketplace notices.'
    );
  }
  if (!isValidFirestoreId(input.actorUid)) {
    throw new Error('Sign in as a designated Supreme Admin to publish notices.');
  }

  const valid = validateMarketplaceUpdateFields(input);
  const updateId = generateFirestoreDocId(COLLECTION_NAMES.marketplaceUpdates);
  const ref = doc(db, COLLECTION_NAMES.marketplaceUpdates, updateId);

  const payload = {
    id: updateId,
    title: valid.title,
    body: valid.body,
    category: valid.category,
    published: Boolean(input.published),
    createdByUid: input.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await commitFreshWriteBatchWithPermissionRetry(
      () => writeBatch(db),
      (batch) => {
        batch.set(ref, payload);
      },
      {
        actorUid: input.actorUid,
        refreshToken: () => refreshAuthSessionToken(input.actorUid),
      }
    );
    notifyMarketplaceUpdatesMutated();
    return {
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.marketplaceUpdates}/${updateId}`
    );
  }
}

export async function updateMarketplaceUpdateRecord(input: {
  existing: MarketplaceUpdate;
  title: string;
  body: string;
  category: MarketplaceUpdateCategory;
  published: boolean;
  actorRole: UserRole;
}): Promise<MarketplaceUpdate> {
  if (input.actorRole !== 'supreme_admin') {
    throw new Error(
      'Only Supreme Admin accounts can edit marketplace notices.'
    );
  }
  const valid = validateMarketplaceUpdateFields(input);
  const ref = doc(db, COLLECTION_NAMES.marketplaceUpdates, input.existing.id);

  try {
    await runWithPermissionRetry(
      () =>
        updateDoc(ref, {
          title: valid.title,
          body: valid.body,
          category: valid.category,
          published: Boolean(input.published),
          updatedAt: serverTimestamp(),
        }),
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );
    notifyMarketplaceUpdatesMutated();
    return {
      ...input.existing,
      title: valid.title,
      body: valid.body,
      category: valid.category,
      published: Boolean(input.published),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceUpdates}/${input.existing.id}`
    );
  }
}

export async function deleteMarketplaceUpdateRecord(input: {
  updateId: string;
  actorRole: UserRole;
}): Promise<void> {
  if (input.actorRole !== 'supreme_admin') {
    throw new Error(
      'Only Supreme Admin accounts can delete marketplace notices.'
    );
  }
  if (!isValidFirestoreId(input.updateId)) return;
  try {
    await runWithPermissionRetry(
      () => deleteDoc(doc(db, COLLECTION_NAMES.marketplaceUpdates, input.updateId)),
      {
        refreshToken: () => refreshAuthSessionToken(),
      }
    );
    notifyMarketplaceUpdatesMutated();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.marketplaceUpdates}/${input.updateId}`
    );
  }
}


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
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
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
  validateTrustedContactPayload,
  type AccountStatus,
  type AnonymousAuditLog,
  type BadgeAuditAction,
  type BadgeAuditLog,
  type MarketplaceListing,
  type MarketplaceListingKind,
  type NotificationItem,
  type PublicProfileProjection,
  type PublicUserProfile,
  type TrustedContact,
  type TrustedContactCategory,
  type UserRole,
  type UserRoleRecord,
} from '../types/database';
import { toPublicProfileProjection } from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import { generateFirestoreDocId } from './mediaStorage';

export interface AdminManagedMember {
  profile: PublicUserProfile;
  roleRecord: UserRoleRecord | null;
  effectiveRole: UserRole;
  isPermanentOwner: boolean;
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
}

export interface CreateTrustedContactInput {
  fullName: string;
  category: TrustedContactCategory;
  roleTitle: string;
  department?: string;
  faculty?: string;
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

function getAuditActorRole(role: UserRole): 'owner' | 'supreme_admin' {
  return role === 'owner' ? 'owner' : 'supreme_admin';
}

export async function bootstrapPermanentOwnerRoleRecord(uid: string): Promise<void> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Invalid owner UID.');
  }

  const roleRef = doc(db, COLLECTION_NAMES.userRoles, uid);
  const userRef = doc(db, COLLECTION_NAMES.users, uid);

  try {
    await runTransaction(db, async (tx) => {
      const [roleSnap, userSnap] = await Promise.all([
        tx.get(roleRef),
        tx.get(userRef),
      ]);

      const rolePayload = {
        uid,
        role: 'owner' as const,
        badge: 'supreme_admin' as const,
        isPermanentOwner: true,
        isHiddenFromDirectory: true,
        grantedBy: uid,
        updatedAt: serverTimestamp(),
      };

      if (roleSnap.exists()) {
        tx.update(roleRef, rolePayload);
      } else {
        tx.set(roleRef, rolePayload);
      }

      if (userSnap.exists()) {
        tx.update(userRef, {
          badge: 'supreme_admin',
          accountStatus: 'active',
          isHiddenFromDirectory: true,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.userRoles}/${uid}`
    );
  }
}

export async function fetchAdminMemberDirectory(
  searchTerm = '',
  includeHiddenForOwner = false
): Promise<AdminManagedMember[]> {
  try {
    const usersSnap = await getDocs(
      query(collection(db, COLLECTION_NAMES.users), limit(120))
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
        const isPermanentOwner = Boolean(
          roleRecord?.isPermanentOwner || roleRecord?.role === 'owner'
        );
        const effectiveRole: UserRole =
          roleRecord?.role ??
          (profile.badge === 'verified'
            ? 'verified'
            : profile.badge === 'moderator'
            ? 'moderator'
            : profile.badge === 'supreme_admin'
            ? 'supreme_admin'
            : 'member');

        return {
          profile,
          roleRecord,
          effectiveRole,
          isPermanentOwner,
        };
      })
      .filter((entry) => {
        if (!includeHiddenForOwner && entry.isPermanentOwner) {
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
      owner: 0,
      supreme_admin: 1,
      moderator: 2,
      verified: 3,
      member: 4,
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
  nextRole: Exclude<UserRole, 'owner'>;
  reason?: string;
}): Promise<{
  action: BadgeAuditAction;
  nextRole: Exclude<UserRole, 'owner'>;
  nextBadge: ReturnType<typeof resolveBadgeForRole>;
}> {
  if (!isValidFirestoreId(input.actorUid) || !isValidFirestoreId(input.targetUid)) {
    throw new Error('Invalid administrator or member identifier.');
  }
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Permanent Owner can manage badges.');
  }

  const cleanReason = input.reason?.trim().slice(0, BLUEPRINT_LIMITS.auditReasonMax);
  const userRef = doc(db, COLLECTION_NAMES.users, input.targetUid);
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, input.targetUid);
  const auditId = generateFirestoreDocId(COLLECTION_NAMES.badgeAuditLogs);
  const auditRef = doc(db, COLLECTION_NAMES.badgeAuditLogs, auditId);
  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);

  try {
    return await runTransaction(db, async (tx) => {
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
      const previousRole: UserRole = existingRole?.role ?? 'member';
      const previousBadge = existingRole?.badge ?? targetProfile.badge ?? 'none';
      const targetIsPermanentOwner = Boolean(
        existingRole?.isPermanentOwner || previousRole === 'owner'
      );

      if (
        !canActorUpdateTargetRoleRecord(
          input.actorRole,
          targetIsPermanentOwner,
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
      const performedByRole = getAuditActorRole(input.actorRole);

      const nextRolePayload = {
        uid: input.targetUid,
        role: input.nextRole,
        badge: nextBadge,
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
    });
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
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Permanent Owner can suspend accounts.');
  }

  const cleanReason = input.reason?.trim().slice(0, BLUEPRINT_LIMITS.auditReasonMax);
  const userRef = doc(db, COLLECTION_NAMES.users, input.targetUid);
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, input.targetUid);
  const auditId = generateFirestoreDocId(COLLECTION_NAMES.badgeAuditLogs);
  const auditRef = doc(db, COLLECTION_NAMES.badgeAuditLogs, auditId);
  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);

  try {
    await runTransaction(db, async (tx) => {
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
      const currentRole: UserRole = existingRole?.role ?? 'member';
      const currentBadge = resolveBadgeForRole(currentRole);
      const targetIsPermanentOwner = Boolean(
        existingRole?.isPermanentOwner || currentRole === 'owner'
      );

      if (
        !canActorUpdateTargetRoleRecord(
          input.actorRole,
          targetIsPermanentOwner,
          currentRole,
          undefined,
          input.actorUid,
          input.targetUid
        )
      ) {
        throw new Error(
          'Protected Owner, peer Supreme Admin, or self-account suspension is forbidden.'
        );
      }

      if (targetProfile.accountStatus === input.nextStatus) {
        return;
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
        performedByRole: getAuditActorRole(input.actorRole),
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
    });
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
 * 1. Verified community contributors (`badge == 'verified'`, active, NOT hidden from directory)
 * 2. Official Admin-listed campus contacts (`/trustedContacts`)
 * Permanent Owner accounts (`isHiddenFromDirectory: true` or `supreme_admin`) are NEVER exposed here.
 */
export async function fetchTrustedCircleDirectory(): Promise<{
  verifiedMembers: PublicProfileProjection[];
  officialContacts: TrustedContact[];
}> {
  try {
    const [usersSnap, contactsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.users),
          where('badge', '==', 'verified'),
          where('isHiddenFromDirectory', '==', false),
          limit(100)
        )
      ),
      getDocs(query(collection(db, COLLECTION_NAMES.trustedContacts), limit(100))),
    ]);

    const verifiedMembers = usersSnap.docs
      .map((item) => item.data() as PublicUserProfile)
      .filter(
        (profile) =>
          profile.badge === 'verified' &&
          profile.accountStatus === 'active' &&
          !profile.isHiddenFromDirectory
      )
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

    return { verifiedMembers, officialContacts };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.trustedContacts
    );
  }
}

export async function createTrustedContactRecord(
  input: CreateTrustedContactInput
): Promise<TrustedContact> {
  const contactId = generateFirestoreDocId(COLLECTION_NAMES.trustedContacts);
  const cleanName = input.fullName.trim();
  const cleanRoleTitle = input.roleTitle.trim();
  const cleanWhatsapp = input.whatsappLink?.trim() || undefined;

  if (cleanWhatsapp && !isSafeMediaUrl(cleanWhatsapp)) {
    throw new Error('WhatsApp link must start with https:// or http://.');
  }

  const record: TrustedContact = {
    id: contactId,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    department: input.department?.trim() || undefined,
    faculty: input.faculty?.trim() || undefined,
    contactNumber: input.contactNumber?.trim() || undefined,
    whatsappLink: cleanWhatsapp,
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
  if (record.department) firestorePayload.department = record.department;
  if (record.faculty) firestorePayload.faculty = record.faculty;
  if (record.contactNumber) firestorePayload.contactNumber = record.contactNumber;
  if (record.whatsappLink) firestorePayload.whatsappLink = record.whatsappLink;
  if (record.description) firestorePayload.description = record.description;

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.trustedContacts, contactId), firestorePayload);

  try {
    await batch.commit();
    return record;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.trustedContacts}/${contactId}`
    );
  }
}

export async function deleteTrustedContactRecord(contactId: string): Promise<void> {
  if (!isValidFirestoreId(contactId)) return;
  try {
    await deleteDoc(doc(db, COLLECTION_NAMES.trustedContacts, contactId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.trustedContacts}/${contactId}`
    );
  }
}

export async function fetchPublicMarketplaceListings(): Promise<
  MarketplaceListing[]
> {
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

  if (
    cleanTitle.length < BLUEPRINT_LIMITS.marketplaceTitleMin ||
    cleanTitle.length > BLUEPRINT_LIMITS.marketplaceTitleMax
  ) {
    throw new Error(
      `Listing title must be ${BLUEPRINT_LIMITS.marketplaceTitleMin}–${BLUEPRINT_LIMITS.marketplaceTitleMax} characters.`
    );
  }
  if (
    cleanDescription.length < BLUEPRINT_LIMITS.marketplaceDescMin ||
    cleanDescription.length > BLUEPRINT_LIMITS.marketplaceDescMax
  ) {
    throw new Error(
      `Description must be ${BLUEPRINT_LIMITS.marketplaceDescMin}–${BLUEPRINT_LIMITS.marketplaceDescMax} characters.`
    );
  }
  if (
    cleanWhatsapp.length < BLUEPRINT_LIMITS.marketplaceWhatsappMin ||
    cleanWhatsapp.length > BLUEPRINT_LIMITS.marketplaceWhatsappMax
  ) {
    throw new Error('Provide a valid WhatsApp phone number (7–24 characters).');
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error('Price must be 0 or higher.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error('Initial quantity must be at least 1.');
  }

  const autoApprove = canRolePublishCommunityFeed(input.actorRole);
  const listingId = generateFirestoreDocId(COLLECTION_NAMES.marketplaceListings);
  const expiryDate = computeMarketplaceExpiryDate();

  const payload = {
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
  } as const;

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.marketplaceListings, listingId), payload);

  try {
    await batch.commit();
    return {
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: expiryDate.getTime(),
    };
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
}): Promise<MarketplaceListing> {
  if (!isValidFirestoreId(input.listingId) || !isValidFirestoreId(input.actorUid)) {
    throw new Error('Invalid marketplace review identifiers.');
  }

  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, input.listingId);
  const expiryDate = computeMarketplaceExpiryDate();

  try {
    return await runTransaction(db, async (tx) => {
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
    });
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
  const listingRef = doc(db, COLLECTION_NAMES.marketplaceListings, input.listing.id);
  const batch = writeBatch(db);
  batch.update(listingRef, {
    quantity: resolved.quantity,
    status: resolved.status,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return {
      ...input.listing,
      quantity: resolved.quantity,
      status: resolved.status,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceListings}/${input.listing.id}`
    );
  }
}

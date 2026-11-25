import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  auth,
  db,
  ensureVerifiedEmailTokenClaim,
  handleFirestoreError,
  OperationType,
  refreshAuthSessionToken,
} from '../lib/firebase';
import {
  isTransientFirestoreConnectionError,
  runWithPermissionRetry,
} from '../utils/firestoreRetry';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  SUBCOLLECTION_NAMES,
  computeTotalOrdinaryPostLikes,
  isMarketplaceListingExpired,
  isSafeMediaUrl,
  isValidFirestoreId,
  isValidUsername,
  validateAnonymousPostPayload,
  type AnonymousComment,
  type AnonymousPost,
  type BadgeType,
  type CampusEvent,
  type CommunityPost,
  type FollowEdge,
  type MarketplaceListing,
  type NotificationEventType,
  type NotificationItem,
  type Opportunity,
  type PostReaction,
  type PrivateUserData,
  type PublicProfileProjection,
  type PublicUserProfile,
  type TrustedContact,
  type UserRole,
  type UserRoleRecord,
  type UsernameReservation,
} from '../types/database';
import {
  isDesignatedSupremeAdminUser,
  isFirebaseErrorCode,
  isProfileAccessibleByDirectInteraction,
  isPublicSupremeAdminUser,
  isUndergroundSupremeAdminUser,
  normalizeUsername,
  resolveAuthoritativeMappingRole,
  toPublicProfileProjection,
  validateProfileSettingsForm,
  validateUsernameCandidate,
  type ProfileSettingsFormInput,
} from '../utils/authValidation';
import { BoundedLruMap, SingleFlightRegistry } from '../utils/cacheSync';
import {
  notifyFollowToggled,
  notifyProfileUpdated,
  registerFoundationProjectionInvalidator,
} from './cacheInvalidation';
import { runWithFirestoreConnectionRetry } from '../utils/firestoreRetry';
import {
  extractTimestampMs,
  filterAnonymousPosts,
  filterCampusEvents,
  filterCommunityPosts,
  filterMarketplaceListings,
  filterMemberMatches,
  filterOpportunities,
  filterTrustedContacts,
  type SearchableCommunityPostItem,
} from '../utils/contextualSearch';
import {
  normalizeInterestList,
  rankForYouCommunityPosts,
  sortLatestCommunityPosts,
  type ForYouRankingOptions,
} from '../utils/feedRanking';
import {
  DEFAULT_NOTIFICATION_PREFS,
  buildAnonymousLikeMilestoneNotificationId,
  buildAnonymousReplyNotificationId,
  buildMarketplaceExpiredNotificationId,
  normalizeNotificationPrefs,
  shouldEmitActivityNotification,
  summarizeNotificationExcerpt,
  type NotificationPreferences,
} from '../utils/notifications';
import type { FeedTabId } from '../types/platform';
import {
  fetchConfiguredVapidPublicKey,
  triggerBestEffortPushDispatch,
} from './webPush';

export interface InitializeMemberProfileInput {
  uid: string;
  authEmail: string;
  fullName: string;
  username: string;
  whatsappNumber: string;
  department: string;
  level: string;
  photoUrl?: string;
}

export interface UsernameAvailabilityResult {
  available: boolean;
  normalized: string;
  reason?: string;
}

export interface CommunityPostWithAuthor {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export interface MemberProfileBundle {
  profile: PublicProfileProjection;
  resolvedUsername: string;
  redirectedFrom?: string;
  isOwnProfile: boolean;
  isFollowing: boolean;
  isSuspended: boolean;
  canPublishOrdinaryPosts: boolean;
  totalLikesReceived: number;
  posts: CommunityPost[];
  likedPosts: CommunityPostWithAuthor[];
  listings: MarketplaceListing[];
}

export interface HomeSearchResult {
  members: PublicProfileProjection[];
  posts: CommunityPostWithAuthor[];
}

function sortByCreatedAtDesc<T extends { createdAt: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

function sortCommunityPosts(items: CommunityPost[]): CommunityPost[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

export async function checkUsernameAvailability(
  username: string,
  currentUid?: string
): Promise<UsernameAvailabilityResult> {
  const normalized = normalizeUsername(username);
  const validationError = validateUsernameCandidate(normalized);
  if (validationError) {
    return { available: false, normalized, reason: validationError };
  }

  const path = `${COLLECTION_NAMES.usernames}/${normalized}`;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.usernames, normalized));
    if (!snap.exists()) {
      return { available: true, normalized };
    }
    const reservation = snap.data() as UsernameReservation;
    if (currentUid && reservation.ownerUID === currentUid) {
      return {
        available: true,
        normalized,
        reason: 'This username already belongs to your account.',
      };
    }
    return {
      available: false,
      normalized,
      reason: 'That username is already taken. Choose another.',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const result = await checkUsernameAvailability(username);
  return result.available;
}

export async function fetchUserRoleRecord(
  uid: string
): Promise<UserRoleRecord | null> {
  if (!isValidFirestoreId(uid)) {
    return null;
  }

  const path = `${COLLECTION_NAMES.userRoles}/${uid}`;
  try {
    const snapshot = await getDoc(doc(db, COLLECTION_NAMES.userRoles, uid));
    if (!snapshot.exists()) {
      return null;
    }
    return snapshot.data() as UserRoleRecord;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeUserRoleRecord(
  uid: string,
  onRole: (record: UserRoleRecord | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const path = `${COLLECTION_NAMES.userRoles}/${uid}`;
  return onSnapshot(
    doc(db, COLLECTION_NAMES.userRoles, uid),
    (snapshot) => {
      onRole(snapshot.exists() ? (snapshot.data() as UserRoleRecord) : null);
    },
    (error) => {
      if (auth.currentUser?.uid !== uid) {
        return;
      }
      if (isTransientFirestoreConnectionError(error)) {
        console.warn('Role subscription paused while reconnecting:', path, error);
        onError?.(error);
        return;
      }
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function fetchPublicMemberProfile(
  uid: string
): Promise<PublicUserProfile | null> {
  if (!isValidFirestoreId(uid)) {
    return null;
  }

  const path = `${COLLECTION_NAMES.users}/${uid}`;
  try {
    const snapshot = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
    if (!snapshot.exists()) {
      return null;
    }
    return snapshot.data() as PublicUserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribePublicMemberProfile(
  uid: string,
  onProfile: (profile: PublicUserProfile | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const path = `${COLLECTION_NAMES.users}/${uid}`;
  return onSnapshot(
    doc(db, COLLECTION_NAMES.users, uid),
    (snapshot) => {
      onProfile(snapshot.exists() ? (snapshot.data() as PublicUserProfile) : null);
    },
    (error) => {
      if (auth.currentUser?.uid !== uid) {
        return;
      }
      if (isTransientFirestoreConnectionError(error)) {
        console.warn('Profile subscription paused while reconnecting:', path, error);
        onError?.(error);
        return;
      }
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function createInitialMemberAccountDocs(
  input: InitializeMemberProfileInput
): Promise<void> {
  const normalizedUsername = normalizeUsername(input.username);
  const normalizedName = input.fullName.trim();

  if (!isValidFirestoreId(input.uid)) {
    throw new Error('Invalid user UID.');
  }

  const usernameError = validateUsernameCandidate(normalizedUsername);
  if (usernameError) {
    throw new Error(usernameError);
  }

  if (
    normalizedName.length < BLUEPRINT_LIMITS.fullNameMin ||
    normalizedName.length > BLUEPRINT_LIMITS.fullNameMax
  ) {
    throw new Error('Full name violates length requirements.');
  }
  if (input.photoUrl && !isSafeMediaUrl(input.photoUrl)) {
    throw new Error('Invalid profile photo URL.');
  }

  const available = await isUsernameAvailable(normalizedUsername);
  if (!available) {
    throw new Error('That username is already taken. Please choose another.');
  }

  const memberId = `LI-${input.uid.slice(0, 12)}`;
  const cleanWhatsapp = input.whatsappNumber
    .trim()
    .slice(0, BLUEPRINT_LIMITS.phoneMax);
  const cleanDepartment = input.department
    .trim()
    .slice(0, BLUEPRINT_LIMITS.departmentMax);
  const cleanLevel = input.level.trim().slice(0, BLUEPRINT_LIMITS.levelMax);

  if (!cleanWhatsapp || cleanWhatsapp.length < 7) {
    throw new Error('A valid WhatsApp number is compulsory.');
  }
  if (cleanDepartment.length < 2) {
    throw new Error('Department or unit is compulsory.');
  }
  if (cleanLevel.length < 2) {
    throw new Error('Academic level or campus status is compulsory.');
  }

  const batch = writeBatch(db);

  batch.set(doc(db, COLLECTION_NAMES.usernames, normalizedUsername), {
    username: normalizedUsername,
    ownerUID: input.uid,
    isPrimary: true,
    createdAt: serverTimestamp(),
  });

  const currentUser =
    auth.currentUser?.uid === input.uid ? auth.currentUser : null;
  const isUndergroundAdmin = isUndergroundSupremeAdminUser(currentUser);
  const isPublicSupremeAdmin = isPublicSupremeAdminUser(currentUser);

  const initialBadge: BadgeType = isPublicSupremeAdmin ? 'supreme_admin' : 'none';

  const publicProfilePayload: Record<string, unknown> = {
    uid: input.uid,
    memberId,
    fullName: normalizedName,
    username: normalizedUsername,
    department: cleanDepartment,
    level: cleanLevel,
    publicWhatsapp: cleanWhatsapp,
    showWhatsappPublicly: true,
    badge: initialBadge,
    accountStatus: 'active',
    isHiddenFromDirectory: isUndergroundAdmin,
    followersCount: 0,
    followingCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.photoUrl?.trim() && isSafeMediaUrl(input.photoUrl.trim())) {
    publicProfilePayload.photoUrl = input.photoUrl.trim();
  }

  batch.set(
    doc(db, COLLECTION_NAMES.users, input.uid),
    publicProfilePayload
  );

  if (isUndergroundAdmin || isPublicSupremeAdmin) {
    batch.set(doc(db, COLLECTION_NAMES.userRoles, input.uid), {
      uid: input.uid,
      role: 'supreme_admin',
      badge: 'supreme_admin',
      isPermanentOwner: false,
      isHiddenFromDirectory: isUndergroundAdmin,
      grantedBy: input.uid,
      updatedAt: serverTimestamp(),
    });
  }

  const privatePayload: Record<string, unknown> = {
    uid: input.uid,
    authEmail: input.authEmail.trim().slice(0, BLUEPRINT_LIMITS.emailMax),
    whatsappNumber: cleanWhatsapp,
    ownedUsernames: [normalizedUsername],
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    ...(isUndergroundAdmin ? { showSupremeAdminBadge: false } : {}),
    updatedAt: serverTimestamp(),
  };

  batch.set(
    doc(db, COLLECTION_NAMES.privateUserData, input.uid),
    privatePayload
  );

  const writePath = `${COLLECTION_NAMES.users}/${input.uid}`;
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, writePath);
  }
}

export async function ensureDesignatedSupremeAdminAccountState(
  user: User | null
): Promise<void> {
  if (!user || !isDesignatedSupremeAdminUser(user) || !isValidFirestoreId(user.uid)) {
    return;
  }
  const isUnderground = isUndergroundSupremeAdminUser(user);
  const expectedPublicBadge: BadgeType = isUnderground ? 'none' : 'supreme_admin';
  const roleRef = doc(db, COLLECTION_NAMES.userRoles, user.uid);
  const userRef = doc(db, COLLECTION_NAMES.users, user.uid);
  const privRef = doc(db, COLLECTION_NAMES.privateUserData, user.uid);

  try {
    await ensureVerifiedEmailTokenClaim(user);
    await runWithPermissionRetry(
      async () => {
        const [roleSnap, userSnap, privSnap] = await Promise.all([
          getDoc(roleRef),
          getDoc(userRef),
          getDoc(privRef),
        ]);

    const roleData = roleSnap.exists() ? (roleSnap.data() as UserRoleRecord) : null;
    if (
      !roleData ||
      roleData.role !== 'supreme_admin' ||
      roleData.badge !== 'supreme_admin' ||
      roleData.isPermanentOwner !== false ||
      roleData.isHiddenFromDirectory !== isUnderground
    ) {
      const rolePayload = {
        uid: user.uid,
        role: 'supreme_admin' as const,
        badge: 'supreme_admin' as const,
        isPermanentOwner: false,
        isHiddenFromDirectory: isUnderground,
        grantedBy: user.uid,
        updatedAt: serverTimestamp(),
      };
      if (roleSnap.exists()) {
        await updateDoc(roleRef, rolePayload);
      } else {
        await setDoc(roleRef, rolePayload);
      }
    }

    if (!userSnap.exists()) {
      const cleanEmail = (user.email ?? '').trim().slice(0, BLUEPRINT_LIMITS.emailMax);
      const rawPrefix = (cleanEmail.split('@')[0] ?? 'member')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 14);
      const uidSuffix = user.uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user';
      let candidateUsername = `${rawPrefix || 'campus'}_${uidSuffix}`.slice(0, 32);
      if (candidateUsername.length < 3) {
        candidateUsername = `member_${uidSuffix}`.slice(0, 32);
      }
      const displayName = isUnderground
        ? 'Campus Member'
        : (user.displayName?.trim() || 'LASUED Intel Official').slice(
            0,
            BLUEPRINT_LIMITS.fullNameMax
          );
      const safeFullName = displayName.length >= 2 ? displayName : 'Campus Member';
      const usernameRef = doc(db, COLLECTION_NAMES.usernames, candidateUsername);

      await runTransaction(db, async (tx) => {
        const [freshUserSnap, freshPrivSnap, freshUsernameSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(privRef),
          tx.get(usernameRef),
        ]);
        if (freshUserSnap.exists()) {
          return;
        }
        const finalUsername =
          !freshUsernameSnap.exists() ||
          (freshUsernameSnap.data() as UsernameReservation).ownerUID === user.uid
            ? candidateUsername
            : `intel_u_${user.uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}`;
        const finalUsernameRef = doc(db, COLLECTION_NAMES.usernames, finalUsername);
        const finalUsernameSnap =
          finalUsername === candidateUsername
            ? freshUsernameSnap
            : await tx.get(finalUsernameRef);

        if (!finalUsernameSnap.exists()) {
          tx.set(finalUsernameRef, {
            username: finalUsername,
            ownerUID: user.uid,
            isPrimary: true,
            createdAt: serverTimestamp(),
          });
        }

        tx.set(userRef, {
          uid: user.uid,
          memberId: `LI-${user.uid.slice(0, 12)}`,
          fullName: safeFullName,
          username: finalUsername,
          department: 'General Studies',
          level: 'Member',
          showWhatsappPublicly: false,
          badge: expectedPublicBadge,
          accountStatus: 'active',
          isHiddenFromDirectory: isUnderground,
          followersCount: 0,
          followingCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (!freshPrivSnap.exists() && cleanEmail.length >= 3) {
          tx.set(privRef, {
            uid: user.uid,
            authEmail: cleanEmail,
            ownedUsernames: [finalUsername],
            notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
            ...(isUnderground ? { showSupremeAdminBadge: false } : {}),
            updatedAt: serverTimestamp(),
          });
        }
      });
    } else {
      const userData = userSnap.data() as PublicUserProfile;
      const missingStatus = userData.accountStatus !== 'active' && userData.accountStatus !== 'suspended';
      const missingFollowers = typeof userData.followersCount !== 'number';
      const missingFollowing = typeof userData.followingCount !== 'number';
      if (
        userData.badge !== expectedPublicBadge ||
        userData.isHiddenFromDirectory !== isUnderground ||
        missingStatus ||
        missingFollowers ||
        missingFollowing
      ) {
        await updateDoc(userRef, {
          badge: expectedPublicBadge,
          isHiddenFromDirectory: isUnderground,
          updatedAt: serverTimestamp(),
          ...(missingStatus ? { accountStatus: 'active' } : {}),
          ...(missingFollowers ? { followersCount: 0 } : {}),
          ...(missingFollowing ? { followingCount: 0 } : {}),
        });
        notifyProfileUpdated({
          uid: user.uid,
          patch: {
            badge: expectedPublicBadge,
          },
        });
      }
    }

        if (isUnderground && privSnap.exists()) {
          const privData = privSnap.data() as PrivateUserData;
          if (privData.showSupremeAdminBadge !== false) {
            await updateDoc(privRef, {
              showSupremeAdminBadge: false,
              updatedAt: serverTimestamp(),
            });
          }
        }
      },
      {
        actorUid: user.uid,
        refreshToken: () => refreshAuthSessionToken(user.uid),
      }
    );
  } catch {
    // Non-blocking role & privacy synchronization
  }
}

class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export async function updateMemberAccountProfileAndUsername(
  uid: string,
  currentUsername: string,
  input: ProfileSettingsFormInput,
  authEmail = ''
): Promise<{ updatedUsername: string }> {
  if (!isValidFirestoreId(uid)) {
    throw new DomainValidationError('Invalid user UID.');
  }

  const validationErrors = validateProfileSettingsForm(input, {
    currentUsername,
  });
  const firstError = Object.values(validationErrors)[0];
  if (firstError) {
    throw new DomainValidationError(firstError);
  }

  const cleanFullName = input.fullName
    .trim()
    .slice(0, BLUEPRINT_LIMITS.fullNameMax);
  const cleanUsername = normalizeUsername(input.username);
  const cleanBio = input.bio.trim().slice(0, BLUEPRINT_LIMITS.bioMax);
  const cleanDepartment = input.department
    .trim()
    .slice(0, BLUEPRINT_LIMITS.departmentMax);
  const cleanFaculty = input.faculty.trim().slice(0, BLUEPRINT_LIMITS.facultyMax);
  const cleanLevel = input.level.trim().slice(0, BLUEPRINT_LIMITS.levelMax);
  const cleanAccountCategory = input.accountCategory
    .trim()
    .slice(0, BLUEPRINT_LIMITS.accountCategoryMax);
  const cleanWhatsapp = input.publicWhatsapp
    .trim()
    .slice(0, BLUEPRINT_LIMITS.phoneMax);
  const cleanPhotoUrl = input.photoUrl.trim().slice(0, BLUEPRINT_LIMITS.urlMax);
  const cleanCoverUrl = input.coverUrl.trim().slice(0, BLUEPRINT_LIMITS.urlMax);
  const cleanAuthEmail = (
    authEmail.trim() ||
    auth.currentUser?.email?.trim() ||
    ''
  ).slice(0, BLUEPRINT_LIMITS.emailMax);

  const publicRef = doc(db, COLLECTION_NAMES.users, uid);
  const privateRef = doc(db, COLLECTION_NAMES.privateUserData, uid);
  const newUsernameRef = doc(db, COLLECTION_NAMES.usernames, cleanUsername);
  const txPath = `${COLLECTION_NAMES.users}/${uid}`;

  try {
    await runTransaction(db, async (tx) => {
      // Perform all Firestore transaction reads before any writes.
      const [publicSnap, privateSnap, newUsernameSnap] = await Promise.all([
        tx.get(publicRef),
        tx.get(privateRef),
        tx.get(newUsernameRef),
      ]);

      const existingPublic = publicSnap.exists()
        ? (publicSnap.data() as PublicUserProfile)
        : null;
      const existingUsername = existingPublic
        ? normalizeUsername(existingPublic.username || currentUsername)
        : normalizeUsername(currentUsername);
      const isChangingUsername =
        !existingPublic ||
        (existingUsername.length > 0 && cleanUsername !== existingUsername);

      const oldUsernameRef =
        existingPublic &&
        isChangingUsername &&
        existingUsername.length > 0 &&
        existingUsername !== cleanUsername
          ? doc(db, COLLECTION_NAMES.usernames, existingUsername)
          : null;
      const oldUsernameSnap = oldUsernameRef ? await tx.get(oldUsernameRef) : null;

      if (newUsernameSnap.exists()) {
        const existingRes = newUsernameSnap.data() as UsernameReservation;
        if (existingRes.ownerUID !== uid) {
          throw new DomainValidationError(
            `Username @${cleanUsername} is already claimed by another member.`
          );
        }
        if (existingRes.isPrimary !== true || Boolean(existingRes.redirectToUsername)) {
          tx.update(newUsernameRef, {
            isPrimary: true,
            redirectToUsername: '',
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        tx.set(newUsernameRef, {
          username: cleanUsername,
          ownerUID: uid,
          isPrimary: true,
          createdAt: serverTimestamp(),
        });
      }

      if (
        oldUsernameRef &&
        oldUsernameSnap?.exists() &&
        (oldUsernameSnap.data() as UsernameReservation).ownerUID === uid
      ) {
        tx.update(oldUsernameRef, {
          isPrimary: false,
          redirectToUsername: cleanUsername,
          updatedAt: serverTimestamp(),
        });
      }

      const nextShowWhatsappPublicly =
        typeof input.showWhatsappPublicly === 'boolean'
          ? input.showWhatsappPublicly
          : existingPublic
          ? existingPublic.showWhatsappPublicly
          : true;

      if (!existingPublic) {
        const currentAuthUser = auth.currentUser?.uid === uid ? auth.currentUser : null;
        const initialBadge: BadgeType = isPublicSupremeAdminUser(currentAuthUser)
          ? 'supreme_admin'
          : 'none';
        const initialHidden = isUndergroundSupremeAdminUser(currentAuthUser);

        const createPayload: Record<string, unknown> = {
          uid,
          memberId: `LI-${uid.slice(0, 12)}`,
          fullName: cleanFullName,
          username: cleanUsername,
          department: cleanDepartment,
          level: cleanLevel,
          publicWhatsapp: cleanWhatsapp,
          showWhatsappPublicly: nextShowWhatsappPublicly,
          badge: initialBadge,
          accountStatus: 'active',
          isHiddenFromDirectory: initialHidden,
          followersCount: 0,
          followingCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (cleanBio) createPayload.bio = cleanBio;
        if (cleanFaculty) createPayload.faculty = cleanFaculty;
        if (cleanAccountCategory) {
          createPayload.accountCategory = cleanAccountCategory;
        }
        if (cleanPhotoUrl) createPayload.photoUrl = cleanPhotoUrl;
        if (cleanCoverUrl) createPayload.coverUrl = cleanCoverUrl;

        tx.set(publicRef, createPayload);
      } else {
        tx.update(publicRef, {
          fullName: cleanFullName,
          username: cleanUsername,
          bio: cleanBio,
          department: cleanDepartment,
          faculty: cleanFaculty,
          level: cleanLevel,
          accountCategory: cleanAccountCategory,
          photoUrl: cleanPhotoUrl,
          coverUrl: cleanCoverUrl,
          publicWhatsapp: cleanWhatsapp,
          showWhatsappPublicly: nextShowWhatsappPublicly,
          updatedAt: serverTimestamp(),
        });
      }

      if (privateSnap.exists()) {
        const privateData = privateSnap.data() as PrivateUserData;
        const ownedSet = new Set<string>(privateData.ownedUsernames ?? []);
        if (existingUsername) ownedSet.add(existingUsername);
        ownedSet.add(cleanUsername);
        const ownedList = Array.from(ownedSet).slice(0, 20);

        tx.update(privateRef, {
          whatsappNumber: cleanWhatsapp,
          ownedUsernames: ownedList,
          updatedAt: serverTimestamp(),
        });
      } else if (cleanAuthEmail.length >= 3) {
        const ownedSet = new Set<string>();
        if (existingUsername) ownedSet.add(existingUsername);
        ownedSet.add(cleanUsername);
        tx.set(privateRef, {
          uid,
          authEmail: cleanAuthEmail,
          whatsappNumber: cleanWhatsapp,
          ownedUsernames: Array.from(ownedSet).slice(0, 20),
          notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
          updatedAt: serverTimestamp(),
        });
      }
    });

    notifyProfileUpdated({
      uid,
      username: cleanUsername,
      previousUsername: normalizeUsername(currentUsername),
      patch: {
        fullName: cleanFullName,
        username: cleanUsername,
        bio: cleanBio,
        department: cleanDepartment,
        faculty: cleanFaculty,
        level: cleanLevel,
        accountCategory: cleanAccountCategory,
        photoUrl: cleanPhotoUrl,
        coverUrl: cleanCoverUrl,
        publicWhatsapp: cleanWhatsapp,
        ...(typeof input.showWhatsappPublicly === 'boolean'
          ? { showWhatsappPublicly: input.showWhatsappPublicly }
          : {}),
      },
    });

    return { updatedUsername: cleanUsername };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, txPath);
  }
}

export async function updateMemberPrivacySettings(
  uid: string,
  input: { showWhatsappPublicly: boolean }
): Promise<void> {
  if (!isValidFirestoreId(uid)) {
    throw new DomainValidationError('Invalid user UID.');
  }

  const publicRef = doc(db, COLLECTION_NAMES.users, uid);
  const path = `${COLLECTION_NAMES.users}/${uid}`;

  try {
    const batch = writeBatch(db);
    batch.update(publicRef, {
      showWhatsappPublicly: Boolean(input.showWhatsappPublicly),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    notifyProfileUpdated({
      uid,
      patch: { showWhatsappPublicly: Boolean(input.showWhatsappPublicly) },
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateMemberProfileSettings(
  uid: string,
  input: ProfileSettingsFormInput,
  currentUsername = '',
  authEmail = ''
): Promise<void> {
  await updateMemberAccountProfileAndUsername(
    uid,
    currentUsername,
    input,
    authEmail
  );
}

async function resolveUsernameToUidInternal(
  rawUsername: string
): Promise<{ uid: string; resolvedUsername: string; redirectedFrom?: string } | null> {
  const initialUsername = normalizeUsername(rawUsername);
  if (!isValidUsername(initialUsername)) {
    return null;
  }

  let current = initialUsername;
  const visited = new Set<string>();

  for (let hop = 0; hop < 4; hop += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    const path = `${COLLECTION_NAMES.usernames}/${current}`;
    try {
      const snap = await getDoc(doc(db, COLLECTION_NAMES.usernames, current));
      if (!snap.exists()) {
        return null;
      }
      const data = snap.data() as UsernameReservation;
      if (
        data.redirectToUsername &&
        isValidUsername(data.redirectToUsername) &&
        data.redirectToUsername !== current
      ) {
        current = data.redirectToUsername;
        continue;
      }
      return {
        uid: data.ownerUID,
        resolvedUsername: current,
        redirectedFrom: current !== initialUsername ? initialUsername : undefined,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  return null;
}

const foundationSingleFlight = new SingleFlightRegistry();
const PUBLIC_PROJECTION_TTL_MS = 60 * 1000;
const publicProjectionCache = new BoundedLruMap<
  string,
  { projection: PublicProfileProjection | null; fetchedAt: number }
>(250);

registerFoundationProjectionInvalidator({
  invalidateUid: (uid) => {
    if (uid) {
      publicProjectionCache.delete(uid);
    } else {
      publicProjectionCache.clear();
    }
  },
});

export async function fetchMemberProfileBundleByUsername(
  rawUsername: string,
  viewerUid: string | null
): Promise<MemberProfileBundle | null> {
  const flightKey = `profile:${normalizeUsername(rawUsername)}:${viewerUid ?? 'guest'}`;
  return foundationSingleFlight.run(flightKey, async () => {
    const resolved = await resolveUsernameToUidInternal(rawUsername);
    if (!resolved) {
      return null;
    }

  const userPath = `${COLLECTION_NAMES.users}/${resolved.uid}`;
  let profileDoc: PublicUserProfile | null = null;

  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.users, resolved.uid));
    if (!snap.exists()) {
      return null;
    }
    profileDoc = snap.data() as PublicUserProfile;
  } catch (error) {
    // Hidden profiles reject public reads cleanly as unavailable
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'permission-denied'
    ) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!profileDoc) {
    return null;
  }

  if (!isProfileAccessibleByDirectInteraction(profileDoc, viewerUid)) {
    return null;
  }

  const profileProjection = toPublicProfileProjection(profileDoc);
  if (isProfileAccessibleByDirectInteraction(profileDoc)) {
    publicProjectionCache.set(profileDoc.uid, {
      projection: profileProjection,
      fetchedAt: Date.now(),
    });
  }

  const baseCanPublishOrdinaryPosts =
    profileDoc.badge === 'verified' ||
    profileDoc.badge === 'moderator' ||
    profileDoc.badge === 'supreme_admin' ||
    Boolean(profileDoc.isHiddenFromDirectory && profileDoc.hasPublicActivity) ||
    (viewerUid === profileDoc.uid &&
      isDesignatedSupremeAdminUser(auth.currentUser));

  const checkIsFollowing = async (): Promise<boolean> => {
    if (!viewerUid || viewerUid === profileDoc.uid) return false;
    const followId = `${viewerUid}_${profileDoc.uid}`;
    const followPath = `${COLLECTION_NAMES.follows}/${followId}`;
    try {
      const followSnap = await getDoc(doc(db, COLLECTION_NAMES.follows, followId));
      return followSnap.exists();
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, followPath);
    }
  };

  const fetchMemberPosts = async (): Promise<CommunityPost[]> => {
    if (!baseCanPublishOrdinaryPosts) return [];
    const postsPath = COLLECTION_NAMES.posts;
    try {
      const q = query(
        collection(db, COLLECTION_NAMES.posts),
        where('ownerUID', '==', profileDoc.uid),
        where('status', '==', 'published'),
        limit(60)
      );
      const snapshot = await getDocs(q);
      return sortCommunityPosts(
        snapshot.docs.map((item) => item.data() as CommunityPost)
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, postsPath);
    }
  };

  const fetchMemberListings = async (): Promise<MarketplaceListing[]> => {
    const listingsPath = COLLECTION_NAMES.marketplaceListings;
    try {
      const q = query(
        collection(db, COLLECTION_NAMES.marketplaceListings),
        where('ownerUID', '==', profileDoc.uid),
        where('status', '==', 'active'),
        limit(60)
      );
      const snapshot = await getDocs(q);
      const nowMs = Date.now();
      return sortByCreatedAtDesc(
        snapshot.docs
          .map((item) => item.data() as MarketplaceListing)
          .filter((item) => {
            if (item.approvalStatus !== 'approved') return false;
            const expiresMs = extractTimestampMs(item.expiresAt);
            return expiresMs === null || nowMs < expiresMs;
          })
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, listingsPath);
    }
  };

  const [isFollowing, posts, listings, likedPosts] = await Promise.all([
    checkIsFollowing(),
    fetchMemberPosts(),
    fetchMemberListings(),
    fetchLikedOrdinaryPostsByUid(profileDoc.uid).catch(
      () => [] as CommunityPostWithAuthor[]
    ),
  ]);

  const anonymousLikesReceived = Math.max(
    0,
    Math.floor(profileDoc.anonymousLikesReceivedCount ?? 0)
  );
  const totalLikesReceived =
    computeTotalOrdinaryPostLikes(posts) + anonymousLikesReceived;

  return {
    profile: profileProjection,
    resolvedUsername: profileDoc.username,
    redirectedFrom:
      resolved.redirectedFrom ||
      (normalizeUsername(rawUsername) !== profileDoc.username
        ? normalizeUsername(rawUsername)
        : undefined),
    isOwnProfile: viewerUid === profileDoc.uid,
    isFollowing,
    isSuspended: profileDoc.accountStatus === 'suspended',
    canPublishOrdinaryPosts: baseCanPublishOrdinaryPosts || posts.length > 0,
    totalLikesReceived,
    posts,
    likedPosts,
    listings,
  };
  });
}

/**
 * Fetches ONLY public ordinary posts liked by the specified user.
 * Strictly filters targetCollection == 'posts' so anonymous likes never leak.
 */
export async function fetchLikedOrdinaryPostsByUid(
  targetUid: string,
  maxItems = 45
): Promise<CommunityPostWithAuthor[]> {
  if (!isValidFirestoreId(targetUid)) {
    return [];
  }

  const q = query(
    collection(db, COLLECTION_NAMES.postReactions),
    where('ownerUID', '==', targetUid),
    limit(300)
  );
  const reactionSnap = await getDocs(q);
  const reactionEntries = reactionSnap.docs
    .map((item) => item.data() as PostReaction)
    .filter((item) => item.targetCollection === 'posts')
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      return bMs - aMs;
    })
    .slice(0, maxItems);

  const uniquePostIds = Array.from(
    new Set(
      reactionEntries
        .map((entry) => entry.targetId)
        .filter(isValidFirestoreId)
    )
  );
  if (uniquePostIds.length === 0) {
    return [];
  }

  const postSnaps = await Promise.allSettled(
    uniquePostIds.map((postId) => getDoc(doc(db, COLLECTION_NAMES.posts, postId)))
  );

  const posts: CommunityPost[] = [];
  for (const res of postSnaps) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const data = res.value.data() as CommunityPost;
      if (data.status === 'published') {
        posts.push(data);
      }
    }
  }

  const authorMap = await fetchPublicProfileProjectionsByUids(
    posts.map((post) => post.ownerUID)
  );

  return posts.map((post) => ({
    post,
    author: authorMap.get(post.ownerUID) ?? null,
  }));
}

export async function followMemberByUsername(
  actorUid: string,
  targetUsername: string
): Promise<void> {
  if (!isValidFirestoreId(actorUid)) {
    throw new Error('Sign in to follow campus members.');
  }
  const resolved = await resolveUsernameToUidInternal(targetUsername);
  if (!resolved) {
    throw new Error('This member account could not be found.');
  }
  if (resolved.uid === actorUid) {
    throw new Error('You cannot follow your own account.');
  }

  if (
    auth.currentUser?.uid === actorUid &&
    isDesignatedSupremeAdminUser(auth.currentUser)
  ) {
    await ensureDesignatedSupremeAdminAccountState(auth.currentUser);
  }

  const targetUid = resolved.uid;
  const followId = `${actorUid}_${targetUid}`;
  const followRef = doc(db, COLLECTION_NAMES.follows, followId);
  const targetRef = doc(db, COLLECTION_NAMES.users, targetUid);
  const actorRef = doc(db, COLLECTION_NAMES.users, actorUid);
  const isSilentUndergroundActor =
    auth.currentUser?.uid === actorUid &&
    isUndergroundSupremeAdminUser(auth.currentUser);

  let createdFollowNotifId: string | null = null;
  const runFollowTransaction = () =>
    runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        createdFollowNotifId = null;
        const [followSnap, targetSnap, actorSnap] = await Promise.all([
          tx.get(followRef),
          tx.get(targetRef),
          tx.get(actorRef),
        ]);

        if (followSnap.exists()) {
          return;
        }
        if (!targetSnap.exists()) {
          throw new Error('This member account is no longer active.');
        }
        const targetData = targetSnap.data() as PublicUserProfile;
        if (targetData.accountStatus === 'suspended') {
          throw new Error('Suspended accounts cannot be followed.');
        }
        if (!actorSnap.exists()) {
          throw new DomainValidationError(
            'Complete and save your profile in Account Settings before following members.'
          );
        }
        const actorData = actorSnap.data() as PublicUserProfile;
        if (actorData.accountStatus === 'suspended') {
          throw new DomainValidationError(
            'Suspended accounts cannot follow other members.'
          );
        }

        tx.set(followRef, {
          followerUid: actorUid,
          targetUid,
          createdAt: serverTimestamp(),
        });

        tx.update(targetRef, {
          followersCount: (targetData.followersCount ?? 0) + 1,
          updatedAt: serverTimestamp(),
        });

        tx.update(actorRef, {
          followingCount: (actorData.followingCount ?? 0) + 1,
          updatedAt: serverTimestamp(),
        });

        const safeActorName = (actorData.fullName?.trim() || 'Campus Member').slice(0, 100);
        const safeActorUsername = (actorData.username?.trim() || 'member').slice(0, 32);
        const notifId = doc(collection(db, COLLECTION_NAMES.notifications)).id;
        const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);
        const notifPayload: Record<string, unknown> = isSilentUndergroundActor
          ? {
              id: notifId,
              recipientUid: targetUid,
              eventType: 'follow',
              title: 'New campus follower',
              body: 'Someone started following your campus updates.',
              isRead: false,
              createdAt: serverTimestamp(),
            }
          : {
              id: notifId,
              recipientUid: targetUid,
              eventType: 'follow',
              title: `${safeActorName} started following you`.slice(0, 160),
              body: `@${safeActorUsername} is now following your campus profile.`.slice(0, 500),
              targetPath: `/?view=profile&username=${safeActorUsername}`.slice(0, 256),
              actorUid,
              actorUsername: safeActorUsername,
              actorName: safeActorName,
              isRead: false,
              createdAt: serverTimestamp(),
            };
        if (!isSilentUndergroundActor) {
          if (actorData.photoImageId && isValidFirestoreId(actorData.photoImageId)) {
            notifPayload.actorPhotoImageId = actorData.photoImageId;
          } else if (actorData.photoUrl && isSafeMediaUrl(actorData.photoUrl)) {
            notifPayload.actorPhotoUrl = actorData.photoUrl.slice(0, 512);
          }
        }
        tx.set(notifRef, notifPayload);
        createdFollowNotifId = notifId;
      })
    );

  try {
    try {
      await runFollowTransaction();
    } catch (firstErr) {
      if (
        firstErr instanceof DomainValidationError &&
        auth.currentUser?.uid === actorUid &&
        isDesignatedSupremeAdminUser(auth.currentUser)
      ) {
        await ensureDesignatedSupremeAdminAccountState(auth.currentUser);
        await runFollowTransaction();
      } else {
        throw firstErr;
      }
    }
    notifyFollowToggled({ targetUsername, following: true });
    if (createdFollowNotifId) {
      void triggerBestEffortPushDispatch({
        notificationId: createdFollowNotifId,
        recipientUid: targetUid,
      });
    }
  } catch (error) {
    if (error instanceof DomainValidationError || (error instanceof Error && !('code' in error))) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.follows}/${followId}`
    );
  }
}

export async function unfollowMemberByUsername(
  actorUid: string,
  targetUsername: string
): Promise<void> {
  if (!isValidFirestoreId(actorUid)) {
    throw new Error('Sign in to manage followed accounts.');
  }
  const resolved = await resolveUsernameToUidInternal(targetUsername);
  if (!resolved) {
    throw new Error('This member account could not be found.');
  }
  if (resolved.uid === actorUid) {
    return;
  }

  const targetUid = resolved.uid;
  const followId = `${actorUid}_${targetUid}`;
  const followRef = doc(db, COLLECTION_NAMES.follows, followId);
  const targetRef = doc(db, COLLECTION_NAMES.users, targetUid);
  const actorRef = doc(db, COLLECTION_NAMES.users, actorUid);

  try {
    await runWithFirestoreConnectionRetry(() =>
      runTransaction(db, async (tx) => {
        const [followSnap, targetSnap, actorSnap] = await Promise.all([
        tx.get(followRef),
        tx.get(targetRef),
        tx.get(actorRef),
      ]);

      if (!followSnap.exists()) {
        return;
      }

      tx.delete(followRef);

      if (targetSnap.exists()) {
        const targetData = targetSnap.data() as PublicUserProfile;
        if ((targetData.followersCount ?? 0) > 0) {
          tx.update(targetRef, {
            followersCount: targetData.followersCount - 1,
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (actorSnap.exists()) {
        const actorData = actorSnap.data() as PublicUserProfile;
        if ((actorData.followingCount ?? 0) > 0) {
          tx.update(actorRef, {
            followingCount: actorData.followingCount - 1,
            updatedAt: serverTimestamp(),
          });
        }
        }
      })
    );
    notifyFollowToggled({ targetUsername, following: false });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.follows}/${followId}`
    );
  }
}

export async function fetchPublicProfileProjectionsByUids(
  uids: string[]
): Promise<Map<string, PublicProfileProjection>> {
  const uniqueUids = Array.from(new Set(uids.filter(isValidFirestoreId)));
  const result = new Map<string, PublicProfileProjection>();
  if (uniqueUids.length === 0) return result;

  const now = Date.now();
  const missingUids: string[] = [];

  for (const uid of uniqueUids) {
    const cached = publicProjectionCache.get(uid);
    if (cached && now - cached.fetchedAt <= PUBLIC_PROJECTION_TTL_MS) {
      if (cached.projection) {
        result.set(uid, cached.projection);
      }
    } else {
      missingUids.push(uid);
    }
  }

  if (missingUids.length === 0) {
    return result;
  }

  const settled = await Promise.allSettled(
    missingUids.map((uid) =>
      foundationSingleFlight.run(`proj:${uid}`, async () => {
        const snap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
        if (!snap.exists()) {
          publicProjectionCache.set(uid, {
            projection: null,
            fetchedAt: Date.now(),
          });
          return null;
        }
        const profile = snap.data() as PublicUserProfile;
        if (!isProfileAccessibleByDirectInteraction(profile)) {
          publicProjectionCache.set(uid, {
            projection: null,
            fetchedAt: Date.now(),
          });
          return null;
        }
        const projection = toPublicProfileProjection(profile);
        publicProjectionCache.set(uid, {
          projection,
          fetchedAt: Date.now(),
        });
        return { uid, projection };
      })
    )
  );

  for (const entry of settled) {
    if (entry.status === 'fulfilled' && entry.value) {
      result.set(entry.value.uid, entry.value.projection);
    }
  }
  return result;
}

export interface FollowDirectoryPageResult {
  items: PublicProfileProjection[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function fetchFollowDirectoryPage(input: {
  username: string;
  kind: 'followers' | 'following';
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<FollowDirectoryPageResult> {
  const resolved = await resolveUsernameToUidInternal(input.username);
  if (!resolved) {
    return { items: [], nextCursor: null, hasMore: false };
  }
  const pageSize = Math.max(5, Math.min(50, input.pageSize ?? 25));
  const field = input.kind === 'followers' ? 'targetUid' : 'followerUid';

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.follows),
      where(field, '==', resolved.uid),
      ...(input.cursor ? [startAfter(input.cursor)] : []),
      limit(pageSize + 1)
    );
    const snap = await getDocs(q);
    const hasMore = snap.docs.length > pageSize;
    const pageDocs = snap.docs.slice(0, pageSize);
    const nextCursor =
      hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
    const targetUids = pageDocs.map((item) => {
      const edge = item.data() as FollowEdge;
      return input.kind === 'followers' ? edge.followerUid : edge.targetUid;
    });
    const map = await fetchPublicProfileProjectionsByUids(targetUids);
    const items = targetUids
      .map((uid) => map.get(uid))
      .filter((item): item is PublicProfileProjection => Boolean(item));
    return { items, nextCursor, hasMore };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
  }
}

export async function fetchFollowersListByUsername(
  username: string
): Promise<PublicProfileProjection[]> {
  const page = await fetchFollowDirectoryPage({
    username,
    kind: 'followers',
    pageSize: 50,
  });
  return page.items;
}

export async function fetchFollowingListByUsername(
  username: string
): Promise<PublicProfileProjection[]> {
  const page = await fetchFollowDirectoryPage({
    username,
    kind: 'following',
    pageSize: 50,
  });
  return page.items;
}

export async function fetchViewerFollowingUsernames(
  viewerUid: string | null
): Promise<Set<string>> {
  if (!viewerUid || !isValidFirestoreId(viewerUid)) {
    return new Set();
  }

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.follows),
      where('followerUid', '==', viewerUid),
      limit(200)
    );
    const snap = await getDocs(q);
    const targetUids = snap.docs.map(
      (item) => (item.data() as FollowEdge).targetUid
    );
    const profiles = await fetchPublicProfileProjectionsByUids(targetUids);
    return new Set(
      Array.from(profiles.values()).map((profile) =>
        profile.username.toLowerCase()
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
  }
}

export function subscribeViewerFollowUsernames(
  viewerUid: string,
  uidToUsernameCache: Map<string, string>,
  onUpdate: (state: {
    followingUsernames: Set<string>;
    followerUsernames: Set<string>;
  }) => void
): Unsubscribe {
  if (!isValidFirestoreId(viewerUid)) {
    return () => {};
  }

  let active = true;
  let followingUids: string[] = [];
  let followerUids: string[] = [];

  const syncResolvedSets = async () => {
    const missing = Array.from(
      new Set([...followingUids, ...followerUids])
    ).filter((uid) => isValidFirestoreId(uid) && !uidToUsernameCache.has(uid));

    if (missing.length > 0) {
      const profiles = await fetchPublicProfileProjectionsByUids(missing).catch(
        () => new Map<string, PublicProfileProjection>()
      );
      for (const uid of missing) {
        const proj = profiles.get(uid);
        if (proj?.username) {
          uidToUsernameCache.set(uid, proj.username.toLowerCase());
        }
      }
    }

    if (!active) return;

    const followingUsernames = new Set<string>();
    for (const uid of followingUids) {
      const uname = uidToUsernameCache.get(uid);
      if (uname) followingUsernames.add(uname);
    }

    const followerUsernames = new Set<string>();
    for (const uid of followerUids) {
      const uname = uidToUsernameCache.get(uid);
      if (uname) followerUsernames.add(uname);
    }

    onUpdate({ followingUsernames, followerUsernames });
  };

  const unsubFollowing = onSnapshot(
    query(
      collection(db, COLLECTION_NAMES.follows),
      where('followerUid', '==', viewerUid),
      limit(250)
    ),
    (snapshot) => {
      followingUids = snapshot.docs.map(
        (item) => (item.data() as FollowEdge).targetUid
      );
      void syncResolvedSets();
    },
    (error) => {
      if (auth.currentUser?.uid !== viewerUid) {
        return;
      }
      if (isTransientFirestoreConnectionError(error)) {
        console.warn('Following listener paused while reconnecting:', error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
    }
  );

  const unsubFollowers = onSnapshot(
    query(
      collection(db, COLLECTION_NAMES.follows),
      where('targetUid', '==', viewerUid),
      limit(250)
    ),
    (snapshot) => {
      followerUids = snapshot.docs.map(
        (item) => (item.data() as FollowEdge).followerUid
      );
      void syncResolvedSets();
    },
    (error) => {
      if (auth.currentUser?.uid !== viewerUid) {
        return;
      }
      if (isTransientFirestoreConnectionError(error)) {
        console.warn('Followers listener paused while reconnecting:', error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
    }
  );

  return () => {
    active = false;
    unsubFollowing();
    unsubFollowers();
  };
}

export type CommunityFeedCursor =
  | { mode: 'firestore'; docSnap: QueryDocumentSnapshot<DocumentData> }
  | { mode: 'offset'; offset: number };

export interface CommunityFeedPageResult {
  items: CommunityPostWithAuthor[];
  nextCursor: CommunityFeedCursor | null;
  hasMore: boolean;
  followingCount: number;
  followedUids: string[];
}

async function fetchViewerFollowedUidList(viewerUid: string): Promise<string[]> {
  const followsSnap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.follows),
      where('followerUid', '==', viewerUid),
      limit(100)
    )
  );
  return followsSnap.docs
    .map((item) => (item.data() as FollowEdge).targetUid)
    .filter(isValidFirestoreId);
}

async function queryPublishedPostsOrderedPage(
  pageLimit: number,
  cursorSnap?: QueryDocumentSnapshot<DocumentData> | null
): Promise<{
  docs: QueryDocumentSnapshot<DocumentData>[];
  indexed: boolean;
}> {
  const constraints = [
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    ...(cursorSnap ? [startAfter(cursorSnap)] : []),
    limit(pageLimit),
  ];

  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.posts), ...constraints)
    );
    return { docs: snap.docs, indexed: true };
  } catch (error) {
    if (isFirebaseErrorCode(error, 'failed-precondition')) {
      const fallbackSnap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.posts),
          where('status', '==', 'published'),
          limit(150)
        )
      );
      return { docs: fallbackSnap.docs, indexed: false };
    }
    throw error;
  }
}

export async function fetchCommunityFeedPage(input: {
  tab: FeedTabId;
  viewerUid: string | null;
  pageSize?: number;
  cursor?: CommunityFeedCursor | null;
  followedUids?: string[];
  rankingOptions?: Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'>;
}): Promise<CommunityFeedPageResult> {
  const pageSize = Math.max(1, Math.min(30, input.pageSize ?? 12));
  const runFetch = async (): Promise<CommunityFeedPageResult> => {

  try {
    let followedUids = input.followedUids;
    if (input.viewerUid && isValidFirestoreId(input.viewerUid) && !followedUids) {
      followedUids = await fetchViewerFollowedUidList(input.viewerUid).catch(
        () => [] as string[]
      );
    }
    const resolvedFollowedUids = followedUids ?? [];

    if (input.tab === 'following') {
      if (!input.viewerUid || !isValidFirestoreId(input.viewerUid)) {
        return {
          items: [],
          nextCursor: null,
          hasMore: false,
          followingCount: 0,
          followedUids: [],
        };
      }
      if (resolvedFollowedUids.length === 0) {
        return {
          items: [],
          nextCursor: null,
          hasMore: false,
          followingCount: 0,
          followedUids: [],
        };
      }

      const followedSet = new Set(resolvedFollowedUids);

      if (input.cursor?.mode === 'offset') {
        const res = await queryPublishedPostsOrderedPage(150);
        const allMatching = sortLatestCommunityPosts(
          res.docs
            .map((item) => item.data() as CommunityPost)
            .filter((post) => followedSet.has(post.ownerUID))
        );
        const slice = allMatching.slice(
          input.cursor.offset,
          input.cursor.offset + pageSize
        );
        const hasMore = input.cursor.offset + slice.length < allMatching.length;
        const authorMap = await fetchPublicProfileProjectionsByUids(
          slice.map((p) => p.ownerUID)
        );
        return {
          items: slice
            .map((post) => ({ post, author: authorMap.get(post.ownerUID) ?? null }))
            .filter((entry) => !entry.author || entry.author.accountStatus !== 'suspended'),
          nextCursor: hasMore
            ? { mode: 'offset', offset: input.cursor.offset + slice.length }
            : null,
          hasMore,
          followingCount: resolvedFollowedUids.length,
          followedUids: resolvedFollowedUids,
        };
      }

      // Scan Firestore chronologically in bounded chunks until we gather a page of followed posts
      const collected: { docSnap: QueryDocumentSnapshot<DocumentData>; post: CommunityPost }[] = [];
      let scanCursor = input.cursor?.mode === 'firestore' ? input.cursor.docSnap : null;
      let reachedCollectionEnd = false;
      let indexedMode = true;

      for (let round = 0; round < 3; round += 1) {
        const batchSize = Math.max(pageSize * 2, 24);
        const res = await queryPublishedPostsOrderedPage(batchSize, scanCursor);
        if (!res.indexed) {
          indexedMode = false;
          const allMatching = sortLatestCommunityPosts(
            res.docs
              .map((item) => item.data() as CommunityPost)
              .filter((post) => followedSet.has(post.ownerUID))
          );
          const slice = allMatching.slice(0, pageSize);
          const hasMore = slice.length < allMatching.length;
          const authorMap = await fetchPublicProfileProjectionsByUids(
            slice.map((p) => p.ownerUID)
          );
          return {
            items: slice
              .map((post) => ({ post, author: authorMap.get(post.ownerUID) ?? null }))
              .filter((entry) => !entry.author || entry.author.accountStatus !== 'suspended'),
            nextCursor: hasMore ? { mode: 'offset', offset: slice.length } : null,
            hasMore,
            followingCount: resolvedFollowedUids.length,
            followedUids: resolvedFollowedUids,
          };
        }

        if (res.docs.length === 0) {
          reachedCollectionEnd = true;
          break;
        }

        for (const docSnap of res.docs) {
          const post = docSnap.data() as CommunityPost;
          if (followedSet.has(post.ownerUID)) {
            collected.push({ docSnap, post });
            if (collected.length > pageSize) break;
          }
          scanCursor = docSnap;
        }

        if (collected.length > pageSize || res.docs.length < batchSize) {
          if (res.docs.length < batchSize) {
            reachedCollectionEnd = true;
          }
          break;
        }
      }

      const pageEntries = collected.slice(0, pageSize);
      const hasMore = indexedMode && (collected.length > pageSize || !reachedCollectionEnd);
      const lastDoc =
        pageEntries.length > 0
          ? pageEntries[pageEntries.length - 1].docSnap
          : scanCursor;
      const authorMap = await fetchPublicProfileProjectionsByUids(
        pageEntries.map((entry) => entry.post.ownerUID)
      );

      return {
        items: pageEntries
          .map((entry) => ({
            post: entry.post,
            author: authorMap.get(entry.post.ownerUID) ?? null,
          }))
          .filter((entry) => !entry.author || entry.author.accountStatus !== 'suspended'),
        nextCursor: hasMore && lastDoc ? { mode: 'firestore', docSnap: lastDoc } : null,
        hasMore,
        followingCount: resolvedFollowedUids.length,
        followedUids: resolvedFollowedUids,
      };
    }

    // 'latest' or 'for-you'
    if (input.cursor?.mode === 'offset') {
      const res = await queryPublishedPostsOrderedPage(150);
      const allPosts = res.docs.map((item) => item.data() as CommunityPost);
      const allAuthorMap =
        input.tab === 'for-you'
          ? await fetchPublicProfileProjectionsByUids(
              allPosts.map((p) => p.ownerUID)
            )
          : null;
      const ordered =
        input.tab === 'latest'
          ? sortLatestCommunityPosts(allPosts)
          : rankForYouCommunityPosts(allPosts, {
              ...input.rankingOptions,
              followedUids: new Set(resolvedFollowedUids),
              authorMap: allAuthorMap ?? undefined,
            });
      const slice = ordered.slice(
        input.cursor.offset,
        input.cursor.offset + pageSize
      );
      const hasMore = input.cursor.offset + slice.length < ordered.length;
      const authorMap =
        allAuthorMap ??
        (await fetchPublicProfileProjectionsByUids(
          slice.map((p) => p.ownerUID)
        ));
      return {
        items: slice.map((post) => ({
          post,
          author: authorMap.get(post.ownerUID) ?? null,
        })),
        nextCursor: hasMore
          ? { mode: 'offset', offset: input.cursor.offset + slice.length }
          : null,
        hasMore,
        followingCount: resolvedFollowedUids.length,
        followedUids: resolvedFollowedUids,
      };
    }

    const cursorSnap =
      input.cursor?.mode === 'firestore' ? input.cursor.docSnap : null;
    const res = await queryPublishedPostsOrderedPage(pageSize + 1, cursorSnap);

    if (!res.indexed) {
      const allPosts = res.docs.map((item) => item.data() as CommunityPost);
      const allAuthorMap =
        input.tab === 'for-you'
          ? await fetchPublicProfileProjectionsByUids(
              allPosts.map((p) => p.ownerUID)
            )
          : null;
      const ordered =
        input.tab === 'latest'
          ? sortLatestCommunityPosts(allPosts)
          : rankForYouCommunityPosts(allPosts, {
              ...input.rankingOptions,
              followedUids: new Set(resolvedFollowedUids),
              authorMap: allAuthorMap ?? undefined,
            });
      const slice = ordered.slice(0, pageSize);
      const hasMore = slice.length < ordered.length;
      const authorMap =
        allAuthorMap ??
        (await fetchPublicProfileProjectionsByUids(
          slice.map((p) => p.ownerUID)
        ));
      return {
        items: slice.map((post) => ({
          post,
          author: authorMap.get(post.ownerUID) ?? null,
        })),
        nextCursor: hasMore ? { mode: 'offset', offset: slice.length } : null,
        hasMore,
        followingCount: resolvedFollowedUids.length,
        followedUids: resolvedFollowedUids,
      };
    }

    const hasMore = res.docs.length > pageSize;
    const pageDocs = res.docs.slice(0, pageSize);
    const rawPosts = pageDocs.map((item) => item.data() as CommunityPost);
    const authorMap = await fetchPublicProfileProjectionsByUids(
      rawPosts.map((post) => post.ownerUID)
    );
    const orderedPosts =
      input.tab === 'latest'
        ? sortLatestCommunityPosts(rawPosts)
        : rankForYouCommunityPosts(rawPosts, {
            ...input.rankingOptions,
            followedUids: new Set(resolvedFollowedUids),
            authorMap,
          });
    const lastDocSnap = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

    return {
      items: orderedPosts.map((post) => ({
        post,
        author: authorMap.get(post.ownerUID) ?? null,
      })),
      nextCursor:
        hasMore && lastDocSnap
          ? { mode: 'firestore', docSnap: lastDocSnap }
          : null,
      hasMore,
      followingCount: resolvedFollowedUids.length,
      followedUids: resolvedFollowedUids,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.posts);
  }
  };

  if (!input.cursor) {
    const flightKey = `feed:${input.tab}:${input.viewerUid ?? 'guest'}:${pageSize}`;
    return foundationSingleFlight.run(flightKey, runFetch);
  }
  return runFetch();
}

export async function fetchPublicCommunityFeed(
  maxItems = 15
): Promise<CommunityPost[]> {
  const path = COLLECTION_NAMES.posts;
  try {
    const res = await queryPublishedPostsOrderedPage(Math.max(maxItems, 40));
    return sortLatestCommunityPosts(
      res.docs.map((item) => item.data() as CommunityPost)
    ).slice(0, maxItems);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchPublicCommunityFeedWithAuthors(
  maxItems = 20
): Promise<CommunityPostWithAuthor[]> {
  const posts = await fetchPublicCommunityFeed(maxItems);
  const authorMap = await fetchPublicProfileProjectionsByUids(
    posts.map((post) => post.ownerUID)
  );
  return posts.map((post) => ({
    post,
    author: authorMap.get(post.ownerUID) ?? null,
  }));
}

export async function fetchFollowingFeedPosts(
  viewerUid: string,
  maxItems = 25
): Promise<{
  followingCount: number;
  items: CommunityPostWithAuthor[];
}> {
  const res = await fetchCommunityFeedPage({
    tab: 'following',
    viewerUid,
    pageSize: maxItems,
  });
  return {
    followingCount: res.followingCount,
    items: res.items,
  };
}

export type AnonymousFeedPageCursor =
  | { mode: 'firestore'; docSnap: QueryDocumentSnapshot<DocumentData> }
  | { mode: 'offset'; offset: number };

export interface AnonymousFeedPageResult {
  items: AnonymousPost[];
  nextCursor: AnonymousFeedPageCursor | null;
  hasMore: boolean;
}

export async function fetchPublicAnonymousFeedPage(
  options: {
    pageSize?: number;
    cursor?: AnonymousFeedPageCursor | null;
  } = {}
): Promise<AnonymousFeedPageResult> {
  const path = COLLECTION_NAMES.anonymousPosts;
  const pageSize = Math.max(1, Math.min(30, options.pageSize ?? 12));
  const runFetch = async (): Promise<AnonymousFeedPageResult> => {

  try {
    if (options.cursor?.mode === 'offset') {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousPosts),
          where('status', '==', 'published'),
          limit(150)
        )
      );
      const sorted = sortByCreatedAtDesc(
        snap.docs.map((item) => item.data() as AnonymousPost)
      );
      const slice = sorted.slice(
        options.cursor.offset,
        options.cursor.offset + pageSize
      );
      const hasMore = options.cursor.offset + slice.length < sorted.length;
      return {
        items: slice,
        nextCursor: hasMore
          ? { mode: 'offset', offset: options.cursor.offset + slice.length }
          : null,
        hasMore,
      };
    }

    const cursorSnap =
      options.cursor?.mode === 'firestore' ? options.cursor.docSnap : null;

    try {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousPosts),
          where('status', '==', 'published'),
          orderBy('createdAt', 'desc'),
          ...(cursorSnap ? [startAfter(cursorSnap)] : []),
          limit(pageSize + 1)
        )
      );
      const hasMore = snap.docs.length > pageSize;
      const pageDocs = snap.docs.slice(0, pageSize);
      const lastDoc =
        pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
      return {
        items: pageDocs.map((item) => item.data() as AnonymousPost),
        nextCursor:
          hasMore && lastDoc ? { mode: 'firestore', docSnap: lastDoc } : null,
        hasMore,
      };
    } catch (innerError) {
      if (!isFirebaseErrorCode(innerError, 'failed-precondition')) {
        throw innerError;
      }
      const fallbackSnap = await getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousPosts),
          where('status', '==', 'published'),
          limit(150)
        )
      );
      const sorted = sortByCreatedAtDesc(
        fallbackSnap.docs.map((item) => item.data() as AnonymousPost)
      );
      const slice = sorted.slice(0, pageSize);
      const hasMore = slice.length < sorted.length;
      return {
        items: slice,
        nextCursor: hasMore ? { mode: 'offset', offset: slice.length } : null,
        hasMore,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
  };

  if (!options.cursor) {
    return foundationSingleFlight.run(`anon:${pageSize}`, runFetch);
  }
  return runFetch();
}

export async function fetchPublicAnonymousFeed(
  maxItems = 15
): Promise<AnonymousPost[]> {
  const res = await fetchPublicAnonymousFeedPage({ pageSize: maxItems });
  return res.items;
}

export async function searchHomeScope(
  rawQuery: string
): Promise<HomeSearchResult> {
  try {
    const [usersSnap, postsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.users),
          where('isHiddenFromDirectory', '==', false),
          limit(80)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.posts),
          where('status', '==', 'published'),
          limit(60)
        )
      ),
    ]);

    const userProfiles = usersSnap.docs.map(
      (item) => item.data() as PublicUserProfile
    );
    const userMap = new Map<string, PublicProfileProjection>();
    for (const profile of userProfiles) {
      if (!profile.isHiddenFromDirectory && profile.accountStatus !== 'suspended') {
        userMap.set(profile.uid, toPublicProfileProjection(profile));
      }
    }

    const members = filterMemberMatches(userProfiles, rawQuery).slice(0, 20);
    const postItems: SearchableCommunityPostItem[] = postsSnap.docs.map((item) => {
      const post = item.data() as CommunityPost;
      return {
        post,
        author: userMap.get(post.ownerUID) ?? null,
      };
    });

    const posts = filterCommunityPosts(postItems, rawQuery).slice(0, 20);
    return { members, posts };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.users);
  }
}

export async function searchAnonymousScope(
  rawQuery: string
): Promise<AnonymousPost[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.anonymousPosts),
        where('status', '==', 'published'),
        limit(80)
      )
    );
    const rawDocs = snap.docs.map(
      (item) => item.data() as Record<string, unknown>
    );
    return filterAnonymousPosts(rawDocs, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.anonymousPosts
    );
  }
}

export async function searchMarketplaceScope(
  rawQuery: string
): Promise<MarketplaceListing[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.marketplaceListings),
        where('status', '==', 'active'),
        limit(80)
      )
    );
    const listings = snap.docs.map((item) => item.data() as MarketplaceListing);
    return filterMarketplaceListings(listings, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.marketplaceListings
    );
  }
}

export async function searchTrustedCircleScope(
  rawQuery: string
): Promise<TrustedContact[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.trustedContacts), limit(80))
    );
    const contacts = snap.docs.map((item) => item.data() as TrustedContact);
    return filterTrustedContacts(contacts, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.trustedContacts
    );
  }
}

export async function searchOpportunitiesScope(
  rawQuery: string
): Promise<Opportunity[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.opportunities),
        where('status', '==', 'active'),
        limit(80)
      )
    );
    const opportunities = snap.docs.map((item) => item.data() as Opportunity);
    return filterOpportunities(opportunities, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.opportunities
    );
  }
}

export async function searchEventsScope(
  rawQuery: string
): Promise<CampusEvent[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.events),
        where('published', '==', true),
        limit(80)
      )
    );
    const events = snap.docs.map((item) => item.data() as CampusEvent);
    return filterCampusEvents(events, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.events);
  }
}

const INITIAL_NOTIFICATION_PAGE_SIZE = 150;

export interface NotificationSubscriptionSnapshot {
  items: NotificationItem[];
  oldestDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function fetchPrivateUserData(
  uid: string
): Promise<PrivateUserData | null> {
  if (!isValidFirestoreId(uid)) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION_NAMES.privateUserData, uid));
    return snap.exists() ? (snap.data() as PrivateUserData) : null;
  } catch (error) {
    if (isFirebaseErrorCode(error, 'permission-denied')) {
      return null;
    }
    handleFirestoreError(
      error,
      OperationType.GET,
      `${COLLECTION_NAMES.privateUserData}/${uid}`
    );
  }
}

export async function updateNotificationPreferences(
  uid: string,
  prefs: NotificationPreferences,
  fallbackEmail?: string | null
): Promise<NotificationPreferences> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Sign in to update notification preferences.');
  }
  const normalized = normalizeNotificationPrefs(prefs);
  const ref = doc(db, COLLECTION_NAMES.privateUserData, uid);
  const path = `${COLLECTION_NAMES.privateUserData}/${uid}`;
  const resolvedEmail =
    fallbackEmail?.trim() || auth.currentUser?.email?.trim() || '';
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await runWithFirestoreConnectionRetry(() =>
        updateDoc(ref, {
          notificationPrefs: normalized,
          updatedAt: serverTimestamp(),
        })
      );
    } else if (resolvedEmail.length >= 3) {
      await runWithFirestoreConnectionRetry(() =>
        setDoc(ref, {
          uid,
          authEmail: resolvedEmail.slice(0, 160),
          notificationPrefs: normalized,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      throw new Error(
        'Initialize your member profile before saving notification preferences.'
      );
    }
    return normalized;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updatePrivateUserInterests(
  uid: string,
  interests: readonly string[],
  fallbackEmail?: string | null
): Promise<string[]> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Sign in to customise your feed topics.');
  }
  const normalized = normalizeInterestList(interests);
  const ref = doc(db, COLLECTION_NAMES.privateUserData, uid);
  const path = `${COLLECTION_NAMES.privateUserData}/${uid}`;
  const resolvedEmail =
    fallbackEmail?.trim() || auth.currentUser?.email?.trim() || '';
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await runWithFirestoreConnectionRetry(() =>
        updateDoc(ref, {
          interestCategories: normalized,
          updatedAt: serverTimestamp(),
        })
      );
    } else if (resolvedEmail.length >= 3) {
      await runWithFirestoreConnectionRetry(() =>
        setDoc(ref, {
          uid,
          authEmail: resolvedEmail.slice(0, 160),
          interestCategories: normalized,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      throw new Error('Initialize your member profile before saving feed topics.');
    }
    return normalized;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserNotifications(
  uid: string,
  onUpdate: (snapshot: NotificationSubscriptionSnapshot) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const path = COLLECTION_NAMES.notifications;
  let activeUnsubscribe: Unsubscribe = () => {};
  let disposed = false;

  const subscribeFallback = () => {
    if (disposed) return;
    const fallbackQuery = query(
      collection(db, COLLECTION_NAMES.notifications),
      where('recipientUid', '==', uid),
      limit(200)
    );
    activeUnsubscribe = onSnapshot(
      fallbackQuery,
      (snapshot) => {
        const sorted = sortByCreatedAtDesc(
          snapshot.docs.map((item) => item.data() as NotificationItem)
        ).slice(0, INITIAL_NOTIFICATION_PAGE_SIZE);
        onUpdate({
          items: sorted,
          oldestDoc: null,
          hasMore: false,
        });
      },
      (error) => {
        onError?.(
          error instanceof Error
            ? error
            : new Error('Unable to listen for live notifications.')
        );
      }
    );
  };

  const orderedQuery = query(
    collection(db, COLLECTION_NAMES.notifications),
    where('recipientUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(INITIAL_NOTIFICATION_PAGE_SIZE + 1)
  );

  activeUnsubscribe = onSnapshot(
    orderedQuery,
    (snapshot) => {
      const hasMore = snapshot.docs.length > INITIAL_NOTIFICATION_PAGE_SIZE;
      const pageDocs = snapshot.docs.slice(0, INITIAL_NOTIFICATION_PAGE_SIZE);
      onUpdate({
        items: pageDocs.map((item) => item.data() as NotificationItem),
        oldestDoc: pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null,
        hasMore,
      });
    },
    (error) => {
      if (isFirebaseErrorCode(error, 'failed-precondition')) {
        subscribeFallback();
        return;
      }
      onError?.(
        error instanceof Error
          ? error
          : new Error('Unable to sync notifications.')
      );
      if (!isFirebaseErrorCode(error, 'permission-denied')) {
        console.warn('Notification subscription warning:', path, error);
      }
    }
  );

  return () => {
    disposed = true;
    activeUnsubscribe();
  };
}

export async function fetchOlderUserNotificationsPage(
  uid: string,
  cursorDoc: QueryDocumentSnapshot<DocumentData> | null,
  pageSize = 30
): Promise<{
  items: NotificationItem[];
  oldestDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  if (!isValidFirestoreId(uid) || !cursorDoc) {
    return { items: [], oldestDoc: null, hasMore: false };
  }
  const safeSize = Math.max(1, Math.min(50, pageSize));
  try {
    const q = query(
      collection(db, COLLECTION_NAMES.notifications),
      where('recipientUid', '==', uid),
      orderBy('createdAt', 'desc'),
      startAfter(cursorDoc),
      limit(safeSize + 1)
    );
    const snap = await getDocs(q);
    const hasMore = snap.docs.length > safeSize;
    const pageDocs = snap.docs.slice(0, safeSize);
    return {
      items: pageDocs.map((item) => item.data() as NotificationItem),
      oldestDoc: pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null,
      hasMore,
    };
  } catch (error) {
    if (isFirebaseErrorCode(error, 'failed-precondition')) {
      return { items: [], oldestDoc: null, hasMore: false };
    }
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.notifications
    );
  }
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<void> {
  if (!isValidFirestoreId(notificationId)) return;
  const path = `${COLLECTION_NAMES.notifications}/${notificationId}`;
  try {
    await runWithFirestoreConnectionRetry(() =>
      updateDoc(doc(db, COLLECTION_NAMES.notifications, notificationId), {
        isRead: true,
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markNotificationAsUnread(
  notificationId: string
): Promise<void> {
  if (!isValidFirestoreId(notificationId)) return;
  const path = `${COLLECTION_NAMES.notifications}/${notificationId}`;
  try {
    await runWithFirestoreConnectionRetry(() =>
      updateDoc(doc(db, COLLECTION_NAMES.notifications, notificationId), {
        isRead: false,
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markAllNotificationsAsRead(
  notifications: readonly NotificationItem[]
): Promise<void> {
  const unreadIds = Array.from(
    new Set(
      notifications
        .filter((item) => !item.isRead && isValidFirestoreId(item.id))
        .map((item) => item.id)
    )
  );
  if (unreadIds.length === 0) return;

  const CHUNK_SIZE = 380;
  try {
    for (let i = 0; i < unreadIds.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const id of unreadIds.slice(i, i + CHUNK_SIZE)) {
        batch.update(doc(db, COLLECTION_NAMES.notifications, id), {
          isRead: true,
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, COLLECTION_NAMES.notifications);
  }
}

export async function deleteUserNotification(
  notificationId: string
): Promise<void> {
  if (!isValidFirestoreId(notificationId)) return;
  const path = `${COLLECTION_NAMES.notifications}/${notificationId}`;
  try {
    await runWithFirestoreConnectionRetry(() =>
      deleteDoc(doc(db, COLLECTION_NAMES.notifications, notificationId))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createSafeMemberNotification(input: {
  id: string;
  recipientUid: string;
  eventType: NotificationEventType;
  title: string;
  body?: string;
  targetPath?: string;
  actorUid?: string | null;
  targetImageId?: string;
  targetImageUrl?: string;
}): Promise<void> {
  if (!isValidFirestoreId(input.id) || !isValidFirestoreId(input.recipientUid)) {
    return;
  }

  const requiresActor =
    input.eventType === 'reaction' ||
    input.eventType === 'comment' ||
    input.eventType === 'reply' ||
    input.eventType === 'mention';

  if (requiresActor) {
    if (
      !shouldEmitActivityNotification({
        actorUid: input.actorUid,
        recipientUid: input.recipientUid,
      })
    ) {
      return;
    }
  } else if (input.actorUid && input.actorUid === input.recipientUid) {
    return;
  }

  try {
    const notifRef = doc(db, COLLECTION_NAMES.notifications, input.id);
    if (auth.currentUser?.uid === input.recipientUid) {
      const existingSnap = await getDoc(notifRef).catch(() => null);
      if (existingSnap?.exists()) {
        return;
      }
    }

    const payload: Record<string, unknown> = {
      id: input.id,
      recipientUid: input.recipientUid,
      eventType: input.eventType,
      title: input.title.trim().slice(0, 160),
      isRead: false,
      createdAt: serverTimestamp(),
    };

    const cleanBody = input.body?.trim().slice(0, 500);
    if (cleanBody) {
      payload.body = cleanBody;
    }
    const cleanTargetPath = input.targetPath?.trim().slice(0, 256);
    if (cleanTargetPath) {
      payload.targetPath = cleanTargetPath;
    }

    const hideUndergroundActor = Boolean(
      input.actorUid &&
        auth.currentUser?.uid === input.actorUid &&
        isUndergroundSupremeAdminUser(auth.currentUser)
    );

    if (
      !hideUndergroundActor &&
      input.eventType !== 'anonymous_reply' &&
      input.eventType !== 'anonymous_reaction' &&
      input.actorUid &&
      isValidFirestoreId(input.actorUid)
    ) {
      payload.actorUid = input.actorUid;
      try {
        const actorSnap = await getDoc(
          doc(db, COLLECTION_NAMES.users, input.actorUid)
        );
        if (actorSnap.exists()) {
          const actor = actorSnap.data() as PublicUserProfile;
          if (actor.username) {
            payload.actorUsername = actor.username.slice(0, 32);
          }
          if (actor.fullName) {
            payload.actorName = actor.fullName.slice(0, 100);
          }
          if (actor.photoImageId && isValidFirestoreId(actor.photoImageId)) {
            payload.actorPhotoImageId = actor.photoImageId;
          } else if (actor.photoUrl && isSafeMediaUrl(actor.photoUrl)) {
            payload.actorPhotoUrl = actor.photoUrl.slice(0, 512);
          }
        }
      } catch {
        // Actor hydration is non-blocking; actorUid remains attached
      }
    }

    if (input.targetImageId && isValidFirestoreId(input.targetImageId)) {
      payload.targetImageId = input.targetImageId;
    } else if (input.targetImageUrl && isSafeMediaUrl(input.targetImageUrl)) {
      payload.targetImageUrl = input.targetImageUrl.slice(0, 512);
    }

    await setDoc(notifRef, payload);
    void triggerBestEffortPushDispatch({
      notificationId: input.id,
      recipientUid: input.recipientUid,
    });
  } catch (error) {
    if (
      !isFirebaseErrorCode(error, 'permission-denied') &&
      !isFirebaseErrorCode(error, 'already-exists')
    ) {
      console.warn('Background notification write skipped:', error);
    }
  }
}

function readSyncedIdCache(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSyncedIdCache(storageKey: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Array.from(ids).slice(-250);
    window.localStorage.setItem(storageKey, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

function readLikeCountBaselineMap(storageKey: string): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        result[key] = Math.max(0, Math.floor(val));
      }
    }
    return result;
  } catch {
    return null;
  }
}

function writeLikeCountBaselineMap(
  storageKey: string,
  map: Record<string, number>
): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(map).slice(-250);
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore storage quota errors
  }
}

export async function syncOwnAnonymousReplyNotifications(
  uid: string,
  existingNotificationIds: ReadonlySet<string>
): Promise<void> {
  if (!isValidFirestoreId(uid)) return;
  const cacheKey = `lasued_intel_synced_anon_notifs_${uid}`;
  const syncedCache = readSyncedIdCache(cacheKey);
  existingNotificationIds.forEach((id) => syncedCache.add(id));

  try {
    const [privateSnap, historySnap, vapidKey] = await Promise.all([
      getDoc(doc(db, COLLECTION_NAMES.privateUserData, uid)),
      getDocs(
        query(
          collection(
            db,
            COLLECTION_NAMES.privateUserData,
            uid,
            SUBCOLLECTION_NAMES.anonymousHistory
          ),
          limit(100)
        )
      ).catch(() => null),
      fetchConfiguredVapidPublicKey().catch(() => null),
    ]);
    const privateData = privateSnap.exists()
      ? (privateSnap.data() as PrivateUserData)
      : null;
    const ownedPostSet = new Set(privateData?.ownedAnonymousPostIds ?? []);
    if (historySnap) {
      for (const item of historySnap.docs) {
        const data = item.data() as { postId?: unknown };
        const candidateId =
          typeof data.postId === 'string' && isValidFirestoreId(data.postId)
            ? data.postId
            : item.id;
        if (isValidFirestoreId(candidateId)) {
          ownedPostSet.add(candidateId);
        }
      }
    }
    const ownedCommentSet = new Set(privateData?.ownedAnonymousCommentIds ?? []);

    if (ownedPostSet.size === 0 && ownedCommentSet.size === 0) {
      return;
    }

    const commentsSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.anonymousComments),
        where('status', '==', 'published'),
        limit(250)
      )
    );

    const candidates: Array<{
      comment: AnonymousComment;
      isDirectReply: boolean;
      isThreadReply: boolean;
    }> = [];
    for (const item of commentsSnap.docs) {
      const comment = item.data() as AnonymousComment;
      if (ownedCommentSet.has(comment.id)) continue;
      const isDirectReply = Boolean(
        (comment.replyToCommentId && ownedCommentSet.has(comment.replyToCommentId)) ||
          (!comment.replyToCommentId &&
            comment.parentCommentId &&
            ownedCommentSet.has(comment.parentCommentId))
      );
      const isThreadReply = Boolean(
        !isDirectReply &&
          comment.parentCommentId &&
          ownedCommentSet.has(comment.parentCommentId)
      );
      const isCommentOnOwnPost = ownedPostSet.has(comment.postId);
      if (!isDirectReply && !isThreadReply && !isCommentOnOwnPost) continue;

      const notifId = buildAnonymousReplyNotificationId(comment.id);
      if (syncedCache.has(notifId)) continue;
      candidates.push({ comment, isDirectReply, isThreadReply });
    }

    for (const candidate of candidates) {
      const notifId = buildAnonymousReplyNotificationId(candidate.comment.id);
      const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);
      try {
        const snap = await getDoc(notifRef).catch(() => null);
        if (snap?.exists()) {
          syncedCache.add(notifId);
          continue;
        }
        const excerpt = summarizeNotificationExcerpt(candidate.comment.body, 140);
        const title = candidate.isDirectReply
          ? 'Someone replied to your anonymous comment'
          : candidate.isThreadReply
            ? 'New reply in your anonymous comment thread'
            : candidate.comment.parentCommentId
              ? 'New reply on your anonymous post'
              : 'New comment on your anonymous post';
        await setDoc(notifRef, {
          id: notifId,
          recipientUid: uid,
          eventType: 'anonymous_reply',
          title,
          ...(excerpt ? { body: excerpt } : {}),
          targetPath: `/?view=anonymous&postId=${candidate.comment.postId}&commentId=${candidate.comment.id}`,
          isRead: false,
          createdAt: serverTimestamp(),
        });
        syncedCache.add(notifId);
        void triggerBestEffortPushDispatch({
          notificationId: notifId,
          recipientUid: uid,
        });
      } catch {
        // Ignore individual duplicate/rule races
      }
    }

    // Client-fallback anonymous reaction sync when server push/Admin SDK is not configured
    if (!vapidKey) {
      const likeCacheKey = `lasued_anon_like_counts_${uid}`;
      const existingBaseline = readLikeCountBaselineMap(likeCacheKey);
      const nextBaseline: Record<string, number> = existingBaseline
        ? { ...existingBaseline }
        : {};
      const shouldEmitIncrements = existingBaseline !== null;

      const ownedPostIds = Array.from(ownedPostSet).slice(0, 60);
      const postSnaps = await Promise.all(
        ownedPostIds.map((postId) =>
          getDoc(doc(db, COLLECTION_NAMES.anonymousPosts, postId)).catch(() => null)
        )
      );

      for (const snap of postSnaps) {
        if (!snap?.exists()) continue;
        const post = snap.data() as AnonymousPost;
        if (post.status !== 'published') continue;
        const currentLikes = Math.max(0, Math.floor(Number(post.likesCount ?? 0)));
        const key = `p_${post.id}`;
        const prevLikes = nextBaseline[key] ?? 0;
        nextBaseline[key] = currentLikes;

        if (shouldEmitIncrements && currentLikes > prevLikes) {
          const notifId = buildAnonymousLikeMilestoneNotificationId(
            'anonymousPosts',
            post.id,
            currentLikes
          );
          if (!syncedCache.has(notifId)) {
            const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);
            try {
              const existingNotif = await getDoc(notifRef).catch(() => null);
              if (!existingNotif?.exists()) {
                const excerpt = summarizeNotificationExcerpt(post.body, 120);
                await setDoc(notifRef, {
                  id: notifId,
                  recipientUid: uid,
                  eventType: 'anonymous_reaction',
                  title: 'Someone liked your anonymous post',
                  ...(excerpt ? { body: excerpt } : {}),
                  targetPath: `/?view=anonymous&postId=${post.id}`,
                  isRead: false,
                  createdAt: serverTimestamp(),
                });
              }
              syncedCache.add(notifId);
            } catch {
              // Ignore rule/duplicate race
            }
          }
        }
      }

      for (const item of commentsSnap.docs) {
        const comment = item.data() as AnonymousComment;
        if (!ownedCommentSet.has(comment.id) || comment.status !== 'published') continue;
        const currentLikes = Math.max(0, Math.floor(Number(comment.likesCount ?? 0)));
        const key = `c_${comment.id}`;
        const prevLikes = nextBaseline[key] ?? 0;
        nextBaseline[key] = currentLikes;

        if (shouldEmitIncrements && currentLikes > prevLikes) {
          const notifId = buildAnonymousLikeMilestoneNotificationId(
            'anonymousComments',
            comment.id,
            currentLikes
          );
          if (!syncedCache.has(notifId)) {
            const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);
            try {
              const existingNotif = await getDoc(notifRef).catch(() => null);
              if (!existingNotif?.exists()) {
                const excerpt = summarizeNotificationExcerpt(comment.body, 120);
                await setDoc(notifRef, {
                  id: notifId,
                  recipientUid: uid,
                  eventType: 'anonymous_reaction',
                  title: 'Someone liked your anonymous comment',
                  ...(excerpt ? { body: excerpt } : {}),
                  targetPath: `/?view=anonymous&postId=${comment.postId}&commentId=${comment.id}`,
                  isRead: false,
                  createdAt: serverTimestamp(),
                });
              }
              syncedCache.add(notifId);
            } catch {
              // Ignore rule/duplicate race
            }
          }
        }
      }

      writeLikeCountBaselineMap(likeCacheKey, nextBaseline);
    }

    writeSyncedIdCache(cacheKey, syncedCache);
  } catch {
    // Non-blocking background sync
  }
}

export async function syncOwnExpiredMarketplaceNotifications(
  uid: string,
  existingNotificationIds: ReadonlySet<string>
): Promise<void> {
  if (!isValidFirestoreId(uid)) return;
  const cacheKey = `lasued_intel_synced_mkt_exp_${uid}`;
  const syncedCache = readSyncedIdCache(cacheKey);
  existingNotificationIds.forEach((id) => syncedCache.add(id));

  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.marketplaceListings),
        where('ownerUID', '==', uid),
        limit(40)
      )
    );
    const nowMs = Date.now();

    for (const item of snap.docs) {
      const listing = item.data() as MarketplaceListing;
      if (listing.approvalStatus !== 'approved') continue;
      const expMs = extractTimestampMs(listing.expiresAt);
      const isExpired =
        listing.status === 'expired' ||
        (listing.status === 'active' &&
          expMs !== null &&
          isMarketplaceListingExpired(expMs, nowMs));
      if (!isExpired) continue;

      const notifId = buildMarketplaceExpiredNotificationId(listing.id);
      if (syncedCache.has(notifId)) continue;

      const notifRef = doc(db, COLLECTION_NAMES.notifications, notifId);
      try {
        const existingSnap = await getDoc(notifRef).catch(() => null);
        if (existingSnap?.exists()) {
          syncedCache.add(notifId);
          continue;
        }
        const payload: Record<string, unknown> = {
          id: notifId,
          recipientUid: uid,
          eventType: 'marketplace_expired',
          title: `Marketplace listing expired: ${listing.title}`.slice(0, 160),
          body: 'Your 7-day Campus Marketplace listing window ended. You can renew it from your listing menu.',
          targetPath: `/?view=marketplace&listingId=${listing.id}`,
          isRead: false,
          createdAt: serverTimestamp(),
        };
        const firstImageId = listing.mediaItems?.[0]?.imageId;
        if (firstImageId && isValidFirestoreId(firstImageId)) {
          payload.targetImageId = firstImageId;
        }
        await setDoc(notifRef, payload);
        syncedCache.add(notifId);
        void triggerBestEffortPushDispatch({
          notificationId: notifId,
          recipientUid: uid,
        });
      } catch {
        // Non-blocking
      }
    }

    writeSyncedIdCache(cacheKey, syncedCache);
  } catch {
    // Non-blocking background sync
  }
}

/**
 * Deletes the authenticated member's own profile, private account data,
 * claimed username reservations, outgoing follows (decrementing target counts),
 * saved posts, and notifications prior to calling Firebase Auth deleteUser().
 */
export async function deleteOwnMemberFirestoreData(uid: string): Promise<void> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Invalid user UID.');
  }

  const privateRef = doc(db, COLLECTION_NAMES.privateUserData, uid);
  const publicRef = doc(db, COLLECTION_NAMES.users, uid);

  const [privateSnap, publicSnap] = await Promise.all([
    getDoc(privateRef),
    getDoc(publicRef),
  ]);

  const usernameCandidates = new Set<string>();
  if (privateSnap.exists()) {
    const pData = privateSnap.data() as PrivateUserData;
    for (const uname of pData.ownedUsernames ?? []) {
      if (isValidUsername(uname)) usernameCandidates.add(uname);
    }
  }
  if (publicSnap.exists()) {
    const uData = publicSnap.data() as PublicUserProfile;
    if (isValidUsername(uData.username)) {
      usernameCandidates.add(uData.username);
    }
  }

  // Clean up outgoing follows atomically with target followersCount decrements
  const outgoingFollowsSnap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.follows),
      where('followerUid', '==', uid),
      limit(100)
    )
  );

  for (const edgeDoc of outgoingFollowsSnap.docs) {
    const edge = edgeDoc.data() as FollowEdge;
    const followRef = doc(db, COLLECTION_NAMES.follows, edgeDoc.id);
    const targetRef = doc(db, COLLECTION_NAMES.users, edge.targetUid);
    await runTransaction(db, async (tx) => {
      const targetSnap = await tx.get(targetRef);
      tx.delete(followRef);
      if (targetSnap.exists()) {
        const targetData = targetSnap.data() as PublicUserProfile;
        if ((targetData.followersCount ?? 0) > 0) {
          tx.update(targetRef, {
            followersCount: targetData.followersCount - 1,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });
  }

  // Delete savedPosts, notifications, and privateUserData subcollections owned by user
  const [savedSnap, notifSnap, anonHistSnap, pushSubSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, COLLECTION_NAMES.savedPosts),
        where('ownerUID', '==', uid),
        limit(100)
      )
    ),
    getDocs(
      query(
        collection(db, COLLECTION_NAMES.notifications),
        where('recipientUid', '==', uid),
        limit(100)
      )
    ),
    getDocs(
      query(
        collection(
          db,
          COLLECTION_NAMES.privateUserData,
          uid,
          SUBCOLLECTION_NAMES.anonymousHistory
        ),
        limit(150)
      )
    ).catch(() => null),
    getDocs(
      query(
        collection(
          db,
          COLLECTION_NAMES.privateUserData,
          uid,
          SUBCOLLECTION_NAMES.pushSubscriptions
        ),
        limit(50)
      )
    ).catch(() => null),
  ]);

  const deleteRefs = [
    ...savedSnap.docs.map((docItem) => docItem.ref),
    ...notifSnap.docs.map((docItem) => docItem.ref),
    ...(anonHistSnap?.docs.map((docItem) => docItem.ref) ?? []),
    ...(pushSubSnap?.docs.map((docItem) => docItem.ref) ?? []),
  ];

  for (const uname of usernameCandidates) {
    const uRef = doc(db, COLLECTION_NAMES.usernames, uname);
    const uSnap = await getDoc(uRef);
    if (uSnap.exists() && (uSnap.data() as UsernameReservation).ownerUID === uid) {
      deleteRefs.push(uRef);
    }
  }

  if (privateSnap.exists()) {
    deleteRefs.push(privateRef);
  }
  if (publicSnap.exists()) {
    deleteRefs.push(publicRef);
  }

  try {
    const CHUNK_SIZE = 380;
    for (let i = 0; i < deleteRefs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const ref of deleteRefs.slice(i, i + CHUNK_SIZE)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.users}/${uid}`
    );
  }
}

export interface CreateAnonymousPostInput {
  postId: string;
  category: string;
  body: string;
  authorUid: string;
  authorRole: UserRole;
}

/**
 * Atomically writes the public anonymous post (with ZERO author identifiers)
 * and the isolated identity mapping doc required by firestore.rules.
 */
export async function createAnonymousPostAtomically(
  input: CreateAnonymousPostInput
): Promise<void> {
  if (!isValidFirestoreId(input.authorUid)) {
    throw new Error('Invalid author UID.');
  }

  const publicDoc: Record<string, unknown> = {
    id: input.postId,
    category: input.category.trim(),
    body: input.body.trim(),
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  validateAnonymousPostPayload(publicDoc);

  const currentUser =
    auth.currentUser?.uid === input.authorUid ? auth.currentUser : null;
  let mappingRole: UserRole;
  try {
    const roleSnap = await getDoc(
      doc(db, COLLECTION_NAMES.userRoles, input.authorUid)
    );
    const rawRoleDoc = roleSnap.exists()
      ? (roleSnap.data() as Partial<UserRoleRecord>)
      : null;
    mappingRole = resolveAuthoritativeMappingRole(
      currentUser,
      rawRoleDoc,
      input.authorRole
    );
  } catch {
    mappingRole = resolveAuthoritativeMappingRole(
      currentUser,
      undefined,
      input.authorRole
    );
  }

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.anonymousPosts, input.postId), publicDoc);
  batch.set(
    doc(db, COLLECTION_NAMES.anonymousIdentityMappings, input.postId),
    {
      entryId: input.postId,
      entryType: 'anonymousPosts',
      authorUid: input.authorUid,
      authorRole: mappingRole,
      createdAt: serverTimestamp(),
    }
  );
  batch.set(
    doc(
      db,
      COLLECTION_NAMES.privateUserData,
      input.authorUid,
      SUBCOLLECTION_NAMES.anonymousHistory,
      input.postId
    ),
    {
      postId: input.postId,
      createdAt: serverTimestamp(),
    }
  );

  const path = `${COLLECTION_NAMES.anonymousPosts}/${input.postId}`;
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function resolveUserUidsByUsernames(
  usernames: readonly string[],
  excludeUids: ReadonlySet<string> = new Set()
): Promise<Array<{ username: string; uid: string }>> {
  const normalized = Array.from(
    new Set(
      usernames
        .map((u) => u.trim().toLowerCase())
        .filter((u) => /^[a-z0-9_]{3,32}$/.test(u))
    )
  ).slice(0, 8);

  if (normalized.length === 0) return [];

  const resolved: Array<{ username: string; uid: string }> = [];
  const seenUids = new Set<string>(excludeUids);

  await Promise.all(
    normalized.map(async (username) => {
      try {
        let currentKey = username;
        for (let hop = 0; hop < 3; hop += 1) {
          const snap = await getDoc(
            doc(db, COLLECTION_NAMES.usernames, currentKey)
          );
          if (!snap.exists()) break;
          const data = snap.data() as {
            ownerUID?: string;
            uid?: string;
            redirectToUsername?: string;
          };
          const resolvedUid = data.ownerUID ?? data.uid;
          if (resolvedUid && isValidFirestoreId(resolvedUid)) {
            if (!seenUids.has(resolvedUid)) {
              seenUids.add(resolvedUid);
              resolved.push({ username, uid: resolvedUid });
            }
            break;
          }
          if (
            data.redirectToUsername &&
            /^[a-z0-9_]{3,32}$/.test(data.redirectToUsername.toLowerCase())
          ) {
            currentKey = data.redirectToUsername.toLowerCase();
            continue;
          }
          break;
        }
      } catch {
        // Non-blocking mention lookup
      }
    })
  );

  return resolved;
}


import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  isSafeMediaUrl,
  isValidFirestoreId,
  isValidUsername,
  validateAnonymousPostPayload,
  type AnonymousPost,
  type BadgeType,
  type CampusEvent,
  type CommunityPost,
  type FollowEdge,
  type MarketplaceListing,
  type NotificationItem,
  type Opportunity,
  type PrivateUserData,
  type PublicProfileProjection,
  type PublicUserProfile,
  type TrustedContact,
  type UserRole,
  type UserRoleRecord,
  type UsernameReservation,
} from '../types/database';
import {
  normalizeUsername,
  toPublicProfileProjection,
  validateProfileSettingsForm,
  validateUsernameCandidate,
  type ProfileSettingsFormInput,
} from '../utils/authValidation';
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
  posts: CommunityPost[];
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
  onRole: (record: UserRoleRecord | null) => void
): Unsubscribe {
  const path = `${COLLECTION_NAMES.userRoles}/${uid}`;
  return onSnapshot(
    doc(db, COLLECTION_NAMES.userRoles, uid),
    (snapshot) => {
      onRole(snapshot.exists() ? (snapshot.data() as UserRoleRecord) : null);
    },
    (error) => {
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
  onProfile: (profile: PublicUserProfile | null) => void
): Unsubscribe {
  const path = `${COLLECTION_NAMES.users}/${uid}`;
  return onSnapshot(
    doc(db, COLLECTION_NAMES.users, uid),
    (snapshot) => {
      onProfile(snapshot.exists() ? (snapshot.data() as PublicUserProfile) : null);
    },
    (error) => {
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

  const publicProfilePayload: Record<string, unknown> = {
    uid: input.uid,
    memberId,
    fullName: normalizedName,
    username: normalizedUsername,
    department: cleanDepartment,
    level: cleanLevel,
    publicWhatsapp: cleanWhatsapp,
    showWhatsappPublicly: true,
    badge: 'none' satisfies BadgeType,
    accountStatus: 'active',
    isHiddenFromDirectory: false,
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

  const privatePayload: Record<string, unknown> = {
    uid: input.uid,
    authEmail: input.authEmail.trim().slice(0, BLUEPRINT_LIMITS.emailMax),
    whatsappNumber: cleanWhatsapp,
    ownedUsernames: [normalizedUsername],
    notificationPrefs: {
      comments: true,
      replies: true,
      anonymousReplies: true,
      opportunities: true,
      events: true,
    },
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

  const validationErrors = validateProfileSettingsForm(input);
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
  const cleanWhatsapp = input.publicWhatsapp
    .trim()
    .slice(0, BLUEPRINT_LIMITS.phoneMax);
  const cleanPhotoUrl = input.photoUrl.trim().slice(0, BLUEPRINT_LIMITS.urlMax);
  const cleanCoverUrl = input.coverUrl.trim().slice(0, BLUEPRINT_LIMITS.urlMax);
  const cleanAuthEmail = authEmail.trim().slice(0, BLUEPRINT_LIMITS.emailMax);

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

      if (!existingPublic) {
        const createPayload: Record<string, unknown> = {
          uid,
          memberId: `LI-${uid.slice(0, 12)}`,
          fullName: cleanFullName,
          username: cleanUsername,
          department: cleanDepartment,
          level: cleanLevel,
          publicWhatsapp: cleanWhatsapp,
          showWhatsappPublicly: true,
          badge: 'none' satisfies BadgeType,
          accountStatus: 'active',
          isHiddenFromDirectory: false,
          followersCount: 0,
          followingCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (cleanBio) createPayload.bio = cleanBio;
        if (cleanFaculty) createPayload.faculty = cleanFaculty;
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
          photoUrl: cleanPhotoUrl,
          coverUrl: cleanCoverUrl,
          publicWhatsapp: cleanWhatsapp,
          showWhatsappPublicly: true,
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
          notificationPrefs: {
            comments: true,
            replies: true,
            anonymousReplies: true,
            opportunities: true,
            events: true,
          },
          updatedAt: serverTimestamp(),
        });
      }
    });

    return { updatedUsername: cleanUsername };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, txPath);
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

export async function fetchMemberProfileBundleByUsername(
  rawUsername: string,
  viewerUid: string | null
): Promise<MemberProfileBundle | null> {
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

  if (profileDoc.isHiddenFromDirectory && viewerUid !== profileDoc.uid) {
    return null;
  }

  const canPublishOrdinaryPosts =
    profileDoc.badge === 'verified' ||
    profileDoc.badge === 'moderator' ||
    profileDoc.badge === 'supreme_admin';

  let isFollowing = false;
  if (viewerUid && viewerUid !== profileDoc.uid) {
    const followId = `${viewerUid}_${profileDoc.uid}`;
    const followPath = `${COLLECTION_NAMES.follows}/${followId}`;
    try {
      const followSnap = await getDoc(doc(db, COLLECTION_NAMES.follows, followId));
      isFollowing = followSnap.exists();
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, followPath);
    }
  }

  let posts: CommunityPost[] = [];
  if (canPublishOrdinaryPosts) {
    const postsPath = COLLECTION_NAMES.posts;
    try {
      const q = query(
        collection(db, COLLECTION_NAMES.posts),
        where('status', '==', 'published'),
        limit(80)
      );
      const snapshot = await getDocs(q);
      posts = sortCommunityPosts(
        snapshot.docs
          .map((item) => item.data() as CommunityPost)
          .filter((item) => item.ownerUID === profileDoc.uid)
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, postsPath);
    }
  }

  let listings: MarketplaceListing[] = [];
  const listingsPath = COLLECTION_NAMES.marketplaceListings;
  try {
    const q = query(
      collection(db, COLLECTION_NAMES.marketplaceListings),
      where('status', '==', 'active'),
      limit(80)
    );
    const snapshot = await getDocs(q);
    const nowMs = Date.now();
    listings = sortByCreatedAtDesc(
      snapshot.docs
        .map((item) => item.data() as MarketplaceListing)
        .filter((item) => {
          if (item.ownerUID !== profileDoc.uid) return false;
          if (item.approvalStatus !== 'approved') return false;
          const expiresMs = extractTimestampMs(item.expiresAt);
          return expiresMs === null || nowMs < expiresMs;
        })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, listingsPath);
  }

  return {
    profile: toPublicProfileProjection(profileDoc),
    resolvedUsername: profileDoc.username,
    redirectedFrom:
      resolved.redirectedFrom ||
      (normalizeUsername(rawUsername) !== profileDoc.username
        ? normalizeUsername(rawUsername)
        : undefined),
    isOwnProfile: viewerUid === profileDoc.uid,
    isFollowing,
    isSuspended: profileDoc.accountStatus === 'suspended',
    canPublishOrdinaryPosts,
    posts,
    listings,
  };
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

  const targetUid = resolved.uid;
  const followId = `${actorUid}_${targetUid}`;
  const followRef = doc(db, COLLECTION_NAMES.follows, followId);
  const targetRef = doc(db, COLLECTION_NAMES.users, targetUid);
  const actorRef = doc(db, COLLECTION_NAMES.users, actorUid);

  try {
    await runTransaction(db, async (tx) => {
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
      if (targetData.accountStatus !== 'active') {
        throw new Error('Suspended accounts cannot be followed.');
      }
      if (!actorSnap.exists()) {
        throw new DomainValidationError(
          'Complete and save your profile in Account Settings before following members.'
        );
      }
      const actorData = actorSnap.data() as PublicUserProfile;
      if (actorData.accountStatus !== 'active') {
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
    });
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
    await runTransaction(db, async (tx) => {
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
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.follows}/${followId}`
    );
  }
}

async function fetchPublicProfileProjectionsByUids(
  uids: string[]
): Promise<Map<string, PublicProfileProjection>> {
  const uniqueUids = Array.from(new Set(uids.filter(isValidFirestoreId)));
  const result = new Map<string, PublicProfileProjection>();
  if (uniqueUids.length === 0) return result;

  const settled = await Promise.allSettled(
    uniqueUids.map(async (uid) => {
      const snap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
      if (!snap.exists()) return null;
      const profile = snap.data() as PublicUserProfile;
      if (profile.isHiddenFromDirectory || profile.accountStatus !== 'active') {
        return null;
      }
      return { uid, projection: toPublicProfileProjection(profile) };
    })
  );

  for (const entry of settled) {
    if (entry.status === 'fulfilled' && entry.value) {
      result.set(entry.value.uid, entry.value.projection);
    }
  }
  return result;
}

export async function fetchFollowersListByUsername(
  username: string
): Promise<PublicProfileProjection[]> {
  const resolved = await resolveUsernameToUidInternal(username);
  if (!resolved) return [];

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.follows),
      where('targetUid', '==', resolved.uid),
      limit(60)
    );
    const snap = await getDocs(q);
    const followerUids = snap.docs.map(
      (item) => (item.data() as FollowEdge).followerUid
    );
    const map = await fetchPublicProfileProjectionsByUids(followerUids);
    return followerUids
      .map((uid) => map.get(uid))
      .filter((item): item is PublicProfileProjection => Boolean(item));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
  }
}

export async function fetchFollowingListByUsername(
  username: string
): Promise<PublicProfileProjection[]> {
  const resolved = await resolveUsernameToUidInternal(username);
  if (!resolved) return [];

  try {
    const q = query(
      collection(db, COLLECTION_NAMES.follows),
      where('followerUid', '==', resolved.uid),
      limit(60)
    );
    const snap = await getDocs(q);
    const targetUids = snap.docs.map(
      (item) => (item.data() as FollowEdge).targetUid
    );
    const map = await fetchPublicProfileProjectionsByUids(targetUids);
    return targetUids
      .map((uid) => map.get(uid))
      .filter((item): item is PublicProfileProjection => Boolean(item));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
  }
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
      limit(100)
    );
    const snap = await getDocs(q);
    const targetUids = snap.docs.map(
      (item) => (item.data() as FollowEdge).targetUid
    );
    const profiles = await fetchPublicProfileProjectionsByUids(targetUids);
    return new Set(
      Array.from(profiles.values()).map((profile) => profile.username)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.follows);
  }
}

export async function fetchPublicCommunityFeed(
  maxItems = 15
): Promise<CommunityPost[]> {
  const path = COLLECTION_NAMES.posts;
  try {
    const q = query(
      collection(db, COLLECTION_NAMES.posts),
      where('status', '==', 'published'),
      limit(Math.max(maxItems, 40))
    );
    const snapshot = await getDocs(q);
    return sortCommunityPosts(
      snapshot.docs.map((item) => item.data() as CommunityPost)
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
  if (!isValidFirestoreId(viewerUid)) {
    return { followingCount: 0, items: [] };
  }

  try {
    const followsSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.follows),
        where('followerUid', '==', viewerUid),
        limit(100)
      )
    );
    const followedUids = followsSnap.docs.map(
      (item) => (item.data() as FollowEdge).targetUid
    );

    if (followedUids.length === 0) {
      return { followingCount: 0, items: [] };
    }

    const followedSet = new Set(followedUids);
    const postsSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.posts),
        where('status', '==', 'published'),
        limit(100)
      )
    );

    const matchingPosts = sortByCreatedAtDesc(
      postsSnap.docs
        .map((item) => item.data() as CommunityPost)
        .filter((post) => followedSet.has(post.ownerUID))
    ).slice(0, maxItems);

    const authorMap = await fetchPublicProfileProjectionsByUids(
      matchingPosts.map((post) => post.ownerUID)
    );

    return {
      followingCount: followedUids.length,
      items: matchingPosts
        .map((post) => ({
          post,
          author: authorMap.get(post.ownerUID) ?? null,
        }))
        .filter((entry) => !entry.author || entry.author.accountStatus === 'active'),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.posts);
  }
}

export async function fetchPublicAnonymousFeed(
  maxItems = 15
): Promise<AnonymousPost[]> {
  const path = COLLECTION_NAMES.anonymousPosts;
  try {
    const q = query(
      collection(db, COLLECTION_NAMES.anonymousPosts),
      where('status', '==', 'published'),
      limit(Math.max(maxItems, 40))
    );
    const snapshot = await getDocs(q);
    return sortByCreatedAtDesc(
      snapshot.docs.map((item) => item.data() as AnonymousPost)
    ).slice(0, maxItems);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
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
      if (!profile.isHiddenFromDirectory && profile.accountStatus === 'active') {
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
      query(collection(db, COLLECTION_NAMES.events), limit(80))
    );
    const events = snap.docs.map((item) => item.data() as CampusEvent);
    return filterCampusEvents(events, rawQuery).slice(0, 25);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.events);
  }
}

export function subscribeUserNotifications(
  uid: string,
  onItems: (items: NotificationItem[]) => void
): Unsubscribe {
  const path = COLLECTION_NAMES.notifications;
  const q = query(
    collection(db, COLLECTION_NAMES.notifications),
    where('recipientUid', '==', uid),
    limit(40)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onItems(
        sortByCreatedAtDesc(
          snapshot.docs.map((item) => item.data() as NotificationItem)
        ).slice(0, 25)
      );
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
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

  // Delete savedPosts and notifications owned by user
  const [savedSnap, notifSnap] = await Promise.all([
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
  ]);

  const batch = writeBatch(db);

  for (const docItem of savedSnap.docs) {
    batch.delete(docItem.ref);
  }
  for (const docItem of notifSnap.docs) {
    batch.delete(docItem.ref);
  }

  for (const uname of usernameCandidates) {
    const uRef = doc(db, COLLECTION_NAMES.usernames, uname);
    const uSnap = await getDoc(uRef);
    if (uSnap.exists() && (uSnap.data() as UsernameReservation).ownerUID === uid) {
      batch.delete(uRef);
    }
  }

  if (privateSnap.exists()) {
    batch.delete(privateRef);
  }
  if (publicSnap.exists()) {
    batch.delete(publicRef);
  }

  try {
    await batch.commit();
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

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.anonymousPosts, input.postId), publicDoc);
  batch.set(
    doc(db, COLLECTION_NAMES.anonymousIdentityMappings, input.postId),
    {
      entryId: input.postId,
      entryType: 'anonymousPosts',
      authorUid: input.authorUid,
      authorRole: input.authorRole,
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

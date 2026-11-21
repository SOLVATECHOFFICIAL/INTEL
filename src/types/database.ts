export type UserRole =
  | 'owner'
  | 'supreme_admin'
  | 'moderator'
  | 'verified'
  | 'member';

export type BadgeType = 'none' | 'verified' | 'moderator' | 'supreme_admin';

export type AccountStatus = 'active' | 'suspended';

export type PostStatus = 'published' | 'deleted';

export type MarketplaceListingKind = 'product' | 'service' | 'accommodation';

export type MarketplaceApprovalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected';

export type MarketplaceStatus =
  | 'pending_approval'
  | 'active'
  | 'sold'
  | 'expired'
  | 'rejected';

export type TrustedContactCategory =
  | 'lecturer'
  | 'department_rep'
  | 'faculty_president'
  | 'class_rep'
  | 'departmental_executive'
  | 'student_union_rep';

export type OpportunityCategory =
  | 'scholarship'
  | 'internship'
  | 'job'
  | 'competition'
  | 'grant'
  | 'training'
  | 'programme';

export type CampusEventStatus = 'upcoming' | 'past' | 'cancelled';

export type ReactionType = 'like' | 'insightful' | 'support';

export type NotificationEventType =
  | 'comment'
  | 'reply'
  | 'anonymous_reply'
  | 'reaction'
  | 'marketplace_approved'
  | 'marketplace_rejected'
  | 'marketplace_expired'
  | 'new_opportunity'
  | 'new_event'
  | 'badge_change'
  | 'account_change'
  | 'announcement';

/**
 * Synchronized verbatim with firebase-blueprint.json & firestore.rules.
 */
export const BLUEPRINT_PATTERNS = {
  id: /^[a-zA-Z0-9_-]+$/,
  username: /^[a-z0-9_]+$/,
} as const;

export const BLUEPRINT_LIMITS = {
  idMin: 1,
  idMax: 128,
  memberIdMin: 4,
  memberIdMax: 32,
  fullNameMin: 2,
  fullNameMax: 100,
  trustedContactNameMax: 120,
  usernameMin: 3,
  usernameMax: 32,
  bioMax: 500,
  departmentMax: 120,
  facultyMax: 120,
  levelMax: 32,
  urlMax: 512,
  emailMax: 160,
  phoneMax: 24,
  categoryMin: 2,
  categoryMax: 64,
  postTitleMax: 180,
  postBodyMin: 1,
  postBodyMax: 5000,
  anonymousBodyMin: 1,
  anonymousBodyMax: 3000,
  commentBodyMin: 1,
  commentBodyMax: 1500,
  marketplaceTitleMin: 3,
  marketplaceTitleMax: 140,
  marketplaceDescMin: 5,
  marketplaceDescMax: 3000,
  marketplaceWhatsappMin: 7,
  marketplaceWhatsappMax: 24,
  mediaMaxCount: 6,
  opportunityTitleMin: 3,
  opportunityTitleMax: 180,
  organisationMin: 2,
  organisationMax: 140,
  eventVenueMax: 200,
  auditReasonMin: 5,
  auditReasonMax: 500,
  sevenDaysMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const COLLECTION_NAMES = {
  users: 'users',
  privateUserData: 'privateUserData',
  userRoles: 'userRoles',
  usernames: 'usernames',
  posts: 'posts',
  postComments: 'postComments',
  follows: 'follows',
  postReactions: 'postReactions',
  anonymousPosts: 'anonymousPosts',
  anonymousComments: 'anonymousComments',
  anonymousIdentityMappings: 'anonymousIdentityMappings',
  anonymousAuditLogs: 'anonymousAuditLogs',
  savedPosts: 'savedPosts',
  marketplaceListings: 'marketplaceListings',
  trustedContacts: 'trustedContacts',
  opportunities: 'opportunities',
  events: 'events',
  notifications: 'notifications',
  polls: 'polls',
  platformSettings: 'platformSettings',
} as const;

export interface PublicUserProfile {
  uid: string;
  memberId: string;
  fullName: string;
  username: string;
  bio?: string;
  department?: string;
  faculty?: string;
  level?: string;
  photoUrl?: string;
  coverUrl?: string;
  publicEmail?: string;
  publicWhatsapp?: string;
  showWhatsappPublicly: boolean;
  badge: BadgeType;
  accountStatus: AccountStatus;
  isHiddenFromDirectory: boolean;
  followersCount: number;
  followingCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * Sanitized public projection omitting internal UID, memberId, and private emails.
 */
export interface PublicProfileProjection {
  fullName: string;
  username: string;
  bio?: string;
  department?: string;
  faculty?: string;
  level?: string;
  photoUrl?: string;
  coverUrl?: string;
  publicWhatsapp?: string;
  showWhatsappPublicly: boolean;
  badge: BadgeType;
  accountStatus: AccountStatus;
  followersCount: number;
  followingCount: number;
  createdAt: unknown;
}

export interface PrivateUserData {
  uid: string;
  authEmail: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  notificationPrefs?: Record<string, boolean>;
  interestCategories?: string[];
  ownedUsernames?: string[];
  updatedAt: unknown;
}

export interface UserRoleRecord {
  uid: string;
  role: UserRole;
  badge: BadgeType;
  isPermanentOwner: boolean;
  isHiddenFromDirectory: boolean;
  grantedBy?: string;
  updatedAt: unknown;
}

export interface UsernameReservation {
  username: string;
  ownerUID: string;
  isPrimary?: boolean;
  redirectToUsername?: string;
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface CommunityPost {
  id: string;
  ownerUID: string;
  authorRole: Exclude<UserRole, 'member'>;
  category: string;
  title?: string;
  body: string;
  mediaUrls?: string[];
  isOfficial: boolean;
  isPinned: boolean;
  status: PostStatus;
  visibility: 'public';
  likesCount: number;
  commentsCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PostComment {
  id: string;
  postId: string;
  parentCommentId?: string;
  ownerUID: string;
  body: string;
  status: PostStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FollowEdge {
  followerUid: string;
  targetUid: string;
  createdAt: unknown;
}

export interface PostReaction {
  targetCollection: 'posts' | 'anonymousPosts';
  targetId: string;
  ownerUID: string;
  reactionType: ReactionType;
  createdAt: unknown;
}

export interface AnonymousPost {
  id: string;
  category: string;
  body: string;
  status: PostStatus;
  visibility: 'public';
  likesCount: number;
  commentsCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AnonymousComment {
  id: string;
  postId: string;
  parentCommentId?: string;
  body: string;
  status: PostStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AnonymousIdentityMapping {
  entryId: string;
  entryType: 'anonymousPosts' | 'anonymousComments';
  authorUid: string;
  authorRole: UserRole;
  createdAt: unknown;
}

export interface AnonymousAuditLog {
  id: string;
  targetEntryId: string;
  revealedByUid: string;
  reason: string;
  createdAt: unknown;
}

export interface SavedPost {
  id: string;
  ownerUID: string;
  targetCollection:
    | 'posts'
    | 'anonymousPosts'
    | 'marketplaceListings'
    | 'opportunities';
  targetId: string;
  createdAt: unknown;
}

export interface MarketplaceListing {
  id: string;
  ownerUID: string;
  listingKind: MarketplaceListingKind;
  title: string;
  description: string;
  category: string;
  price: number;
  quantity: number;
  mediaUrls?: string[];
  whatsappNumber: string;
  approvalStatus: MarketplaceApprovalStatus;
  status: MarketplaceStatus;
  approvedByUid?: string;
  visibility: 'public' | 'owner_and_admins';
  createdAt: unknown;
  updatedAt: unknown;
  expiresAt: unknown;
}

export interface TrustedContact {
  id: string;
  entryType: 'admin_listed_contact';
  isUserAccount: false;
  fullName: string;
  category: TrustedContactCategory;
  roleTitle: string;
  department?: string;
  faculty?: string;
  photoUrl?: string;
  contactNumber?: string;
  whatsappLink?: string;
  description?: string;
  createdByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Opportunity {
  id: string;
  ownerUID: string;
  category: OpportunityCategory;
  title: string;
  organisation: string;
  description: string;
  eligibility?: string;
  requiredDocuments?: string;
  benefits?: string;
  applicationInstructions?: string;
  applicationUrl: string;
  contactInfo?: string;
  status: 'active' | 'expired';
  expiresAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CampusEvent {
  id: string;
  ownerUID: string;
  title: string;
  description: string;
  bannerUrl?: string;
  eventDate: unknown;
  timeLabel?: string;
  venue: string;
  onlineMeetingUrl?: string;
  organiser: string;
  registrationUrl?: string;
  instructions?: string;
  status: CampusEventStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface NotificationItem {
  id: string;
  recipientUid: string;
  eventType: NotificationEventType;
  title: string;
  body?: string;
  targetPath?: string;
  isRead: boolean;
  createdAt: unknown;
}

export interface CampusPoll {
  id: string;
  ownerUID: string;
  question: string;
  options: string[];
  status: 'open' | 'closed';
  expiresAt: unknown;
  createdAt: unknown;
}

export interface PlatformSetting {
  id: string;
  updatedByUid: string;
  pinnedAnnouncementPostId?: string;
  maintenanceNotice?: string;
  updatedAt: unknown;
}

export interface BadgeVisualMeta {
  badge: BadgeType;
  label: string;
  colorDescription: string;
  canPublishOrdinaryFeed: boolean;
}

export function getBadgeVisualMeta(badge: BadgeType): BadgeVisualMeta {
  switch (badge) {
    case 'supreme_admin':
      return {
        badge: 'supreme_admin',
        label: 'Supreme Admin',
        colorDescription: 'Purple, thick, shiny',
        canPublishOrdinaryFeed: true,
      };
    case 'moderator':
      return {
        badge: 'moderator',
        label: 'Moderator',
        colorDescription: 'Red',
        canPublishOrdinaryFeed: true,
      };
    case 'verified':
      return {
        badge: 'verified',
        label: 'Verified',
        colorDescription: 'Green',
        canPublishOrdinaryFeed: true,
      };
    case 'none':
    default:
      return {
        badge: 'none',
        label: 'Member',
        colorDescription: 'None',
        canPublishOrdinaryFeed: false,
      };
  }
}

export function isValidFirestoreId(value: string): boolean {
  return (
    value.length >= BLUEPRINT_LIMITS.idMin &&
    value.length <= BLUEPRINT_LIMITS.idMax &&
    BLUEPRINT_PATTERNS.id.test(value)
  );
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= BLUEPRINT_LIMITS.usernameMin &&
    username.length <= BLUEPRINT_LIMITS.usernameMax &&
    BLUEPRINT_PATTERNS.username.test(username)
  );
}

/**
 * Prevents storing Base64 images/videos or oversized URLs directly inside Firestore.
 */
export function isSafeMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > BLUEPRINT_LIMITS.urlMax) {
    return false;
  }
  if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return false;
  }
  return /^https?:\/\//i.test(trimmed);
}

export function validateMediaUrls(urls: string[] | undefined): void {
  if (!urls) return;
  if (urls.length > BLUEPRINT_LIMITS.mediaMaxCount) {
    throw new Error(
      `At most ${BLUEPRINT_LIMITS.mediaMaxCount} media URLs are permitted per document.`
    );
  }
  for (const url of urls) {
    if (!isSafeMediaUrl(url)) {
      throw new Error(
        'Invalid media URL. Store only external HTTPS/HTTP URLs (max 512 chars), never Base64 data URIs.'
      );
    }
  }
}

export function validateAnonymousPostPayload(
  payload: Record<string, unknown>
): void {
  const forbiddenIdentityKeys = [
    'ownerUID',
    'authorUid',
    'uid',
    'email',
    'authEmail',
    'phoneNumber',
    'whatsappNumber',
    'username',
    'fullName',
  ];

  for (const key of forbiddenIdentityKeys) {
    if (key in payload) {
      throw new Error(
        `AnonymousPost must never expose identity field "${key}".`
      );
    }
  }

  const id = String(payload.id ?? '');
  const category = String(payload.category ?? '').trim();
  const body = String(payload.body ?? '').trim();

  if (!isValidFirestoreId(id)) {
    throw new Error('Invalid anonymous post ID.');
  }
  if (
    category.length < BLUEPRINT_LIMITS.categoryMin ||
    category.length > BLUEPRINT_LIMITS.categoryMax
  ) {
    throw new Error('Anonymous post category violates blueprint length bounds.');
  }
  if (
    body.length < BLUEPRINT_LIMITS.anonymousBodyMin ||
    body.length > BLUEPRINT_LIMITS.anonymousBodyMax
  ) {
    throw new Error('Anonymous post body violates blueprint length bounds.');
  }
}

export function validateTrustedContactPayload(contact: TrustedContact): void {
  if (contact.entryType !== 'admin_listed_contact') {
    throw new Error(
      'TrustedContact must have entryType set to "admin_listed_contact".'
    );
  }
  if (contact.isUserAccount !== false) {
    throw new Error('TrustedContact records are never user accounts.');
  }
  if (!isValidFirestoreId(contact.id) || !isValidFirestoreId(contact.createdByUid)) {
    throw new Error('TrustedContact has an invalid ID.');
  }
  if (
    contact.fullName.trim().length < BLUEPRINT_LIMITS.fullNameMin ||
    contact.fullName.trim().length > BLUEPRINT_LIMITS.trustedContactNameMax
  ) {
    throw new Error('TrustedContact fullName violates blueprint length bounds.');
  }
  if (contact.photoUrl && !isSafeMediaUrl(contact.photoUrl)) {
    throw new Error('TrustedContact photoUrl must be a valid URL.');
  }
}

export function canRolePublishCommunityFeed(role: UserRole): boolean {
  return (
    role === 'owner' ||
    role === 'supreme_admin' ||
    role === 'moderator' ||
    role === 'verified'
  );
}

/**
 * Enforces the Part 5 / Part 7 permission boundary:
 * Moderators can only moderate/delete ordinary members' content (including anonymous posts).
 */
export function canModeratorDeleteTargetRole(targetRole: UserRole): boolean {
  return targetRole === 'member';
}

export function canActorUpdateTargetRoleRecord(
  actorRole: UserRole,
  targetIsPermanentOwner: boolean,
  currentTargetRole: UserRole
): boolean {
  if (actorRole === 'owner') {
    return true;
  }
  if (actorRole === 'supreme_admin') {
    return !targetIsPermanentOwner && currentTargetRole !== 'owner' && currentTargetRole !== 'supreme_admin';
  }
  return false;
}

export function canApproveMarketplaceListing(
  actorRole: UserRole,
  currentApprovalStatus: MarketplaceApprovalStatus
): boolean {
  if (currentApprovalStatus !== 'pending_approval') {
    return false;
  }
  return (
    actorRole === 'owner' ||
    actorRole === 'supreme_admin' ||
    actorRole === 'moderator'
  );
}

export function computeMarketplaceExpiryDate(
  activeFromDate: Date = new Date()
): Date {
  return new Date(activeFromDate.getTime() + BLUEPRINT_LIMITS.sevenDaysMs);
}

export function isMarketplaceListingExpired(
  expiresAtMs: number,
  nowMs: number = Date.now()
): boolean {
  return nowMs >= expiresAtMs;
}

export function resolveMarketplaceUpdateFromQuantity(
  quantity: number
): Pick<MarketplaceListing, 'quantity' | 'status'> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('Marketplace quantity must be a non-negative integer.');
  }
  if (quantity === 0) {
    return { quantity: 0, status: 'sold' };
  }
  return { quantity, status: 'active' };
}

export function categorizeEventByDate(
  eventDateMs: number,
  nowMs: number = Date.now(),
  explicitStatus: CampusEventStatus = 'upcoming'
): CampusEventStatus {
  if (explicitStatus === 'cancelled') {
    return 'cancelled';
  }
  return eventDateMs < nowMs ? 'past' : 'upcoming';
}

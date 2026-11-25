export type UserRole =
  | 'supreme_admin'
  | 'moderator'
  | 'verified'
  | 'member';

export type BadgeType = 'none' | 'verified' | 'moderator' | 'supreme_admin';
export type PublicBadgeType = 'verified' | 'moderator' | 'trust';

export type AccountStatus = 'active' | 'suspended';

export type PostStatus = 'published' | 'deleted';

export type MediaTargetCollection =
  | 'users_avatar'
  | 'users_cover'
  | 'posts'
  | 'updates'
  | 'anonymousPosts'
  | 'marketplaceListings'
  | 'trustedContacts'
  | 'events';

export type SupportedImageMimeType = 'image/webp' | 'image/jpeg';

export type OrdinaryPostType = 'text' | 'photo';

export type AnonymousPostType = 'text' | 'photo';

export type AnonymousBackgroundId =
  | 'plain'
  | 'navy_slate'
  | 'ocean_blue'
  | 'cobalt_indigo'
  | 'midnight_emerald'
  | 'sunset_amber'
  | 'crimson_rose'
  | 'royal_plum'
  | 'warm_charcoal';

export type TextPostBackgroundId = Exclude<AnonymousBackgroundId, 'plain'>;

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
  | 'officially_verified'
  | 'community_recommended'
  | 'lecturer'
  | 'department_rep'
  | 'faculty_president'
  | 'class_rep'
  | 'departmental_executive'
  | 'student_union_rep';

export type OpportunityCategory =
  | 'scholarship'
  | 'grant'
  | 'internship'
  | 'job'
  | 'competition'
  | 'programme'
  | 'training'
  | 'conference'
  | 'other';

export type EventCategory =
  | 'departmental'
  | 'faculty'
  | 'student_association'
  | 'seminar_workshop'
  | 'conference'
  | 'orientation'
  | 'public_lecture'
  | 'competition'
  | 'social_cultural'
  | 'other';

export type CampusEventStatus =
  | 'upcoming'
  | 'ongoing'
  | 'completed'
  | 'past'
  | 'cancelled';

export type ReactionType = 'like' | 'insightful' | 'support';

export type NotificationEventType =
  | 'follow'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'anonymous_reply'
  | 'anonymous_reaction'
  | 'reaction'
  | 'marketplace_approved'
  | 'marketplace_rejected'
  | 'marketplace_expired'
  | 'new_opportunity'
  | 'new_event'
  | 'badge_change'
  | 'account_change'
  | 'announcement'
  | 'official_update';

/**
 * Synchronized verbatim with firebase-blueprint.json & firestore.rules.
 */
export const BLUEPRINT_PATTERNS = {
  id: /^[a-zA-Z0-9_-]+$/,
  username: /^[a-z0-9_]+$/,
} as const;

export const ALLOWED_TEXT_POST_BACKGROUND_IDS: readonly TextPostBackgroundId[] =
  [
    'navy_slate',
    'ocean_blue',
    'cobalt_indigo',
    'midnight_emerald',
    'sunset_amber',
    'crimson_rose',
    'royal_plum',
    'warm_charcoal',
  ] as const;

export const ALLOWED_ANONYMOUS_BACKGROUND_IDS: readonly AnonymousBackgroundId[] =
  [
    'plain',
    ...ALLOWED_TEXT_POST_BACKGROUND_IDS,
  ] as const;

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
  accountCategoryMax: 64,
  urlMax: 512,
  emailMax: 160,
  phoneMax: 24,
  categoryMin: 2,
  categoryMax: 64,
  postTitleMax: 180,
  postBodyMin: 0,
  postBodyMax: 5000,
  textPostBodyMax: 500,
  photoPostCaptionMax: 2000,
  anonymousBodyMin: 0,
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
  mediaPostMaxCount: 4,
  imageCaptionMax: 300,
  mediaTargetBytes: 102400,
  mediaMaxBytes: 250000,
  mediaBase64MinChars: 24,
  mediaBase64MaxChars: 340000,
  backgroundStyleMax: 32,
  opportunityTitleMin: 3,
  opportunityTitleMax: 180,
  organisationMin: 2,
  organisationMax: 140,
  eventVenueMax: 200,
  auditReasonMin: 5,
  auditReasonMax: 500,
  pollQuestionMin: 5,
  pollQuestionMax: 280,
  pollDescriptionMax: 300,
  pollOptionsMin: 2,
  pollOptionsMax: 8,
  pollOptionMinLength: 1,
  pollOptionMaxLength: 120,
  sevenDaysMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const COLLECTION_NAMES = {
  users: 'users',
  privateUserData: 'privateUserData',
  userRoles: 'userRoles',
  badgeAuditLogs: 'badgeAuditLogs',
  adminAuditLogs: 'adminAuditLogs',
  usernames: 'usernames',
  posts: 'posts',
  updates: 'updates',
  adminUpdateMappings: 'adminUpdateMappings',
  postComments: 'postComments',
  follows: 'follows',
  postReactions: 'postReactions',
  anonymousPosts: 'anonymousPosts',
  anonymousComments: 'anonymousComments',
  anonymousIdentityMappings: 'anonymousIdentityMappings',
  anonymousAuditLogs: 'anonymousAuditLogs',
  anonymousReports: 'anonymousReports',
  mediaImages: 'mediaImages',
  savedPosts: 'savedPosts',
  marketplaceListings: 'marketplaceListings',
  trustedContacts: 'trustedContacts',
  opportunities: 'opportunities',
  events: 'events',
  notifications: 'notifications',
  polls: 'polls',
  platformSettings: 'platformSettings',
  postViews: 'postViews',
  marketplaceUpdates: 'marketplaceUpdates',
} as const;

export const SUBCOLLECTION_NAMES = {
  anonymousHistory: 'anonymousHistory',
  pushSubscriptions: 'pushSubscriptions',
  votes: 'votes',
} as const;

export interface PostMediaMeta {
  imageId: string;
  caption?: string;
  width: number;
  height: number;
  byteSize: number;
  mimeType: SupportedImageMimeType;
  order: number;
}

export interface MediaImage {
  id: string;
  targetCollection: MediaTargetCollection;
  targetId: string;
  ownerUID?: string;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteSize: number;
  base64Data: string;
  createdAt: unknown;
}

export interface PublicUserProfile {
  uid: string;
  memberId: string;
  fullName: string;
  username: string;
  bio?: string;
  department?: string;
  faculty?: string;
  level?: string;
  accountCategory?: string;
  photoUrl?: string;
  coverUrl?: string;
  photoImageId?: string;
  coverImageId?: string;
  publicEmail?: string;
  publicWhatsapp?: string;
  showWhatsappPublicly: boolean;
  badge: BadgeType;
  isVerified?: boolean;
  hasPublicActivity?: boolean;
  anonymousLikesReceivedCount?: number;
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
  accountCategory?: string;
  photoUrl?: string;
  coverUrl?: string;
  photoImageId?: string;
  coverImageId?: string;
  publicWhatsapp?: string;
  showWhatsappPublicly: boolean;
  badge: BadgeType;
  isVerified?: boolean;
  anonymousLikesReceivedCount?: number;
  accountStatus: AccountStatus;
  followersCount: number;
  followingCount: number;
  createdAt: unknown;
}

export interface PrivateAnonymousHistoryEntry {
  postId: string;
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
  ownedAnonymousPostIds?: string[];
  ownedAnonymousCommentIds?: string[];
  showSupremeAdminBadge?: boolean;
  updatedAt: unknown;
}

export interface PushSubscriptionRecord {
  id: string;
  uid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  platform?: string;
  isStandalone?: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserRoleRecord {
  uid: string;
  role: UserRole;
  badge: BadgeType;
  isVerified?: boolean;
  isPermanentOwner: boolean;
  isHiddenFromDirectory: boolean;
  grantedBy?: string;
  updatedAt: unknown;
}

export type BadgeAuditAction =
  | 'grant_verified'
  | 'remove_verified'
  | 'grant_moderator'
  | 'promote_verified_to_moderator'
  | 'demote_moderator_to_verified'
  | 'demote_moderator_to_member'
  | 'remove_moderator'
  | 'grant_supreme_admin'
  | 'remove_supreme_admin'
  | 'suspend_account'
  | 'restore_account';

export interface BadgeAuditLog {
  id: string;
  targetUid: string;
  targetUsername?: string;
  action: BadgeAuditAction;
  previousRole: UserRole;
  previousBadge: BadgeType;
  nextRole: UserRole;
  nextBadge: BadgeType;
  performedByUid: string;
  performedByRole: 'supreme_admin';
  reason?: string;
  createdAt: unknown;
}

export type AdminAuditAction =
  | 'marketplace_approved'
  | 'marketplace_rejected'
  | 'marketplace_removed'
  | 'marketplace_status_updated'
  | 'post_deleted'
  | 'anonymous_post_deleted'
  | 'post_comment_deleted'
  | 'anonymous_comment_deleted'
  | 'anonymous_report_dismissed'
  | 'anonymous_report_removed'
  | 'post_pinned'
  | 'post_unpinned'
  | 'post_official_toggled'
  | 'opportunity_created'
  | 'opportunity_updated'
  | 'opportunity_expired'
  | 'opportunity_deleted'
  | 'event_created'
  | 'event_updated'
  | 'event_cancelled'
  | 'event_deleted'
  | 'trusted_contact_created'
  | 'trusted_contact_updated'
  | 'trusted_contact_deleted'
  | 'settings_updated'
  | 'announcement_broadcast'
  | 'update_created'
  | 'update_updated'
  | 'update_deleted'
  | 'poll_created'
  | 'poll_updated'
  | 'poll_closed'
  | 'poll_deleted';

export interface AdminAuditLog {
  id: string;
  action: AdminAuditAction;
  targetCollection: string;
  targetId: string;
  targetLabel?: string;
  performedByUid: string;
  performedByRole: 'supreme_admin' | 'moderator';
  details?: string;
  createdAt: unknown;
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
  postType?: OrdinaryPostType;
  category: string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  mediaUrls?: string[];
  mediaItems?: PostMediaMeta[];
  isOfficial: boolean;
  isPinned: boolean;
  status: PostStatus;
  visibility: 'public';
  likesCount: number;
  commentsCount: number;
  viewsCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export function resolveOrdinaryPostType(
  post: Pick<CommunityPost, 'postType' | 'mediaItems' | 'mediaUrls'>
): OrdinaryPostType {
  if (post.postType === 'text' || post.postType === 'photo') {
    return post.postType;
  }
  const hasMediaItems = Array.isArray(post.mediaItems) && post.mediaItems.length > 0;
  const hasMediaUrls = Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0;
  return hasMediaItems || hasMediaUrls ? 'photo' : 'text';
}

export type AdminUpdateFormat = 'photo' | 'text';
export type AdminUpdateAuthorMode = 'public_admin' | 'official_desk';
export type AdminUpdateCategory =
  | 'announcement'
  | 'academic'
  | 'campus_life'
  | 'security'
  | 'urgent';

export const ALLOWED_ADMIN_UPDATE_CATEGORIES: readonly AdminUpdateCategory[] = [
  'announcement',
  'academic',
  'campus_life',
  'security',
  'urgent',
] as const;

export interface AdminUpdate {
  id: string;
  format: AdminUpdateFormat;
  authorMode: AdminUpdateAuthorMode;
  ownerUID?: string;
  authorDisplayName: string;
  authorBadge: 'supreme_admin' | 'verified';
  authorPhotoUrl?: string;
  authorPhotoImageId?: string;
  category: AdminUpdateCategory | string;
  title?: string;
  body: string;
  backgroundStyle?: TextPostBackgroundId;
  mediaItems?: PostMediaMeta[];
  pollId?: string;
  isPinned: boolean;
  status: PostStatus;
  visibility: 'public';
  likesCount: number;
  commentsCount: number;
  viewsCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AdminUpdateMapping {
  updateId: string;
  authorUid: string;
  authorMode: AdminUpdateAuthorMode;
  createdAt: unknown;
}

export function resolveAdminUpdateFormat(
  update: Pick<AdminUpdate, 'format' | 'mediaItems'>
): AdminUpdateFormat {
  if (update.format === 'text' || update.format === 'photo') {
    return update.format;
  }
  return Array.isArray(update.mediaItems) && update.mediaItems.length > 0
    ? 'photo'
    : 'text';
}

export interface PostComment {
  id: string;
  postId: string;
  targetCollection?: 'posts' | 'updates' | 'events' | 'marketplaceListings';
  parentCommentId?: string;
  replyToCommentId?: string;
  ownerUID: string;
  body: string;
  status: PostStatus;
  likesCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FollowEdge {
  followerUid: string;
  targetUid: string;
  createdAt: unknown;
}

export interface PostReaction {
  targetCollection:
    | 'posts'
    | 'updates'
    | 'anonymousPosts'
    | 'anonymousComments'
    | 'events'
    | 'postComments';
  targetId: string;
  ownerUID: string;
  reactionType: ReactionType;
  createdAt: unknown;
}

export interface AnonymousPost {
  id: string;
  postType?: AnonymousPostType;
  category: string;
  body: string;
  backgroundStyle?: AnonymousBackgroundId;
  mediaItems?: PostMediaMeta[];
  status: PostStatus;
  visibility: 'public';
  likesCount: number;
  commentsCount: number;
  viewsCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export function resolveAnonymousPostType(
  post: Pick<AnonymousPost, 'postType' | 'mediaItems'>
): AnonymousPostType {
  if (post.postType === 'text' || post.postType === 'photo') {
    return post.postType;
  }
  const hasMediaItems = Array.isArray(post.mediaItems) && post.mediaItems.length > 0;
  return hasMediaItems ? 'photo' : 'text';
}

export interface AnonymousComment {
  id: string;
  postId: string;
  parentCommentId?: string;
  replyToCommentId?: string;
  body: string;
  status: PostStatus;
  likesCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export type AnonymousReportTargetType = 'anonymousPost' | 'anonymousComment';

export type AnonymousReportReason =
  | 'harassment'
  | 'hate_speech'
  | 'privacy_leak'
  | 'misinformation'
  | 'spam'
  | 'other';

export type AnonymousReportStatus =
  | 'pending'
  | 'reviewed_removed'
  | 'dismissed';

export interface AnonymousReport {
  id: string;
  targetType: AnonymousReportTargetType;
  targetId: string;
  postId: string;
  reporterUid: string;
  reason: AnonymousReportReason;
  details?: string;
  excerpt: string;
  status: AnonymousReportStatus;
  reviewedByUid?: string;
  reviewedByRole?: 'supreme_admin' | 'moderator';
  resolutionNote?: string;
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
    | 'updates'
    | 'anonymousPosts'
    | 'marketplaceListings'
    | 'opportunities'
    | 'events';
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
  mediaItems?: PostMediaMeta[];
  whatsappNumber: string;
  approvalStatus: MarketplaceApprovalStatus;
  status: MarketplaceStatus;
  approvedByUid?: string;
  approvedAt?: unknown;
  visibility: 'public' | 'owner_and_admins';
  commentsCount?: number;
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
  badgeLabel?: string;
  roleTitle: string;
  department?: string;
  faculty?: string;
  photoUrl?: string;
  photoImageId?: string;
  contactNumber?: string;
  whatsappLink?: string;
  description?: string;
  createdByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type OpportunityStatus = 'active' | 'expired' | 'unpublished';

export interface Opportunity {
  id: string;
  ownerUID: string;
  category: OpportunityCategory;
  title: string;
  organisation: string;
  description: string;
  eligibility?: string;
  whoCanApply?: string;
  requiredDocuments?: string;
  benefits?: string;
  applicationInstructions?: string;
  applicationUrl: string;
  contactInfo?: string;
  opensAt?: unknown;
  isVerified?: boolean;
  notifiedNewAt?: unknown;
  lastDeadlineNotifiedMs?: number;
  status: OpportunityStatus;
  expiresAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CampusEvent {
  id: string;
  ownerUID: string;
  category?: EventCategory;
  title: string;
  description: string;
  bannerUrl?: string;
  mediaItems?: PostMediaMeta[];
  eventDate: unknown;
  endDate?: unknown;
  timeLabel?: string;
  venue: string;
  onlineMeetingUrl?: string;
  organiser: string;
  registrationRequired?: boolean;
  registrationUrl?: string;
  contactInfo?: string;
  instructions?: string;
  status: CampusEventStatus;
  published?: boolean;
  likesCount?: number;
  commentsCount?: number;
  notifiedNewAt?: unknown;
  lastUpdatedNoticeMs?: number;
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
  actorUid?: string;
  actorUsername?: string;
  actorName?: string;
  actorPhotoUrl?: string;
  actorPhotoImageId?: string;
  targetImageId?: string;
  targetImageUrl?: string;
  isRead: boolean;
  createdAt: unknown;
}

export type PollVoterScope = 'all_members' | 'verified_and_above';
export type PollResultsVisibility = 'always' | 'after_vote' | 'after_close';

export interface CampusPoll {
  id: string;
  updateId: string;
  authorMode: AdminUpdateAuthorMode;
  ownerUID?: string;
  question: string;
  description?: string;
  options: string[];
  optionCounts: number[];
  totalVotes: number;
  allowMultiple: boolean;
  maxSelections: number;
  allowVoteChange: boolean;
  voterScope: PollVoterScope;
  resultsVisibility: PollResultsVisibility;
  status: 'open' | 'closed';
  expiresAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PollVoteRecord {
  id: string;
  pollId: string;
  voterUid: string;
  selectedIndices: number[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PlatformSetting {
  id: string;
  updatedByUid: string;
  pinnedAnnouncementPostId?: string;
  maintenanceNotice?: string;
  marketplaceSubmissionsOpen?: boolean;
  anonymousPostingOpen?: boolean;
  newRegistrationsOpen?: boolean;
  updatedAt: unknown;
}

export type MarketplaceUpdateCategory =
  | 'safety'
  | 'policy'
  | 'notice'
  | 'general';

export interface MarketplaceUpdate {
  id: string;
  title: string;
  body: string;
  category: MarketplaceUpdateCategory;
  published: boolean;
  createdByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface BadgeVisualMeta {
  badge: BadgeType | 'trust';
  label: string;
  colorDescription: string;
  canPublishOrdinaryFeed: boolean;
}

export function getBadgeVisualMeta(badge: BadgeType | 'trust'): BadgeVisualMeta {
  switch (badge) {
    case 'supreme_admin':
      return {
        badge: 'supreme_admin',
        label: 'Supreme Admin',
        colorDescription: 'Navy & Royal Blue',
        canPublishOrdinaryFeed: true,
      };
    case 'moderator':
      return {
        badge: 'moderator',
        label: 'Moderator',
        colorDescription: 'Green',
        canPublishOrdinaryFeed: true,
      };
    case 'verified':
      return {
        badge: 'verified',
        label: 'Verified',
        colorDescription: 'Blue',
        canPublishOrdinaryFeed: true,
      };
    case 'trust':
      return {
        badge: 'trust',
        label: 'Trust',
        colorDescription: 'Purple',
        canPublishOrdinaryFeed: false,
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

export function resolvePublicBadgesForProfile(
  profile: Pick<PublicProfileProjection, 'badge' | 'isVerified'> | null | undefined
): BadgeType[] {
  if (!profile) return [];
  if (profile.badge === 'supreme_admin') {
    return ['supreme_admin'];
  }
  if (profile.badge === 'moderator') {
    return profile.isVerified ? ['verified', 'moderator'] : ['moderator'];
  }
  if (profile.badge === 'verified') {
    return ['verified'];
  }
  return [];
}

export type BadgeRenderVariant = 'icon' | 'full';

/**
 * Resolves how a badge renders:
 * - 'icon': Small circular TikTok-style badge next to a user's name on posts, comments, replies, and cards.
 * - 'full': Full rectangular badge when opening a profile, contact detail, or administrative summary.
 */
export function resolveBadgeRenderVariant(
  size: 'xs' | 'sm' | 'md' = 'sm',
  explicitVariant?: BadgeRenderVariant
): BadgeRenderVariant {
  if (explicitVariant) {
    return explicitVariant;
  }
  return size === 'xs' ? 'icon' : 'full';
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
 * Prevents storing Base64 images/videos or oversized URLs directly inside post/user documents.
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

export function validatePostMediaItems(items: PostMediaMeta[] | undefined): void {
  if (!items) return;
  if (items.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    throw new Error(
      `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
    );
  }
  items.forEach((item, index) => {
    if (!isValidFirestoreId(item.imageId)) {
      throw new Error(`Invalid image reference at position ${index + 1}.`);
    }
    if (
      item.mimeType !== 'image/webp' &&
      item.mimeType !== 'image/jpeg'
    ) {
      throw new Error(`Unsupported image format at position ${index + 1}.`);
    }
    if (
      !Number.isInteger(item.width) ||
      item.width < 1 ||
      item.width > 4096 ||
      !Number.isInteger(item.height) ||
      item.height < 1 ||
      item.height > 4096
    ) {
      throw new Error(`Invalid image dimensions at position ${index + 1}.`);
    }
    if (
      !Number.isInteger(item.byteSize) ||
      item.byteSize < 1 ||
      item.byteSize > BLUEPRINT_LIMITS.mediaMaxBytes
    ) {
      throw new Error(
        `Compressed image at position ${index + 1} exceeds the Firestore safety threshold.`
      );
    }
    if (
      item.caption !== undefined &&
      item.caption.trim().length > BLUEPRINT_LIMITS.imageCaptionMax
    ) {
      throw new Error(
        `Image caption at position ${index + 1} must be ${BLUEPRINT_LIMITS.imageCaptionMax} characters or fewer.`
      );
    }
  });
}

export function validateMediaImagePayload(
  payload: Record<string, unknown>
): void {
  const id = String(payload.id ?? '');
  const targetCollection = String(payload.targetCollection ?? '');
  const targetId = String(payload.targetId ?? '');
  const mimeType = String(payload.mimeType ?? '');
  const base64Data = String(payload.base64Data ?? '');
  const byteSize = Number(payload.byteSize ?? 0);
  const width = Number(payload.width ?? 0);
  const height = Number(payload.height ?? 0);

  if (!isValidFirestoreId(id) || !isValidFirestoreId(targetId)) {
    throw new Error('Invalid image document identifiers.');
  }
  if (
    targetCollection === 'anonymousPosts' &&
    ('ownerUID' in payload || 'authorUid' in payload || 'filename' in payload)
  ) {
    throw new Error(
      'Anonymous image documents must never store ownerUID or filename metadata.'
    );
  }
  if (mimeType !== 'image/webp' && mimeType !== 'image/jpeg') {
    throw new Error('Only WebP and JPEG compressed images are accepted.');
  }
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 4096 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 4096
  ) {
    throw new Error('Image dimensions must be within 1–4096 pixels.');
  }
  if (
    !Number.isInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > BLUEPRINT_LIMITS.mediaMaxBytes
  ) {
    throw new Error(
      'Compressed image size exceeds the safe per-document limit.'
    );
  }
  if (
    base64Data.length < BLUEPRINT_LIMITS.mediaBase64MinChars ||
    base64Data.length > BLUEPRINT_LIMITS.mediaBase64MaxChars
  ) {
    throw new Error(
      'Encoded image data exceeds the safe Firestore Base64 document ceiling.'
    );
  }
}

export function validateCommunityPostPayload(
  payload: Record<string, unknown>
): void {
  const id = String(payload.id ?? '');
  const ownerUID = String(payload.ownerUID ?? '');
  const postType = payload.postType;
  const category = String(payload.category ?? '').trim();
  const title = payload.title === undefined ? '' : String(payload.title).trim();
  const body = String(payload.body ?? '').trim();
  const backgroundStyle = payload.backgroundStyle;
  const mediaItems = Array.isArray(payload.mediaItems)
    ? (payload.mediaItems as PostMediaMeta[])
    : [];
  const mediaUrls = Array.isArray(payload.mediaUrls)
    ? (payload.mediaUrls as string[])
    : [];

  if (!isValidFirestoreId(id) || !isValidFirestoreId(ownerUID)) {
    throw new Error('Invalid community post identifiers.');
  }
  if (postType !== 'text' && postType !== 'photo') {
    throw new Error(
      'Ordinary community posts must specify postType as "text" or "photo".'
    );
  }
  if (
    category.length < BLUEPRINT_LIMITS.categoryMin ||
    category.length > BLUEPRINT_LIMITS.categoryMax
  ) {
    throw new Error('Post category must be between 2 and 64 characters.');
  }
  if (title.length > BLUEPRINT_LIMITS.postTitleMax) {
    throw new Error(
      `Post title must be ${BLUEPRINT_LIMITS.postTitleMax} characters or fewer.`
    );
  }

  if (postType === 'text') {
    if (mediaItems.length > 0 || mediaUrls.length > 0) {
      throw new Error(
        'Text-only posts cannot include photo attachments. Switch to Photo Post to upload images.'
      );
    }
    if (
      typeof backgroundStyle !== 'string' ||
      !ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(
        backgroundStyle as TextPostBackgroundId
      )
    ) {
      throw new Error(
        'Select a valid coloured or gradient background for your text-only post.'
      );
    }
    if (body.length === 0) {
      throw new Error('Write a message for your text-only post.');
    }
    if (body.length > BLUEPRINT_LIMITS.textPostBodyMax) {
      throw new Error(
        `Text-only posts must be ${BLUEPRINT_LIMITS.textPostBodyMax} characters or fewer.`
      );
    }
    return;
  }

  // postType === 'photo'
  if (backgroundStyle !== undefined && backgroundStyle !== '') {
    throw new Error(
      'Photo posts cannot use coloured text-post backgrounds.'
    );
  }
  if (mediaItems.length === 0 || mediaItems.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    throw new Error(
      `Photo posts require between 1 and ${BLUEPRINT_LIMITS.mediaPostMaxCount} photographs.`
    );
  }
  validatePostMediaItems(mediaItems);
  for (let i = 0; i < mediaItems.length; i += 1) {
    if (
      mediaItems[i].caption !== undefined &&
      mediaItems[i].caption!.trim().length > 0
    ) {
      throw new Error(
        'Photo posts use one shared caption above the photos; individual photo captions are not allowed.'
      );
    }
  }
  if (body.length > BLUEPRINT_LIMITS.photoPostCaptionMax) {
    throw new Error(
      `Shared photo caption must be ${BLUEPRINT_LIMITS.photoPostCaptionMax} characters or fewer.`
    );
  }
}

export function validateAdminUpdatePayload(
  payload: Record<string, unknown>
): void {
  const id = String(payload.id ?? '');
  const format = payload.format;
  const authorMode = payload.authorMode;
  const authorDisplayName = String(payload.authorDisplayName ?? '').trim();
  const authorBadge = payload.authorBadge;
  const category = String(payload.category ?? '').trim();
  const title = payload.title === undefined ? '' : String(payload.title).trim();
  const body = String(payload.body ?? '').trim();
  const backgroundStyle = payload.backgroundStyle;
  const mediaItems = Array.isArray(payload.mediaItems)
    ? (payload.mediaItems as PostMediaMeta[])
    : [];
  const mediaUrls = Array.isArray(payload.mediaUrls)
    ? (payload.mediaUrls as string[])
    : [];

  if (!isValidFirestoreId(id)) {
    throw new Error('Invalid official update identifier.');
  }
  if (format !== 'text' && format !== 'photo') {
    throw new Error(
      'Official administrator updates must specify format as "text" or "photo".'
    );
  }
  if (authorMode !== 'public_admin' && authorMode !== 'official_desk') {
    throw new Error('Invalid administrator update authorMode.');
  }
  if (
    authorDisplayName.length < BLUEPRINT_LIMITS.fullNameMin ||
    authorDisplayName.length > BLUEPRINT_LIMITS.fullNameMax
  ) {
    throw new Error(
      'Official update author display name must be between 2 and 100 characters.'
    );
  }
  if (authorBadge !== 'supreme_admin' && authorBadge !== 'verified') {
    throw new Error('Official update author badge must be supreme_admin or verified.');
  }

  if (authorMode === 'official_desk') {
    const forbiddenIdentityKeys = [
      'ownerUID',
      'authorUid',
      'uid',
      'email',
      'authEmail',
      'authorEmail',
      'authorUsername',
      'isHiddenFromDirectory',
      'hiddenFromDirectory',
    ];
    for (const key of forbiddenIdentityKeys) {
      if (key in payload && payload[key] !== undefined) {
        throw new Error(
          `Official desk update must never expose hidden admin field "${key}".`
        );
      }
    }
    if (authorBadge !== 'verified') {
      throw new Error(
        'Official desk updates must use the neutral verified official badge.'
      );
    }
  } else {
    const ownerUID = String(payload.ownerUID ?? '');
    if (!isValidFirestoreId(ownerUID)) {
      throw new Error(
        'Public admin updates require a valid ownerUID.'
      );
    }
  }

  if (
    category.length < BLUEPRINT_LIMITS.categoryMin ||
    category.length > BLUEPRINT_LIMITS.categoryMax
  ) {
    throw new Error('Update category must be between 2 and 64 characters.');
  }
  if (title.length > BLUEPRINT_LIMITS.postTitleMax) {
    throw new Error(
      `Update title must be ${BLUEPRINT_LIMITS.postTitleMax} characters or fewer.`
    );
  }

  if (format === 'text') {
    if (mediaItems.length > 0 || mediaUrls.length > 0) {
      throw new Error(
        'Text-only updates cannot include photo attachments. Switch to Photo Update to upload images.'
      );
    }
    if (
      typeof backgroundStyle !== 'string' ||
      !ALLOWED_TEXT_POST_BACKGROUND_IDS.includes(
        backgroundStyle as TextPostBackgroundId
      )
    ) {
      throw new Error(
        'Select a valid coloured or gradient background for your text-only update.'
      );
    }
    if (body.length === 0) {
      throw new Error('Write a message for your text-only update.');
    }
    if (body.length > BLUEPRINT_LIMITS.textPostBodyMax) {
      throw new Error(
        `Text-only updates must be ${BLUEPRINT_LIMITS.textPostBodyMax} characters or fewer.`
      );
    }
    return;
  }

  // format === 'photo'
  if (backgroundStyle !== undefined && backgroundStyle !== '') {
    throw new Error(
      'Photo updates cannot use coloured text-post backgrounds.'
    );
  }
  if (
    mediaItems.length === 0 ||
    mediaItems.length > BLUEPRINT_LIMITS.mediaPostMaxCount
  ) {
    throw new Error(
      `Photo updates require between 1 and ${BLUEPRINT_LIMITS.mediaPostMaxCount} photographs.`
    );
  }
  validatePostMediaItems(mediaItems);
  for (let i = 0; i < mediaItems.length; i += 1) {
    if (
      mediaItems[i].caption !== undefined &&
      mediaItems[i].caption!.trim().length > 0
    ) {
      throw new Error(
        'Photo updates use one shared caption above the photos; individual photo captions are not allowed.'
      );
    }
  }
  if (body.length > BLUEPRINT_LIMITS.photoPostCaptionMax) {
    throw new Error(
      `Shared photo caption must be ${BLUEPRINT_LIMITS.photoPostCaptionMax} characters or fewer.`
    );
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
    'filename',
    'originalFileName',
  ];

  for (const key of forbiddenIdentityKeys) {
    if (key in payload) {
      throw new Error(
        `AnonymousPost must never expose identity field "${key}".`
      );
    }
  }

  const id = String(payload.id ?? '');
  const postType = payload.postType;
  const category = String(payload.category ?? '').trim();
  const body = String(payload.body ?? '').trim();
  const backgroundStyle = payload.backgroundStyle;
  const mediaItems = Array.isArray(payload.mediaItems)
    ? (payload.mediaItems as PostMediaMeta[])
    : [];

  if (!isValidFirestoreId(id)) {
    throw new Error('Invalid anonymous post ID.');
  }
  if (
    postType !== undefined &&
    postType !== 'text' &&
    postType !== 'photo'
  ) {
    throw new Error('Anonymous post type must be "text" or "photo".');
  }
  if (
    category.length < BLUEPRINT_LIMITS.categoryMin ||
    category.length > BLUEPRINT_LIMITS.categoryMax
  ) {
    throw new Error('Anonymous post category violates blueprint length bounds.');
  }
  if (
    backgroundStyle !== undefined &&
    !ALLOWED_ANONYMOUS_BACKGROUND_IDS.includes(
      backgroundStyle as AnonymousBackgroundId
    )
  ) {
    throw new Error('Invalid anonymous post background style.');
  }

  if (postType === 'text') {
    if (mediaItems.length > 0) {
      throw new Error(
        'Anonymous text-only posts cannot include photo attachments. Switch to Photo Post to upload images.'
      );
    }
    if (body.length === 0) {
      throw new Error('Write your anonymous message before posting.');
    }
    if (body.length > BLUEPRINT_LIMITS.anonymousBodyMax) {
      throw new Error('Anonymous post body violates blueprint length bounds.');
    }
    return;
  }

  if (postType === 'photo') {
    if (backgroundStyle !== undefined && backgroundStyle !== '') {
      throw new Error(
        'Anonymous photo posts cannot use coloured text-post backgrounds.'
      );
    }
    if (
      mediaItems.length === 0 ||
      mediaItems.length > BLUEPRINT_LIMITS.mediaPostMaxCount
    ) {
      throw new Error(
        `Anonymous photo posts require between 1 and ${BLUEPRINT_LIMITS.mediaPostMaxCount} photographs.`
      );
    }
    validatePostMediaItems(mediaItems);
    for (let i = 0; i < mediaItems.length; i += 1) {
      if (
        mediaItems[i].caption !== undefined &&
        mediaItems[i].caption!.trim().length > 0
      ) {
        throw new Error(
          'Anonymous photo posts use one shared caption above the photos; individual photo captions are not allowed.'
        );
      }
    }
    if (body.length > BLUEPRINT_LIMITS.photoPostCaptionMax) {
      throw new Error(
        `Shared photo caption must be ${BLUEPRINT_LIMITS.photoPostCaptionMax} characters or fewer.`
      );
    }
    return;
  }

  validatePostMediaItems(mediaItems);

  if (body.length === 0 && mediaItems.length === 0) {
    throw new Error(
      'Write your anonymous post or attach at least one photograph.'
    );
  }
  if (body.length > BLUEPRINT_LIMITS.anonymousBodyMax) {
    throw new Error('Anonymous post body violates blueprint length bounds.');
  }
}

export const ALLOWED_ANONYMOUS_REPORT_REASONS: readonly AnonymousReportReason[] =
  [
    'harassment',
    'hate_speech',
    'privacy_leak',
    'misinformation',
    'spam',
    'other',
  ] as const;

export function validateAnonymousReportPayload(
  payload: Record<string, unknown>
): void {
  const id = String(payload.id ?? '');
  const targetType = payload.targetType;
  const targetId = String(payload.targetId ?? '');
  const postId = String(payload.postId ?? '');
  const reporterUid = String(payload.reporterUid ?? '');
  const reason = payload.reason;
  const details =
    payload.details === undefined ? '' : String(payload.details).trim();
  const excerpt = String(payload.excerpt ?? '');

  if (
    !isValidFirestoreId(id) ||
    !isValidFirestoreId(targetId) ||
    !isValidFirestoreId(postId) ||
    !isValidFirestoreId(reporterUid)
  ) {
    throw new Error('Invalid anonymous report identifiers.');
  }
  if (targetType !== 'anonymousPost' && targetType !== 'anonymousComment') {
    throw new Error('Invalid anonymous report target type.');
  }
  if (
    typeof reason !== 'string' ||
    !ALLOWED_ANONYMOUS_REPORT_REASONS.includes(reason as AnonymousReportReason)
  ) {
    throw new Error('Select a valid reason for this report.');
  }
  if (details.length > 500) {
    throw new Error('Additional report details must be 500 characters or fewer.');
  }
  if (excerpt.length > 240) {
    throw new Error('Report excerpt exceeds maximum length.');
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
  if (contact.photoImageId && !isValidFirestoreId(contact.photoImageId)) {
    throw new Error('TrustedContact photoImageId is invalid.');
  }
  if (contact.badgeLabel && contact.badgeLabel.trim().length > 48) {
    throw new Error('TrustedContact badgeLabel must be 48 characters or fewer.');
  }
  const phone = (contact.contactNumber ?? '').trim();
  const waLink = (contact.whatsappLink ?? '').trim();
  const phoneDigits = phone.replace(/\D/g, '');
  const hasValidPhone = /^[+0-9\s()-]{7,24}$/.test(phone) && phoneDigits.length >= 7 && phoneDigits.length <= 15;
  const hasValidWaLink = /^https:\/\/(wa\.me|api\.whatsapp\.com)\/[0-9]{7,15}/i.test(waLink);
  if (!hasValidPhone && !hasValidWaLink) {
    throw new Error(
      'A valid WhatsApp number is compulsory before publishing a Trust contact.'
    );
  }
}

export function resolveBadgeForRole(role: UserRole): BadgeType {
  switch (role) {
    case 'supreme_admin':
      return 'supreme_admin';
    case 'moderator':
      return 'moderator';
    case 'verified':
      return 'verified';
    case 'member':
    default:
      return 'none';
  }
}

export function canRolePublishCommunityFeed(role: UserRole): boolean {
  return (
    role === 'supreme_admin' ||
    role === 'moderator' ||
    role === 'verified'
  );
}

/**
 * Enforces the permission boundary:
 * Moderators can only moderate/delete ordinary members' content (including anonymous posts).
 * Verified, Moderator, and Supreme Admin content is protected from Moderator deletion.
 */
export function canModeratorDeleteTargetRole(targetRole: UserRole): boolean {
  return targetRole === 'member';
}

export function canModeratorDeleteByBadge(targetBadge: BadgeType): boolean {
  return targetBadge === 'none';
}

export function canActorDeleteOrdinaryPost(input: {
  viewerUid: string | null;
  viewerTier: UserRole | 'guest';
  viewerSuspended: boolean;
  postOwnerUid: string;
  authorBadge?: BadgeType | null;
  authorRole?: UserRole;
}): boolean {
  if (input.viewerSuspended || !input.viewerUid || input.viewerTier === 'guest') {
    return false;
  }
  if (input.postOwnerUid === input.viewerUid) {
    return true;
  }
  if (input.viewerTier === 'supreme_admin') {
    return true;
  }
  if (input.viewerTier === 'moderator') {
    if (input.authorRole !== undefined) {
      return canModeratorDeleteTargetRole(input.authorRole);
    }
    if (input.authorBadge !== undefined && input.authorBadge !== null) {
      return canModeratorDeleteByBadge(input.authorBadge);
    }
  }
  return false;
}

export function canActorUpdateTargetRoleRecord(
  actorRole: UserRole,
  _targetIsLegacyOwner: boolean,
  currentTargetRole: UserRole,
  nextTargetRole?: UserRole,
  actorUid?: string,
  targetUid?: string
): boolean {
  if (actorUid && targetUid && actorUid === targetUid) {
    return false;
  }
  if (actorRole !== 'supreme_admin') {
    return false;
  }
  if (currentTargetRole === 'supreme_admin') {
    return false;
  }
  if (nextTargetRole && nextTargetRole === 'supreme_admin') {
    return false;
  }
  return true;
}

export function resolveBadgeAuditAction(
  previousRole: UserRole,
  nextRole: UserRole
): BadgeAuditAction {
  if (previousRole === 'member' && nextRole === 'verified') {
    return 'grant_verified';
  }
  if (previousRole === 'verified' && nextRole === 'member') {
    return 'remove_verified';
  }
  if (previousRole === 'member' && nextRole === 'moderator') {
    return 'grant_moderator';
  }
  if (previousRole === 'verified' && nextRole === 'moderator') {
    return 'promote_verified_to_moderator';
  }
  if (previousRole === 'moderator' && nextRole === 'verified') {
    return 'demote_moderator_to_verified';
  }
  if (previousRole === 'moderator' && nextRole === 'member') {
    return 'demote_moderator_to_member';
  }
  if (nextRole === 'supreme_admin') {
    return 'grant_supreme_admin';
  }
  if (previousRole === 'supreme_admin') {
    return 'remove_supreme_admin';
  }
  return 'remove_moderator';
}

export interface MarketplaceListingValidationInput {
  listingKind: MarketplaceListingKind;
  title: string;
  description: string;
  category: string;
  price: number;
  quantity: number;
  whatsappNumber: string;
  mediaCount: number;
}

export function validateMarketplaceListingInput(
  input: MarketplaceListingValidationInput
): string | null {
  const cleanTitle = input.title.trim();
  const cleanDescription = input.description.trim();
  const cleanCategory = input.category.trim();
  const cleanWhatsapp = input.whatsappNumber.trim();

  if (
    cleanTitle.length < BLUEPRINT_LIMITS.marketplaceTitleMin ||
    cleanTitle.length > BLUEPRINT_LIMITS.marketplaceTitleMax
  ) {
    return `Listing title must be ${BLUEPRINT_LIMITS.marketplaceTitleMin}–${BLUEPRINT_LIMITS.marketplaceTitleMax} characters.`;
  }
  if (!cleanCategory) {
    return 'Select a marketplace category.';
  }
  if (
    cleanDescription.length < BLUEPRINT_LIMITS.marketplaceDescMin ||
    cleanDescription.length > BLUEPRINT_LIMITS.marketplaceDescMax
  ) {
    return `Description must be ${BLUEPRINT_LIMITS.marketplaceDescMin}–${BLUEPRINT_LIMITS.marketplaceDescMax} characters.`;
  }
  if (
    cleanWhatsapp.length < BLUEPRINT_LIMITS.marketplaceWhatsappMin ||
    cleanWhatsapp.length > BLUEPRINT_LIMITS.marketplaceWhatsappMax
  ) {
    return 'Provide a valid WhatsApp phone number (7–24 characters).';
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'Enter a valid price (0 or higher).';
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return 'Initial quantity must be at least 1.';
  }
  if (input.mediaCount > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    return `A maximum of ${BLUEPRINT_LIMITS.mediaPostMaxCount} photographs is allowed per listing.`;
  }
  if (input.listingKind === 'product' && input.mediaCount < 1) {
    return 'Products require at least 1 photograph before publishing.';
  }
  return null;
}

export function canApproveMarketplaceListing(
  actorRole: UserRole,
  currentApprovalStatus: MarketplaceApprovalStatus
): boolean {
  if (currentApprovalStatus !== 'pending_approval') {
    return false;
  }
  return actorRole === 'supreme_admin' || actorRole === 'moderator';
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

export type MarketplaceFilterBucket =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'sold';

export function classifyMarketplaceListingBucket(
  listing: Pick<
    MarketplaceListing,
    'approvalStatus' | 'status' | 'quantity' | 'expiresAt'
  >,
  expiresAtMs: number | null,
  nowMs: number = Date.now()
): MarketplaceFilterBucket {
  if (
    listing.approvalStatus === 'rejected' ||
    listing.status === 'rejected'
  ) {
    return 'rejected';
  }
  if (listing.approvalStatus === 'pending_approval' || listing.status === 'pending_approval') {
    return 'pending';
  }
  if (listing.status === 'sold' || listing.quantity === 0) {
    return 'sold';
  }
  if (
    listing.status === 'expired' ||
    (expiresAtMs !== null && isMarketplaceListingExpired(expiresAtMs, nowMs))
  ) {
    return 'expired';
  }
  return 'approved';
}

export function resolveOpportunityEffectiveStatus(
  opp: Pick<Opportunity, 'status'>,
  expiresAtMs: number | null,
  nowMs: number = Date.now()
): 'active' | 'expired' {
  if (opp.status === 'expired' || opp.status === 'unpublished') {
    return 'expired';
  }
  if (expiresAtMs !== null && expiresAtMs <= nowMs) {
    return 'expired';
  }
  return 'active';
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

/**
 * Computes total likes received across a user's eligible public ordinary posts.
 * Anonymous post likes are strictly excluded from public profiles.
 */
export function computeTotalOrdinaryPostLikes(
  posts: readonly Pick<CommunityPost, 'likesCount' | 'status'>[]
): number {
  let total = 0;
  for (const post of posts) {
    if (post.status === 'published' && Number.isFinite(post.likesCount)) {
      total += Math.max(0, Math.floor(post.likesCount));
    }
  }
  return total;
}

/**
 * Recursively gathers a comment's ID and all descendant nested reply IDs
 * so deleting a parent thread never leaves orphaned replies behind.
 */
export function collectCommentTreeIds(
  comments: readonly { id: string; parentCommentId?: string }[],
  rootCommentId: string
): string[] {
  const byParent = new Map<string, string[]>();
  for (const item of comments) {
    if (!item.parentCommentId) continue;
    const list = byParent.get(item.parentCommentId) ?? [];
    list.push(item.id);
    byParent.set(item.parentCommentId, list);
  }

  const collected: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [rootCommentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    collected.push(currentId);

    const children = byParent.get(currentId) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return collected;
}


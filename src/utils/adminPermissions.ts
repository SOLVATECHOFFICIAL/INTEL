import {
  BLUEPRINT_LIMITS,
  canModeratorDeleteByBadge,
  classifyMarketplaceListingBucket,
  isSafeMediaUrl,
  resolveOpportunityEffectiveStatus,
  type AdminAuditAction,
  type AnonymousReport,
  type AnonymousReportReason,
  type BadgeAuditAction,
  type BadgeType,
  type CampusEvent,
  type CampusEventStatus,
  type EventCategory,
  type MarketplaceListing,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityStatus,
  type PublicUserProfile,
  type UserRole,
} from '../types/database';
import type { EffectiveAccountTier } from './authValidation';
import { extractTimestampMs } from './contextualSearch';
import { resolveEventLifecycle } from './events';

export type AdminDashboardSectionId =
  | 'overview'
  | 'members'
  | 'badges'
  | 'marketplace'
  | 'content'
  | 'opportunities'
  | 'events'
  | 'trusted-circle'
  | 'audit-log'
  | 'settings';

export interface AdminDashboardSectionMeta {
  id: AdminDashboardSectionId;
  number: number;
  label: string;
  description: string;
  supremeAdminOnly: boolean;
}

export const ADMIN_DASHBOARD_SECTIONS: readonly AdminDashboardSectionMeta[] = [
  {
    id: 'overview',
    number: 1,
    label: 'Overview',
    description: 'Real-time platform metrics, growth breakdown, and recent actions.',
    supremeAdminOnly: false,
  },
  {
    id: 'members',
    number: 2,
    label: 'Members',
    description: 'Search registered profiles, inspect account standing, suspend or restore.',
    supremeAdminOnly: true,
  },
  {
    id: 'badges',
    number: 3,
    label: 'Badges & Roles',
    description: 'Manage Verified, Moderator, and authorized Supreme Admin assignments.',
    supremeAdminOnly: true,
  },
  {
    id: 'marketplace',
    number: 4,
    label: 'Marketplace',
    description: 'Review pending items and inspect approved, rejected, expired, or sold listings.',
    supremeAdminOnly: false,
  },
  {
    id: 'content',
    number: 5,
    label: 'Community Content',
    description: 'Moderate posts, anonymous threads, comments, and listings by role.',
    supremeAdminOnly: false,
  },
  {
    id: 'opportunities',
    number: 6,
    label: 'Opportunities',
    description: 'Publish, update, expire, or remove scholarships, internships, grants, and jobs.',
    supremeAdminOnly: true,
  },
  {
    id: 'events',
    number: 7,
    label: 'Events',
    description: 'Publish campus events, manage venue/schedules, and cancel or remove events.',
    supremeAdminOnly: true,
  },
  {
    id: 'trusted-circle',
    number: 8,
    label: 'Trusted Circle',
    description: 'Manage official lecturer & representative contacts alongside Verified holders.',
    supremeAdminOnly: true,
  },
  {
    id: 'audit-log',
    number: 9,
    label: 'Audit Log',
    description: 'Immutable ledger of role, suspension, moderation, content, and settings changes.',
    supremeAdminOnly: true,
  },
  {
    id: 'settings',
    number: 10,
    label: 'Settings',
    description: 'Platform notices, pinned announcements, and Supreme Admin authority configuration.',
    supremeAdminOnly: true,
  },
] as const;

const MODERATOR_ALLOWED_SECTIONS: ReadonlySet<AdminDashboardSectionId> = new Set([
  'overview',
  'marketplace',
  'content',
]);

export function getVisibleAdminSections(
  tier: EffectiveAccountTier,
  suspended: boolean
): AdminDashboardSectionMeta[] {
  if (
    suspended ||
    tier === 'guest' ||
    tier === 'member' ||
    tier === 'verified'
  ) {
    return [];
  }
  if (tier === 'moderator') {
    return ADMIN_DASHBOARD_SECTIONS.filter((sec) =>
      MODERATOR_ALLOWED_SECTIONS.has(sec.id)
    );
  }
  return [...ADMIN_DASHBOARD_SECTIONS];
}

export function canActorAccessAdminSection(
  tier: EffectiveAccountTier,
  suspended: boolean,
  sectionId: AdminDashboardSectionId
): boolean {
  return getVisibleAdminSections(tier, suspended).some(
    (item) => item.id === sectionId
  );
}

export function canActorModerateMarketplaceListing(
  actorRole: UserRole,
  ownerBadge: BadgeType | null | undefined,
  approvalStatus: MarketplaceListing['approvalStatus']
): boolean {
  if (approvalStatus !== 'pending_approval') {
    return false;
  }
  if (actorRole === 'supreme_admin') {
    return true;
  }
  if (actorRole === 'moderator') {
    return ownerBadge === undefined || ownerBadge === null || ownerBadge === 'none';
  }
  return false;
}

export function canActorDeleteMarketplaceListing(actorRole: UserRole): boolean {
  return actorRole === 'supreme_admin';
}

export function canActorDeleteCommentByBadge(
  actorRole: UserRole,
  authorBadge: BadgeType | null | undefined
): boolean {
  if (actorRole === 'supreme_admin') {
    return true;
  }
  if (actorRole === 'moderator') {
    return canModeratorDeleteByBadge(authorBadge ?? 'none');
  }
  return false;
}

export interface PlatformOverviewStats {
  totalMembers: number;
  activeMembers: number;
  verifiedMembers: number;
  moderators: number;
  ordinaryMembers: number;
  supremeAdmins: number;
  suspendedMembers: number;
  totalActivePosts: number;
  publishedOrdinaryPosts: number;
  publishedAnonymousPosts: number;
  totalMarketplaceListings: number;
  pendingMarketplaceApprovals: number;
  approvedMarketplaceListings: number;
  rejectedMarketplaceListings: number;
  expiredMarketplaceListings: number;
  soldMarketplaceListings: number;
  totalOpportunities: number;
  activeOpportunities: number;
  totalEvents: number;
  upcomingEvents: number;
  totalFlaggedReports: number;
  pendingFlaggedReports: number;
  removedFlaggedReports: number;
  dismissedFlaggedReports: number;
  flaggedReportsByReason: Record<AnonymousReportReason, number>;
  flaggedReportsByTarget: {
    anonymousPost: number;
    anonymousComment: number;
  };
}

export function computePlatformOverviewStats(input: {
  profiles: readonly PublicUserProfile[];
  ordinaryPostsCount: number;
  anonymousPostsCount: number;
  listings: readonly MarketplaceListing[];
  opportunities: readonly Opportunity[];
  events: readonly CampusEvent[];
  reports?: readonly AnonymousReport[];
  nowMs?: number;
}): PlatformOverviewStats {
  const nowMs = input.nowMs ?? Date.now();

  let verifiedMembers = 0;
  let moderators = 0;
  let ordinaryMembers = 0;
  let supremeAdmins = 0;
  let suspendedMembers = 0;

  for (const profile of input.profiles) {
    if (profile.accountStatus === 'suspended') {
      suspendedMembers += 1;
    }
    if (profile.badge !== 'verified' && profile.isVerified === true) {
      verifiedMembers += 1;
    }
    switch (profile.badge) {
      case 'verified':
        verifiedMembers += 1;
        break;
      case 'moderator':
        moderators += 1;
        break;
      case 'supreme_admin':
        supremeAdmins += 1;
        break;
      case 'none':
      default:
        ordinaryMembers += 1;
        break;
    }
  }

  let pendingMarketplaceApprovals = 0;
  let approvedMarketplaceListings = 0;
  let rejectedMarketplaceListings = 0;
  let expiredMarketplaceListings = 0;
  let soldMarketplaceListings = 0;

  for (const listing of input.listings) {
    const expMs = extractTimestampMs(listing.expiresAt);
    const bucket = classifyMarketplaceListingBucket(listing, expMs, nowMs);
    if (bucket === 'pending') pendingMarketplaceApprovals += 1;
    else if (bucket === 'approved') approvedMarketplaceListings += 1;
    else if (bucket === 'rejected') rejectedMarketplaceListings += 1;
    else if (bucket === 'expired') expiredMarketplaceListings += 1;
    else if (bucket === 'sold') soldMarketplaceListings += 1;
  }

  let activeOpportunities = 0;
  for (const opp of input.opportunities) {
    const expMs = extractTimestampMs(opp.expiresAt);
    if (resolveOpportunityEffectiveStatus(opp, expMs, nowMs) === 'active') {
      activeOpportunities += 1;
    }
  }

  let upcomingEvents = 0;
  for (const evt of input.events) {
    const lifecycle = resolveEventLifecycle(evt, nowMs);
    if (lifecycle.isPublished && (lifecycle.isUpcoming || lifecycle.isOngoing)) {
      upcomingEvents += 1;
    }
  }

  const flaggedReportsByReason: Record<AnonymousReportReason, number> = {
    harassment: 0,
    hate_speech: 0,
    privacy_leak: 0,
    misinformation: 0,
    spam: 0,
    other: 0,
  };
  let pendingFlaggedReports = 0;
  let removedFlaggedReports = 0;
  let dismissedFlaggedReports = 0;
  let anonymousPostReports = 0;
  let anonymousCommentReports = 0;

  for (const report of input.reports ?? []) {
    if (report.status === 'pending') pendingFlaggedReports += 1;
    else if (report.status === 'reviewed_removed') removedFlaggedReports += 1;
    else if (report.status === 'dismissed') dismissedFlaggedReports += 1;

    if (report.targetType === 'anonymousPost') anonymousPostReports += 1;
    else if (report.targetType === 'anonymousComment') anonymousCommentReports += 1;

    if (Object.prototype.hasOwnProperty.call(flaggedReportsByReason, report.reason)) {
      flaggedReportsByReason[report.reason] += 1;
    } else {
      flaggedReportsByReason.other += 1;
    }
  }

  const activeMembers = Math.max(0, input.profiles.length - suspendedMembers);
  const totalActivePosts = input.ordinaryPostsCount + input.anonymousPostsCount;
  const totalFlaggedReports = (input.reports ?? []).length;

  return {
    totalMembers: input.profiles.length,
    activeMembers,
    verifiedMembers,
    moderators,
    ordinaryMembers,
    supremeAdmins,
    suspendedMembers,
    totalActivePosts,
    publishedOrdinaryPosts: input.ordinaryPostsCount,
    publishedAnonymousPosts: input.anonymousPostsCount,
    totalMarketplaceListings: input.listings.length,
    pendingMarketplaceApprovals,
    approvedMarketplaceListings,
    rejectedMarketplaceListings,
    expiredMarketplaceListings,
    soldMarketplaceListings,
    totalOpportunities: input.opportunities.length,
    activeOpportunities,
    totalEvents: input.events.length,
    upcomingEvents,
    totalFlaggedReports,
    pendingFlaggedReports,
    removedFlaggedReports,
    dismissedFlaggedReports,
    flaggedReportsByReason,
    flaggedReportsByTarget: {
      anonymousPost: anonymousPostReports,
      anonymousComment: anonymousCommentReports,
    },
  };
}

export function formatAdminAuditActionLabel(
  action: AdminAuditAction | BadgeAuditAction
): string {
  switch (action) {
    case 'grant_verified':
      return 'Granted Verified badge';
    case 'remove_verified':
      return 'Removed Verified badge';
    case 'grant_moderator':
      return 'Granted Moderator badge';
    case 'promote_verified_to_moderator':
      return 'Promoted Verified -> Moderator';
    case 'demote_moderator_to_verified':
      return 'Demoted Moderator -> Verified';
    case 'demote_moderator_to_member':
      return 'Demoted Moderator -> Member';
    case 'remove_moderator':
      return 'Removed Moderator badge';
    case 'grant_supreme_admin':
      return 'Granted Supreme Admin';
    case 'remove_supreme_admin':
      return 'Removed Supreme Admin';
    case 'suspend_account':
      return 'Suspended account';
    case 'restore_account':
      return 'Restored account';
    case 'marketplace_approved':
      return 'Approved marketplace listing';
    case 'marketplace_rejected':
      return 'Rejected marketplace listing';
    case 'marketplace_removed':
      return 'Removed marketplace listing';
    case 'marketplace_status_updated':
      return 'Updated marketplace listing status';
    case 'post_deleted':
      return 'Deleted community post';
    case 'anonymous_post_deleted':
      return 'Deleted anonymous post';
    case 'post_comment_deleted':
      return 'Deleted post comment';
    case 'anonymous_comment_deleted':
      return 'Deleted anonymous comment';
    case 'anonymous_report_dismissed':
      return 'Dismissed anonymous report';
    case 'anonymous_report_removed':
      return 'Removed reported anonymous content';
    case 'post_pinned':
      return 'Pinned community post';
    case 'post_unpinned':
      return 'Unpinned community post';
    case 'post_official_toggled':
      return 'Updated official post flag';
    case 'opportunity_created':
      return 'Published opportunity';
    case 'opportunity_updated':
      return 'Updated opportunity';
    case 'opportunity_expired':
      return 'Marked opportunity expired';
    case 'opportunity_deleted':
      return 'Removed opportunity';
    case 'event_created':
      return 'Published campus event';
    case 'event_updated':
      return 'Updated campus event';
    case 'event_cancelled':
      return 'Cancelled campus event';
    case 'event_deleted':
      return 'Removed campus event';
    case 'trusted_contact_created':
      return 'Added Trusted Circle contact';
    case 'trusted_contact_updated':
      return 'Updated Trusted Circle contact';
    case 'trusted_contact_deleted':
      return 'Removed Trusted Circle contact';
    case 'settings_updated':
      return 'Updated platform settings';
    case 'announcement_broadcast':
      return 'Published official announcement';
    case 'update_created':
      return 'Published official update';
    case 'update_updated':
      return 'Edited official update';
    case 'update_deleted':
      return 'Deleted official update';
    case 'poll_created':
      return 'Created official poll';
    case 'poll_updated':
      return 'Updated official poll';
    case 'poll_closed':
      return 'Closed official poll';
    case 'poll_deleted':
      return 'Deleted official poll';
  }
}

export interface OpportunityFormInput {
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
  opensAtIso?: string;
  expiresAtIso: string;
  isVerified?: boolean;
  status?: OpportunityStatus;
}

export function validateOpportunityFormInput(
  input: OpportunityFormInput
): string | null {
  const title = input.title.trim();
  const org = input.organisation.trim();
  const desc = input.description.trim();
  const appUrl = input.applicationUrl.trim();
  const whoCanApply = input.whoCanApply?.trim() ?? '';

  if (
    title.length < BLUEPRINT_LIMITS.opportunityTitleMin ||
    title.length > BLUEPRINT_LIMITS.opportunityTitleMax
  ) {
    return `Opportunity title must be ${BLUEPRINT_LIMITS.opportunityTitleMin}–${BLUEPRINT_LIMITS.opportunityTitleMax} characters.`;
  }
  if (
    org.length < BLUEPRINT_LIMITS.organisationMin ||
    org.length > BLUEPRINT_LIMITS.organisationMax
  ) {
    return `Organisation name must be ${BLUEPRINT_LIMITS.organisationMin}–${BLUEPRINT_LIMITS.organisationMax} characters.`;
  }
  if (desc.length < 5 || desc.length > BLUEPRINT_LIMITS.postBodyMax) {
    return 'Opportunity description must be between 5 and 5000 characters.';
  }
  if (whoCanApply.length > 1000) {
    return 'Who Can Apply details must be 1000 characters or fewer.';
  }
  if (appUrl && !isSafeMediaUrl(appUrl)) {
    return 'Application link must be a valid http(s) URL (max 512 characters).';
  }
  const deadlineMs = Date.parse(input.expiresAtIso);
  if (!Number.isFinite(deadlineMs)) {
    return 'Provide a valid deadline date and time.';
  }
  if (input.opensAtIso?.trim()) {
    const opensMs = Date.parse(input.opensAtIso);
    if (!Number.isFinite(opensMs)) {
      return 'Provide a valid opening date and time.';
    }
    if (opensMs > deadlineMs) {
      return 'Opening date cannot be later than the application deadline.';
    }
  }
  return null;
}

export interface CampusEventFormInput {
  category?: EventCategory;
  title: string;
  description: string;
  eventDateIso: string;
  endDateIso?: string;
  timeLabel?: string;
  venue: string;
  organiser: string;
  registrationRequired?: boolean;
  registrationUrl?: string;
  onlineMeetingUrl?: string;
  contactInfo?: string;
  instructions?: string;
  bannerUrl?: string;
  status?: CampusEventStatus;
  published?: boolean;
}

export function validateCampusEventFormInput(
  input: CampusEventFormInput
): string | null {
  const title = input.title.trim();
  const desc = input.description.trim();
  const venue = input.venue.trim();
  const organiser = input.organiser.trim();

  if (
    title.length < BLUEPRINT_LIMITS.opportunityTitleMin ||
    title.length > BLUEPRINT_LIMITS.opportunityTitleMax
  ) {
    return `Event title must be ${BLUEPRINT_LIMITS.opportunityTitleMin}–${BLUEPRINT_LIMITS.opportunityTitleMax} characters.`;
  }
  if (desc.length < 5 || desc.length > BLUEPRINT_LIMITS.postBodyMax) {
    return 'Event description must be between 5 and 5000 characters.';
  }
  if (venue.length < 2 || venue.length > BLUEPRINT_LIMITS.eventVenueMax) {
    return `Event venue must be 2–${BLUEPRINT_LIMITS.eventVenueMax} characters.`;
  }
  if (
    organiser.length < BLUEPRINT_LIMITS.organisationMin ||
    organiser.length > BLUEPRINT_LIMITS.organisationMax
  ) {
    return `Organiser must be ${BLUEPRINT_LIMITS.organisationMin}–${BLUEPRINT_LIMITS.organisationMax} characters.`;
  }
  const eventMs = Date.parse(input.eventDateIso);
  if (!Number.isFinite(eventMs)) {
    return 'Provide a valid start date and time.';
  }
  if (input.endDateIso?.trim()) {
    const endMs = Date.parse(input.endDateIso);
    if (!Number.isFinite(endMs)) {
      return 'Provide a valid event end date and time.';
    }
    if (endMs <= eventMs) {
      return 'Event end time must be after the start time.';
    }
  }
  if (input.bannerUrl?.trim() && !isSafeMediaUrl(input.bannerUrl)) {
    return 'Cover image link must start with https:// or http://.';
  }
  if (input.registrationUrl?.trim() && !isSafeMediaUrl(input.registrationUrl)) {
    return 'Registration link must start with https:// or http://.';
  }
  if (
    input.onlineMeetingUrl?.trim() &&
    !isSafeMediaUrl(input.onlineMeetingUrl)
  ) {
    return 'Meeting link must start with https:// or http://.';
  }
  if (input.contactInfo && input.contactInfo.trim().length > 256) {
    return 'Contact details must be 256 characters or fewer.';
  }
  return null;
}

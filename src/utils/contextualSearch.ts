import type {
  AnonymousPost,
  CampusEvent,
  CommunityPost,
  MarketplaceListing,
  Opportunity,
  PublicProfileProjection,
  PublicUserProfile,
  TrustedContact,
} from '../types/database';
import type { SearchScopeId } from '../types/platform';
import { getOpportunityCategoryLabel } from './opportunities';

export interface SearchScopeMeta {
  id: SearchScopeId;
  label: string;
  placeholder: string;
  description: string;
}

export const SEARCH_SCOPE_CONFIG: Record<SearchScopeId, SearchScopeMeta> = {
  home: {
    id: 'home',
    label: 'Members & Campus Posts',
    placeholder: 'Search members by name or @username, or search campus posts...',
    description:
      'Matches registered campus members and published ordinary community updates. Anonymous posts never appear here.',
  },
  anonymous: {
    id: 'anonymous',
    label: 'Anonymous Posts Only',
    placeholder: 'Search anonymous campus posts by topic or message...',
    description:
      'Searches only published anonymous campus posts. Member names, usernames, photos, and identities are strictly excluded.',
  },
  marketplace: {
    id: 'marketplace',
    label: 'Marketplace Listings',
    placeholder: 'Search active listings by title, category, or description...',
    description:
      'Matches approved, active, non-expired campus products, services, and accommodation listings.',
  },
  'trusted-circle': {
    id: 'trusted-circle',
    label: 'Trusted Circle Contacts',
    placeholder: 'Search official contacts by name, role, department, or faculty...',
    description:
      'Searches administrator-listed official campus contacts (distinct from member accounts).',
  },
  opportunities: {
    id: 'opportunities',
    label: 'Opportunities',
    placeholder:
      'Search scholarships, grants, internships, jobs, or conferences...',
    description:
      'Matches active scholarships, grants, internships, jobs, competitions, programmes, trainings, and conferences.',
  },
  'upcoming-events': {
    id: 'upcoming-events',
    label: 'Upcoming Events',
    placeholder: 'Search campus events by title, organiser, venue, or details...',
    description: 'Matches active campus events (cancelled events are excluded).',
  },
};

export const FIRESTORE_SEARCH_SCOPE_NOTE =
  'Search evaluates recent published campus records available in this section.';

export function sanitizeAnonymousPostForSearch(
  raw: Record<string, unknown>
): AnonymousPost {
  const rawMedia = Array.isArray(raw.mediaItems) ? raw.mediaItems : undefined;
  return {
    id: String(raw.id ?? ''),
    category: String(raw.category ?? ''),
    body: String(raw.body ?? ''),
    backgroundStyle:
      typeof raw.backgroundStyle === 'string'
        ? (raw.backgroundStyle as AnonymousPost['backgroundStyle'])
        : undefined,
    mediaItems: rawMedia as AnonymousPost['mediaItems'],
    status: raw.status === 'deleted' ? 'deleted' : 'published',
    visibility: 'public',
    likesCount: typeof raw.likesCount === 'number' ? raw.likesCount : 0,
    commentsCount: typeof raw.commentsCount === 'number' ? raw.commentsCount : 0,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

export function sanitizePublicProfileProjection(
  profile: PublicUserProfile
): PublicProfileProjection {
  return {
    fullName: profile.fullName,
    username: profile.username,
    bio: profile.bio,
    department: profile.department,
    faculty: profile.faculty,
    level: profile.level,
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

export function extractTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'object' && value !== null) {
    const maybe = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === 'function') {
      return maybe.toMillis();
    }
    if (typeof maybe.seconds === 'number') {
      return maybe.seconds * 1000;
    }
  }
  return null;
}

export function filterMemberMatches(
  profiles: PublicUserProfile[],
  rawQuery: string
): PublicProfileProjection[] {
  const normalized = rawQuery.trim().toLowerCase().replace(/^@+/, '');
  if (!normalized) return [];

  const scored: { score: number; profile: PublicProfileProjection }[] = [];

  for (const profile of profiles) {
    if (profile.isHiddenFromDirectory || profile.accountStatus !== 'active') {
      continue;
    }
    const username = profile.username.toLowerCase();
    const fullName = profile.fullName.toLowerCase();
    const department = (profile.department ?? '').toLowerCase();
    const faculty = (profile.faculty ?? '').toLowerCase();
    const level = (profile.level ?? '').toLowerCase();

    let score = 0;
    if (username === normalized || fullName === normalized) {
      score = 100;
    } else if (username.startsWith(normalized) || fullName.startsWith(normalized)) {
      score = 80;
    } else if (username.includes(normalized) || fullName.includes(normalized)) {
      score = 60;
    } else if (
      department.includes(normalized) ||
      faculty.includes(normalized) ||
      level.includes(normalized)
    ) {
      score = 35;
    }

    if (score > 0) {
      scored.push({
        score,
        profile: sanitizePublicProfileProjection(profile),
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.profile.followersCount - a.profile.followersCount;
  });

  return scored.map((item) => item.profile);
}

export interface SearchableCommunityPostItem {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export function filterCommunityPosts(
  items: SearchableCommunityPostItem[],
  rawQuery: string
): SearchableCommunityPostItem[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return items.filter(({ post, author }) => {
    if (post.status !== 'published') return false;
    if (author && author.accountStatus !== 'active') return false;
    const title = (post.title ?? '').toLowerCase();
    const body = post.body.toLowerCase();
    const category = post.category.toLowerCase();
    const authorName = (author?.fullName ?? '').toLowerCase();
    const authorUsername = (author?.username ?? '').toLowerCase();

    return (
      title.includes(normalized) ||
      body.includes(normalized) ||
      category.includes(normalized) ||
      authorName.includes(normalized) ||
      authorUsername.includes(normalized)
    );
  });
}

export function filterAnonymousPosts(
  rawPosts: Record<string, unknown>[],
  rawQuery: string
): AnonymousPost[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return rawPosts
    .map(sanitizeAnonymousPostForSearch)
    .filter(
      (post) =>
        post.status === 'published' &&
        (post.body.toLowerCase().includes(normalized) ||
          post.category.toLowerCase().includes(normalized))
    );
}

export function filterMarketplaceListings(
  listings: MarketplaceListing[],
  rawQuery: string,
  nowMs: number = Date.now()
): MarketplaceListing[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return listings.filter((item) => {
    if (item.status !== 'active' || item.approvalStatus !== 'approved') {
      return false;
    }
    const expiresMs = extractTimestampMs(item.expiresAt);
    if (expiresMs !== null && nowMs >= expiresMs) {
      return false;
    }
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      item.category.toLowerCase().includes(normalized) ||
      item.listingKind.toLowerCase().includes(normalized)
    );
  });
}

export function filterTrustedContacts(
  contacts: TrustedContact[],
  rawQuery: string
): TrustedContact[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return contacts.filter((item) => {
    const fullName = item.fullName.toLowerCase();
    const roleTitle = item.roleTitle.toLowerCase();
    const department = (item.department ?? '').toLowerCase();
    const faculty = (item.faculty ?? '').toLowerCase();
    const category = item.category.replace(/_/g, ' ').toLowerCase();
    return (
      fullName.includes(normalized) ||
      roleTitle.includes(normalized) ||
      department.includes(normalized) ||
      faculty.includes(normalized) ||
      category.includes(normalized)
    );
  });
}

export function filterOpportunities(
  items: Opportunity[],
  rawQuery: string,
  nowMs: number = Date.now()
): Opportunity[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return items.filter((item) => {
    if (item.status !== 'active') return false;
    const expiresMs = extractTimestampMs(item.expiresAt);
    if (expiresMs !== null && nowMs >= expiresMs) {
      return false;
    }
    const categoryLabel = getOpportunityCategoryLabel(item.category).toLowerCase();
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.organisation.toLowerCase().includes(normalized) ||
      item.category.toLowerCase().includes(normalized) ||
      categoryLabel.includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      (item.eligibility ?? '').toLowerCase().includes(normalized) ||
      (item.whoCanApply ?? '').toLowerCase().includes(normalized) ||
      (item.benefits ?? '').toLowerCase().includes(normalized)
    );
  });
}

export function filterCampusEvents(
  events: CampusEvent[],
  rawQuery: string
): CampusEvent[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return events.filter((item) => {
    if (item.published === false) return false;
    if (item.status === 'cancelled') return false;
    const categoryText = (item.category ?? '').replace(/_/g, ' ').toLowerCase();
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.organiser.toLowerCase().includes(normalized) ||
      item.venue.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      (item.instructions ?? '').toLowerCase().includes(normalized) ||
      categoryText.includes(normalized)
    );
  });
}

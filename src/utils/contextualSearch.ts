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
import { getEventCategoryLabel, resolveEventLifecycle } from './events';
import {
  getOpportunityCategoryLabel,
  resolveOpportunityLifecycle,
} from './opportunities';

export interface SearchScopeMeta {
  id: SearchScopeId;
  label: string;
  placeholder: string;
  description: string;
}

export const SEARCH_SCOPE_CONFIG: Record<SearchScopeId, SearchScopeMeta> = {
  all: {
    id: 'all',
    label: 'All LASUED Intel',
    placeholder:
      'Search posts, @usernames, marketplace listings, events, or opportunities...',
    description:
      'Searches public campus updates, anonymous posts, member profiles, Marketplace listings, events, opportunities, and Trusted Circle.',
  },
  posts: {
    id: 'posts',
    label: 'Community Posts',
    placeholder: 'Search campus updates by title, topic, category, or author...',
    description:
      'Matches published public updates and campus news from verified contributors.',
  },
  people: {
    id: 'people',
    label: 'People & Usernames',
    placeholder: 'Search LASUED Intel members by name, @username, or department...',
    description:
      'Matches active public member profiles across campus departments and faculties.',
  },
  home: {
    id: 'home',
    label: 'Members & Campus Posts',
    placeholder:
      'Search members by name or @username, or search campus posts...',
    description:
      'Matches registered campus members and published public community updates.',
  },
  anonymous: {
    id: 'anonymous',
    label: 'Anonymous Posts',
    placeholder: 'Search anonymous campus posts by topic or message...',
    description:
      'Searches published anonymous campus posts only. Member names, usernames, photos, and identities are strictly excluded.',
  },
  marketplace: {
    id: 'marketplace',
    label: 'Marketplace',
    placeholder:
      'Search active products, services, or accommodation by keyword...',
    description:
      'Matches approved, active, non-expired campus products, services, and accommodation listings.',
  },
  'trusted-circle': {
    id: 'trusted-circle',
    label: 'Trusted Circle',
    placeholder:
      'Search official contacts by name, role, department, or faculty...',
    description:
      'Searches official campus contacts and verified directory profiles.',
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
    label: 'Events',
    placeholder:
      'Search campus events by title, organiser, venue, or details...',
    description:
      'Matches published campus lectures, orientations, seminars, and student activities.',
  },
};

export const FIRESTORE_SEARCH_SCOPE_NOTE =
  'Results only show active, published campus records matching your search terms.';

export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MIN_SEARCH_QUERY_LENGTH = 2;

export type SearchSortOption = 'relevant' | 'newest' | 'oldest';

export interface SearchFiltersState {
  sortBy: SearchSortOption;
  category: string;
  department: string;
  availability: string;
}

export const DEFAULT_SEARCH_FILTERS: SearchFiltersState = {
  sortBy: 'relevant',
  category: 'all',
  department: 'all',
  availability: 'all',
};

export interface SearchQueryValidation {
  valid: boolean;
  reason: 'ok' | 'empty' | 'too_short';
  normalizedQuery: string;
  tokens: string[];
  message?: string;
}

export function normalizeSearchInput(rawQuery: string): string {
  return Array.from(rawQuery)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function tokenizeSearchQuery(rawQuery: string): string[] {
  const normalized = normalizeSearchInput(rawQuery).toLowerCase();
  if (!normalized) return [];
  const rawTokens = normalized.split(' ');
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of rawTokens) {
    const cleaned = rawToken.replace(/^@+/, '').trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      tokens.push(cleaned);
    }
  }
  return tokens;
}

export function validateSearchQuery(rawQuery: string): SearchQueryValidation {
  const normalizedQuery = normalizeSearchInput(rawQuery);
  if (!normalizedQuery) {
    return {
      valid: false,
      reason: 'empty',
      normalizedQuery: '',
      tokens: [],
    };
  }
  const tokens = tokenizeSearchQuery(normalizedQuery);
  const meaningfulChars = normalizedQuery.replace(/^@+/, '').trim();
  if (meaningfulChars.length < MIN_SEARCH_QUERY_LENGTH || tokens.length === 0) {
    return {
      valid: false,
      reason: 'too_short',
      normalizedQuery,
      tokens,
      message: `Enter at least ${MIN_SEARCH_QUERY_LENGTH} characters to search across LASUED Intel.`,
    };
  }
  return {
    valid: true,
    reason: 'ok',
    normalizedQuery,
    tokens,
  };
}

export interface SearchableField {
  text?: string | null;
  weight: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scoreSearchFields(
  fields: SearchableField[],
  rawQuery: string
): number {
  const normalized = normalizeSearchInput(rawQuery).toLowerCase();
  const tokens = tokenizeSearchQuery(rawQuery);
  if (!normalized || tokens.length === 0) return 0;

  const cleanPhrase = normalized.replace(/^@+/, '').trim();
  const preparedFields = fields
    .map((f) => ({
      text: (f.text ?? '').trim().toLowerCase(),
      weight: f.weight,
    }))
    .filter((f) => f.text.length > 0);

  if (preparedFields.length === 0) return 0;

  const combinedText = preparedFields.map((f) => f.text).join(' ');

  // Strict multi-word AND matching: every token must appear somewhere in searchable fields
  for (const token of tokens) {
    if (!combinedText.includes(token)) {
      return 0;
    }
  }

  let totalScore = 0;

  for (const field of preparedFields) {
    if (cleanPhrase && field.text === cleanPhrase) {
      totalScore += 120 * field.weight;
    } else if (cleanPhrase && field.text.startsWith(cleanPhrase)) {
      totalScore += 75 * field.weight;
    } else if (
      cleanPhrase &&
      tokens.length > 1 &&
      field.text.includes(cleanPhrase)
    ) {
      totalScore += 55 * field.weight;
    }

    for (const token of tokens) {
      if (field.text === token) {
        totalScore += 80 * field.weight;
      } else if (field.text.startsWith(token)) {
        totalScore += 45 * field.weight;
      } else {
        const wordRegex = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}`);
        if (wordRegex.test(field.text)) {
          totalScore += 28 * field.weight;
        } else if (field.text.includes(token)) {
          totalScore += 14 * field.weight;
        }
      }
    }
  }

  return totalScore;
}

export function sanitizeAnonymousPostForSearch(
  raw: Record<string, unknown>
): AnonymousPost {
  const rawMedia = Array.isArray(raw.mediaItems) ? raw.mediaItems : undefined;
  return {
    id: String(raw.id ?? ''),
    postType:
      raw.postType === 'photo' || raw.postType === 'text'
        ? raw.postType
        : undefined,
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

export function deduplicateByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function filterMemberMatches(
  profiles: PublicUserProfile[],
  rawQuery: string
): PublicProfileProjection[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: { score: number; profile: PublicProfileProjection }[] = [];

  for (const profile of profiles) {
    if (profile.isHiddenFromDirectory || profile.accountStatus !== 'active') {
      continue;
    }

    const score = scoreSearchFields(
      [
        { text: profile.username, weight: 3.5 },
        { text: profile.fullName, weight: 3.0 },
        { text: profile.department, weight: 1.4 },
        { text: profile.faculty, weight: 1.2 },
        { text: profile.level, weight: 1.0 },
        { text: profile.bio, weight: 0.8 },
        { text: profile.accountCategory, weight: 1.0 },
      ],
      rawQuery
    );

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

  return deduplicateByKey(
    scored.map((item) => item.profile),
    (p) => p.username.toLowerCase()
  );
}

export interface SearchableCommunityPostItem {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export function filterCommunityPosts(
  items: SearchableCommunityPostItem[],
  rawQuery: string
): SearchableCommunityPostItem[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{
    score: number;
    createdAtMs: number;
    item: SearchableCommunityPostItem;
  }> = [];

  for (const entry of items) {
    const { post, author } = entry;
    if (post.status !== 'published') continue;
    if (author && author.accountStatus !== 'active') continue;

    const score = scoreSearchFields(
      [
        { text: post.title, weight: 3.0 },
        { text: post.category, weight: 2.0 },
        { text: post.body, weight: 1.4 },
        { text: author?.fullName, weight: 1.8 },
        { text: author?.username, weight: 1.8 },
        { text: author?.department, weight: 1.0 },
        { text: author?.faculty, weight: 0.9 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({
        score,
        createdAtMs: extractTimestampMs(post.createdAt) ?? 0,
        item: entry,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAtMs - a.createdAtMs;
  });

  return deduplicateByKey(
    scored.map((entry) => entry.item),
    (entry) => entry.post.id
  );
}

export function filterAnonymousPosts(
  rawPosts: Record<string, unknown>[],
  rawQuery: string
): AnonymousPost[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{
    score: number;
    createdAtMs: number;
    post: AnonymousPost;
  }> = [];

  for (const raw of rawPosts) {
    const post = sanitizeAnonymousPostForSearch(raw);
    if (post.status !== 'published' || !post.id) continue;

    const score = scoreSearchFields(
      [
        { text: post.category, weight: 2.0 },
        { text: post.body, weight: 1.6 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({
        score,
        createdAtMs: extractTimestampMs(post.createdAt) ?? 0,
        post,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAtMs - a.createdAtMs;
  });

  return deduplicateByKey(
    scored.map((entry) => entry.post),
    (p) => p.id
  );
}

export function filterMarketplaceListings(
  listings: MarketplaceListing[],
  rawQuery: string,
  nowMs: number = Date.now()
): MarketplaceListing[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{
    score: number;
    createdAtMs: number;
    listing: MarketplaceListing;
  }> = [];

  for (const item of listings) {
    if (item.status !== 'active' || item.approvalStatus !== 'approved') {
      continue;
    }
    const expiresMs = extractTimestampMs(item.expiresAt);
    if (expiresMs !== null && nowMs >= expiresMs) {
      continue;
    }

    const score = scoreSearchFields(
      [
        { text: item.title, weight: 3.2 },
        { text: item.category, weight: 2.0 },
        { text: item.listingKind, weight: 1.6 },
        { text: item.description, weight: 1.3 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({
        score,
        createdAtMs: extractTimestampMs(item.createdAt) ?? 0,
        listing: item,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAtMs - a.createdAtMs;
  });

  return deduplicateByKey(
    scored.map((entry) => entry.listing),
    (l) => l.id
  );
}

export function filterTrustedContacts(
  contacts: TrustedContact[],
  rawQuery: string
): TrustedContact[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{ score: number; contact: TrustedContact }> = [];

  for (const item of contacts) {
    const score = scoreSearchFields(
      [
        { text: item.fullName, weight: 3.2 },
        { text: item.roleTitle, weight: 2.2 },
        { text: item.department, weight: 1.6 },
        { text: item.faculty, weight: 1.4 },
        { text: item.category.replace(/_/g, ' '), weight: 1.4 },
        { text: item.badgeLabel, weight: 1.4 },
        { text: item.description, weight: 1.0 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({ score, contact: item });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.contact.fullName.localeCompare(b.contact.fullName);
  });

  return deduplicateByKey(
    scored.map((entry) => entry.contact),
    (c) => c.id
  );
}

export function filterOpportunities(
  items: Opportunity[],
  rawQuery: string,
  nowMs: number = Date.now()
): Opportunity[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{
    score: number;
    createdAtMs: number;
    opp: Opportunity;
  }> = [];

  for (const item of items) {
    if (item.status !== 'active') continue;
    const expiresMs = extractTimestampMs(item.expiresAt);
    if (expiresMs !== null && nowMs >= expiresMs) {
      continue;
    }

    const categoryLabel = getOpportunityCategoryLabel(item.category);
    const score = scoreSearchFields(
      [
        { text: item.title, weight: 3.2 },
        { text: item.organisation, weight: 2.2 },
        { text: categoryLabel, weight: 2.0 },
        { text: item.category, weight: 1.8 },
        { text: item.description, weight: 1.2 },
        { text: item.eligibility, weight: 1.0 },
        { text: item.whoCanApply, weight: 1.0 },
        { text: item.benefits, weight: 1.0 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({
        score,
        createdAtMs: extractTimestampMs(item.createdAt) ?? 0,
        opp: item,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAtMs - a.createdAtMs;
  });

  return deduplicateByKey(
    scored.map((entry) => entry.opp),
    (o) => o.id
  );
}

export function filterCampusEvents(
  events: CampusEvent[],
  rawQuery: string
): CampusEvent[] {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) return [];

  const scored: Array<{
    score: number;
    eventDateMs: number;
    event: CampusEvent;
  }> = [];

  for (const item of events) {
    if (item.published === false) continue;
    if (item.status === 'cancelled') continue;

    const categoryText = (item.category ?? '').replace(/_/g, ' ');
    const categoryLabel = getEventCategoryLabel(item.category);
    const score = scoreSearchFields(
      [
        { text: item.title, weight: 3.2 },
        { text: item.organiser, weight: 2.2 },
        { text: item.venue, weight: 2.0 },
        { text: categoryLabel, weight: 2.0 },
        { text: categoryText, weight: 1.8 },
        { text: item.description, weight: 1.2 },
        { text: item.instructions, weight: 0.9 },
      ],
      rawQuery
    );

    if (score > 0) {
      scored.push({
        score,
        eventDateMs: extractTimestampMs(item.eventDate) ?? 0,
        event: item,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.eventDateMs - a.eventDateMs;
  });

  return deduplicateByKey(
    scored.map((entry) => entry.event),
    (e) => e.id
  );
}

// ---------------------------------------------------------------------------
// Advanced Discovery Filtering & Sorting (per category & sort mode)
// ---------------------------------------------------------------------------

function sortByOption<T>(
  items: T[],
  sortBy: SearchSortOption,
  getTimeMs: (item: T) => number
): T[] {
  if (sortBy === 'relevant') {
    return items;
  }
  const copy = [...items];
  copy.sort((a, b) => {
    const aMs = getTimeMs(a);
    const bMs = getTimeMs(b);
    return sortBy === 'newest' ? bMs - aMs : aMs - bMs;
  });
  return copy;
}

export function applyPeopleSearchFilters(
  members: PublicProfileProjection[],
  filters: SearchFiltersState
): PublicProfileProjection[] {
  let list = deduplicateByKey(members, (m) => m.username.toLowerCase());
  if (filters.department !== 'all') {
    const dep = filters.department.toLowerCase();
    list = list.filter(
      (m) =>
        (m.department ?? '').toLowerCase() === dep ||
        (m.faculty ?? '').toLowerCase() === dep
    );
  }
  return sortByOption(
    list,
    filters.sortBy,
    (m) => extractTimestampMs(m.createdAt) ?? 0
  );
}

export const applyMemberSearchFilters = applyPeopleSearchFilters;

export function applyPostSearchFilters(
  posts: SearchableCommunityPostItem[],
  filters: SearchFiltersState
): SearchableCommunityPostItem[] {
  let list = deduplicateByKey(posts, (item) => item.post.id);
  if (filters.category !== 'all') {
    const cat = filters.category.toLowerCase();
    list = list.filter((item) => item.post.category.toLowerCase() === cat);
  }
  if (filters.department !== 'all') {
    const dep = filters.department.toLowerCase();
    list = list.filter(
      (item) =>
        (item.author?.department ?? '').toLowerCase() === dep ||
        (item.author?.faculty ?? '').toLowerCase() === dep
    );
  }
  return sortByOption(
    list,
    filters.sortBy,
    (item) => extractTimestampMs(item.post.createdAt) ?? 0
  );
}

export function applyAnonymousSearchFilters(
  posts: AnonymousPost[],
  filters: SearchFiltersState
): AnonymousPost[] {
  let list = deduplicateByKey(posts, (p) => p.id);
  if (filters.category !== 'all') {
    const cat = filters.category.toLowerCase();
    list = list.filter((p) => p.category.toLowerCase() === cat);
  }
  return sortByOption(
    list,
    filters.sortBy,
    (p) => extractTimestampMs(p.createdAt) ?? 0
  );
}

export function applyMarketplaceSearchFilters(
  listings: MarketplaceListing[],
  filters: SearchFiltersState
): MarketplaceListing[] {
  let list = deduplicateByKey(listings, (l) => l.id);
  if (filters.category !== 'all') {
    if (filters.category.startsWith('kind:')) {
      const kind = filters.category.slice(5);
      list = list.filter((l) => l.listingKind === kind);
    } else {
      const cat = filters.category.toLowerCase();
      list = list.filter((l) => l.category.toLowerCase() === cat);
    }
  }
  if (filters.availability === 'available') {
    list = list.filter((l) => l.status === 'active' && l.quantity > 0);
  } else if (filters.availability === 'low_stock') {
    list = list.filter((l) => l.status === 'active' && l.quantity <= 2);
  }
  return sortByOption(
    list,
    filters.sortBy,
    (l) => extractTimestampMs(l.createdAt) ?? 0
  );
}

export function applyEventSearchFilters(
  events: CampusEvent[],
  filters: SearchFiltersState,
  nowMs: number = Date.now()
): CampusEvent[] {
  let list = deduplicateByKey(events, (e) => e.id);
  if (filters.category !== 'all') {
    list = list.filter((e) => e.category === filters.category);
  }
  if (
    filters.availability === 'upcoming' ||
    filters.availability === 'ongoing' ||
    filters.availability === 'completed'
  ) {
    list = list.filter(
      (e) => resolveEventLifecycle(e, nowMs).state === filters.availability
    );
  }
  return sortByOption(
    list,
    filters.sortBy,
    (e) =>
      extractTimestampMs(e.eventDate) ?? extractTimestampMs(e.createdAt) ?? 0
  );
}

export function applyOpportunitySearchFilters(
  opportunities: Opportunity[],
  filters: SearchFiltersState,
  nowMs: number = Date.now()
): Opportunity[] {
  let list = deduplicateByKey(opportunities, (o) => o.id);
  if (filters.category !== 'all') {
    list = list.filter((o) => o.category === filters.category);
  }
  if (
    filters.availability === 'open' ||
    filters.availability === 'closing_soon' ||
    filters.availability === 'closed'
  ) {
    list = list.filter(
      (o) =>
        resolveOpportunityLifecycle(o, nowMs).state === filters.availability
    );
  }
  return sortByOption(
    list,
    filters.sortBy,
    (o) => extractTimestampMs(o.createdAt) ?? 0
  );
}

export function applyTrustedContactSearchFilters(
  contacts: TrustedContact[],
  filters: SearchFiltersState
): TrustedContact[] {
  let list = deduplicateByKey(contacts, (c) => c.id);
  if (filters.category !== 'all') {
    list = list.filter((c) => c.category === filters.category);
  }
  if (filters.department !== 'all') {
    const dep = filters.department.toLowerCase();
    list = list.filter(
      (c) =>
        (c.department ?? '').toLowerCase() === dep ||
        (c.faculty ?? '').toLowerCase() === dep
    );
  }
  return sortByOption(
    list,
    filters.sortBy,
    (c) => extractTimestampMs(c.createdAt) ?? 0
  );
}

// ---------------------------------------------------------------------------
// Search Suggestions & Recent Search History
// ---------------------------------------------------------------------------

const RECENT_SEARCHES_STORAGE_KEY = 'lasued_intel_recent_searches_v1';
const MAX_RECENT_SEARCHES = 8;

export type SearchSuggestionKind = 'recent' | 'person' | 'category' | 'term';

export interface SearchSuggestionItem {
  id: string;
  kind: SearchSuggestionKind;
  label: string;
  subtitle?: string;
  query: string;
  targetScope?: SearchScopeId;
  username?: string;
}

export const DISCOVERY_CATEGORY_SUGGESTIONS: Array<{
  label: string;
  keywords: string[];
  query: string;
  targetScope: SearchScopeId;
  subtitle: string;
}> = [
  {
    label: 'Academic Updates',
    keywords: ['academic', 'lecture', 'exam', 'timetable', 'csc', 'course'],
    query: 'Academic',
    targetScope: 'posts',
    subtitle: 'Category · Community Posts',
  },
  {
    label: 'Campus News & Notices',
    keywords: ['news', 'campus', 'notice', 'senate', 'vc', 'announcement'],
    query: 'Campus News',
    targetScope: 'posts',
    subtitle: 'Category · Community Posts',
  },
  {
    label: 'Scholarships & Grants',
    keywords: ['scholarship', 'grant', 'bursary', 'fellowship', 'tuition'],
    query: 'scholarship',
    targetScope: 'opportunities',
    subtitle: 'Category · Opportunities',
  },
  {
    label: 'Internships & Career Jobs',
    keywords: ['internship', 'siwes', 'job', 'career', 'training', 'workshop'],
    query: 'internship',
    targetScope: 'opportunities',
    subtitle: 'Category · Opportunities',
  },
  {
    label: 'Textbooks & Study Materials',
    keywords: ['textbook', 'book', 'handout', 'calculator', 'educational'],
    query: 'textbook',
    targetScope: 'marketplace',
    subtitle: 'Category · Campus Marketplace',
  },
  {
    label: 'Hostel & Accommodation',
    keywords: ['hostel', 'accommodation', 'room', 'lodge', 'self contain'],
    query: 'hostel',
    targetScope: 'marketplace',
    subtitle: 'Category · Campus Marketplace',
  },
  {
    label: 'Electronics & Gadgets',
    keywords: ['laptop', 'phone', 'charger', 'electronics', 'gadgets'],
    query: 'laptop',
    targetScope: 'marketplace',
    subtitle: 'Category · Campus Marketplace',
  },
  {
    label: 'Orientations & Seminars',
    keywords: ['orientation', 'seminar', 'conference', 'freshers', 'event'],
    query: 'seminar',
    targetScope: 'upcoming-events',
    subtitle: 'Category · Campus Events',
  },
  {
    label: 'Department Contacts & Advisers',
    keywords: ['lecturer', 'hod', 'adviser', 'president', 'office', 'faculty'],
    query: 'Department',
    targetScope: 'trusted-circle',
    subtitle: 'Directory · Trusted Circle',
  },
];

export function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length >= 2)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentSearch(rawQuery: string): string[] {
  const clean = normalizeSearchInput(rawQuery);
  if (clean.replace(/^@+/, '').trim().length < MIN_SEARCH_QUERY_LENGTH) {
    return loadRecentSearches();
  }
  const existing = loadRecentSearches();
  const next = [
    clean,
    ...existing.filter((item) => item.toLowerCase() !== clean.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        RECENT_SEARCHES_STORAGE_KEY,
        JSON.stringify(next)
      );
    } catch {
      // Ignore storage quota restrictions
    }
  }
  return next;
}

export function removeRecentSearch(termToRemove: string): string[] {
  const next = loadRecentSearches().filter(
    (item) => item.toLowerCase() !== termToRemove.trim().toLowerCase()
  );
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        RECENT_SEARCHES_STORAGE_KEY,
        JSON.stringify(next)
      );
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function buildSearchSuggestions(input: {
  rawQuery: string;
  recentSearches?: string[];
  members?: PublicProfileProjection[];
  dynamicTerms?: Array<{
    term: string;
    subtitle?: string;
    targetScope?: SearchScopeId;
  }>;
  scope?: SearchScopeId;
  maxItems?: number;
}): SearchSuggestionItem[] {
  const normalized = normalizeSearchInput(input.rawQuery).toLowerCase();
  const cleanNeedle = normalized.replace(/^@+/, '').trim();
  const maxItems = input.maxItems ?? 7;

  // Do not show noisy suggestions for 0 or 1 char unless matching recent history when input is empty
  if (!normalized) {
    return (input.recentSearches ?? []).slice(0, 5).map((term) => ({
      id: `recent:${term.toLowerCase()}`,
      kind: 'recent',
      label: term,
      subtitle: 'Recent search',
      query: term,
    }));
  }

  if (cleanNeedle.length < 2) {
    return [];
  }

  const results: SearchSuggestionItem[] = [];
  const seenKeys = new Set<string>();

  const pushUnique = (item: SearchSuggestionItem) => {
    const key = `${item.kind}:${item.query.toLowerCase()}`;
    if (seenKeys.has(key) || results.length >= maxItems) return;
    seenKeys.add(key);
    results.push(item);
  };

  // 1. Matching recent searches
  for (const term of input.recentSearches ?? []) {
    if (term.toLowerCase().includes(cleanNeedle)) {
      pushUnique({
        id: `recent:${term.toLowerCase()}`,
        kind: 'recent',
        label: term,
        subtitle: 'Recent search',
        query: term,
      });
    }
  }

  // 2. Matching people / usernames (skip when strictly scoped to anonymous)
  if (input.scope !== 'anonymous' && input.members && input.members.length > 0) {
    const matchedMembers = input.members
      .filter((m) => {
        if (m.accountStatus !== 'active') return false;
        const uname = m.username.toLowerCase();
        const fname = m.fullName.toLowerCase();
        const dept = (m.department ?? '').toLowerCase();
        return (
          uname.includes(cleanNeedle) ||
          fname.includes(cleanNeedle) ||
          dept.includes(cleanNeedle)
        );
      })
      .slice(0, 3);

    for (const member of matchedMembers) {
      pushUnique({
        id: `person:${member.username}`,
        kind: 'person',
        label: `${member.fullName} (@${member.username})`,
        subtitle: member.department
          ? `Member · ${member.department}`
          : 'Campus Member',
        query: `@${member.username}`,
        targetScope: 'people',
        username: member.username,
      });
    }
  }

  // 3. Matching categories / campus hubs
  for (const cat of DISCOVERY_CATEGORY_SUGGESTIONS) {
    if (
      input.scope === 'home' &&
      cat.targetScope !== 'posts' &&
      cat.targetScope !== 'people'
    ) {
      continue;
    }
    if (
      input.scope &&
      input.scope !== 'all' &&
      input.scope !== 'home' &&
      cat.targetScope !== input.scope
    ) {
      continue;
    }
    const matchesCat =
      cat.label.toLowerCase().includes(cleanNeedle) ||
      cat.query.toLowerCase().includes(cleanNeedle) ||
      cat.keywords.some((kw) => kw.includes(cleanNeedle) || cleanNeedle.includes(kw));
    if (matchesCat) {
      pushUnique({
        id: `cat:${cat.targetScope}:${cat.query.toLowerCase()}`,
        kind: 'category',
        label: cat.label,
        subtitle: cat.subtitle,
        query: cat.query,
        targetScope: cat.targetScope,
      });
    }
  }

  // 4. Matching dynamic topic terms from recent published items
  for (const dyn of input.dynamicTerms ?? []) {
    if (dyn.term.toLowerCase().includes(cleanNeedle)) {
      pushUnique({
        id: `term:${dyn.term.toLowerCase()}`,
        kind: 'term',
        label: dyn.term,
        subtitle: dyn.subtitle || 'Campus topic',
        query: dyn.term,
        targetScope: dyn.targetScope,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Clean University-Friendly Search Error Formatter (zero backend jargon)
// ---------------------------------------------------------------------------

export function formatSearchUserError(
  error: unknown,
  fallback = 'We could not complete your search right now. Please try again.'
): string {
  if (error instanceof Error) {
    const msg = error.message.trim();
    const lower = msg.toLowerCase();
    if (
      !msg ||
      lower.includes('firebase') ||
      lower.includes('firestore') ||
      lower.includes('permission-denied') ||
      lower.includes('failed-precondition') ||
      lower.includes('index') ||
      lower.includes('network') ||
      lower.includes('fetch') ||
      msg.startsWith('{')
    ) {
      return fallback;
    }
    if (msg.length <= 160) {
      return msg;
    }
  }
  return fallback;
}

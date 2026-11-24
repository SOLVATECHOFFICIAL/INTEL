import type {
  AdminUpdate,
  AnonymousPost,
  CampusEvent,
  CommunityPost,
  Opportunity,
  PublicProfileProjection,
} from '../types/database';
import { extractTimestampMs } from './contextualSearch';
import { isCampusEventPublished, resolveEventLifecycle } from './events';
import { resolveOpportunityLifecycle } from './opportunities';

export const FEED_INTEREST_OPTIONS = [
  'Academic Notices',
  'Campus News',
  'Scholarships & Grants',
  'Internships & Jobs',
  'Campus Events',
  'Student Welfare',
  'Faculty & Department',
  'Books & Study Materials',
  'Tech & Digital Skills',
  'Hostel & Accommodation',
  'Competitions & Fellowships',
  'Campus Discussions',
] as const;

export type FeedInterestOption = (typeof FEED_INTEREST_OPTIONS)[number];

export interface PersonalisedPostWithAuthor {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export interface ForYouRankingOptions {
  viewerUid?: string | null;
  followedUids?: ReadonlySet<string>;
  viewerDepartment?: string | null;
  viewerFaculty?: string | null;
  viewerLevel?: string | null;
  interestCategories?: readonly string[];
  interactedAuthorWeights?: ReadonlyMap<string, number>;
  interactedCategoryWeights?: ReadonlyMap<string, number>;
  interactedKeywords?: ReadonlyMap<string, number>;
  authorMap?: ReadonlyMap<string, PublicProfileProjection>;
  seenCounts?: ReadonlyMap<string, number>;
  lastSeenMs?: ReadonlyMap<string, number>;
  fastSkippedIds?: ReadonlySet<string>;
  nowMs?: number;
}

export interface FeedInteractionSignal {
  targetId: string;
  authorKey?: string;
  category?: string;
  text?: string;
  dwellMs: number;
  completed?: boolean;
  skippedFast?: boolean;
  interacted?: boolean;
  timestampMs?: number;
}

export interface FeedBehaviorSnapshot {
  authorWeights: Map<string, number>;
  categoryWeights: Map<string, number>;
  keywordWeights: Map<string, number>;
  seenCounts: Map<string, number>;
  lastSeenMs: Map<string, number>;
  fastSkippedIds: Set<string>;
}

export interface PersonRecommendationItem {
  member: PublicProfileProjection;
  score: number;
  reason: string;
}

export interface EventRecommendationItem {
  event: CampusEvent;
  score: number;
  reason: string;
}

export interface OpportunityRecommendationItem {
  opportunity: Opportunity;
  score: number;
  reason: string;
}

export interface AnonymousRecommendationItem {
  post: AnonymousPost;
  score: number;
  reason: string;
}

export type ForYouStreamEntry =
  | {
      kind: 'post';
      id: string;
      item: PersonalisedPostWithAuthor;
      reason?: string;
    }
  | {
      kind: 'people_discovery';
      id: string;
      people: PersonRecommendationItem[];
    }
  | {
      kind: 'recommended_event';
      id: string;
      recommendation: EventRecommendationItem;
    }
  | {
      kind: 'recommended_opportunity';
      id: string;
      recommendation: OpportunityRecommendationItem;
    }
  | {
      kind: 'recommended_anonymous';
      id: string;
      recommendation: AnonymousRecommendationItem;
    };

export interface HomeUpdateWithAuthor {
  update: AdminUpdate;
  author: PublicProfileProjection | null;
}

export type CombinedHomeStreamEntry =
  | ForYouStreamEntry
  | {
      kind: 'update';
      id: string;
      item: HomeUpdateWithAuthor;
    }
  | {
      kind: 'anonymous';
      id: string;
      post: AnonymousPost;
    };

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'your',
  'you',
  'are',
  'was',
  'were',
  'have',
  'has',
  'will',
  'all',
  'new',
  'out',
  'about',
  'into',
  'more',
  'campus',
  'lasued',
  'student',
  'students',
  'update',
  'general',
]);

export function normalizeInterestList(
  rawInterests: readonly string[] | null | undefined
): string[] {
  if (!Array.isArray(rawInterests)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of rawInterests) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().slice(0, 64);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
    if (cleaned.length >= 20) break;
  }
  return cleaned;
}

export function tokenizeInterestText(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function buildInterestTokenSet(
  interests: readonly string[] | undefined,
  department?: string | null,
  faculty?: string | null
): Set<string> {
  const tokens = new Set<string>();
  for (const interest of interests ?? []) {
    for (const token of tokenizeInterestText(interest)) {
      tokens.add(token);
    }
  }
  for (const token of tokenizeInterestText(department)) {
    tokens.add(token);
  }
  for (const token of tokenizeInterestText(faculty)) {
    tokens.add(token);
  }
  return tokens;
}

function normalizePhrase(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function countTokenOverlap(
  text: string,
  interestTokens: ReadonlySet<string>,
  interactedKeywords?: ReadonlyMap<string, number>
): { interestHits: number; keywordWeight: number } {
  if (!text) return { interestHits: 0, keywordWeight: 0 };
  const words = new Set(tokenizeInterestText(text));
  let interestHits = 0;
  let keywordWeight = 0;

  for (const word of words) {
    if (interestTokens.has(word)) {
      interestHits += 1;
    }
    const kw = interactedKeywords?.get(word);
    if (kw) {
      keywordWeight += kw;
    }
  }
  return { interestHits, keywordWeight };
}

/**
 * Latest feed: strictly newest-first chronological ordering (createdAt DESC),
 * without pinned-first reordering.
 */
export function sortLatestCommunityPosts(
  posts: readonly CommunityPost[]
): CommunityPost[] {
  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      if (bMs !== aMs) {
        return bMs - aMs;
      }
      return b.id.localeCompare(a.id);
    });
}

/**
 * Anonymous feed: strictly newest-first chronological ordering (createdAt DESC).
 */
export function sortChronologicalAnonymousPosts(
  posts: readonly AnonymousPost[]
): AnonymousPost[] {
  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      if (bMs !== aMs) {
        return bMs - aMs;
      }
      return b.id.localeCompare(a.id);
    });
}

/**
 * Builds affinity weights exclusively from viewer's real ordinary post/event/opportunity
 * interactions (and public category keywords of liked/saved anonymous topics — NEVER
 * exposing or using anonymous author identities).
 */
export function buildInteractionAffinities(input: {
  likedOrSavedPosts?: readonly CommunityPost[];
  likedOrSavedAnonymousPosts?: readonly AnonymousPost[];
  likedOrSavedEvents?: readonly CampusEvent[];
  savedOpportunities?: readonly Opportunity[];
}): {
  interactedAuthorWeights: Map<string, number>;
  interactedCategoryWeights: Map<string, number>;
  interactedKeywords: Map<string, number>;
} {
  const interactedAuthorWeights = new Map<string, number>();
  const interactedCategoryWeights = new Map<string, number>();
  const interactedKeywords = new Map<string, number>();

  const bumpCategory = (cat: string | undefined, amount: number) => {
    const key = normalizePhrase(cat);
    if (!key) return;
    interactedCategoryWeights.set(
      key,
      Math.min(40, (interactedCategoryWeights.get(key) ?? 0) + amount)
    );
  };

  const bumpKeywords = (text: string | undefined, weight: number) => {
    for (const token of tokenizeInterestText(text)) {
      interactedKeywords.set(
        token,
        Math.min(12, (interactedKeywords.get(token) ?? 0) + weight)
      );
    }
  };

  for (const post of input.likedOrSavedPosts ?? []) {
    if (post.ownerUID) {
      interactedAuthorWeights.set(
        post.ownerUID,
        Math.min(36, (interactedAuthorWeights.get(post.ownerUID) ?? 0) + 12)
      );
    }
    bumpCategory(post.category, 10);
    bumpKeywords(`${post.category} ${post.title ?? ''} ${post.body}`, 2);
  }

  // Strictly public fields only (category + body words), zero author data
  for (const anon of input.likedOrSavedAnonymousPosts ?? []) {
    bumpCategory(anon.category, 8);
    bumpKeywords(`${anon.category} ${anon.body}`, 1.5);
  }

  for (const evt of input.likedOrSavedEvents ?? []) {
    bumpCategory(evt.category, 10);
    bumpCategory('campus events', 8);
    bumpKeywords(`${evt.title} ${evt.organiser} ${evt.description}`, 2);
  }

  for (const opp of input.savedOpportunities ?? []) {
    bumpCategory(opp.category, 10);
    bumpCategory('scholarships & grants', opp.category === 'scholarship' ? 8 : 4);
    bumpCategory('internships & jobs', opp.category === 'internship' || opp.category === 'job' ? 8 : 4);
    bumpKeywords(`${opp.title} ${opp.organisation} ${opp.description}`, 2);
  }

  return {
    interactedAuthorWeights,
    interactedCategoryWeights,
    interactedKeywords,
  };
}

export interface TikTokVelocityMetrics {
  likesCount?: number;
  commentsCount?: number;
  viewsCount?: number;
  mediaCount?: number;
  ageHours: number;
  isOfficial?: boolean;
}

/**
 * TikTok-style engagement velocity + hook weighting: rewards posts whose real
 * engagement (likes, comments, views, visual media hook) grows rapidly relative
 * to age while decaying older stale items gracefully.
 */
export function computeTikTokEngagementVelocityScore(
  metrics: TikTokVelocityMetrics
): number {
  const likes =
    typeof metrics.likesCount === 'number' && Number.isFinite(metrics.likesCount)
      ? Math.max(0, metrics.likesCount)
      : 0;
  const comments =
    typeof metrics.commentsCount === 'number' &&
    Number.isFinite(metrics.commentsCount)
      ? Math.max(0, metrics.commentsCount)
      : 0;
  const views =
    typeof metrics.viewsCount === 'number' && Number.isFinite(metrics.viewsCount)
      ? Math.max(0, metrics.viewsCount)
      : 0;
  const mediaCount =
    typeof metrics.mediaCount === 'number' && Number.isFinite(metrics.mediaCount)
      ? Math.max(0, metrics.mediaCount)
      : 0;

  const mediaHookWeight =
    mediaCount > 1 ? 16 : mediaCount === 1 ? 10 : metrics.isOfficial ? 6 : 0;
  const weightedInteractions =
    likes * 1.6 + comments * 2.8 + views * 0.08 + mediaHookWeight;
  const velocity =
    weightedInteractions / Math.pow(Math.max(0, metrics.ageHours) + 1.5, 1.35);

  const boundedVirality =
    Math.min(34, Math.sqrt(likes) * 3.8) +
    Math.min(44, Math.sqrt(comments) * 5.5);

  return Math.min(68, velocity * 4.5) + boundedVirality + mediaHookWeight * 0.45;
}

function computeImpressionFatiguePenalty(
  entryKey: string,
  options: ForYouRankingOptions,
  nowMs: number,
  isPinned: boolean
): number {
  if (isPinned) return 0;
  let penalty = 0;
  if (options.fastSkippedIds?.has(entryKey)) {
    penalty += 55;
  }
  const seenCount = options.seenCounts?.get(entryKey) ?? 0;
  if (seenCount > 0) {
    penalty += Math.min(84, seenCount * 24);
    const seenAt = options.lastSeenMs?.get(entryKey) ?? 0;
    if (seenAt > 0 && nowMs - seenAt < 20 * 60_000) {
      penalty += 20;
    }
  }
  return penalty;
}

/**
 * Computes a transparent, TikTok-inspired AI relevance score combining
 * engagement velocity, freshness decay, follow relationships, academic match,
 * behavioral dwell/skip signals, and impression fatigue anti-repetition.
 */
export function computeForYouPostScore(
  post: CommunityPost,
  options: ForYouRankingOptions = {}
): number {
  const nowMs = options.nowMs ?? Date.now();
  const createdMs = extractTimestampMs(post.createdAt) ?? nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));

  // Freshness starts at 105 and decays smoothly over time
  const freshnessScore = 105 / Math.pow(1 + ageHours / 18, 1.15);

  const pinnedBoost = post.isPinned ? 500 : 0;
  const officialBoost = post.isOfficial ? 55 : 0;
  const followedBoost = options.followedUids?.has(post.ownerUID) ? 48 : 0;

  const author = options.authorMap?.get(post.ownerUID);
  const viewerDept = normalizePhrase(options.viewerDepartment);
  const viewerFaculty = normalizePhrase(options.viewerFaculty);
  const viewerLevel = normalizePhrase(options.viewerLevel);

  const authorDept = normalizePhrase(author?.department);
  const authorFaculty = normalizePhrase(author?.faculty);
  const authorLevel = normalizePhrase(author?.level);
  const searchableText = `${post.category ?? ''} ${post.title ?? ''} ${post.body ?? ''}`.toLowerCase();

  let academicBoost = 0;
  if (viewerDept) {
    if (authorDept && (authorDept === viewerDept || authorDept.includes(viewerDept) || viewerDept.includes(authorDept))) {
      academicBoost += 38;
    } else if (searchableText.includes(viewerDept)) {
      academicBoost += 26;
    }
  }
  if (viewerFaculty) {
    if (authorFaculty && (authorFaculty === viewerFaculty || authorFaculty.includes(viewerFaculty) || viewerFaculty.includes(authorFaculty))) {
      academicBoost += 24;
    } else if (searchableText.includes(viewerFaculty)) {
      academicBoost += 16;
    }
  }
  if (viewerLevel && authorLevel && authorLevel === viewerLevel) {
    academicBoost += 10;
  }

  const interestTokens = buildInterestTokenSet(
    options.interestCategories,
    options.viewerDepartment,
    options.viewerFaculty
  );
  const { interestHits, keywordWeight } = countTokenOverlap(
    searchableText,
    interestTokens,
    options.interactedKeywords
  );
  const explicitInterestBoost = Math.min(34, interestHits * 11);

  const categoryKey = normalizePhrase(post.category);
  const categoryInterestMatch = (options.interestCategories ?? []).some((cat) => {
    const c = normalizePhrase(cat);
    return (
      c === categoryKey ||
      c.includes(categoryKey) ||
      categoryKey.includes(c.split(' ')[0] ?? '')
    );
  })
    ? 22
    : 0;

  const authorAffinityBoost = Math.min(
    36,
    options.interactedAuthorWeights?.get(post.ownerUID) ?? 0
  );
  const categoryAffinityBoost = Math.min(
    28,
    (options.interactedCategoryWeights?.get(categoryKey) ?? 0) +
      Math.min(16, keywordWeight * 2)
  );

  const mediaCount =
    Array.isArray(post.mediaItems) && post.mediaItems.length > 0
      ? post.mediaItems.length
      : Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0
        ? post.mediaUrls.length
        : 0;

  const engagementScore = computeTikTokEngagementVelocityScore({
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    viewsCount: post.viewsCount,
    mediaCount,
    ageHours,
    isOfficial: post.isOfficial,
  });

  const fatiguePenalty = computeImpressionFatiguePenalty(
    `post_${post.id}`,
    options,
    nowMs,
    Boolean(post.isPinned)
  );

  return (
    pinnedBoost +
    officialBoost +
    followedBoost +
    academicBoost +
    explicitInterestBoost +
    categoryInterestMatch +
    authorAffinityBoost +
    categoryAffinityBoost +
    engagementScore +
    freshnessScore -
    fatiguePenalty
  );
}

/**
 * Ranks published ordinary posts for "For You" while applying gentle author
 * diversity spacing so one active author doesn't monopolize consecutive slots.
 */
export function rankForYouCommunityPosts(
  posts: readonly CommunityPost[],
  options: ForYouRankingOptions = {}
): CommunityPost[] {
  const published = posts.filter((post) => post.status === 'published');
  const scored = published
    .map((post) => ({
      post,
      baseScore: computeForYouPostScore(post, options),
      createdMs: extractTimestampMs(post.createdAt) ?? 0,
    }))
    .sort((a, b) => {
      if (Math.abs(b.baseScore - a.baseScore) > 0.0001) {
        return b.baseScore - a.baseScore;
      }
      return b.createdMs - a.createdMs;
    });

  // Gentle author diversity pass on non-pinned posts to avoid monotonous clustering
  const authorCounts = new Map<string, number>();
  const adjusted = scored
    .map((entry) => {
      const seenAuthorCount = authorCounts.get(entry.post.ownerUID) ?? 0;
      authorCounts.set(entry.post.ownerUID, seenAuthorCount + 1);
      const repetitionPenalty = entry.post.isPinned
        ? 0
        : Math.min(60, seenAuthorCount * 16);
      return {
        ...entry,
        finalScore: entry.baseScore - repetitionPenalty,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.finalScore - a.finalScore) > 0.0001) {
        return b.finalScore - a.finalScore;
      }
      return b.createdMs - a.createdMs;
    });

  return adjusted.map((entry) => entry.post);
}

/**
 * Recommends relevant active members beyond accounts the viewer already follows.
 * Prioritizes shared department, faculty, academic level, and shared topic interests
 * rather than simply picking the highest global follower count.
 */
export function rankRecommendedPeople(
  members: readonly PublicProfileProjection[],
  options: {
    viewerUsername?: string | null;
    followingUsernames?: ReadonlySet<string>;
    viewerDepartment?: string | null;
    viewerFaculty?: string | null;
    viewerLevel?: string | null;
    interestCategories?: readonly string[];
    interactedAuthorUsernames?: ReadonlyMap<string, number>;
    interactedKeywords?: ReadonlyMap<string, number>;
    dismissedKeys?: ReadonlySet<string>;
    maxResults?: number;
  } = {}
): PersonRecommendationItem[] {
  const viewerDept = normalizePhrase(options.viewerDepartment);
  const viewerFaculty = normalizePhrase(options.viewerFaculty);
  const viewerLevel = normalizePhrase(options.viewerLevel);
  const viewerUsernameLower = normalizePhrase(options.viewerUsername);
  const interestTokens = buildInterestTokenSet(
    options.interestCategories,
    options.viewerDepartment,
    options.viewerFaculty
  );

  const scored: PersonRecommendationItem[] = [];

  for (const member of members) {
    if (member.accountStatus !== 'active') continue;
    const unameLower = member.username.toLowerCase();
    if (viewerUsernameLower && unameLower === viewerUsernameLower) {
      continue;
    }
    if (options.followingUsernames?.has(unameLower)) continue;
    if (options.dismissedKeys?.has(`person:${unameLower}`)) continue;

    let score = 0;
    const reasons: string[] = [];

    const mDept = normalizePhrase(member.department);
    const mFaculty = normalizePhrase(member.faculty);
    const mLevel = normalizePhrase(member.level);

    if (
      viewerDept &&
      mDept &&
      (mDept === viewerDept || mDept.includes(viewerDept) || viewerDept.includes(mDept))
    ) {
      score += 58;
      reasons.push(`Same department (${member.department})`);
    }

    if (
      viewerFaculty &&
      mFaculty &&
      (mFaculty === viewerFaculty ||
        mFaculty.includes(viewerFaculty) ||
        viewerFaculty.includes(mFaculty))
    ) {
      score += 34;
      if (reasons.length === 0) reasons.push(`Same faculty (${member.faculty})`);
    }

    if (viewerLevel && mLevel && mLevel === viewerLevel) {
      score += 18;
      if (reasons.length === 0) reasons.push(`Same level (${member.level})`);
    }

    const interactionAffinity =
      options.interactedAuthorUsernames?.get(unameLower) ?? 0;
    if (interactionAffinity > 0) {
      score += Math.min(35, interactionAffinity * 1.5);
      if (reasons.length === 0) reasons.push('Posts you interacted with');
    }

    const profileText = `${member.department ?? ''} ${member.faculty ?? ''} ${member.accountCategory ?? ''} ${member.bio ?? ''}`;
    const { interestHits, keywordWeight } = countTokenOverlap(
      profileText,
      interestTokens,
      options.interactedKeywords
    );
    if (interestHits > 0 || keywordWeight > 0) {
      score += Math.min(28, interestHits * 10 + keywordWeight * 2);
      if (reasons.length === 0) reasons.push('Shared campus interests');
    }

    const hasSharedProfileOrInterest = score > 0;

    if (member.badge === 'verified' || member.badge === 'moderator' || member.badge === 'supreme_admin') {
      score += 8;
      if (reasons.length === 0) {
        reasons.push(
          member.accountCategory || member.department || 'Verified campus voice'
        );
      }
    }

    // When viewer has academic/interest context, require genuine shared relevance rather than badge or raw popularity
    const viewerHasContext = Boolean(
      viewerDept || viewerFaculty || (options.interestCategories?.length ?? 0) > 0
    );
    const qualified = viewerHasContext
      ? hasSharedProfileOrInterest
      : Boolean(hasSharedProfileOrInterest || member.department || member.bio);
    if (!qualified) continue;

    // Small bounded community presence tie-breaker (never dominates over shared academic/interest match)
    const boundedActivityTieBreaker = Math.min(
      8,
      Math.sqrt(Math.max(0, member.followersCount ?? 0)) * 0.8
    );
    score += boundedActivityTieBreaker + (member.bio ? 4 : 0);

    scored.push({
      member,
      score,
      reason:
        reasons[0] ??
        (member.department
          ? `Member in ${member.department}`
          : 'Active campus member'),
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults ?? 6);
}

/**
 * Recommends relevant upcoming/ongoing campus events tailored to user interests,
 * faculty/department, recency, and community engagement.
 */
export function rankRecommendedEvents(
  events: readonly CampusEvent[],
  options: {
    viewerDepartment?: string | null;
    viewerFaculty?: string | null;
    interestCategories?: readonly string[];
    interactedCategoryWeights?: ReadonlyMap<string, number>;
    interactedKeywords?: ReadonlyMap<string, number>;
    savedEventIds?: ReadonlySet<string>;
    dismissedKeys?: ReadonlySet<string>;
    nowMs?: number;
    maxResults?: number;
  } = {}
): EventRecommendationItem[] {
  const nowMs = options.nowMs ?? Date.now();
  const interestTokens = buildInterestTokenSet(
    options.interestCategories,
    options.viewerDepartment,
    options.viewerFaculty
  );

  const ranked: EventRecommendationItem[] = [];

  for (const event of events) {
    if (!isCampusEventPublished(event)) continue;
    if (options.dismissedKeys?.has(`event:${event.id}`)) continue;
    if (options.savedEventIds?.has(event.id)) continue;

    const lifecycle = resolveEventLifecycle(event, nowMs);
    if (
      !lifecycle.isPublished ||
      lifecycle.state === 'completed' ||
      lifecycle.state === 'cancelled'
    ) {
      continue;
    }

    const text = `${event.title} ${event.organiser} ${event.category} ${event.venue} ${event.description}`;
    const { interestHits, keywordWeight } = countTokenOverlap(
      text,
      interestTokens,
      options.interactedKeywords
    );

    const catWeight =
      options.interactedCategoryWeights?.get(normalizePhrase(event.category)) ??
      options.interactedCategoryWeights?.get('campus events') ??
      0;

    const isOngoingBoost = lifecycle.state === 'ongoing' ? 28 : 16;
    const soonHours = Math.max(
      0,
      ((extractTimestampMs(event.eventDate) ?? nowMs) - nowMs) / 3_600_000
    );
    const timingBoost = soonHours <= 72 ? 22 : soonHours <= 168 ? 14 : 6;
    const engagementBoost = Math.min(
      20,
      Math.sqrt(Math.max(0, event.likesCount ?? 0)) * 3 +
        Math.sqrt(Math.max(0, event.commentsCount ?? 0)) * 4
    );

    const deptMatch =
      options.viewerDepartment &&
      text.toLowerCase().includes(options.viewerDepartment.toLowerCase())
        ? 30
        : 0;
    const interestMatch =
      (options.interestCategories ?? []).some((i) =>
        normalizePhrase(i).includes('event')
      )
        ? 14
        : 0;

    const score =
      isOngoingBoost +
      timingBoost +
      engagementBoost +
      deptMatch +
      interestMatch +
      Math.min(30, interestHits * 10 + keywordWeight * 2 + catWeight);

    const reason =
      deptMatch > 0
        ? `Relevant to ${options.viewerDepartment}`
        : interestHits > 0
          ? 'Matches your campus interests'
          : lifecycle.state === 'ongoing'
            ? 'Happening on campus now'
            : 'Upcoming campus activity';

    ranked.push({ event, score, reason });
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults ?? 3);
}

/**
 * Recommends open or closing-soon opportunities relevant to student interests,
 * faculty/department, and saved opportunity topics.
 */
export function rankRecommendedOpportunities(
  opportunities: readonly Opportunity[],
  options: {
    viewerDepartment?: string | null;
    viewerFaculty?: string | null;
    viewerLevel?: string | null;
    interestCategories?: readonly string[];
    interactedCategoryWeights?: ReadonlyMap<string, number>;
    interactedKeywords?: ReadonlyMap<string, number>;
    savedOpportunityIds?: ReadonlySet<string>;
    dismissedKeys?: ReadonlySet<string>;
    nowMs?: number;
    maxResults?: number;
  } = {}
): OpportunityRecommendationItem[] {
  const nowMs = options.nowMs ?? Date.now();
  const interestTokens = buildInterestTokenSet(
    options.interestCategories,
    options.viewerDepartment,
    options.viewerFaculty
  );

  const ranked: OpportunityRecommendationItem[] = [];

  for (const opp of opportunities) {
    if (opp.status !== 'active') continue;
    if (options.dismissedKeys?.has(`opportunity:${opp.id}`)) continue;
    if (options.savedOpportunityIds?.has(opp.id)) continue;

    const lifecycle = resolveOpportunityLifecycle(opp, nowMs);
    if (lifecycle.state === 'closed') continue;

    const text = `${opp.title} ${opp.organisation} ${opp.category} ${opp.description} ${opp.whoCanApply ?? ''} ${opp.eligibility ?? ''}`;
    const { interestHits, keywordWeight } = countTokenOverlap(
      text,
      interestTokens,
      options.interactedKeywords
    );
    const catWeight =
      options.interactedCategoryWeights?.get(normalizePhrase(opp.category)) ?? 0;

    const deptMatch =
      options.viewerDepartment &&
      text.toLowerCase().includes(options.viewerDepartment.toLowerCase())
        ? 30
        : 0;
    const levelMatch =
      options.viewerLevel &&
      text.toLowerCase().includes(options.viewerLevel.toLowerCase())
        ? 14
        : 0;
    const explicitInterestMatch = (options.interestCategories ?? []).some((item) => {
      const low = item.toLowerCase();
      return (
        (opp.category === 'scholarship' && low.includes('scholarship')) ||
        (opp.category === 'grant' && low.includes('scholarship')) ||
        ((opp.category === 'internship' || opp.category === 'job') &&
          low.includes('internship')) ||
        ((opp.category === 'programme' || opp.category === 'competition') &&
          (low.includes('fellowship') || low.includes('competition')))
      );
    })
      ? 22
      : 0;

    const urgencyBoost = lifecycle.state === 'closing_soon' ? 18 : 10;
    const verifiedBoost = opp.isVerified ? 10 : 0;

    const score =
      urgencyBoost +
      verifiedBoost +
      deptMatch +
      levelMatch +
      explicitInterestMatch +
      Math.min(30, interestHits * 10 + keywordWeight * 2 + catWeight);

    const reason =
      deptMatch > 0
        ? `Fits ${options.viewerDepartment}`
        : explicitInterestMatch > 0 || interestHits > 0
          ? 'Matches your feed topics'
          : lifecycle.state === 'closing_soon'
            ? 'Closing soon for LASUED students'
            : 'Open campus opportunity';

    ranked.push({ opportunity: opp, score, reason });
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults ?? 3);
}

/**
 * Recommends relevant anonymous discussions using STRICTLY public fields
 * (category, body text, recency, engagement) — NEVER author identities.
 */
export function rankRecommendedAnonymousPosts(
  posts: readonly AnonymousPost[],
  options: {
    viewerDepartment?: string | null;
    viewerFaculty?: string | null;
    interestCategories?: readonly string[];
    interactedCategoryWeights?: ReadonlyMap<string, number>;
    interactedKeywords?: ReadonlyMap<string, number>;
    dismissedKeys?: ReadonlySet<string>;
    nowMs?: number;
    maxResults?: number;
  } = {}
): AnonymousRecommendationItem[] {
  const nowMs = options.nowMs ?? Date.now();
  const interestTokens = buildInterestTokenSet(
    options.interestCategories,
    options.viewerDepartment,
    options.viewerFaculty
  );

  const ranked: AnonymousRecommendationItem[] = [];

  for (const post of posts) {
    if (post.status !== 'published') continue;
    if (options.dismissedKeys?.has(`anon:${post.id}`)) continue;

    const createdMs = extractTimestampMs(post.createdAt) ?? nowMs;
    const ageHours = Math.max(0, (nowMs - createdMs) / 3_600_000);
    // Do not resurface stale anonymous posts older than 14 days
    if (ageHours > 24 * 14) continue;

    const text = `${post.category} ${post.body}`;
    const { interestHits, keywordWeight } = countTokenOverlap(
      text,
      interestTokens,
      options.interactedKeywords
    );
    const catWeight =
      options.interactedCategoryWeights?.get(normalizePhrase(post.category)) ?? 0;

    const likes = Math.max(0, post.likesCount ?? 0);
    const comments = Math.max(0, post.commentsCount ?? 0);
    const freshness = 50 / Math.pow(1 + ageHours / 20, 1.15);
    const engagement = Math.min(36, Math.sqrt(likes) * 3.5 + Math.sqrt(comments) * 5.5);

    const score =
      freshness +
      engagement +
      Math.min(28, interestHits * 9 + keywordWeight * 2 + catWeight);

    // Require either active genuine campus discussion or topic relevance
    if (likes + comments < 1 && interestHits === 0 && catWeight === 0) {
      continue;
    }

    const reason =
      interestHits > 0 || catWeight > 0
        ? `Anonymous topic: ${post.category}`
        : `Active campus discussion · ${post.category}`;

    ranked.push({ post, score, reason });
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults ?? 2);
}

/**
 * Interleaves ranked ordinary posts with non-repetitive contextual discovery cards
 * in "For You", ensuring zero duplicate IDs and honoring dismissed recommendations.
 */
export function buildForYouFeedStream(input: {
  posts: readonly PersonalisedPostWithAuthor[];
  recommendedPeople?: readonly PersonRecommendationItem[];
  recommendedEvents?: readonly EventRecommendationItem[];
  recommendedOpportunities?: readonly OpportunityRecommendationItem[];
  recommendedAnonymous?: readonly AnonymousRecommendationItem[];
  dismissedKeys?: ReadonlySet<string>;
}): ForYouStreamEntry[] {
  const dismissed = input.dismissedKeys ?? new Set<string>();
  const stream: ForYouStreamEntry[] = [];
  const seenPostIds = new Set<string>();

  const uniquePosts: PersonalisedPostWithAuthor[] = [];
  for (const item of input.posts) {
    if (seenPostIds.has(item.post.id)) continue;
    if (dismissed.has(`post:${item.post.id}`)) continue;
    seenPostIds.add(item.post.id);
    uniquePosts.push(item);
  }

  const topEvent = (input.recommendedEvents ?? []).find(
    (item) => !dismissed.has(`event:${item.event.id}`)
  );
  const topOpportunity = (input.recommendedOpportunities ?? []).find(
    (item) => !dismissed.has(`opportunity:${item.opportunity.id}`)
  );
  const visiblePeople = (input.recommendedPeople ?? [])
    .filter((item) => !dismissed.has(`person:${item.member.username.toLowerCase()}`))
    .slice(0, 3);
  const topAnonymous = (input.recommendedAnonymous ?? []).find(
    (item) => !dismissed.has(`anon:${item.post.id}`)
  );

  // Choose at most 1 primary campus item at slot 2, people at slot 4, remaining campus/anon at slots 6 & 8
  const primaryCampusSlot: ForYouStreamEntry | null = topEvent
    ? {
        kind: 'recommended_event',
        id: `rec_event_${topEvent.event.id}`,
        recommendation: topEvent,
      }
    : topOpportunity
      ? {
          kind: 'recommended_opportunity',
          id: `rec_opp_${topOpportunity.opportunity.id}`,
          recommendation: topOpportunity,
        }
      : null;

  const secondaryCampusSlot: ForYouStreamEntry | null =
    topEvent && topOpportunity
      ? {
          kind: 'recommended_opportunity',
          id: `rec_opp_${topOpportunity.opportunity.id}`,
          recommendation: topOpportunity,
        }
      : null;

  const peopleSlot: ForYouStreamEntry | null =
    visiblePeople.length > 0
      ? {
          kind: 'people_discovery',
          id: `rec_people_${visiblePeople.map((p) => p.member.username).join('_')}`,
          people: visiblePeople,
        }
      : null;

  const anonSlot: ForYouStreamEntry | null = topAnonymous
    ? {
        kind: 'recommended_anonymous',
        id: `rec_anon_${topAnonymous.post.id}`,
        recommendation: topAnonymous,
      }
    : null;

  if (uniquePosts.length === 0) {
    if (primaryCampusSlot) stream.push(primaryCampusSlot);
    if (peopleSlot) stream.push(peopleSlot);
    if (secondaryCampusSlot) stream.push(secondaryCampusSlot);
    if (anonSlot) stream.push(anonSlot);
    return stream;
  }

  uniquePosts.forEach((item, index) => {
    stream.push({
      kind: 'post',
      id: item.post.id,
      item,
    });

    if (index === 1 && primaryCampusSlot) {
      stream.push(primaryCampusSlot);
    }
    if (index === 3 && peopleSlot) {
      stream.push(peopleSlot);
    }
    if (index === 5 && secondaryCampusSlot) {
      stream.push(secondaryCampusSlot);
    }
    if (index === 7 && anonSlot) {
      stream.push(anonSlot);
    }
  });

  if (uniquePosts.length <= 1 && primaryCampusSlot) {
    stream.push(primaryCampusSlot);
  }
  if (uniquePosts.length <= 3 && peopleSlot) {
    stream.push(peopleSlot);
  }
  if (uniquePosts.length <= 5 && secondaryCampusSlot) {
    stream.push(secondaryCampusSlot);
  }
  if (uniquePosts.length <= 7 && anonSlot) {
    stream.push(anonSlot);
  }

  return stream;
}

function computeOfficialUpdateHomeScore(
  update: AdminUpdate,
  options: ForYouRankingOptions,
  nowMs: number
): number {
  const createdMs = extractTimestampMs(update.createdAt) ?? nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / 3_600_000);
  const freshness = 135 / Math.pow(1 + ageHours / 22, 1.1);
  const pinnedBoost = update.isPinned ? 560 : 0;
  const urgentBoost = update.category === 'urgent' ? 40 : 18;
  const mediaCount =
    Array.isArray(update.mediaItems) && update.mediaItems.length > 0
      ? update.mediaItems.length
      : 0;
  const engagement = computeTikTokEngagementVelocityScore({
    likesCount: update.likesCount,
    commentsCount: update.commentsCount,
    viewsCount: update.viewsCount,
    mediaCount,
    ageHours,
    isOfficial: true,
  });
  const fatiguePenalty = computeImpressionFatiguePenalty(
    `update_${update.id}`,
    options,
    nowMs,
    Boolean(update.isPinned)
  );
  return pinnedBoost + urgentBoost + engagement + freshness - fatiguePenalty;
}

function getEntryAuthorSpacingKey(entry: CombinedHomeStreamEntry): string | null {
  if (entry.kind === 'post') {
    return `uid:${entry.item.post.ownerUID}`;
  }
  if (entry.kind === 'update') {
    return entry.item.update.authorMode === 'official_desk'
      ? 'official_desk'
      : `uid:${entry.item.update.ownerUID ?? entry.item.author?.username ?? 'desk'}`;
  }
  if (entry.kind === 'anonymous') {
    return `anon_cat:${normalizePhrase(entry.post.category)}`;
  }
  return null;
}

function getEntryCategoryKey(entry: CombinedHomeStreamEntry): string {
  if (entry.kind === 'post') return normalizePhrase(entry.item.post.category);
  if (entry.kind === 'update') return normalizePhrase(entry.item.update.category);
  if (entry.kind === 'anonymous') return normalizePhrase(entry.post.category);
  return entry.kind;
}

function isEntryPinned(entry: CombinedHomeStreamEntry): boolean {
  if (entry.kind === 'post') return Boolean(entry.item.post.isPinned);
  if (entry.kind === 'update') return Boolean(entry.item.update.isPinned);
  return false;
}

/**
 * TikTok-style anti-repetition interleaver: prevents consecutive posts from the
 * same author or >2 consecutive posts from the same category/type while keeping
 * pinned announcements anchored at the top.
 */
export function diversifyCombinedHomeStream(
  entries: readonly CombinedHomeStreamEntry[],
  lookaheadWindow = 5
): CombinedHomeStreamEntry[] {
  if (entries.length <= 2) return [...entries];
  const pool = [...entries];
  const result: CombinedHomeStreamEntry[] = [];

  while (pool.length > 0) {
    const prev1 = result[result.length - 1];
    const prev2 = result[result.length - 2];

    let chosenIdx = 0;
    const head = pool[0];
    if (!isEntryPinned(head) && prev1) {
      const headAuthor = getEntryAuthorSpacingKey(head);
      const prev1Author = getEntryAuthorSpacingKey(prev1);
      const headCat = getEntryCategoryKey(head);
      const prev1Cat = getEntryCategoryKey(prev1);
      const prev2Cat = prev2 ? getEntryCategoryKey(prev2) : null;

      const sameAuthorConflict = Boolean(headAuthor && prev1Author && headAuthor === prev1Author);
      const sameCategoryRun =
        Boolean(headCat && prev1Cat === headCat && prev2Cat === headCat);

      if (sameAuthorConflict || sameCategoryRun) {
        const maxLook = Math.min(pool.length - 1, lookaheadWindow);
        for (let i = 1; i <= maxLook; i += 1) {
          const candidate = pool[i];
          if (isEntryPinned(candidate)) {
            chosenIdx = i;
            break;
          }
          const candAuthor = getEntryAuthorSpacingKey(candidate);
          const candCat = getEntryCategoryKey(candidate);
          const candAuthorOk = !candAuthor || !prev1Author || candAuthor !== prev1Author;
          const candCatOk = !candCat || !(prev1Cat === candCat && prev2Cat === candCat);
          if (candAuthorOk && candCatOk) {
            chosenIdx = i;
            break;
          }
        }
      }
    }

    const [picked] = pool.splice(chosenIdx, 1);
    result.push(picked);
  }

  return result;
}

/**
 * Combines Official Updates, Campus Updates (ordinary posts), Anonymous posts,
 * and discovery blocks into a unified Home "For You" stream powered by
 * TikTok-style velocity & anti-repetition spacing.
 */
export function buildCombinedHomeForYouStream(input: {
  updates?: readonly HomeUpdateWithAuthor[];
  posts: readonly PersonalisedPostWithAuthor[];
  anonymousPosts?: readonly AnonymousPost[];
  recommendedPeople?: readonly PersonRecommendationItem[];
  recommendedEvents?: readonly EventRecommendationItem[];
  recommendedOpportunities?: readonly OpportunityRecommendationItem[];
  dismissedKeys?: ReadonlySet<string>;
  rankingOptions?: ForYouRankingOptions;
  nowMs?: number;
}): CombinedHomeStreamEntry[] {
  const nowMs = input.nowMs ?? Date.now();
  const dismissed = input.dismissedKeys ?? new Set<string>();
  const effectiveRankingOptions: ForYouRankingOptions = {
    ...(input.rankingOptions ?? {}),
    nowMs,
  };

  const seenUpdateIds = new Set<string>();
  const primaryRanked: Array<{
    score: number;
    createdMs: number;
    entry: CombinedHomeStreamEntry;
  }> = [];

  for (const item of input.updates ?? []) {
    if (item.update.status !== 'published') continue;
    if (seenUpdateIds.has(item.update.id)) continue;
    if (dismissed.has(`update:${item.update.id}`)) continue;
    seenUpdateIds.add(item.update.id);
    primaryRanked.push({
      score: computeOfficialUpdateHomeScore(
        item.update,
        effectiveRankingOptions,
        nowMs
      ),
      createdMs: extractTimestampMs(item.update.createdAt) ?? 0,
      entry: {
        kind: 'update',
        id: `update_${item.update.id}`,
        item,
      },
    });
  }

  const seenPostIds = new Set<string>();
  for (const item of input.posts) {
    if (item.post.status !== 'published') continue;
    if (seenPostIds.has(item.post.id)) continue;
    if (dismissed.has(`post:${item.post.id}`)) continue;
    seenPostIds.add(item.post.id);
    const baseScore = computeForYouPostScore(item.post, effectiveRankingOptions);
    primaryRanked.push({
      score: baseScore,
      createdMs: extractTimestampMs(item.post.createdAt) ?? 0,
      entry: {
        kind: 'post',
        id: `post_${item.post.id}`,
        item,
      },
    });
  }

  primaryRanked.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.0001) {
      return b.score - a.score;
    }
    if (b.createdMs !== a.createdMs) {
      return b.createdMs - a.createdMs;
    }
    return a.entry.id.localeCompare(b.entry.id);
  });

  const diversifiedPrimary = diversifyCombinedHomeStream(
    primaryRanked.map((wrapped) => wrapped.entry)
  );

  const seenAnonIds = new Set<string>();
  const uniqueAnonPosts: AnonymousPost[] = [];
  for (const anon of sortChronologicalAnonymousPosts(input.anonymousPosts ?? [])) {
    if (seenAnonIds.has(anon.id)) continue;
    if (dismissed.has(`anon:${anon.id}`)) continue;
    seenAnonIds.add(anon.id);
    uniqueAnonPosts.push(anon);
  }

  const topEvent = (input.recommendedEvents ?? []).find(
    (item) => !dismissed.has(`event:${item.event.id}`)
  );
  const topOpportunity = (input.recommendedOpportunities ?? []).find(
    (item) => !dismissed.has(`opportunity:${item.opportunity.id}`)
  );
  const visiblePeople = (input.recommendedPeople ?? [])
    .filter((item) => !dismissed.has(`person:${item.member.username.toLowerCase()}`))
    .slice(0, 3);

  const primaryDiscovery: CombinedHomeStreamEntry | null = topEvent
    ? {
        kind: 'recommended_event',
        id: `rec_event_${topEvent.event.id}`,
        recommendation: topEvent,
      }
    : topOpportunity
      ? {
          kind: 'recommended_opportunity',
          id: `rec_opp_${topOpportunity.opportunity.id}`,
          recommendation: topOpportunity,
        }
      : null;

  const secondaryDiscovery: CombinedHomeStreamEntry | null =
    topEvent && topOpportunity
      ? {
          kind: 'recommended_opportunity',
          id: `rec_opp_${topOpportunity.opportunity.id}`,
          recommendation: topOpportunity,
        }
      : null;

  const peopleDiscovery: CombinedHomeStreamEntry | null =
    visiblePeople.length > 0
      ? {
          kind: 'people_discovery',
          id: `rec_people_${visiblePeople.map((p) => p.member.username).join('_')}`,
          people: visiblePeople,
        }
      : null;

  const stream: CombinedHomeStreamEntry[] = [];
  let anonCursor = 0;

  if (diversifiedPrimary.length === 0) {
    for (const anon of uniqueAnonPosts) {
      stream.push({ kind: 'anonymous', id: `anon_${anon.id}`, post: anon });
    }
    if (primaryDiscovery) stream.push(primaryDiscovery);
    if (peopleDiscovery) stream.push(peopleDiscovery);
    if (secondaryDiscovery) stream.push(secondaryDiscovery);
    return stream;
  }

  diversifiedPrimary.forEach((entry, index) => {
    stream.push(entry);

    if (index === 1 && primaryDiscovery) {
      stream.push(primaryDiscovery);
    }
    if ((index + 1) % 3 === 0 && anonCursor < uniqueAnonPosts.length) {
      const anon = uniqueAnonPosts[anonCursor];
      anonCursor += 1;
      stream.push({ kind: 'anonymous', id: `anon_${anon.id}`, post: anon });
    }
    if (index === 4 && peopleDiscovery) {
      stream.push(peopleDiscovery);
    }
    if (index === 7 && secondaryDiscovery) {
      stream.push(secondaryDiscovery);
    }
  });

  if (diversifiedPrimary.length <= 1 && primaryDiscovery) {
    stream.push(primaryDiscovery);
  }
  if (diversifiedPrimary.length <= 4 && peopleDiscovery) {
    stream.push(peopleDiscovery);
  }
  if (diversifiedPrimary.length <= 7 && secondaryDiscovery) {
    stream.push(secondaryDiscovery);
  }
  while (anonCursor < uniqueAnonPosts.length) {
    const anon = uniqueAnonPosts[anonCursor];
    anonCursor += 1;
    stream.push({ kind: 'anonymous', id: `anon_${anon.id}`, post: anon });
  }

  return stream;
}

/**
 * Merges Official Updates, Campus Updates, and Anonymous Posts into a unified
 * newest-first Home "Latest" stream without duplicate entries.
 */
export function buildCombinedHomeLatestStream(input: {
  updates?: readonly HomeUpdateWithAuthor[];
  posts: readonly PersonalisedPostWithAuthor[];
  anonymousPosts?: readonly AnonymousPost[];
}): CombinedHomeStreamEntry[] {
  const combined: Array<{
    kindRank: number;
    createdMs: number;
    rawId: string;
    entry: CombinedHomeStreamEntry;
  }> = [];

  const seenUpdates = new Set<string>();
  for (const item of input.updates ?? []) {
    if (item.update.status !== 'published' || seenUpdates.has(item.update.id)) {
      continue;
    }
    seenUpdates.add(item.update.id);
    combined.push({
      kindRank: 3,
      createdMs: extractTimestampMs(item.update.createdAt) ?? 0,
      rawId: item.update.id,
      entry: { kind: 'update', id: `update_${item.update.id}`, item },
    });
  }

  const seenPosts = new Set<string>();
  for (const item of input.posts) {
    if (item.post.status !== 'published' || seenPosts.has(item.post.id)) {
      continue;
    }
    seenPosts.add(item.post.id);
    combined.push({
      kindRank: 2,
      createdMs: extractTimestampMs(item.post.createdAt) ?? 0,
      rawId: item.post.id,
      entry: { kind: 'post', id: `post_${item.post.id}`, item },
    });
  }

  const seenAnon = new Set<string>();
  for (const anon of input.anonymousPosts ?? []) {
    if (anon.status !== 'published' || seenAnon.has(anon.id)) {
      continue;
    }
    seenAnon.add(anon.id);
    combined.push({
      kindRank: 1,
      createdMs: extractTimestampMs(anon.createdAt) ?? 0,
      rawId: anon.id,
      entry: { kind: 'anonymous', id: `anon_${anon.id}`, post: anon },
    });
  }

  return combined
    .sort((a, b) => {
      if (b.createdMs !== a.createdMs) {
        return b.createdMs - a.createdMs;
      }
      if (b.kindRank !== a.kindRank) {
        return b.kindRank - a.kindRank;
      }
      return b.rawId.localeCompare(a.rawId);
    })
    .map((item) => item.entry);
}

const DISMISSED_RECS_STORAGE_PREFIX = 'lasued_intel_dismissed_recs_v1';

export function loadDismissedRecommendationKeys(
  viewerUid: string | null | undefined
): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const key = `${DISMISSED_RECS_STORAGE_PREFIX}:${viewerUid || 'guest'}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveDismissedRecommendationKey(
  viewerUid: string | null | undefined,
  recKey: string
): Set<string> {
  const next = loadDismissedRecommendationKeys(viewerUid);
  next.add(recKey);
  if (typeof window !== 'undefined') {
    const key = `${DISMISSED_RECS_STORAGE_PREFIX}:${viewerUid || 'guest'}`;
    try {
      const trimmed = Array.from(next).slice(-200);
      window.localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

const AI_BEHAVIOR_STORAGE_PREFIX = 'lasued_intel_ai_behavior_v1';

interface SerializedBehaviorPayload {
  authorWeights: Array<[string, number]>;
  categoryWeights: Array<[string, number]>;
  keywordWeights: Array<[string, number]>;
  seenCounts: Array<[string, number]>;
  lastSeenMs: Array<[string, number]>;
  fastSkippedIds: string[];
}

const memoryBehaviorStore = new Map<string, FeedBehaviorSnapshot>();

function emptyBehaviorSnapshot(): FeedBehaviorSnapshot {
  return {
    authorWeights: new Map(),
    categoryWeights: new Map(),
    keywordWeights: new Map(),
    seenCounts: new Map(),
    lastSeenMs: new Map(),
    fastSkippedIds: new Set(),
  };
}

function cloneBehaviorSnapshot(snap: FeedBehaviorSnapshot): FeedBehaviorSnapshot {
  return {
    authorWeights: new Map(snap.authorWeights),
    categoryWeights: new Map(snap.categoryWeights),
    keywordWeights: new Map(snap.keywordWeights),
    seenCounts: new Map(snap.seenCounts),
    lastSeenMs: new Map(snap.lastSeenMs),
    fastSkippedIds: new Set(snap.fastSkippedIds),
  };
}

export function loadFeedBehaviorSnapshot(
  viewerUid: string | null | undefined
): FeedBehaviorSnapshot {
  const storageKey = `${AI_BEHAVIOR_STORAGE_PREFIX}:${viewerUid || 'guest'}`;
  if (typeof window === 'undefined') {
    const cached = memoryBehaviorStore.get(storageKey);
    return cached ? cloneBehaviorSnapshot(cached) : emptyBehaviorSnapshot();
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyBehaviorSnapshot();
    const parsed = JSON.parse(raw) as Partial<SerializedBehaviorPayload>;
    return {
      authorWeights: new Map(Array.isArray(parsed.authorWeights) ? parsed.authorWeights : []),
      categoryWeights: new Map(Array.isArray(parsed.categoryWeights) ? parsed.categoryWeights : []),
      keywordWeights: new Map(Array.isArray(parsed.keywordWeights) ? parsed.keywordWeights : []),
      seenCounts: new Map(Array.isArray(parsed.seenCounts) ? parsed.seenCounts : []),
      lastSeenMs: new Map(Array.isArray(parsed.lastSeenMs) ? parsed.lastSeenMs : []),
      fastSkippedIds: new Set(Array.isArray(parsed.fastSkippedIds) ? parsed.fastSkippedIds : []),
    };
  } catch {
    return emptyBehaviorSnapshot();
  }
}

export function recordFeedBehaviorSignal(
  viewerUid: string | null | undefined,
  signal: FeedInteractionSignal
): FeedBehaviorSnapshot {
  const storageKey = `${AI_BEHAVIOR_STORAGE_PREFIX}:${viewerUid || 'guest'}`;
  const snap = loadFeedBehaviorSnapshot(viewerUid);
  const nowMs = signal.timestampMs ?? Date.now();
  const dwellMs = Math.max(0, signal.dwellMs);

  const prevSeen = snap.seenCounts.get(signal.targetId) ?? 0;
  snap.seenCounts.set(signal.targetId, Math.min(20, prevSeen + 1));
  snap.lastSeenMs.set(signal.targetId, nowMs);

  const isCompleted = signal.completed ?? dwellMs >= 4500;
  const isFastSkip = signal.skippedFast ?? (dwellMs < 900 && !signal.interacted);

  if (isFastSkip) {
    snap.fastSkippedIds.add(signal.targetId);
  } else if (signal.interacted || isCompleted) {
    snap.fastSkippedIds.delete(signal.targetId);
  }

  const delta = signal.interacted
    ? 8
    : isCompleted
      ? 4.5
      : dwellMs >= 2000
        ? 2
        : isFastSkip
          ? -3
          : 0;

  if (delta !== 0) {
    if (signal.authorKey) {
      const nextAuthor = Math.max(
        -18,
        Math.min(36, (snap.authorWeights.get(signal.authorKey) ?? 0) + delta)
      );
      snap.authorWeights.set(signal.authorKey, nextAuthor);
    }
    const catKey = normalizePhrase(signal.category);
    if (catKey) {
      const nextCat = Math.max(
        -12,
        Math.min(36, (snap.categoryWeights.get(catKey) ?? 0) + delta)
      );
      snap.categoryWeights.set(catKey, nextCat);
    }
    if (signal.text && delta > 0) {
      for (const word of tokenizeInterestText(signal.text).slice(0, 8)) {
        const nextKw = Math.min(12, (snap.keywordWeights.get(word) ?? 0) + delta * 0.25);
        snap.keywordWeights.set(word, nextKw);
      }
    }
  }

  // Bound stored map sizes for performance
  const trimMap = <V>(m: Map<string, V>, limit: number) => {
    while (m.size > limit) {
      const oldest = m.keys().next().value;
      if (oldest === undefined) break;
      m.delete(oldest);
    }
  };
  trimMap(snap.authorWeights, 60);
  trimMap(snap.categoryWeights, 40);
  trimMap(snap.keywordWeights, 80);
  trimMap(snap.seenCounts, 120);
  trimMap(snap.lastSeenMs, 120);
  if (snap.fastSkippedIds.size > 100) {
    const trimmed = Array.from(snap.fastSkippedIds).slice(-80);
    snap.fastSkippedIds = new Set(trimmed);
  }

  memoryBehaviorStore.set(storageKey, cloneBehaviorSnapshot(snap));

  if (typeof window !== 'undefined') {
    try {
      const serialized: SerializedBehaviorPayload = {
        authorWeights: Array.from(snap.authorWeights.entries()),
        categoryWeights: Array.from(snap.categoryWeights.entries()),
        keywordWeights: Array.from(snap.keywordWeights.entries()),
        seenCounts: Array.from(snap.seenCounts.entries()),
        lastSeenMs: Array.from(snap.lastSeenMs.entries()),
        fastSkippedIds: Array.from(snap.fastSkippedIds),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(serialized));
    } catch {
      // Ignore storage quota errors
    }
  }

  return snap;
}

export function clearFeedBehaviorCacheForTest(viewerUid?: string | null): void {
  if (viewerUid === undefined) {
    memoryBehaviorStore.clear();
  } else {
    memoryBehaviorStore.delete(`${AI_BEHAVIOR_STORAGE_PREFIX}:${viewerUid || 'guest'}`);
  }
}

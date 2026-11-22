import type {
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
  nowMs?: number;
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

/**
 * Computes a transparent, deterministic relevance score combining recency,
 * follow relationships, academic department/faculty relevance, explicit topics,
 * interaction affinities, official/pinned priority, and bounded engagement.
 */
export function computeForYouPostScore(
  post: CommunityPost,
  options: ForYouRankingOptions = {}
): number {
  const nowMs = options.nowMs ?? Date.now();
  const createdMs = extractTimestampMs(post.createdAt) ?? nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));

  // Freshness starts at 100 and decays smoothly over time
  const freshnessScore = 100 / Math.pow(1 + ageHours / 18, 1.15);

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
    32,
    options.interactedAuthorWeights?.get(post.ownerUID) ?? 0
  );
  const categoryAffinityBoost = Math.min(
    26,
    (options.interactedCategoryWeights?.get(categoryKey) ?? 0) +
      Math.min(14, keywordWeight * 2)
  );

  const likes = Number.isFinite(post.likesCount)
    ? Math.max(0, post.likesCount)
    : 0;
  const comments = Number.isFinite(post.commentsCount)
    ? Math.max(0, post.commentsCount)
    : 0;

  // Bounded engagement so viral older posts don't crowd out fresh relevant content
  const engagementScore =
    Math.min(35, Math.sqrt(likes) * 3.8) + Math.min(45, Math.sqrt(comments) * 5.5);

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
    freshnessScore
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

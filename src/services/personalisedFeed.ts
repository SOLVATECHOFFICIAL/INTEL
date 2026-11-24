import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  COLLECTION_NAMES,
  isValidFirestoreId,
  type AnonymousPost,
  type CampusEvent,
  type CommunityPost,
  type Opportunity,
  type PublicProfileProjection,
  type PublicUserProfile,
} from '../types/database';
import { toPublicProfileProjection } from '../utils/authValidation';
import {
  buildInteractionAffinities,
  loadFeedBehaviorSnapshot,
  rankRecommendedAnonymousPosts,
  rankRecommendedEvents,
  rankRecommendedOpportunities,
  rankRecommendedPeople,
  type AnonymousRecommendationItem,
  type EventRecommendationItem,
  type ForYouRankingOptions,
  type OpportunityRecommendationItem,
  type PersonRecommendationItem,
} from '../utils/feedRanking';
import { fetchPublicAnonymousFeedPage } from './firestoreFoundation';
import { fetchPublishedOpportunities } from './adminDashboard';
import { fetchPublishedCampusEvents } from './events';
import {
  fetchOwnedAnonymousEntries,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
} from './socialPosts';
import { SingleFlightRegistry } from '../utils/cacheSync';
import { registerPersonalisationInvalidator } from './cacheInvalidation';

export type {
  AnonymousFeedSessionSnapshot,
  HomeFeedSessionSnapshot,
} from './feedSessionCache';
export {
  clearAnonymousFeedSessionCache,
  clearHomeFeedSessionCache,
  getAnonymousFeedSessionSnapshot,
  getHomeFeedSessionSnapshot,
  hydrateAnonymousFeedSnapshot,
  hydrateHomeFeedSnapshot,
  saveAnonymousFeedSessionSnapshot,
  saveHomeFeedSessionSnapshot,
  updateAllCachedHomeFeedSnapshots,
  updateCachedAnonymousFeedSnapshot,
} from './feedSessionCache';

export interface ForYouDiscoveryBundle {
  recommendedPeople: PersonRecommendationItem[];
  recommendedEvents: EventRecommendationItem[];
  recommendedOpportunities: OpportunityRecommendationItem[];
  recommendedAnonymous: AnonymousRecommendationItem[];
  likedEventIds: Set<string>;
  savedEventIds: Set<string>;
  savedOpportunityIds: Set<string>;
  likedAnonIds: Set<string>;
  savedAnonIds: Set<string>;
  ownedAnonPostIds: Set<string>;
  ownedAnonCommentIds: Set<string>;
}

const personalisationSingleFlight = new SingleFlightRegistry();
const DIRECTORY_POOL_TTL_MS = 60 * 1000;
const PUBLIC_POOLS_TTL_MS = 45 * 1000;

let cachedDirectoryPool: {
  data: {
    projections: PublicProfileProjection[];
    uidToUsernameLower: Map<string, string>;
  };
  fetchedAt: number;
} | null = null;

let cachedDiscoveryPools: {
  events: CampusEvent[];
  opportunities: Opportunity[];
  anonPosts: AnonymousPost[];
  fetchedAt: number;
} | null = null;

export function invalidatePersonalisationPools(): void {
  cachedDirectoryPool = null;
  cachedDiscoveryPools = null;
}

registerPersonalisationInvalidator({
  invalidateAll: invalidatePersonalisationPools,
});

async function fetchActiveDirectoryMembers(maxItems = 50): Promise<{
  projections: PublicProfileProjection[];
  uidToUsernameLower: Map<string, string>;
}> {
  if (
    cachedDirectoryPool &&
    Date.now() - cachedDirectoryPool.fetchedAt <= DIRECTORY_POOL_TTL_MS
  ) {
    return cachedDirectoryPool.data;
  }

  return personalisationSingleFlight.run(`dir:${maxItems}`, async () => {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.users),
        where('isHiddenFromDirectory', '==', false),
        limit(maxItems)
      )
    );
    const projections: PublicProfileProjection[] = [];
    const uidToUsernameLower = new Map<string, string>();
    for (const docSnap of snap.docs) {
      const profile = docSnap.data() as PublicUserProfile;
      if (profile.accountStatus === 'active' && !profile.isHiddenFromDirectory) {
        projections.push(toPublicProfileProjection(profile));
        uidToUsernameLower.set(profile.uid, profile.username.toLowerCase());
      }
    }
    const data = { projections, uidToUsernameLower };
    cachedDirectoryPool = { data, fetchedAt: Date.now() };
    return data;
  });
}

async function fetchPublicDiscoveryPools(): Promise<{
  events: CampusEvent[];
  opportunities: Opportunity[];
  anonPosts: AnonymousPost[];
}> {
  if (
    cachedDiscoveryPools &&
    Date.now() - cachedDiscoveryPools.fetchedAt <= PUBLIC_POOLS_TTL_MS
  ) {
    return cachedDiscoveryPools;
  }

  return personalisationSingleFlight.run('discovery_pools', async () => {
    const [eventsRes, oppsRes, anonPageRes] = await Promise.allSettled([
      fetchPublishedCampusEvents(),
      fetchPublishedOpportunities(),
      fetchPublicAnonymousFeedPage({ pageSize: 20 }),
    ]);

    const pools = {
      events: eventsRes.status === 'fulfilled' ? eventsRes.value : [],
      opportunities: oppsRes.status === 'fulfilled' ? oppsRes.value : [],
      anonPosts:
        anonPageRes.status === 'fulfilled' ? anonPageRes.value.items : [],
      fetchedAt: Date.now(),
    };
    if (
      eventsRes.status === 'fulfilled' ||
      oppsRes.status === 'fulfilled' ||
      anonPageRes.status === 'fulfilled'
    ) {
      cachedDiscoveryPools = pools;
    }
    return pools;
  });
}

async function fetchSamplePostsByIds(
  postIds: readonly string[],
  maxCount = 12
): Promise<CommunityPost[]> {
  const validIds = Array.from(new Set(postIds.filter(isValidFirestoreId))).slice(
    0,
    maxCount
  );
  if (validIds.length === 0) return [];
  const results = await Promise.allSettled(
    validIds.map((id) => getDoc(doc(db, COLLECTION_NAMES.posts, id)))
  );
  const posts: CommunityPost[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      const post = res.value.data() as CommunityPost;
      if (post.status === 'published') posts.push(post);
    }
  }
  return posts;
}

/**
 * Loads the viewer's interaction affinities (ordinary likes/saves, event likes/saves,
 * opportunity saves) alongside active campus candidate pools to drive both
 * For You ranking options and mixed-content discovery cards.
 */
export async function loadPersonalisationContextAndDiscovery(input: {
  viewerUid: string | null;
  viewerProfile: PublicUserProfile | null;
  interestCategories: readonly string[];
  followedUids: readonly string[];
  followingUsernames: ReadonlySet<string>;
  likedPostIds: ReadonlySet<string>;
  savedPostIds: ReadonlySet<string>;
  dismissedKeys: ReadonlySet<string>;
}): Promise<{
  rankingOptions: Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'>;
  discovery: ForYouDiscoveryBundle;
}> {
  const viewerUid = input.viewerUid;
  const emptyDiscovery: ForYouDiscoveryBundle = {
    recommendedPeople: [],
    recommendedEvents: [],
    recommendedOpportunities: [],
    recommendedAnonymous: [],
    likedEventIds: new Set(),
    savedEventIds: new Set(),
    savedOpportunityIds: new Set(),
    likedAnonIds: new Set(),
    savedAnonIds: new Set(),
    ownedAnonPostIds: new Set(),
    ownedAnonCommentIds: new Set(),
  };

  const interactedPostIds = Array.from(
    new Set([...input.likedPostIds, ...input.savedPostIds])
  ).slice(0, 12);

  const [
    membersRes,
    poolsRes,
    interactedPostsRes,
    likedEventsRes,
    savedEventsRes,
    savedOppsRes,
    likedAnonRes,
    savedAnonRes,
    ownedAnonRes,
  ] = await Promise.allSettled([
    fetchActiveDirectoryMembers(50),
    fetchPublicDiscoveryPools(),
    fetchSamplePostsByIds(interactedPostIds, 12),
    viewerUid
      ? fetchViewerLikedPostIds('events', viewerUid)
      : Promise.resolve(new Set<string>()),
    viewerUid
      ? fetchViewerSavedPostIds('events', viewerUid)
      : Promise.resolve(new Set<string>()),
    viewerUid
      ? fetchViewerSavedPostIds('opportunities', viewerUid)
      : Promise.resolve(new Set<string>()),
    viewerUid
      ? fetchViewerLikedPostIds('anonymousPosts', viewerUid)
      : Promise.resolve(new Set<string>()),
    viewerUid
      ? fetchViewerSavedPostIds('anonymousPosts', viewerUid)
      : Promise.resolve(new Set<string>()),
    viewerUid
      ? fetchOwnedAnonymousEntries(viewerUid)
      : Promise.resolve({ postIds: new Set<string>(), commentIds: new Set<string>() }),
  ]);

  const memberPool =
    membersRes.status === 'fulfilled'
      ? membersRes.value
      : { projections: [], uidToUsernameLower: new Map<string, string>() };
  const pools =
    poolsRes.status === 'fulfilled'
      ? poolsRes.value
      : { events: [], opportunities: [], anonPosts: [] };
  const events: CampusEvent[] = pools.events;
  const opportunities: Opportunity[] = pools.opportunities;
  const anonPosts: AnonymousPost[] = pools.anonPosts;
  const interactedPosts =
    interactedPostsRes.status === 'fulfilled' ? interactedPostsRes.value : [];

  const likedEventIds =
    likedEventsRes.status === 'fulfilled'
      ? likedEventsRes.value
      : new Set<string>();
  const savedEventIds =
    savedEventsRes.status === 'fulfilled'
      ? savedEventsRes.value
      : new Set<string>();
  const savedOpportunityIds =
    savedOppsRes.status === 'fulfilled' ? savedOppsRes.value : new Set<string>();
  const likedAnonIds =
    likedAnonRes.status === 'fulfilled' ? likedAnonRes.value : new Set<string>();
  const savedAnonIds =
    savedAnonRes.status === 'fulfilled' ? savedAnonRes.value : new Set<string>();
  const ownedAnon =
    ownedAnonRes.status === 'fulfilled'
      ? ownedAnonRes.value
      : { postIds: new Set<string>(), commentIds: new Set<string>() };

  const interactedEvents = events.filter(
    (evt) => likedEventIds.has(evt.id) || savedEventIds.has(evt.id)
  );
  const savedOpportunities = opportunities.filter((opp) =>
    savedOpportunityIds.has(opp.id)
  );
  const interactedAnon = anonPosts.filter(
    (item) => likedAnonIds.has(item.id) || savedAnonIds.has(item.id)
  );

  const affinities = buildInteractionAffinities({
    likedOrSavedPosts: interactedPosts,
    likedOrSavedAnonymousPosts: interactedAnon,
    likedOrSavedEvents: interactedEvents,
    savedOpportunities,
  });

  const behaviorSnap = loadFeedBehaviorSnapshot(viewerUid);

  const mergedAuthorWeights = new Map(affinities.interactedAuthorWeights);
  for (const [k, v] of behaviorSnap.authorWeights.entries()) {
    mergedAuthorWeights.set(
      k,
      Math.max(-18, Math.min(40, (mergedAuthorWeights.get(k) ?? 0) + v))
    );
  }
  const mergedCategoryWeights = new Map(affinities.interactedCategoryWeights);
  for (const [k, v] of behaviorSnap.categoryWeights.entries()) {
    mergedCategoryWeights.set(
      k,
      Math.max(-12, Math.min(40, (mergedCategoryWeights.get(k) ?? 0) + v))
    );
  }
  const mergedKeywords = new Map(affinities.interactedKeywords);
  for (const [k, v] of behaviorSnap.keywordWeights.entries()) {
    mergedKeywords.set(
      k,
      Math.min(14, (mergedKeywords.get(k) ?? 0) + v)
    );
  }

  const interactedAuthorUsernames = new Map<string, number>();
  for (const [uid, weight] of mergedAuthorWeights.entries()) {
    if (weight <= 0) continue;
    const uname = memberPool.uidToUsernameLower.get(uid);
    if (uname) interactedAuthorUsernames.set(uname, weight);
  }

  const rankingOptions: Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'> = {
    viewerUid,
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    viewerLevel: input.viewerProfile?.level ?? null,
    interestCategories: input.interestCategories,
    interactedAuthorWeights: mergedAuthorWeights,
    interactedCategoryWeights: mergedCategoryWeights,
    interactedKeywords: mergedKeywords,
    seenCounts: behaviorSnap.seenCounts,
    lastSeenMs: behaviorSnap.lastSeenMs,
    fastSkippedIds: behaviorSnap.fastSkippedIds,
  };

  const followedUsernames = new Set(input.followingUsernames);
  for (const fUid of input.followedUids) {
    const uname = memberPool.uidToUsernameLower.get(fUid);
    if (uname) followedUsernames.add(uname);
  }

  const recommendedPeople = rankRecommendedPeople(memberPool.projections, {
    viewerUsername: input.viewerProfile?.username ?? null,
    followingUsernames: followedUsernames,
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    viewerLevel: input.viewerProfile?.level ?? null,
    interestCategories: input.interestCategories,
    interactedAuthorUsernames,
    interactedKeywords: affinities.interactedKeywords,
    dismissedKeys: input.dismissedKeys,
    maxResults: 5,
  });

  const recommendedEvents = rankRecommendedEvents(events, {
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    interestCategories: input.interestCategories,
    interactedCategoryWeights: affinities.interactedCategoryWeights,
    interactedKeywords: affinities.interactedKeywords,
    savedEventIds,
    dismissedKeys: input.dismissedKeys,
    maxResults: 3,
  });

  const recommendedOpportunities = rankRecommendedOpportunities(opportunities, {
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    viewerLevel: input.viewerProfile?.level ?? null,
    interestCategories: input.interestCategories,
    interactedCategoryWeights: affinities.interactedCategoryWeights,
    interactedKeywords: affinities.interactedKeywords,
    savedOpportunityIds,
    dismissedKeys: input.dismissedKeys,
    maxResults: 3,
  });

  const recommendedAnonymous = rankRecommendedAnonymousPosts(anonPosts, {
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    interestCategories: input.interestCategories,
    interactedCategoryWeights: affinities.interactedCategoryWeights,
    interactedKeywords: affinities.interactedKeywords,
    dismissedKeys: input.dismissedKeys,
    maxResults: 2,
  });

  return {
    rankingOptions,
    discovery: {
      ...emptyDiscovery,
      recommendedPeople,
      recommendedEvents,
      recommendedOpportunities,
      recommendedAnonymous,
      likedEventIds,
      savedEventIds,
      savedOpportunityIds,
      likedAnonIds,
      savedAnonIds,
      ownedAnonPostIds: ownedAnon.postIds,
      ownedAnonCommentIds: ownedAnon.commentIds,
    },
  };
}

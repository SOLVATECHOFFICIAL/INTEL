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

async function fetchActiveDirectoryMembers(maxItems = 50): Promise<{
  projections: PublicProfileProjection[];
  uidToUsernameLower: Map<string, string>;
}> {
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
  return { projections, uidToUsernameLower };
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
    eventsRes,
    oppsRes,
    anonPageRes,
    interactedPostsRes,
    likedEventsRes,
    savedEventsRes,
    savedOppsRes,
    likedAnonRes,
    savedAnonRes,
    ownedAnonRes,
  ] = await Promise.allSettled([
    fetchActiveDirectoryMembers(50),
    fetchPublishedCampusEvents(),
    fetchPublishedOpportunities(),
    fetchPublicAnonymousFeedPage({ pageSize: 20 }),
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
  const events: CampusEvent[] =
    eventsRes.status === 'fulfilled' ? eventsRes.value : [];
  const opportunities: Opportunity[] =
    oppsRes.status === 'fulfilled' ? oppsRes.value : [];
  const anonPosts: AnonymousPost[] =
    anonPageRes.status === 'fulfilled' ? anonPageRes.value.items : [];
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

  const interactedAuthorUsernames = new Map<string, number>();
  for (const [uid, weight] of affinities.interactedAuthorWeights.entries()) {
    const uname = memberPool.uidToUsernameLower.get(uid);
    if (uname) interactedAuthorUsernames.set(uname, weight);
  }

  const rankingOptions: Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'> = {
    viewerUid,
    viewerDepartment: input.viewerProfile?.department ?? null,
    viewerFaculty: input.viewerProfile?.faculty ?? null,
    viewerLevel: input.viewerProfile?.level ?? null,
    interestCategories: input.interestCategories,
    interactedAuthorWeights: affinities.interactedAuthorWeights,
    interactedCategoryWeights: affinities.interactedCategoryWeights,
    interactedKeywords: affinities.interactedKeywords,
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

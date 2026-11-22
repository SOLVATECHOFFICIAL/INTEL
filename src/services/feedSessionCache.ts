import type { AnonymousPost } from '../types/database';
import type { FeedTabId } from '../types/platform';
import type { ForYouRankingOptions } from '../utils/feedRanking';
import type {
  AnonymousFeedPageCursor,
  CommunityFeedCursor,
  CommunityPostWithAuthor,
} from './firestoreFoundation';
import type { ForYouDiscoveryBundle } from './personalisedFeed';
import {
  readPersistentContent,
  writePersistentContent,
} from './persistentCache';
import {
  deserializeSet,
  perfMetrics,
  sanitizeAnonymousPostsForCache,
  serializeSet,
  stripFirestoreCursor,
} from '../utils/cacheSync';

export interface HomeFeedSessionSnapshot {
  viewerKey: string;
  tab: FeedTabId;
  postItems: CommunityPostWithAuthor[];
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  followingCount: number;
  followedUids: string[];
  feedCursor: CommunityFeedCursor | null;
  hasMorePosts: boolean;
  rankingOptions?: Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'>;
  discovery?: ForYouDiscoveryBundle;
  interestSignature: string;
  cachedAt: number;
}

export interface AnonymousFeedSessionSnapshot {
  viewerKey: string;
  anonymousPosts: AnonymousPost[];
  anonCursor: AnonymousFeedPageCursor | null;
  hasMoreAnon: boolean;
  likedAnonIds: Set<string>;
  savedAnonIds: Set<string>;
  ownedAnonPostIds: Set<string>;
  ownedAnonCommentIds: Set<string>;
  cachedAt: number;
}

interface PersistedHomePublicPosts {
  postItems: CommunityPostWithAuthor[];
  hasMorePosts: boolean;
  feedCursor: { mode: 'offset'; offset: number } | null;
  cachedAt: number;
}

interface SerializedForYouDiscovery {
  recommendedPeople: ForYouDiscoveryBundle['recommendedPeople'];
  recommendedEvents: ForYouDiscoveryBundle['recommendedEvents'];
  recommendedOpportunities: ForYouDiscoveryBundle['recommendedOpportunities'];
  recommendedAnonymous: ForYouDiscoveryBundle['recommendedAnonymous'];
  likedEventIds: string[];
  savedEventIds: string[];
  savedOpportunityIds: string[];
  likedAnonIds: string[];
  savedAnonIds: string[];
  ownedAnonPostIds: string[];
  ownedAnonCommentIds: string[];
}

interface PersistedHomeViewerState {
  viewerKey: string;
  tab: FeedTabId;
  postItems?: CommunityPostWithAuthor[];
  hasMorePosts?: boolean;
  feedCursor?: { mode: 'offset'; offset: number } | null;
  likedPostIds: string[];
  savedPostIds: string[];
  followingCount: number;
  followedUids: string[];
  discovery?: SerializedForYouDiscovery;
  interestSignature: string;
  cachedAt: number;
}

interface PersistedAnonPublicPosts {
  anonymousPosts: AnonymousPost[];
  hasMoreAnon: boolean;
  anonCursor: { mode: 'offset'; offset: number } | null;
  cachedAt: number;
}

interface PersistedAnonViewerState {
  viewerKey: string;
  likedAnonIds: string[];
  savedAnonIds: string[];
  ownedAnonPostIds: string[];
  ownedAnonCommentIds: string[];
  cachedAt: number;
}

const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const homeFeedSessionCache = new Map<string, HomeFeedSessionSnapshot>();
let anonymousFeedSessionCache: AnonymousFeedSessionSnapshot | null = null;

function isGuestViewer(viewerKey: string): boolean {
  return !viewerKey || viewerKey === 'guest';
}

function makeHomeCacheKey(viewerKey: string, tab: FeedTabId): string {
  return `${viewerKey}:${tab}`;
}

function serializeDiscovery(
  discovery: ForYouDiscoveryBundle | undefined
): SerializedForYouDiscovery | undefined {
  if (!discovery) return undefined;
  return {
    recommendedPeople: discovery.recommendedPeople,
    recommendedEvents: discovery.recommendedEvents,
    recommendedOpportunities: discovery.recommendedOpportunities,
    recommendedAnonymous: discovery.recommendedAnonymous.map((item) => ({
      ...item,
      post: sanitizeAnonymousPostsForCache([item.post])[0],
    })),
    likedEventIds: serializeSet(discovery.likedEventIds),
    savedEventIds: serializeSet(discovery.savedEventIds),
    savedOpportunityIds: serializeSet(discovery.savedOpportunityIds),
    likedAnonIds: serializeSet(discovery.likedAnonIds),
    savedAnonIds: serializeSet(discovery.savedAnonIds),
    ownedAnonPostIds: serializeSet(discovery.ownedAnonPostIds),
    ownedAnonCommentIds: serializeSet(discovery.ownedAnonCommentIds),
  };
}

function deserializeDiscovery(
  raw: SerializedForYouDiscovery | undefined
): ForYouDiscoveryBundle | undefined {
  if (!raw) return undefined;
  return {
    recommendedPeople: raw.recommendedPeople ?? [],
    recommendedEvents: raw.recommendedEvents ?? [],
    recommendedOpportunities: raw.recommendedOpportunities ?? [],
    recommendedAnonymous: raw.recommendedAnonymous ?? [],
    likedEventIds: deserializeSet(raw.likedEventIds),
    savedEventIds: deserializeSet(raw.savedEventIds),
    savedOpportunityIds: deserializeSet(raw.savedOpportunityIds),
    likedAnonIds: deserializeSet(raw.likedAnonIds),
    savedAnonIds: deserializeSet(raw.savedAnonIds),
    ownedAnonPostIds: deserializeSet(raw.ownedAnonPostIds),
    ownedAnonCommentIds: deserializeSet(raw.ownedAnonCommentIds),
  };
}

export function getHomeFeedSessionSnapshot(
  viewerKey: string,
  tab: FeedTabId
): HomeFeedSessionSnapshot | null {
  const entry = homeFeedSessionCache.get(makeHomeCacheKey(viewerKey, tab));
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > SESSION_CACHE_TTL_MS) {
    homeFeedSessionCache.delete(makeHomeCacheKey(viewerKey, tab));
    return null;
  }
  perfMetrics.recordHit('home_feed_ram');
  return entry;
}

export function saveHomeFeedSessionSnapshot(
  snapshot: HomeFeedSessionSnapshot
): void {
  homeFeedSessionCache.set(
    makeHomeCacheKey(snapshot.viewerKey, snapshot.tab),
    snapshot
  );

  const isGuest = isGuestViewer(snapshot.viewerKey);
  if (snapshot.tab === 'following') {
    if (isGuest) return;
    const privPayload: PersistedHomeViewerState = {
      viewerKey: snapshot.viewerKey,
      tab: snapshot.tab,
      postItems: snapshot.postItems.slice(0, 36),
      hasMorePosts: snapshot.hasMorePosts,
      feedCursor: stripFirestoreCursor(snapshot.feedCursor),
      likedPostIds: serializeSet(snapshot.likedPostIds),
      savedPostIds: serializeSet(snapshot.savedPostIds),
      followingCount: snapshot.followingCount,
      followedUids: snapshot.followedUids,
      interestSignature: snapshot.interestSignature,
      cachedAt: snapshot.cachedAt,
    };
    void writePersistentContent(
      `priv:feed:v1:${snapshot.viewerKey}:following`,
      privPayload,
      { viewerKey: snapshot.viewerKey, scope: 'private' }
    );
    return;
  }

  // Persist public feed posts pool for fast cold-reload paint
  const publicPostsPayload: PersistedHomePublicPosts = {
    postItems: snapshot.postItems.slice(0, 36),
    hasMorePosts: snapshot.hasMorePosts,
    feedCursor: stripFirestoreCursor(snapshot.feedCursor),
    cachedAt: snapshot.cachedAt,
  };
  void writePersistentContent(
    `feed:posts:v1:${snapshot.tab}`,
    publicPostsPayload,
    { viewerKey: 'public', scope: 'public' }
  );

  if (!isGuest) {
    const privPayload: PersistedHomeViewerState = {
      viewerKey: snapshot.viewerKey,
      tab: snapshot.tab,
      likedPostIds: serializeSet(snapshot.likedPostIds),
      savedPostIds: serializeSet(snapshot.savedPostIds),
      followingCount: snapshot.followingCount,
      followedUids: snapshot.followedUids,
      discovery: serializeDiscovery(snapshot.discovery),
      interestSignature: snapshot.interestSignature,
      cachedAt: snapshot.cachedAt,
    };
    void writePersistentContent(
      `priv:feed:v1:${snapshot.viewerKey}:${snapshot.tab}`,
      privPayload,
      { viewerKey: snapshot.viewerKey, scope: 'private' }
    );
  }
}

export async function hydrateHomeFeedSnapshot(
  viewerKey: string,
  tab: FeedTabId
): Promise<HomeFeedSessionSnapshot | null> {
  const ramHit = getHomeFeedSessionSnapshot(viewerKey, tab);
  if (ramHit) return ramHit;

  const isGuest = isGuestViewer(viewerKey);
  if (tab === 'following') {
    if (isGuest) return null;
    const priv = await readPersistentContent<PersistedHomeViewerState>(
      `priv:feed:v1:${viewerKey}:following`
    );
    if (!priv) return null;
    const hydrated: HomeFeedSessionSnapshot = {
      viewerKey,
      tab,
      postItems: priv.postItems ?? [],
      likedPostIds: deserializeSet(priv.likedPostIds),
      savedPostIds: deserializeSet(priv.savedPostIds),
      followingCount: priv.followingCount ?? 0,
      followedUids: priv.followedUids ?? [],
      feedCursor: priv.feedCursor ?? null,
      hasMorePosts: Boolean(priv.hasMorePosts),
      interestSignature: priv.interestSignature ?? '',
      cachedAt: priv.cachedAt,
    };
    homeFeedSessionCache.set(makeHomeCacheKey(viewerKey, tab), hydrated);
    return hydrated;
  }

  const [pubPosts, privState] = await Promise.all([
    readPersistentContent<PersistedHomePublicPosts>(`feed:posts:v1:${tab}`),
    isGuest
      ? Promise.resolve(null)
      : readPersistentContent<PersistedHomeViewerState>(
          `priv:feed:v1:${viewerKey}:${tab}`
        ),
  ]);

  if (!pubPosts || pubPosts.postItems.length === 0) return null;

  const hydrated: HomeFeedSessionSnapshot = {
    viewerKey,
    tab,
    postItems: pubPosts.postItems,
    likedPostIds: privState ? deserializeSet(privState.likedPostIds) : new Set(),
    savedPostIds: privState ? deserializeSet(privState.savedPostIds) : new Set(),
    followingCount: privState?.followingCount ?? 0,
    followedUids: privState?.followedUids ?? [],
    feedCursor: pubPosts.feedCursor ?? null,
    hasMorePosts: Boolean(pubPosts.hasMorePosts),
    discovery: privState ? deserializeDiscovery(privState.discovery) : undefined,
    interestSignature: privState?.interestSignature ?? '',
    cachedAt: pubPosts.cachedAt,
  };

  homeFeedSessionCache.set(makeHomeCacheKey(viewerKey, tab), hydrated);
  return hydrated;
}

export function updateAllCachedHomeFeedSnapshots(
  updater: (snapshot: HomeFeedSessionSnapshot) => HomeFeedSessionSnapshot
): void {
  for (const [key, entry] of Array.from(homeFeedSessionCache.entries())) {
    const next = updater(entry);
    homeFeedSessionCache.set(key, next);
    saveHomeFeedSessionSnapshot(next);
  }
}

export function clearHomeFeedSessionCache(tab?: FeedTabId): void {
  if (!tab) {
    homeFeedSessionCache.clear();
    return;
  }
  for (const key of homeFeedSessionCache.keys()) {
    if (key.endsWith(`:${tab}`)) {
      homeFeedSessionCache.delete(key);
    }
  }
}

export function getAnonymousFeedSessionSnapshot(
  viewerKey: string
): AnonymousFeedSessionSnapshot | null {
  if (!anonymousFeedSessionCache) return null;
  if (
    anonymousFeedSessionCache.viewerKey !== viewerKey ||
    Date.now() - anonymousFeedSessionCache.cachedAt > SESSION_CACHE_TTL_MS
  ) {
    anonymousFeedSessionCache = null;
    return null;
  }
  perfMetrics.recordHit('anon_feed_ram');
  return anonymousFeedSessionCache;
}

export function saveAnonymousFeedSessionSnapshot(
  snapshot: AnonymousFeedSessionSnapshot
): void {
  const sanitizedPosts = sanitizeAnonymousPostsForCache(snapshot.anonymousPosts);
  const cleanSnapshot: AnonymousFeedSessionSnapshot = {
    ...snapshot,
    anonymousPosts: sanitizedPosts,
  };
  anonymousFeedSessionCache = cleanSnapshot;

  const publicPayload: PersistedAnonPublicPosts = {
    anonymousPosts: sanitizedPosts.slice(0, 36),
    hasMoreAnon: cleanSnapshot.hasMoreAnon,
    anonCursor: stripFirestoreCursor(cleanSnapshot.anonCursor),
    cachedAt: cleanSnapshot.cachedAt,
  };
  void writePersistentContent('anon:posts:v1', publicPayload, {
    viewerKey: 'public',
    scope: 'public',
  });

  if (!isGuestViewer(cleanSnapshot.viewerKey)) {
    const privPayload: PersistedAnonViewerState = {
      viewerKey: cleanSnapshot.viewerKey,
      likedAnonIds: serializeSet(cleanSnapshot.likedAnonIds),
      savedAnonIds: serializeSet(cleanSnapshot.savedAnonIds),
      ownedAnonPostIds: serializeSet(cleanSnapshot.ownedAnonPostIds),
      ownedAnonCommentIds: serializeSet(cleanSnapshot.ownedAnonCommentIds),
      cachedAt: cleanSnapshot.cachedAt,
    };
    void writePersistentContent(
      `priv:anon:v1:${cleanSnapshot.viewerKey}`,
      privPayload,
      { viewerKey: cleanSnapshot.viewerKey, scope: 'private' }
    );
  }
}

export async function hydrateAnonymousFeedSnapshot(
  viewerKey: string
): Promise<AnonymousFeedSessionSnapshot | null> {
  const ramHit = getAnonymousFeedSessionSnapshot(viewerKey);
  if (ramHit) return ramHit;

  const isGuest = isGuestViewer(viewerKey);
  const [pub, priv] = await Promise.all([
    readPersistentContent<PersistedAnonPublicPosts>('anon:posts:v1'),
    isGuest
      ? Promise.resolve(null)
      : readPersistentContent<PersistedAnonViewerState>(
          `priv:anon:v1:${viewerKey}`
        ),
  ]);

  if (!pub || pub.anonymousPosts.length === 0) return null;

  const hydrated: AnonymousFeedSessionSnapshot = {
    viewerKey,
    anonymousPosts: sanitizeAnonymousPostsForCache(pub.anonymousPosts),
    anonCursor: pub.anonCursor ?? null,
    hasMoreAnon: Boolean(pub.hasMoreAnon),
    likedAnonIds: priv ? deserializeSet(priv.likedAnonIds) : new Set(),
    savedAnonIds: priv ? deserializeSet(priv.savedAnonIds) : new Set(),
    ownedAnonPostIds: priv ? deserializeSet(priv.ownedAnonPostIds) : new Set(),
    ownedAnonCommentIds: priv
      ? deserializeSet(priv.ownedAnonCommentIds)
      : new Set(),
    cachedAt: pub.cachedAt,
  };

  anonymousFeedSessionCache = hydrated;
  return hydrated;
}

export function updateCachedAnonymousFeedSnapshot(
  updater: (snapshot: AnonymousFeedSessionSnapshot) => AnonymousFeedSessionSnapshot
): void {
  if (!anonymousFeedSessionCache) return;
  const next = updater(anonymousFeedSessionCache);
  saveAnonymousFeedSessionSnapshot(next);
}

export function clearAnonymousFeedSessionCache(): void {
  anonymousFeedSessionCache = null;
}

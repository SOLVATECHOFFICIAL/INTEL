import type { MemberProfileBundle } from './firestoreFoundation';
import type {
  SearchCollectionKey,
  SearchDiscoveryBundle,
} from './searchDiscovery';
import type {
  CommentWithAuthor,
  CommentsPageCursor,
  SavedContentBundle,
} from './socialPosts';
import {
  deletePersistentContent,
  readPersistentContent,
  writePersistentContent,
} from './persistentCache';
import {
  deserializeRecordMap,
  deserializeSet,
  perfMetrics,
  sanitizeAnonymousPostsForCache,
  serializeRecordMap,
  serializeSet,
  stripFirestoreCursor,
} from '../utils/cacheSync';
import type {
  AnonymousPost,
  CampusEvent,
  CommunityPost,
  MarketplaceListing,
  Opportunity,
  OpportunityCategory,
  PublicProfileProjection,
  TrustedContact,
  EventCategory,
} from '../types/database';
import type {
  AccountSettingsSection,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
} from '../types/platform';
import type { SearchFiltersState } from '../utils/contextualSearch';
import type {
  EventDateWindowFilter,
  EventStatusFilter,
} from '../utils/events';
import type {
  NotificationCategoryFilter,
  NotificationReadFilter,
} from '../utils/notifications';
import type {
  OpportunityDeadlineFilter,
  OpportunityStatusFilter,
} from '../utils/opportunities';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt <= SESSION_CACHE_TTL_MS;
}

function isGuestViewer(viewerKey: string): boolean {
  return !viewerKey || viewerKey === 'guest';
}

// ---------------------------------------------------------------------------
// 1. Post UI Snapshot (open comments, pagination, reply target, lightbox)
// ---------------------------------------------------------------------------
export interface PostUiSnapshot {
  viewerKey: string;
  kind: 'ordinary' | 'anonymous';
  postId: string;
  commentsManualOpen: boolean | null;
  comments: CommentWithAuthor[];
  commentsCursor: CommentsPageCursor | null;
  hasMoreComments: boolean;
  commentsLoaded: boolean;
  replyingToId: string | null;
  lightboxIndex: number | null;
  likedCommentIds: Set<string>;
  commentLikesCounts: Record<string, number>;
  cachedAt: number;
}

interface SerializedPostUiSnapshot {
  viewerKey: string;
  kind: 'ordinary' | 'anonymous';
  postId: string;
  commentsManualOpen: boolean | null;
  comments: CommentWithAuthor[];
  commentsCursor: { mode: 'offset'; offset: number } | null;
  hasMoreComments: boolean;
  commentsLoaded: boolean;
  replyingToId: string | null;
  lightboxIndex: number | null;
  likedCommentIds: string[];
  commentLikesCounts: Record<string, number>;
  cachedAt: number;
}

const postUiCache = new Map<string, PostUiSnapshot>();

function makePostUiKey(
  viewerKey: string,
  kind: 'ordinary' | 'anonymous',
  postId: string
): string {
  return `${viewerKey}:${kind}:${postId}`;
}

function makePersistentPostUiKey(
  viewerKey: string,
  kind: 'ordinary' | 'anonymous',
  postId: string
): string {
  return isGuestViewer(viewerKey)
    ? `postui:pub:v1:${kind}:${postId}`
    : `priv:postui:v1:${viewerKey}:${kind}:${postId}`;
}

export function getPostUiSnapshot(
  viewerKey: string,
  kind: 'ordinary' | 'anonymous',
  postId: string
): PostUiSnapshot | null {
  const key = makePostUiKey(viewerKey, kind, postId);
  const entry = postUiCache.get(key);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    postUiCache.delete(key);
    return null;
  }
  perfMetrics.recordHit('post_ui_ram');
  return entry;
}

export function savePostUiSnapshot(snapshot: PostUiSnapshot): void {
  const key = makePostUiKey(
    snapshot.viewerKey,
    snapshot.kind,
    snapshot.postId
  );
  if (postUiCache.size > 160 && !postUiCache.has(key)) {
    const oldest = postUiCache.keys().next().value;
    if (oldest) postUiCache.delete(oldest);
  }
  postUiCache.set(key, snapshot);

  const sanitizedComments =
    snapshot.kind === 'anonymous'
      ? snapshot.comments.map((entry) => ({
          comment: { ...entry.comment },
          author: null,
        }))
      : snapshot.comments;

  const serialized: SerializedPostUiSnapshot = {
    viewerKey: snapshot.viewerKey,
    kind: snapshot.kind,
    postId: snapshot.postId,
    commentsManualOpen: snapshot.commentsManualOpen,
    comments: sanitizedComments.slice(0, 60),
    commentsCursor: stripFirestoreCursor(snapshot.commentsCursor),
    hasMoreComments: snapshot.hasMoreComments,
    commentsLoaded: snapshot.commentsLoaded,
    replyingToId: snapshot.replyingToId,
    lightboxIndex: snapshot.lightboxIndex,
    likedCommentIds: serializeSet(snapshot.likedCommentIds),
    commentLikesCounts: snapshot.commentLikesCounts,
    cachedAt: snapshot.cachedAt,
  };

  void writePersistentContent(
    makePersistentPostUiKey(snapshot.viewerKey, snapshot.kind, snapshot.postId),
    serialized,
    {
      viewerKey: snapshot.viewerKey,
      scope: isGuestViewer(snapshot.viewerKey) ? 'public' : 'private',
    }
  );
}

export async function hydratePostUiSnapshot(
  viewerKey: string,
  kind: 'ordinary' | 'anonymous',
  postId: string
): Promise<PostUiSnapshot | null> {
  const ramHit = getPostUiSnapshot(viewerKey, kind, postId);
  if (ramHit) return ramHit;

  const stored = await readPersistentContent<SerializedPostUiSnapshot>(
    makePersistentPostUiKey(viewerKey, kind, postId)
  );
  if (!stored) return null;

  const hydrated: PostUiSnapshot = {
    viewerKey,
    kind: stored.kind,
    postId: stored.postId,
    commentsManualOpen: stored.commentsManualOpen,
    comments: stored.comments ?? [],
    commentsCursor: stored.commentsCursor,
    hasMoreComments: Boolean(stored.hasMoreComments),
    commentsLoaded: Boolean(stored.commentsLoaded),
    replyingToId: stored.replyingToId ?? null,
    lightboxIndex: stored.lightboxIndex ?? null,
    likedCommentIds: deserializeSet(stored.likedCommentIds),
    commentLikesCounts: stored.commentLikesCounts ?? {},
    cachedAt: stored.cachedAt,
  };
  postUiCache.set(makePostUiKey(viewerKey, kind, postId), hydrated);
  return hydrated;
}

export function updateCachedPostUiSnapshot(
  kind: 'ordinary' | 'anonymous',
  postId: string,
  updater: (snapshot: PostUiSnapshot) => PostUiSnapshot | null
): void {
  for (const [key, entry] of Array.from(postUiCache.entries())) {
    if (entry.kind === kind && entry.postId === postId) {
      const next = updater(entry);
      if (next) {
        savePostUiSnapshot(next);
      } else {
        postUiCache.delete(key);
        void deletePersistentContent(
          makePersistentPostUiKey(entry.viewerKey, kind, postId)
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Marketplace Session Snapshot
// ---------------------------------------------------------------------------
export interface MarketplaceSessionSnapshot {
  viewerKey: string;
  activeTab: MarketplaceTab;
  selectedCategory: string;
  searchQuery: string;
  publicListings: MarketplaceListing[];
  sellerMap: Map<string, PublicProfileProjection>;
  myListings: MarketplaceListing[];
  pendingListings: MarketplaceListing[];
  activeGalleryIndexByListingId: Record<string, number>;
  detailLightbox: { listingId: string; index: number } | null;
  directLookupListing: {
    targetId: string;
    listing: MarketplaceListing | null;
  } | null;
  cachedAt: number;
}

interface PersistedMarketplacePublic {
  publicListings: MarketplaceListing[];
  sellerMap: Array<[string, PublicProfileProjection]>;
  cachedAt: number;
}

interface PersistedMarketplacePrivate {
  viewerKey: string;
  activeTab: MarketplaceTab;
  selectedCategory: string;
  searchQuery: string;
  myListings: MarketplaceListing[];
  pendingListings: MarketplaceListing[];
  activeGalleryIndexByListingId: Record<string, number>;
  detailLightbox: { listingId: string; index: number } | null;
  cachedAt: number;
}

const MARKETPLACE_PUBLIC_IDB_KEY = 'mkt:public:v1';
const makeMarketplacePrivateIdbKey = (viewerKey: string) =>
  isGuestViewer(viewerKey) ? 'mkt:ui:guest' : `priv:mkt:v1:${viewerKey}`;

const marketplaceCache = new Map<string, MarketplaceSessionSnapshot>();

export function getMarketplaceSessionSnapshot(
  viewerKey: string
): MarketplaceSessionSnapshot | null {
  const entry = marketplaceCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    marketplaceCache.delete(viewerKey);
    return null;
  }
  perfMetrics.recordHit('marketplace_ram');
  return entry;
}

export function saveMarketplaceSessionSnapshot(
  snapshot: MarketplaceSessionSnapshot
): void {
  marketplaceCache.set(snapshot.viewerKey, snapshot);

  const pubPayload: PersistedMarketplacePublic = {
    publicListings: snapshot.publicListings,
    sellerMap: serializeRecordMap(snapshot.sellerMap),
    cachedAt: snapshot.cachedAt,
  };
  void writePersistentContent(MARKETPLACE_PUBLIC_IDB_KEY, pubPayload, {
    viewerKey: 'public',
    scope: 'public',
  });

  const privPayload: PersistedMarketplacePrivate = {
    viewerKey: snapshot.viewerKey,
    activeTab: snapshot.activeTab,
    selectedCategory: snapshot.selectedCategory,
    searchQuery: snapshot.searchQuery,
    myListings: isGuestViewer(snapshot.viewerKey) ? [] : snapshot.myListings,
    pendingListings: isGuestViewer(snapshot.viewerKey)
      ? []
      : snapshot.pendingListings,
    activeGalleryIndexByListingId: snapshot.activeGalleryIndexByListingId,
    detailLightbox: snapshot.detailLightbox,
    cachedAt: snapshot.cachedAt,
  };
  void writePersistentContent(
    makeMarketplacePrivateIdbKey(snapshot.viewerKey),
    privPayload,
    {
      viewerKey: snapshot.viewerKey,
      scope: isGuestViewer(snapshot.viewerKey) ? 'public' : 'private',
    }
  );
}

export async function hydrateMarketplaceSnapshot(
  viewerKey: string
): Promise<MarketplaceSessionSnapshot | null> {
  const ramHit = getMarketplaceSessionSnapshot(viewerKey);
  if (ramHit) return ramHit;

  const [pub, priv] = await Promise.all([
    readPersistentContent<PersistedMarketplacePublic>(MARKETPLACE_PUBLIC_IDB_KEY),
    readPersistentContent<PersistedMarketplacePrivate>(
      makeMarketplacePrivateIdbKey(viewerKey)
    ),
  ]);

  if (!pub && !priv) return null;

  const snapshot: MarketplaceSessionSnapshot = {
    viewerKey,
    activeTab: priv?.activeTab ?? 'browse',
    selectedCategory:
      !priv?.selectedCategory || priv.selectedCategory === 'All'
        ? 'All Categories'
        : priv.selectedCategory,
    searchQuery: priv?.searchQuery ?? '',
    publicListings: pub?.publicListings ?? [],
    sellerMap: deserializeRecordMap<PublicProfileProjection>(pub?.sellerMap),
    myListings: isGuestViewer(viewerKey) ? [] : priv?.myListings ?? [],
    pendingListings: isGuestViewer(viewerKey) ? [] : priv?.pendingListings ?? [],
    activeGalleryIndexByListingId: priv?.activeGalleryIndexByListingId ?? {},
    detailLightbox: priv?.detailLightbox ?? null,
    directLookupListing: null,
    cachedAt: Math.max(pub?.cachedAt ?? 0, priv?.cachedAt ?? 0) || Date.now(),
  };

  marketplaceCache.set(viewerKey, snapshot);
  return snapshot;
}

export function updateAllCachedMarketplaceSnapshots(
  updater: (snap: MarketplaceSessionSnapshot) => MarketplaceSessionSnapshot
): void {
  for (const [key, entry] of Array.from(marketplaceCache.entries())) {
    const next = updater(entry);
    marketplaceCache.set(key, next);
    saveMarketplaceSessionSnapshot(next);
  }
}

// ---------------------------------------------------------------------------
// 3. Events Session Snapshot
// ---------------------------------------------------------------------------
export interface EventsSessionSnapshot {
  viewerKey: string;
  events: CampusEvent[];
  likedIds: Set<string>;
  savedIds: Set<string>;
  activeTab: 'all' | 'saved';
  searchQuery: string;
  categoryFilter: 'all' | EventCategory;
  statusFilter: EventStatusFilter;
  dateWindowFilter: EventDateWindowFilter;
  venueFilter: string;
  directLookupResult: {
    targetId: string;
    event: CampusEvent | null;
  } | null;
  lightboxByEventId: Record<string, number | null>;
  cachedAt: number;
}

interface PersistedEventsPublic {
  events: CampusEvent[];
  cachedAt: number;
}

interface PersistedEventsPrivate {
  viewerKey: string;
  likedIds: string[];
  savedIds: string[];
  activeTab: 'all' | 'saved';
  searchQuery: string;
  categoryFilter: 'all' | EventCategory;
  statusFilter: EventStatusFilter;
  dateWindowFilter: EventDateWindowFilter;
  venueFilter: string;
  lightboxByEventId: Record<string, number | null>;
  cachedAt: number;
}

const EVENTS_PUBLIC_IDB_KEY = 'events:public:v1';
const makeEventsPrivateIdbKey = (viewerKey: string) =>
  isGuestViewer(viewerKey) ? 'events:ui:guest' : `priv:events:v1:${viewerKey}`;

const eventsCache = new Map<string, EventsSessionSnapshot>();

export function getEventsSessionSnapshot(
  viewerKey: string
): EventsSessionSnapshot | null {
  const entry = eventsCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    eventsCache.delete(viewerKey);
    return null;
  }
  perfMetrics.recordHit('events_ram');
  return entry;
}

export function saveEventsSessionSnapshot(
  snapshot: EventsSessionSnapshot
): void {
  eventsCache.set(snapshot.viewerKey, snapshot);

  void writePersistentContent<PersistedEventsPublic>(
    EVENTS_PUBLIC_IDB_KEY,
    {
      events: snapshot.events,
      cachedAt: snapshot.cachedAt,
    },
    { viewerKey: 'public', scope: 'public' }
  );

  void writePersistentContent<PersistedEventsPrivate>(
    makeEventsPrivateIdbKey(snapshot.viewerKey),
    {
      viewerKey: snapshot.viewerKey,
      likedIds: isGuestViewer(snapshot.viewerKey)
        ? []
        : serializeSet(snapshot.likedIds),
      savedIds: isGuestViewer(snapshot.viewerKey)
        ? []
        : serializeSet(snapshot.savedIds),
      activeTab: snapshot.activeTab,
      searchQuery: snapshot.searchQuery,
      categoryFilter: snapshot.categoryFilter,
      statusFilter: snapshot.statusFilter,
      dateWindowFilter: snapshot.dateWindowFilter,
      venueFilter: snapshot.venueFilter,
      lightboxByEventId: snapshot.lightboxByEventId,
      cachedAt: snapshot.cachedAt,
    },
    {
      viewerKey: snapshot.viewerKey,
      scope: isGuestViewer(snapshot.viewerKey) ? 'public' : 'private',
    }
  );
}

export async function hydrateEventsSnapshot(
  viewerKey: string
): Promise<EventsSessionSnapshot | null> {
  const ramHit = getEventsSessionSnapshot(viewerKey);
  if (ramHit) return ramHit;

  const [pub, priv] = await Promise.all([
    readPersistentContent<PersistedEventsPublic>(EVENTS_PUBLIC_IDB_KEY),
    readPersistentContent<PersistedEventsPrivate>(
      makeEventsPrivateIdbKey(viewerKey)
    ),
  ]);

  if (!pub && !priv) return null;

  const snapshot: EventsSessionSnapshot = {
    viewerKey,
    events: pub?.events ?? [],
    likedIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.likedIds),
    savedIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.savedIds),
    activeTab: priv?.activeTab ?? 'all',
    searchQuery: priv?.searchQuery ?? '',
    categoryFilter: priv?.categoryFilter ?? 'all',
    statusFilter: priv?.statusFilter ?? 'all',
    dateWindowFilter: priv?.dateWindowFilter ?? 'all',
    venueFilter: priv?.venueFilter ?? '',
    directLookupResult: null,
    lightboxByEventId: priv?.lightboxByEventId ?? {},
    cachedAt: Math.max(pub?.cachedAt ?? 0, priv?.cachedAt ?? 0) || Date.now(),
  };

  eventsCache.set(viewerKey, snapshot);
  return snapshot;
}

export function updateAllCachedEventsSnapshots(
  updater: (snap: EventsSessionSnapshot) => EventsSessionSnapshot
): void {
  for (const [key, entry] of Array.from(eventsCache.entries())) {
    const next = updater(entry);
    eventsCache.set(key, next);
    saveEventsSessionSnapshot(next);
  }
}

// ---------------------------------------------------------------------------
// 4. Opportunities Session Snapshot
// ---------------------------------------------------------------------------
export interface OpportunitiesSessionSnapshot {
  viewerKey: string;
  opportunities: Opportunity[];
  savedIds: Set<string>;
  activeTab: 'all' | 'saved';
  searchQuery: string;
  categoryFilter: 'all' | OpportunityCategory;
  statusFilter: OpportunityStatusFilter;
  deadlineFilter: OpportunityDeadlineFilter;
  organisationFilter: string;
  directLookupResult: {
    targetId: string;
    opportunity: Opportunity | null;
  } | null;
  cachedAt: number;
}

interface PersistedOppsPublic {
  opportunities: Opportunity[];
  cachedAt: number;
}

interface PersistedOppsPrivate {
  viewerKey: string;
  savedIds: string[];
  activeTab: 'all' | 'saved';
  searchQuery: string;
  categoryFilter: 'all' | OpportunityCategory;
  statusFilter: OpportunityStatusFilter;
  deadlineFilter: OpportunityDeadlineFilter;
  organisationFilter: string;
  cachedAt: number;
}

const OPPS_PUBLIC_IDB_KEY = 'opps:public:v1';
const makeOppsPrivateIdbKey = (viewerKey: string) =>
  isGuestViewer(viewerKey) ? 'opps:ui:guest' : `priv:opps:v1:${viewerKey}`;

const opportunitiesCache = new Map<string, OpportunitiesSessionSnapshot>();

export function getOpportunitiesSessionSnapshot(
  viewerKey: string
): OpportunitiesSessionSnapshot | null {
  const entry = opportunitiesCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    opportunitiesCache.delete(viewerKey);
    return null;
  }
  perfMetrics.recordHit('opportunities_ram');
  return entry;
}

export function saveOpportunitiesSessionSnapshot(
  snapshot: OpportunitiesSessionSnapshot
): void {
  opportunitiesCache.set(snapshot.viewerKey, snapshot);

  void writePersistentContent<PersistedOppsPublic>(
    OPPS_PUBLIC_IDB_KEY,
    {
      opportunities: snapshot.opportunities,
      cachedAt: snapshot.cachedAt,
    },
    { viewerKey: 'public', scope: 'public' }
  );

  void writePersistentContent<PersistedOppsPrivate>(
    makeOppsPrivateIdbKey(snapshot.viewerKey),
    {
      viewerKey: snapshot.viewerKey,
      savedIds: isGuestViewer(snapshot.viewerKey)
        ? []
        : serializeSet(snapshot.savedIds),
      activeTab: snapshot.activeTab,
      searchQuery: snapshot.searchQuery,
      categoryFilter: snapshot.categoryFilter,
      statusFilter: snapshot.statusFilter,
      deadlineFilter: snapshot.deadlineFilter,
      organisationFilter: snapshot.organisationFilter,
      cachedAt: snapshot.cachedAt,
    },
    {
      viewerKey: snapshot.viewerKey,
      scope: isGuestViewer(snapshot.viewerKey) ? 'public' : 'private',
    }
  );
}

export async function hydrateOpportunitiesSnapshot(
  viewerKey: string
): Promise<OpportunitiesSessionSnapshot | null> {
  const ramHit = getOpportunitiesSessionSnapshot(viewerKey);
  if (ramHit) return ramHit;

  const [pub, priv] = await Promise.all([
    readPersistentContent<PersistedOppsPublic>(OPPS_PUBLIC_IDB_KEY),
    readPersistentContent<PersistedOppsPrivate>(makeOppsPrivateIdbKey(viewerKey)),
  ]);

  if (!pub && !priv) return null;

  const snapshot: OpportunitiesSessionSnapshot = {
    viewerKey,
    opportunities: pub?.opportunities ?? [],
    savedIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.savedIds),
    activeTab: priv?.activeTab ?? 'all',
    searchQuery: priv?.searchQuery ?? '',
    categoryFilter: priv?.categoryFilter ?? 'all',
    statusFilter: priv?.statusFilter ?? 'all',
    deadlineFilter: priv?.deadlineFilter ?? 'all',
    organisationFilter: priv?.organisationFilter ?? '',
    directLookupResult: null,
    cachedAt: Math.max(pub?.cachedAt ?? 0, priv?.cachedAt ?? 0) || Date.now(),
  };

  opportunitiesCache.set(viewerKey, snapshot);
  return snapshot;
}

export function updateAllCachedOpportunitiesSnapshots(
  updater: (
    snap: OpportunitiesSessionSnapshot
  ) => OpportunitiesSessionSnapshot
): void {
  for (const [key, entry] of Array.from(opportunitiesCache.entries())) {
    const next = updater(entry);
    opportunitiesCache.set(key, next);
    saveOpportunitiesSessionSnapshot(next);
  }
}

// ---------------------------------------------------------------------------
// 4B. Trusted Circle Session Snapshot
// ---------------------------------------------------------------------------
export interface TrustedCircleSnapshot {
  viewerKey: string;
  supremeAdmins: PublicProfileProjection[];
  verifiedMembers: PublicProfileProjection[];
  officialContacts: TrustedContact[];
  cachedAt: number;
}

const TRUSTED_CIRCLE_PUBLIC_IDB_KEY = 'trusted_circle:public:v1';
const trustedCircleCache = new Map<string, TrustedCircleSnapshot>();

export function getTrustedCircleSnapshot(
  viewerKey: string
): TrustedCircleSnapshot | null {
  const entry = trustedCircleCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    trustedCircleCache.delete(viewerKey);
    return null;
  }
  perfMetrics.recordHit('trusted_circle_ram');
  return entry;
}

export function saveTrustedCircleSnapshot(
  snapshot: TrustedCircleSnapshot
): void {
  trustedCircleCache.set(snapshot.viewerKey, snapshot);
  void writePersistentContent(
    TRUSTED_CIRCLE_PUBLIC_IDB_KEY,
    {
      supremeAdmins: snapshot.supremeAdmins,
      verifiedMembers: snapshot.verifiedMembers,
      officialContacts: snapshot.officialContacts,
      cachedAt: snapshot.cachedAt,
    },
    { viewerKey: 'public', scope: 'public' }
  );
}

export async function hydrateTrustedCircleSnapshot(
  viewerKey: string
): Promise<TrustedCircleSnapshot | null> {
  const ramHit = getTrustedCircleSnapshot(viewerKey);
  if (ramHit) return ramHit;

  const pub = await readPersistentContent<
    Omit<TrustedCircleSnapshot, 'viewerKey'>
  >(TRUSTED_CIRCLE_PUBLIC_IDB_KEY);
  if (!pub) return null;

  const snapshot: TrustedCircleSnapshot = {
    viewerKey,
    supremeAdmins: pub.supremeAdmins ?? [],
    verifiedMembers: pub.verifiedMembers ?? [],
    officialContacts: pub.officialContacts ?? [],
    cachedAt: pub.cachedAt,
  };
  trustedCircleCache.set(viewerKey, snapshot);
  return snapshot;
}

export function updateAllCachedTrustedCircleSnapshots(
  updater: (snap: TrustedCircleSnapshot) => TrustedCircleSnapshot
): void {
  for (const [key, entry] of Array.from(trustedCircleCache.entries())) {
    const next = updater(entry);
    trustedCircleCache.set(key, next);
    saveTrustedCircleSnapshot(next);
  }
}

// ---------------------------------------------------------------------------
// 5. Member Profile Session Snapshot
// ---------------------------------------------------------------------------
export type ProfileDetailModalTarget =
  | {
      kind: 'ordinary';
      post: CommunityPost;
      author: PublicProfileProjection | null;
    }
  | { kind: 'anonymous'; post: AnonymousPost };

export interface ProfileSessionSnapshot {
  viewerKey: string;
  username: string;
  bundle: MemberProfileBundle;
  activeTab: ProfileTab;
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  likedAnonIds: Set<string>;
  savedAnonIds: Set<string>;
  ownedAnonCommentIds: Set<string>;
  savedBundle: SavedContentBundle | null;
  anonHistory: AnonymousPost[] | null;
  detailTarget: ProfileDetailModalTarget | null;
  followModalKind: 'followers' | 'following' | null;
  followList: PublicProfileProjection[];
  followCursor: QueryDocumentSnapshot<DocumentData> | null;
  followHasMore: boolean;
  cachedAt: number;
}

interface PersistedProfilePublic {
  username: string;
  bundle: Omit<MemberProfileBundle, 'isOwnProfile' | 'isFollowing'>;
  cachedAt: number;
}

interface PersistedProfilePrivate {
  viewerKey: string;
  username: string;
  isOwnProfile: boolean;
  isFollowing: boolean;
  activeTab: ProfileTab;
  likedPostIds: string[];
  savedPostIds: string[];
  likedAnonIds: string[];
  savedAnonIds: string[];
  ownedAnonCommentIds: string[];
  savedBundle: SavedContentBundle | null;
  anonHistory: AnonymousPost[] | null;
  cachedAt: number;
}

const profileCache = new Map<string, ProfileSessionSnapshot>();

function makeProfileKey(viewerKey: string, username: string): string {
  return `${viewerKey}:${username.trim().toLowerCase()}`;
}

function makePublicProfileIdbKey(username: string): string {
  return `profile:pub:v1:${username.trim().toLowerCase()}`;
}

function makePrivateProfileIdbKey(viewerKey: string, username: string): string {
  const lower = username.trim().toLowerCase();
  return isGuestViewer(viewerKey)
    ? `profile:ui:guest:${lower}`
    : `priv:profile:v1:${viewerKey}:${lower}`;
}

export function getProfileSessionSnapshot(
  viewerKey: string,
  username: string
): ProfileSessionSnapshot | null {
  const key = makeProfileKey(viewerKey, username);
  const entry = profileCache.get(key);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    profileCache.delete(key);
    return null;
  }
  perfMetrics.recordHit('profile_ram');
  return entry;
}

export function saveProfileSessionSnapshot(
  snapshot: ProfileSessionSnapshot
): void {
  const key = makeProfileKey(snapshot.viewerKey, snapshot.username);
  if (profileCache.size > 30 && !profileCache.has(key)) {
    const oldest = profileCache.keys().next().value;
    if (oldest) profileCache.delete(oldest);
  }
  profileCache.set(key, snapshot);

  const normalizedTarget = snapshot.bundle.resolvedUsername.toLowerCase();
  const requestedLower = snapshot.username.trim().toLowerCase();

  // Store ONLY non-private profile card + posts + liked posts + listings publicly
  const { isOwnProfile, isFollowing, ...publicBundleRest } = snapshot.bundle;
  const publicPayload: PersistedProfilePublic = {
    username: normalizedTarget,
    bundle: publicBundleRest,
    cachedAt: snapshot.cachedAt,
  };
  void writePersistentContent(
    makePublicProfileIdbKey(normalizedTarget),
    publicPayload,
    { viewerKey: 'public', scope: 'public' }
  );
  if (requestedLower && requestedLower !== normalizedTarget) {
    void writePersistentContent(
      makePublicProfileIdbKey(requestedLower),
      publicPayload,
      { viewerKey: 'public', scope: 'public' }
    );
  }

  // Strictly isolate owner saved/anonymous history & viewer reactions per viewerKey
  const isAuthOwn = !isGuestViewer(snapshot.viewerKey) && isOwnProfile;
  const privatePayload: PersistedProfilePrivate = {
    viewerKey: snapshot.viewerKey,
    username: normalizedTarget,
    isOwnProfile: isAuthOwn,
    isFollowing: isGuestViewer(snapshot.viewerKey) ? false : isFollowing,
    activeTab: isAuthOwn
      ? snapshot.activeTab
      : snapshot.activeTab === 'saved' || snapshot.activeTab === 'anonymous'
        ? 'posts'
        : snapshot.activeTab,
    likedPostIds: isGuestViewer(snapshot.viewerKey)
      ? []
      : serializeSet(snapshot.likedPostIds),
    savedPostIds: isGuestViewer(snapshot.viewerKey)
      ? []
      : serializeSet(snapshot.savedPostIds),
    likedAnonIds: isGuestViewer(snapshot.viewerKey)
      ? []
      : serializeSet(snapshot.likedAnonIds),
    savedAnonIds: isGuestViewer(snapshot.viewerKey)
      ? []
      : serializeSet(snapshot.savedAnonIds),
    ownedAnonCommentIds: isGuestViewer(snapshot.viewerKey)
      ? []
      : serializeSet(snapshot.ownedAnonCommentIds),
    savedBundle:
      isAuthOwn && snapshot.savedBundle
        ? {
            ...snapshot.savedBundle,
            anonymousPosts: sanitizeAnonymousPostsForCache(
              snapshot.savedBundle.anonymousPosts
            ),
          }
        : null,
    anonHistory:
      isAuthOwn && snapshot.anonHistory
        ? sanitizeAnonymousPostsForCache(snapshot.anonHistory)
        : null,
    cachedAt: snapshot.cachedAt,
  };

  void writePersistentContent(
    makePrivateProfileIdbKey(snapshot.viewerKey, normalizedTarget),
    privatePayload,
    {
      viewerKey: snapshot.viewerKey,
      scope: isGuestViewer(snapshot.viewerKey) ? 'public' : 'private',
    }
  );
}

export async function hydrateProfileSnapshot(
  viewerKey: string,
  username: string
): Promise<ProfileSessionSnapshot | null> {
  const ramHit = getProfileSessionSnapshot(viewerKey, username);
  if (ramHit) return ramHit;

  const lower = username.trim().toLowerCase();
  if (!lower) return null;

  const [pub, priv] = await Promise.all([
    readPersistentContent<PersistedProfilePublic>(makePublicProfileIdbKey(lower)),
    readPersistentContent<PersistedProfilePrivate>(
      makePrivateProfileIdbKey(viewerKey, lower)
    ),
  ]);

  if (!pub) return null;

  const isOwn =
    !isGuestViewer(viewerKey) &&
    Boolean(priv?.isOwnProfile && priv.viewerKey === viewerKey);
  const resolvedTab: ProfileTab =
    !isOwn && (priv?.activeTab === 'saved' || priv?.activeTab === 'anonymous')
      ? 'posts'
      : priv?.activeTab ?? 'posts';

  const snapshot: ProfileSessionSnapshot = {
    viewerKey,
    username: pub.bundle.resolvedUsername,
    bundle: {
      ...pub.bundle,
      isOwnProfile: isOwn,
      isFollowing: isOwn || isGuestViewer(viewerKey) ? false : Boolean(priv?.isFollowing),
    },
    activeTab: resolvedTab,
    likedPostIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.likedPostIds),
    savedPostIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.savedPostIds),
    likedAnonIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.likedAnonIds),
    savedAnonIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.savedAnonIds),
    ownedAnonCommentIds: isGuestViewer(viewerKey)
      ? new Set()
      : deserializeSet(priv?.ownedAnonCommentIds),
    savedBundle: isOwn ? priv?.savedBundle ?? null : null,
    anonHistory: isOwn ? priv?.anonHistory ?? null : null,
    detailTarget: null,
    followModalKind: null,
    followList: [],
    followCursor: null,
    followHasMore: false,
    cachedAt: pub.cachedAt,
  };

  profileCache.set(makeProfileKey(viewerKey, pub.bundle.resolvedUsername), snapshot);
  profileCache.set(makeProfileKey(viewerKey, lower), snapshot);
  return snapshot;
}

export function updateAllCachedProfileSnapshots(
  updater: (snap: ProfileSessionSnapshot) => ProfileSessionSnapshot
): void {
  for (const [key, entry] of Array.from(profileCache.entries())) {
    const next = updater(entry);
    profileCache.set(key, next);
    saveProfileSessionSnapshot(next);
  }
}

// ---------------------------------------------------------------------------
// 6. Search Page & Contextual Search Bar Snapshots
// ---------------------------------------------------------------------------
export interface SearchPageSnapshot {
  viewerKey: string;
  activeScope: SearchScopeId;
  queryText: string;
  submittedQuery: string;
  filters: SearchFiltersState;
  showFilters: boolean;
  bundle: SearchDiscoveryBundle | null;
  status: 'idle' | 'short' | 'loading' | 'ready' | 'error';
  cachedAt: number;
}

const searchPageCache = new Map<string, SearchPageSnapshot>();

export function getSearchPageSnapshot(
  viewerKey: string
): SearchPageSnapshot | null {
  const entry = searchPageCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    searchPageCache.delete(viewerKey);
    return null;
  }
  return entry;
}

export function saveSearchPageSnapshot(snapshot: SearchPageSnapshot): void {
  searchPageCache.set(snapshot.viewerKey, snapshot);
}

export interface ContextualSearchSnapshot {
  viewerKey: string;
  scope: SearchScopeId;
  queryText: string;
  submittedQuery: string;
  bundle: SearchDiscoveryBundle | null;
  status: 'idle' | 'short' | 'loading' | 'ready' | 'error';
  loadingMoreSlice: SearchCollectionKey | null;
  cachedAt: number;
}

const contextualSearchCache = new Map<string, ContextualSearchSnapshot>();

export function getContextualSearchSnapshot(
  viewerKey: string,
  scope: SearchScopeId
): ContextualSearchSnapshot | null {
  const key = `${viewerKey}:${scope}`;
  const entry = contextualSearchCache.get(key);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    contextualSearchCache.delete(key);
    return null;
  }
  return entry;
}

export function saveContextualSearchSnapshot(
  snapshot: ContextualSearchSnapshot
): void {
  const key = `${snapshot.viewerKey}:${snapshot.scope}`;
  contextualSearchCache.set(key, snapshot);
}

// ---------------------------------------------------------------------------
// 7. Notifications, Account Settings & Anonymous View Snapshots
// ---------------------------------------------------------------------------
export interface NotificationsFilterSnapshot {
  viewerKey: string;
  readFilter: NotificationReadFilter;
  categoryFilter: NotificationCategoryFilter;
  cachedAt: number;
}

const notificationsFilterCache = new Map<string, NotificationsFilterSnapshot>();

export function getNotificationsFilterSnapshot(
  viewerKey: string
): NotificationsFilterSnapshot | null {
  const entry = notificationsFilterCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    notificationsFilterCache.delete(viewerKey);
    return null;
  }
  return entry;
}

export function saveNotificationsFilterSnapshot(
  snapshot: NotificationsFilterSnapshot
): void {
  notificationsFilterCache.set(snapshot.viewerKey, snapshot);
}

export interface AccountSectionSnapshot {
  viewerKey: string;
  activeTab: AccountSettingsSection;
  cachedAt: number;
}

const accountSectionCache = new Map<string, AccountSectionSnapshot>();

export function getAccountSectionSnapshot(
  viewerKey: string
): AccountSectionSnapshot | null {
  const entry = accountSectionCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    accountSectionCache.delete(viewerKey);
    return null;
  }
  return entry;
}

export function saveAccountSectionSnapshot(
  snapshot: AccountSectionSnapshot
): void {
  accountSectionCache.set(snapshot.viewerKey, snapshot);
}

export interface AnonymousTabSnapshot {
  viewerKey: string;
  anonViewTab: 'feed' | 'mine';
  cachedAt: number;
}

const anonymousTabCache = new Map<string, AnonymousTabSnapshot>();

export function getAnonymousTabSnapshot(
  viewerKey: string
): AnonymousTabSnapshot | null {
  const entry = anonymousTabCache.get(viewerKey);
  if (!entry) return null;
  if (!isFresh(entry.cachedAt)) {
    anonymousTabCache.delete(viewerKey);
    return null;
  }
  return entry;
}

export function saveAnonymousTabSnapshot(snapshot: AnonymousTabSnapshot): void {
  anonymousTabCache.set(snapshot.viewerKey, snapshot);
}

// ---------------------------------------------------------------------------
// Auth / Account Isolation Purge
// ---------------------------------------------------------------------------
export function clearAllViewerNavigationCaches(): void {
  postUiCache.clear();
  marketplaceCache.clear();
  eventsCache.clear();
  opportunitiesCache.clear();
  trustedCircleCache.clear();
  profileCache.clear();
  searchPageCache.clear();
  contextualSearchCache.clear();
  notificationsFilterCache.clear();
  accountSectionCache.clear();
  anonymousTabCache.clear();
}

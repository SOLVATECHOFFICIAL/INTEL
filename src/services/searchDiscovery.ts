import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  COLLECTION_NAMES,
  isValidFirestoreId,
  type AnonymousPost,
  type CampusEvent,
  type CommunityPost,
  type MarketplaceListing,
  type Opportunity,
  type PublicProfileProjection,
  type PublicUserProfile,
  type TrustedContact,
} from '../types/database';
import type { SearchScopeId } from '../types/platform';
import {
  isFirebaseErrorCode,
  toPublicProfileProjection,
} from '../utils/authValidation';
import {
  deduplicateByKey,
  filterAnonymousPosts,
  filterCampusEvents,
  filterCommunityPosts,
  filterMarketplaceListings,
  filterMemberMatches,
  filterOpportunities,
  filterTrustedContacts,
  normalizeSearchInput,
  type SearchableCommunityPostItem,
} from '../utils/contextualSearch';
import { isCampusEventPublished } from '../utils/events';
import { fetchMarketplaceSellersMap } from './governance';
import {
  fetchOwnedAnonymousEntries,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
} from './socialPosts';

export type SearchCollectionKey =
  | 'posts'
  | 'people'
  | 'anonymous'
  | 'marketplace'
  | 'events'
  | 'opportunities'
  | 'trustedCircle';

export interface SearchSliceState<T> {
  items: T[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  loaded: boolean;
  error: boolean;
}

export interface SearchViewerInteractions {
  viewerUid: string | null;
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  likedAnonIds: Set<string>;
  savedAnonIds: Set<string>;
  ownedAnonPostIds: Set<string>;
  ownedAnonCommentIds: Set<string>;
  likedEventIds: Set<string>;
  savedEventIds: Set<string>;
  savedOpportunityIds: Set<string>;
  loadedForUid: string | null;
}

export interface SearchDiscoveryBundle {
  normalizedQuery: string;
  posts: SearchSliceState<SearchableCommunityPostItem>;
  people: SearchSliceState<PublicProfileProjection>;
  anonymous: SearchSliceState<AnonymousPost>;
  marketplace: SearchSliceState<MarketplaceListing>;
  marketplaceSellers: Map<string, PublicProfileProjection>;
  events: SearchSliceState<CampusEvent>;
  opportunities: SearchSliceState<Opportunity>;
  trustedCircle: SearchSliceState<TrustedContact>;
  updatedAt: number;
}

const SEARCH_BATCH_SIZE = 30;
const MAX_CACHE_ENTRIES = 24;

function createEmptySlice<T>(): SearchSliceState<T> {
  return {
    items: [],
    cursor: null,
    hasMore: false,
    loaded: false,
    error: false,
  };
}

export function createEmptySearchBundle(
  normalizedQuery: string
): SearchDiscoveryBundle {
  return {
    normalizedQuery,
    posts: createEmptySlice(),
    people: createEmptySlice(),
    anonymous: createEmptySlice(),
    marketplace: createEmptySlice(),
    marketplaceSellers: new Map(),
    events: createEmptySlice(),
    opportunities: createEmptySlice(),
    trustedCircle: createEmptySlice(),
    updatedAt: Date.now(),
  };
}

const bundleCache = new Map<string, SearchDiscoveryBundle>();
const authorProjectionCache = new Map<string, PublicProfileProjection | null>();

function getBundleCacheKey(rawQuery: string): string {
  return normalizeSearchInput(rawQuery).toLowerCase();
}

export function getCachedSearchBundle(
  rawQuery: string
): SearchDiscoveryBundle | null {
  const key = getBundleCacheKey(rawQuery);
  if (!key) return null;
  const hit = bundleCache.get(key) ?? null;
  if (hit) {
    // Refresh LRU order
    bundleCache.delete(key);
    bundleCache.set(key, hit);
  }
  return hit;
}

export function setCachedSearchBundle(bundle: SearchDiscoveryBundle): void {
  const key = getBundleCacheKey(bundle.normalizedQuery);
  if (!key) return;
  if (bundleCache.has(key)) {
    bundleCache.delete(key);
  }
  bundleCache.set(key, { ...bundle, updatedAt: Date.now() });
  while (bundleCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = bundleCache.keys().next().value;
    if (oldestKey) {
      bundleCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

export function clearSearchBundleCache(): void {
  bundleCache.clear();
}

export function getRequiredCollectionsForScope(
  scope: SearchScopeId
): SearchCollectionKey[] {
  switch (scope) {
    case 'all':
      return [
        'posts',
        'people',
        'anonymous',
        'marketplace',
        'events',
        'opportunities',
        'trustedCircle',
      ];
    case 'home':
      return ['people', 'posts'];
    case 'posts':
      return ['posts'];
    case 'people':
      return ['people'];
    case 'anonymous':
      return ['anonymous'];
    case 'marketplace':
      return ['marketplace'];
    case 'upcoming-events':
      return ['events'];
    case 'opportunities':
      return ['opportunities'];
    case 'trusted-circle':
      return ['trustedCircle'];
  }
}

async function hydrateAuthorsByUids(
  uids: string[]
): Promise<Map<string, PublicProfileProjection>> {
  const result = new Map<string, PublicProfileProjection>();
  const missing: string[] = [];

  for (const uid of uids) {
    if (!isValidFirestoreId(uid)) continue;
    if (authorProjectionCache.has(uid)) {
      const cached = authorProjectionCache.get(uid);
      if (cached) result.set(uid, cached);
    } else {
      missing.push(uid);
    }
  }

  if (missing.length > 0) {
    await Promise.allSettled(
      Array.from(new Set(missing))
        .slice(0, 30)
        .map(async (uid) => {
          const snap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
          if (!snap.exists()) {
            authorProjectionCache.set(uid, null);
            return;
          }
          const profile = snap.data() as PublicUserProfile;
          if (profile.accountStatus !== 'active') {
            authorProjectionCache.set(uid, null);
            return;
          }
          const projection = toPublicProfileProjection(profile);
          authorProjectionCache.set(uid, projection);
          result.set(uid, projection);
        })
    );
  }

  return result;
}

async function fetchPeopleBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<PublicProfileProjection>> {
  const q = query(
    collection(db, COLLECTION_NAMES.users),
    where('isHiddenFromDirectory', '==', false),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(SEARCH_BATCH_SIZE + 1)
  );
  const snap = await getDocs(q);
  const hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
  const pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

  const profiles = pageDocs.map((d) => d.data() as PublicUserProfile);
  for (const p of profiles) {
    if (!p.isHiddenFromDirectory && p.accountStatus === 'active') {
      authorProjectionCache.set(p.uid, toPublicProfileProjection(p));
    }
  }

  return {
    items: filterMemberMatches(profiles, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

async function fetchPostsBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<SearchableCommunityPostItem>> {
  let pageDocs: QueryDocumentSnapshot<DocumentData>[];
  let hasMore: boolean;

  try {
    const orderedQuery = query(
      collection(db, COLLECTION_NAMES.posts),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    );
    const snap = await getDocs(orderedQuery);
    hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
    pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  } catch (err) {
    if (!isFirebaseErrorCode(err, 'failed-precondition') || cursor) {
      throw err;
    }
    const fallbackSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.posts),
        where('status', '==', 'published'),
        limit(SEARCH_BATCH_SIZE)
      )
    );
    pageDocs = fallbackSnap.docs;
    hasMore = false;
  }

  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const rawPosts = pageDocs.map((d) => d.data() as CommunityPost);
  const authorMap = await hydrateAuthorsByUids(rawPosts.map((p) => p.ownerUID));

  const searchable: SearchableCommunityPostItem[] = rawPosts.map((post) => ({
    post,
    author: authorMap.get(post.ownerUID) ?? null,
  }));

  return {
    items: filterCommunityPosts(searchable, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

async function fetchAnonymousBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<AnonymousPost>> {
  let pageDocs: QueryDocumentSnapshot<DocumentData>[];
  let hasMore: boolean;

  try {
    const orderedQuery = query(
      collection(db, COLLECTION_NAMES.anonymousPosts),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    );
    const snap = await getDocs(orderedQuery);
    hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
    pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  } catch (err) {
    if (!isFirebaseErrorCode(err, 'failed-precondition') || cursor) {
      throw err;
    }
    const fallbackSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.anonymousPosts),
        where('status', '==', 'published'),
        limit(SEARCH_BATCH_SIZE)
      )
    );
    pageDocs = fallbackSnap.docs;
    hasMore = false;
  }

  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const rawDocs = pageDocs.map((d) => d.data() as Record<string, unknown>);

  return {
    items: filterAnonymousPosts(rawDocs, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

async function fetchMarketplaceBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<{
  slice: SearchSliceState<MarketplaceListing>;
  sellers: Map<string, PublicProfileProjection>;
}> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.marketplaceListings),
      where('status', '==', 'active'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    )
  );
  const hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
  const pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const listings = pageDocs.map((d) => d.data() as MarketplaceListing);
  const matched = filterMarketplaceListings(listings, rawQuery);
  const sellers =
    matched.length > 0
      ? await fetchMarketplaceSellersMap(matched).catch(
          () => new Map<string, PublicProfileProjection>()
        )
      : new Map<string, PublicProfileProjection>();

  return {
    slice: {
      items: matched,
      cursor: hasMore ? lastDoc : null,
      hasMore,
      loaded: true,
      error: false,
    },
    sellers,
  };
}

async function fetchEventsBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<CampusEvent>> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.events),
      where('published', '==', true),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    )
  );
  const hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
  const pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const events = pageDocs
    .map((d) => d.data() as CampusEvent)
    .filter((evt) => isCampusEventPublished(evt));

  return {
    items: filterCampusEvents(events, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

async function fetchOpportunitiesBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<Opportunity>> {
  let pageDocs: QueryDocumentSnapshot<DocumentData>[];
  let hasMore: boolean;

  try {
    const orderedQuery = query(
      collection(db, COLLECTION_NAMES.opportunities),
      where('status', '==', 'active'),
      orderBy('expiresAt', 'asc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    );
    const snap = await getDocs(orderedQuery);
    hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
    pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  } catch (err) {
    if (!isFirebaseErrorCode(err, 'failed-precondition') || cursor) {
      throw err;
    }
    const fallbackSnap = await getDocs(
      query(
        collection(db, COLLECTION_NAMES.opportunities),
        where('status', '==', 'active'),
        limit(SEARCH_BATCH_SIZE)
      )
    );
    pageDocs = fallbackSnap.docs;
    hasMore = false;
  }

  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const opps = pageDocs.map((d) => d.data() as Opportunity);

  return {
    items: filterOpportunities(opps, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

async function fetchTrustedCircleBatch(
  rawQuery: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Promise<SearchSliceState<TrustedContact>> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.trustedContacts),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SEARCH_BATCH_SIZE + 1)
    )
  );
  const hasMore = snap.docs.length > SEARCH_BATCH_SIZE;
  const pageDocs = snap.docs.slice(0, SEARCH_BATCH_SIZE);
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  const contacts = pageDocs.map((d) => d.data() as TrustedContact);

  return {
    items: filterTrustedContacts(contacts, rawQuery),
    cursor: hasMore ? lastDoc : null,
    hasMore,
    loaded: true,
    error: false,
  };
}

/**
 * Searches only the required slices that are not yet loaded in the cached bundle,
 * preserving previously loaded results across category tab switches or return navigation.
 */
export async function executeScopedSearchDiscovery(input: {
  rawQuery: string;
  scope: SearchScopeId;
  forceRefresh?: boolean;
}): Promise<SearchDiscoveryBundle> {
  const normalized = normalizeSearchInput(input.rawQuery);
  const bundle =
    (!input.forceRefresh && getCachedSearchBundle(normalized)) ||
    createEmptySearchBundle(normalized);

  const requiredCollections = getRequiredCollectionsForScope(input.scope);
  const missingCollections = requiredCollections.filter((key) => {
    if (input.forceRefresh) return true;
    return !bundle[key].loaded || bundle[key].error;
  });

  if (missingCollections.length === 0) {
    return bundle;
  }

  const nextBundle: SearchDiscoveryBundle = {
    ...bundle,
    marketplaceSellers: new Map(bundle.marketplaceSellers),
  };

  await Promise.all(
    missingCollections.map(async (key) => {
      try {
        if (key === 'people') {
          nextBundle.people = await fetchPeopleBatch(normalized, null);
        } else if (key === 'posts') {
          nextBundle.posts = await fetchPostsBatch(normalized, null);
        } else if (key === 'anonymous') {
          nextBundle.anonymous = await fetchAnonymousBatch(normalized, null);
        } else if (key === 'marketplace') {
          const { slice, sellers } = await fetchMarketplaceBatch(
            normalized,
            null
          );
          nextBundle.marketplace = slice;
          sellers.forEach((v, k) => nextBundle.marketplaceSellers.set(k, v));
        } else if (key === 'events') {
          nextBundle.events = await fetchEventsBatch(normalized, null);
        } else if (key === 'opportunities') {
          nextBundle.opportunities = await fetchOpportunitiesBatch(
            normalized,
            null
          );
        } else if (key === 'trustedCircle') {
          nextBundle.trustedCircle = await fetchTrustedCircleBatch(
            normalized,
            null
          );
        }
      } catch {
        nextBundle[key] = {
          ...nextBundle[key],
          loaded: true,
          error: true,
        } as never;
      }
    })
  );

  setCachedSearchBundle(nextBundle);
  return nextBundle;
}

/**
 * Progressive cursor-based pagination for a specific search slice.
 */
export async function loadMoreSearchSlice(input: {
  bundle: SearchDiscoveryBundle;
  sliceKey: SearchCollectionKey;
}): Promise<SearchDiscoveryBundle> {
  const { bundle, sliceKey } = input;
  const currentSlice = bundle[sliceKey];
  if (!currentSlice.hasMore || !currentSlice.cursor) {
    return bundle;
  }

  const nextBundle: SearchDiscoveryBundle = {
    ...bundle,
    marketplaceSellers: new Map(bundle.marketplaceSellers),
  };

  if (sliceKey === 'people') {
    const extra = await fetchPeopleBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.people = {
      items: deduplicateByKey(
        [...bundle.people.items, ...extra.items],
        (m) => m.username.toLowerCase()
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'posts') {
    const extra = await fetchPostsBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.posts = {
      items: deduplicateByKey(
        [...bundle.posts.items, ...extra.items],
        (item) => item.post.id
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'anonymous') {
    const extra = await fetchAnonymousBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.anonymous = {
      items: deduplicateByKey(
        [...bundle.anonymous.items, ...extra.items],
        (p) => p.id
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'marketplace') {
    const { slice, sellers } = await fetchMarketplaceBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    sellers.forEach((v, k) => nextBundle.marketplaceSellers.set(k, v));
    nextBundle.marketplace = {
      items: deduplicateByKey(
        [...bundle.marketplace.items, ...slice.items],
        (l) => l.id
      ),
      cursor: slice.cursor,
      hasMore: slice.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'events') {
    const extra = await fetchEventsBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.events = {
      items: deduplicateByKey(
        [...bundle.events.items, ...extra.items],
        (e) => e.id
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'opportunities') {
    const extra = await fetchOpportunitiesBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.opportunities = {
      items: deduplicateByKey(
        [...bundle.opportunities.items, ...extra.items],
        (o) => o.id
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  } else if (sliceKey === 'trustedCircle') {
    const extra = await fetchTrustedCircleBatch(
      bundle.normalizedQuery,
      currentSlice.cursor
    );
    nextBundle.trustedCircle = {
      items: deduplicateByKey(
        [...bundle.trustedCircle.items, ...extra.items],
        (c) => c.id
      ),
      cursor: extra.cursor,
      hasMore: extra.hasMore,
      loaded: true,
      error: false,
    };
  }

  setCachedSearchBundle(nextBundle);
  return nextBundle;
}

export async function fetchSearchViewerInteractions(
  viewerUid: string | null
): Promise<SearchViewerInteractions> {
  if (!viewerUid) {
    return {
      viewerUid: null,
      likedPostIds: new Set(),
      savedPostIds: new Set(),
      likedAnonIds: new Set(),
      savedAnonIds: new Set(),
      ownedAnonPostIds: new Set(),
      ownedAnonCommentIds: new Set(),
      likedEventIds: new Set(),
      savedEventIds: new Set(),
      savedOpportunityIds: new Set(),
      loadedForUid: null,
    };
  }

  const [
    likedPostIds,
    savedPostIds,
    likedAnonIds,
    savedAnonIds,
    ownedAnon,
    likedEventIds,
    savedEventIds,
    savedOpportunityIds,
  ] = await Promise.all([
    fetchViewerLikedPostIds('posts', viewerUid).catch(() => new Set<string>()),
    fetchViewerSavedPostIds('posts', viewerUid).catch(() => new Set<string>()),
    fetchViewerLikedPostIds('anonymousPosts', viewerUid).catch(
      () => new Set<string>()
    ),
    fetchViewerSavedPostIds('anonymousPosts', viewerUid).catch(
      () => new Set<string>()
    ),
    fetchOwnedAnonymousEntries(viewerUid).catch(() => ({
      postIds: new Set<string>(),
      commentIds: new Set<string>(),
    })),
    fetchViewerLikedPostIds('events', viewerUid).catch(() => new Set<string>()),
    fetchViewerSavedPostIds('events', viewerUid).catch(() => new Set<string>()),
    fetchViewerSavedPostIds('opportunities', viewerUid).catch(
      () => new Set<string>()
    ),
  ]);

  return {
    viewerUid,
    likedPostIds,
    savedPostIds,
    likedAnonIds,
    savedAnonIds,
    ownedAnonPostIds: ownedAnon.postIds,
    ownedAnonCommentIds: ownedAnon.commentIds,
    likedEventIds,
    savedEventIds,
    savedOpportunityIds,
    loadedForUid: viewerUid,
  };
}

// ---------------------------------------------------------------------------
// Lightweight Cached Suggestion Seed (prevents hammering DB while typing)
// ---------------------------------------------------------------------------

export interface SearchSuggestionSeed {
  members: PublicProfileProjection[];
  dynamicTerms: Array<{
    term: string;
    subtitle?: string;
    targetScope?: SearchScopeId;
  }>;
  fetchedAt: number;
}

let cachedSuggestionSeed: SearchSuggestionSeed | null = null;
const SUGGESTION_SEED_TTL_MS = 5 * 60 * 1000;

export async function fetchSearchSuggestionSeed(): Promise<SearchSuggestionSeed> {
  if (
    cachedSuggestionSeed &&
    Date.now() - cachedSuggestionSeed.fetchedAt < SUGGESTION_SEED_TTL_MS
  ) {
    return cachedSuggestionSeed;
  }

  const [usersResult, postsResult, eventsResult, oppsResult, mktResult] =
    await Promise.allSettled([
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.users),
          where('isHiddenFromDirectory', '==', false),
          limit(30)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.posts),
          where('status', '==', 'published'),
          orderBy('createdAt', 'desc'),
          limit(12)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.events),
          where('published', '==', true),
          limit(10)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.opportunities),
          where('status', '==', 'active'),
          limit(10)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.marketplaceListings),
          where('status', '==', 'active'),
          limit(10)
        )
      ),
    ]);

  const members: PublicProfileProjection[] = [];
  if (usersResult.status === 'fulfilled') {
    for (const d of usersResult.value.docs) {
      const profile = d.data() as PublicUserProfile;
      if (!profile.isHiddenFromDirectory && profile.accountStatus === 'active') {
        const proj = toPublicProfileProjection(profile);
        members.push(proj);
        authorProjectionCache.set(profile.uid, proj);
      }
    }
  }

  const dynamicTerms: SearchSuggestionSeed['dynamicTerms'] = [];
  const seenTerms = new Set<string>();
  const addTerm = (
    term: string | undefined,
    subtitle: string,
    targetScope: SearchScopeId
  ) => {
    const clean = term?.trim();
    if (!clean || clean.length < 3 || clean.length > 64) return;
    const lower = clean.toLowerCase();
    if (seenTerms.has(lower)) return;
    seenTerms.add(lower);
    dynamicTerms.push({ term: clean, subtitle, targetScope });
  };

  if (postsResult.status === 'fulfilled') {
    for (const d of postsResult.value.docs) {
      const p = d.data() as CommunityPost;
      addTerm(p.title, `Post · ${p.category}`, 'posts');
    }
  }
  if (eventsResult.status === 'fulfilled') {
    for (const d of eventsResult.value.docs) {
      const ev = d.data() as CampusEvent;
      if (isCampusEventPublished(ev) && ev.status !== 'cancelled') {
        addTerm(ev.title, `Event · ${ev.venue}`, 'upcoming-events');
      }
    }
  }
  if (oppsResult.status === 'fulfilled') {
    for (const d of oppsResult.value.docs) {
      const opp = d.data() as Opportunity;
      addTerm(opp.title, `Opportunity · ${opp.organisation}`, 'opportunities');
    }
  }
  if (mktResult.status === 'fulfilled') {
    for (const d of mktResult.value.docs) {
      const m = d.data() as MarketplaceListing;
      if (m.approvalStatus === 'approved') {
        addTerm(m.title, `Marketplace · ${m.category}`, 'marketplace');
      }
    }
  }

  cachedSuggestionSeed = {
    members,
    dynamicTerms,
    fetchedAt: Date.now(),
  };
  return cachedSuggestionSeed;
}

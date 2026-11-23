import type {
  AnonymousPost,
  CampusEvent,
  CommunityPost,
  MarketplaceListing,
  Opportunity,
  PublicProfileProjection,
} from '../types/database';
import {
  clearAnonymousFeedSessionCache,
  clearHomeFeedSessionCache,
  updateAllCachedHomeFeedSnapshots,
  updateCachedAnonymousFeedSnapshot,
} from './feedSessionCache';
import {
  clearAllViewerNavigationCaches,
  updateAllCachedEventsSnapshots,
  updateAllCachedMarketplaceSnapshots,
  updateAllCachedOpportunitiesSnapshots,
  updateAllCachedProfileSnapshots,
  updateAllCachedTrustedCircleSnapshots,
  updateCachedPostUiSnapshot,
} from './navigationStateCache';
import {
  clearViewerPersistentCaches,
  deletePersistentContent,
  purgePersistentContentByPrefix,
} from './persistentCache';
import {
  patchAuthorProjectionInMap,
  patchAuthorProjectionInPostItems,
  removeItemById,
  sanitizeAnonymousPostForCache,
  upsertItemById,
} from '../utils/cacheSync';

export type CacheMutationEvent =
  | { type: 'community_post_created'; post: CommunityPost; author: PublicProfileProjection | null }
  | { type: 'community_post_updated'; post: CommunityPost }
  | { type: 'community_post_deleted'; postId: string }
  | { type: 'community_post_reaction'; postId: string; liked: boolean; likesCount: number }
  | { type: 'community_post_saved'; postId: string; saved: boolean }
  | { type: 'anonymous_post_created'; post: AnonymousPost }
  | { type: 'anonymous_post_updated'; post: AnonymousPost }
  | { type: 'anonymous_post_deleted'; postId: string }
  | { type: 'anonymous_post_reaction'; postId: string; liked: boolean; likesCount: number }
  | { type: 'anonymous_post_saved'; postId: string; saved: boolean }
  | { type: 'marketplace_mutated' }
  | { type: 'event_mutated' }
  | { type: 'opportunity_mutated' }
  | { type: 'trusted_circle_mutated' }
  | { type: 'profile_updated'; uid: string; username?: string }
  | { type: 'follow_toggled'; targetUsername: string; following: boolean }
  | { type: 'viewer_reset' };

type MutationListener = (event: CacheMutationEvent) => void;
const listeners = new Set<MutationListener>();

let searchCacheHandlers: {
  invalidate: () => void;
  clearAuthorCache: () => void;
  patchAuthor: (uid: string, profile: PublicProfileProjection) => void;
  patchAuthorPartial?: (uid: string, patch: Partial<PublicProfileProjection>) => void;
} | null = null;

let foundationProjectionHandlers: {
  invalidateUid: (uid?: string) => void;
} | null = null;

let personalisationPoolHandlers: {
  invalidateAll: () => void;
} | null = null;

export function registerSearchCacheInvalidator(handlers: {
  invalidate: () => void;
  clearAuthorCache: () => void;
  patchAuthor: (uid: string, profile: PublicProfileProjection) => void;
  patchAuthorPartial?: (uid: string, patch: Partial<PublicProfileProjection>) => void;
}): void {
  searchCacheHandlers = handlers;
}

export function registerFoundationProjectionInvalidator(handlers: {
  invalidateUid: (uid?: string) => void;
}): void {
  foundationProjectionHandlers = handlers;
}

export function registerPersonalisationInvalidator(handlers: {
  invalidateAll: () => void;
}): void {
  personalisationPoolHandlers = handlers;
}

export function subscribeCacheMutations(listener: MutationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitMutation(event: CacheMutationEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Non-blocking listener isolation
    }
  });
}

// ---------------------------------------------------------------------------
// Community Posts
// ---------------------------------------------------------------------------

export function notifyCommunityPostCreated(
  post: CommunityPost,
  author: PublicProfileProjection | null = null
): void {
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    postItems: [
      { post, author },
      ...snap.postItems.filter((item) => item.post.id !== post.id),
    ],
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => {
    const matchesUsername = Boolean(
      author?.username &&
        snap.bundle.resolvedUsername.toLowerCase() ===
          author.username.toLowerCase()
    );
    const matchesOwn =
      snap.bundle.isOwnProfile && snap.viewerKey === post.ownerUID;
    if (!matchesUsername && !matchesOwn) return snap;
    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        posts: upsertItemById(snap.bundle.posts, post, true),
      },
      cachedAt: Date.now(),
    };
  });

  void purgePersistentContentByPrefix('feed:posts:v1:');
  void deletePersistentContent(
    `profile:pub:v1:${author?.username?.toLowerCase() ?? ''}`
  );
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'community_post_created', post, author });
}

export function notifyCommunityPostUpdated(post: CommunityPost): void {
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    postItems: snap.postItems.map((entry) =>
      entry.post.id === post.id ? { ...entry, post } : entry
    ),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => {
    const hasPost = snap.bundle.posts.some((p) => p.id === post.id);
    const hasLiked = snap.bundle.likedPosts.some((p) => p.post.id === post.id);
    const matchesOwn =
      snap.bundle.isOwnProfile && snap.viewerKey === post.ownerUID;
    if (!hasPost && !hasLiked && !matchesOwn) {
      return snap;
    }
    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        posts: hasPost ? upsertItemById(snap.bundle.posts, post, false) : snap.bundle.posts,
        likedPosts: hasLiked
          ? snap.bundle.likedPosts.map((e) =>
              e.post.id === post.id ? { ...e, post } : e
            )
          : snap.bundle.likedPosts,
      },
      cachedAt: Date.now(),
    };
  });

  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'community_post_updated', post });
}

export function notifyCommunityPostDeleted(postId: string): void {
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    postItems: snap.postItems.filter((entry) => entry.post.id !== postId),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => ({
    ...snap,
    bundle: {
      ...snap.bundle,
      posts: removeItemById(snap.bundle.posts, postId),
      likedPosts: snap.bundle.likedPosts.filter((e) => e.post.id !== postId),
    },
    savedBundle: snap.savedBundle
      ? {
          ...snap.savedBundle,
          posts: snap.savedBundle.posts.filter((e) => e.post.id !== postId),
        }
      : null,
    cachedAt: Date.now(),
  }));

  updateCachedPostUiSnapshot('ordinary', postId, () => null);
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'community_post_deleted', postId });
}

export function notifyCommunityPostReactionChanged(
  postId: string,
  liked: boolean,
  likesCount: number
): void {
  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextLiked = new Set(snap.likedPostIds);
    if (liked) nextLiked.add(postId);
    else nextLiked.delete(postId);
    return {
      ...snap,
      likedPostIds: nextLiked,
      postItems: snap.postItems.map((entry) =>
        entry.post.id === postId
          ? { ...entry, post: { ...entry.post, likesCount } }
          : entry
      ),
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) => {
    const nextLiked = new Set(snap.likedPostIds);
    if (liked) nextLiked.add(postId);
    else nextLiked.delete(postId);
    return {
      ...snap,
      likedPostIds: nextLiked,
      bundle: {
        ...snap.bundle,
        posts: snap.bundle.posts.map((p) =>
          p.id === postId ? { ...p, likesCount } : p
        ),
      },
      cachedAt: Date.now(),
    };
  });

  emitMutation({ type: 'community_post_reaction', postId, liked, likesCount });
}

export function notifyCommunityPostSavedChanged(
  postId: string,
  saved: boolean
): void {
  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextSaved = new Set(snap.savedPostIds);
    if (saved) nextSaved.add(postId);
    else nextSaved.delete(postId);
    return {
      ...snap,
      savedPostIds: nextSaved,
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) => {
    const nextSaved = new Set(snap.savedPostIds);
    if (saved) nextSaved.add(postId);
    else nextSaved.delete(postId);
    return {
      ...snap,
      savedPostIds: nextSaved,
      cachedAt: Date.now(),
    };
  });

  emitMutation({ type: 'community_post_saved', postId, saved });
}

export function notifyPostCommentMutated(
  kind: 'ordinary' | 'anonymous',
  postId: string,
  commentsCount: number
): void {
  const safeCount = Math.max(0, commentsCount);

  if (kind === 'ordinary') {
    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      postItems: snap.postItems.map((entry) =>
        entry.post.id === postId
          ? { ...entry, post: { ...entry.post, commentsCount: safeCount } }
          : entry
      ),
      cachedAt: Date.now(),
    }));

    updateAllCachedProfileSnapshots((snap) => ({
      ...snap,
      bundle: {
        ...snap.bundle,
        posts: snap.bundle.posts.map((p) =>
          p.id === postId ? { ...p, commentsCount: safeCount } : p
        ),
        likedPosts: snap.bundle.likedPosts.map((e) =>
          e.post.id === postId
            ? { ...e, post: { ...e.post, commentsCount: safeCount } }
            : e
        ),
      },
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            posts: snap.savedBundle.posts.map((e) =>
              e.post.id === postId
                ? { ...e, post: { ...e.post, commentsCount: safeCount } }
                : e
            ),
          }
        : null,
      cachedAt: Date.now(),
    }));
  } else {
    updateCachedAnonymousFeedSnapshot((snap) => ({
      ...snap,
      anonymousPosts: snap.anonymousPosts.map((p) =>
        p.id === postId ? { ...p, commentsCount: safeCount } : p
      ),
      cachedAt: Date.now(),
    }));

    updateAllCachedProfileSnapshots((snap) => ({
      ...snap,
      anonHistory: snap.anonHistory
        ? snap.anonHistory.map((p) =>
            p.id === postId ? { ...p, commentsCount: safeCount } : p
          )
        : null,
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            anonymousPosts: snap.savedBundle.anonymousPosts.map((p) =>
              p.id === postId ? { ...p, commentsCount: safeCount } : p
            ),
          }
        : null,
      cachedAt: Date.now(),
    }));
  }
}

// ---------------------------------------------------------------------------
// Anonymous Posts
// ---------------------------------------------------------------------------

export function notifyAnonymousPostCreated(
  post: AnonymousPost,
  actorViewerKey?: string
): void {
  const clean = sanitizeAnonymousPostForCache(post);
  updateCachedAnonymousFeedSnapshot((snap) => {
    const nextOwned = new Set(snap.ownedAnonPostIds);
    if (actorViewerKey && snap.viewerKey === actorViewerKey) {
      nextOwned.add(clean.id);
    }
    return {
      ...snap,
      anonymousPosts: upsertItemById(snap.anonymousPosts, clean, true),
      ownedAnonPostIds: nextOwned,
      cachedAt: Date.now(),
    };
  });

  void deletePersistentContent('anon:posts:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'anonymous_post_created', post: clean });
}

export function notifyAnonymousPostUpdated(post: AnonymousPost): void {
  const clean = sanitizeAnonymousPostForCache(post);
  updateCachedAnonymousFeedSnapshot((snap) => ({
    ...snap,
    anonymousPosts: upsertItemById(snap.anonymousPosts, clean, false),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) =>
    snap.anonHistory
      ? {
          ...snap,
          anonHistory: upsertItemById(snap.anonHistory, clean, false),
          cachedAt: Date.now(),
        }
      : snap
  );

  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'anonymous_post_updated', post: clean });
}

export function notifyAnonymousPostDeleted(postId: string): void {
  updateCachedAnonymousFeedSnapshot((snap) => {
    const nextOwned = new Set(snap.ownedAnonPostIds);
    nextOwned.delete(postId);
    return {
      ...snap,
      anonymousPosts: removeItemById(snap.anonymousPosts, postId),
      ownedAnonPostIds: nextOwned,
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) => ({
    ...snap,
    anonHistory: snap.anonHistory
      ? removeItemById(snap.anonHistory, postId)
      : null,
    savedBundle: snap.savedBundle
      ? {
          ...snap.savedBundle,
          anonymousPosts: removeItemById(snap.savedBundle.anonymousPosts, postId),
        }
      : null,
    cachedAt: Date.now(),
  }));

  updateCachedPostUiSnapshot('anonymous', postId, () => null);
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'anonymous_post_deleted', postId });
}

export function notifyAnonymousPostReactionChanged(
  postId: string,
  liked: boolean,
  likesCount: number
): void {
  updateCachedAnonymousFeedSnapshot((snap) => {
    const nextLiked = new Set(snap.likedAnonIds);
    if (liked) nextLiked.add(postId);
    else nextLiked.delete(postId);
    return {
      ...snap,
      likedAnonIds: nextLiked,
      anonymousPosts: snap.anonymousPosts.map((p) =>
        p.id === postId ? { ...p, likesCount } : p
      ),
      cachedAt: Date.now(),
    };
  });

  emitMutation({ type: 'anonymous_post_reaction', postId, liked, likesCount });
}

export function notifyAnonymousPostSavedChanged(
  postId: string,
  saved: boolean
): void {
  updateCachedAnonymousFeedSnapshot((snap) => {
    const nextSaved = new Set(snap.savedAnonIds);
    if (saved) nextSaved.add(postId);
    else nextSaved.delete(postId);
    return {
      ...snap,
      savedAnonIds: nextSaved,
      cachedAt: Date.now(),
    };
  });

  emitMutation({ type: 'anonymous_post_saved', postId, saved });
}

// ---------------------------------------------------------------------------
// Marketplace, Events, Opportunities, Trusted Circle, Profiles
// ---------------------------------------------------------------------------

export function notifyMarketplaceListingCreated(listing: MarketplaceListing): void {
  updateAllCachedMarketplaceSnapshots((snap) => {
    const nextPublic =
      listing.approvalStatus === 'approved' && listing.status === 'active'
        ? upsertItemById(snap.publicListings, listing, true)
        : snap.publicListings;
    const nextMine =
      snap.viewerKey === listing.ownerUID
        ? upsertItemById(snap.myListings, listing, true)
        : snap.myListings;
    const nextPending =
      listing.approvalStatus === 'pending_approval'
        ? upsertItemById(snap.pendingListings, listing, true)
        : snap.pendingListings;

    return {
      ...snap,
      publicListings: nextPublic,
      myListings: nextMine,
      pendingListings: nextPending,
      cachedAt: Date.now(),
    };
  });

  void deletePersistentContent('mkt:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'marketplace_mutated' });
}

export function notifyMarketplaceListingUpdated(listing: MarketplaceListing): void {
  updateAllCachedMarketplaceSnapshots((snap) => {
    const isPublic =
      listing.approvalStatus === 'approved' && listing.status === 'active';
    return {
      ...snap,
      publicListings: isPublic
        ? upsertItemById(snap.publicListings, listing, true)
        : removeItemById(snap.publicListings, listing.id),
      myListings:
        snap.viewerKey === listing.ownerUID
          ? upsertItemById(snap.myListings, listing, false)
          : snap.myListings,
      pendingListings:
        listing.approvalStatus === 'pending_approval'
          ? upsertItemById(snap.pendingListings, listing, false)
          : removeItemById(snap.pendingListings, listing.id),
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) => {
    const hasInListings = snap.bundle.listings.some((l) => l.id === listing.id);
    const hasInSaved = Boolean(
      snap.savedBundle?.listings.some((l) => l.id === listing.id)
    );
    const isOwnSeller =
      snap.bundle.isOwnProfile && snap.viewerKey === listing.ownerUID;
    if (!hasInListings && !hasInSaved && !isOwnSeller) {
      return snap;
    }
    const isPublicActive =
      listing.approvalStatus === 'approved' && listing.status === 'active';
    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        listings: isPublicActive
          ? upsertItemById(snap.bundle.listings, listing, false)
          : removeItemById(snap.bundle.listings, listing.id),
      },
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            listings: snap.savedBundle.listings.some((l) => l.id === listing.id)
              ? snap.savedBundle.listings.map((l) =>
                  l.id === listing.id ? listing : l
                )
              : snap.savedBundle.listings,
          }
        : null,
      cachedAt: Date.now(),
    };
  });

  void deletePersistentContent('mkt:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'marketplace_mutated' });
}

export function notifyMarketplaceListingDeleted(listingId: string): void {
  updateAllCachedMarketplaceSnapshots((snap) => ({
    ...snap,
    publicListings: removeItemById(snap.publicListings, listingId),
    myListings: removeItemById(snap.myListings, listingId),
    pendingListings: removeItemById(snap.pendingListings, listingId),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => {
    const hasInListings = snap.bundle.listings.some((l) => l.id === listingId);
    const hasInSaved = Boolean(
      snap.savedBundle?.listings.some((l) => l.id === listingId)
    );
    if (!hasInListings && !hasInSaved) {
      return snap;
    }
    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        listings: removeItemById(snap.bundle.listings, listingId),
      },
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            listings: removeItemById(snap.savedBundle.listings, listingId),
          }
        : null,
      cachedAt: Date.now(),
    };
  });

  void deletePersistentContent('mkt:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'marketplace_mutated' });
}

export function notifyMarketplaceListingCommentMutated(
  listingId: string,
  commentsCount: number
): void {
  const safeCount = Math.max(0, commentsCount);
  const patchList = (items: MarketplaceListing[]) =>
    items.map((l) => (l.id === listingId ? { ...l, commentsCount: safeCount } : l));

  updateAllCachedMarketplaceSnapshots((snap) => ({
    ...snap,
    publicListings: patchList(snap.publicListings),
    myListings: patchList(snap.myListings),
    pendingListings: patchList(snap.pendingListings),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => ({
    ...snap,
    bundle: {
      ...snap.bundle,
      listings: patchList(snap.bundle.listings),
    },
    savedBundle: snap.savedBundle
      ? {
          ...snap.savedBundle,
          listings: patchList(snap.savedBundle.listings),
        }
      : null,
    cachedAt: Date.now(),
  }));
}

export function notifyCampusEventMutated(input: {
  action: 'upsert' | 'delete';
  event?: CampusEvent;
  eventId?: string;
}): void {
  updateAllCachedEventsSnapshots((snap) => {
    if (input.action === 'delete' && input.eventId) {
      return {
        ...snap,
        events: removeItemById(snap.events, input.eventId),
        cachedAt: Date.now(),
      };
    }
    if (input.event) {
      const nextEvents =
        input.event.published === false
          ? removeItemById(snap.events, input.event.id)
          : upsertItemById(snap.events, input.event, true);
      return {
        ...snap,
        events: nextEvents,
        cachedAt: Date.now(),
      };
    }
    return snap;
  });

  personalisationPoolHandlers?.invalidateAll();
  void deletePersistentContent('events:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'event_mutated' });
}

export function notifyEventReactionChanged(
  eventId: string,
  liked: boolean,
  likesCount: number
): void {
  const safeCount = Math.max(0, likesCount);

  updateAllCachedEventsSnapshots((snap) => {
    const nextLiked = new Set(snap.likedIds);
    if (liked) nextLiked.add(eventId);
    else nextLiked.delete(eventId);
    return {
      ...snap,
      likedIds: nextLiked,
      events: snap.events.map((ev) =>
        ev.id === eventId ? { ...ev, likesCount: safeCount } : ev
      ),
      cachedAt: Date.now(),
    };
  });

  updateAllCachedHomeFeedSnapshots((snap) => {
    if (!snap.discovery) return snap;
    const nextLiked = new Set(snap.discovery.likedEventIds);
    if (liked) nextLiked.add(eventId);
    else nextLiked.delete(eventId);
    return {
      ...snap,
      discovery: {
        ...snap.discovery,
        likedEventIds: nextLiked,
        recommendedEvents: snap.discovery.recommendedEvents.map((item) =>
          item.event.id === eventId
            ? { ...item, event: { ...item.event, likesCount: safeCount } }
            : item
        ),
      },
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) =>
    snap.savedBundle
      ? {
          ...snap,
          savedBundle: {
            ...snap.savedBundle,
            events: snap.savedBundle.events.map((ev) =>
              ev.id === eventId ? { ...ev, likesCount: safeCount } : ev
            ),
          },
          cachedAt: Date.now(),
        }
      : snap
  );
}

export function notifyEventSavedChanged(eventId: string, saved: boolean): void {
  updateAllCachedEventsSnapshots((snap) => {
    const nextSaved = new Set(snap.savedIds);
    if (saved) nextSaved.add(eventId);
    else nextSaved.delete(eventId);
    return {
      ...snap,
      savedIds: nextSaved,
      cachedAt: Date.now(),
    };
  });

  updateAllCachedHomeFeedSnapshots((snap) => {
    if (!snap.discovery) return snap;
    const nextSaved = new Set(snap.discovery.savedEventIds);
    if (saved) nextSaved.add(eventId);
    else nextSaved.delete(eventId);
    return {
      ...snap,
      discovery: {
        ...snap.discovery,
        savedEventIds: nextSaved,
      },
      cachedAt: Date.now(),
    };
  });
}

export function notifyEventCommentMutated(
  eventId: string,
  commentsCount: number
): void {
  const safeCount = Math.max(0, commentsCount);

  updateAllCachedEventsSnapshots((snap) => ({
    ...snap,
    events: snap.events.map((ev) =>
      ev.id === eventId ? { ...ev, commentsCount: safeCount } : ev
    ),
    cachedAt: Date.now(),
  }));

  updateAllCachedHomeFeedSnapshots((snap) =>
    snap.discovery
      ? {
          ...snap,
          discovery: {
            ...snap.discovery,
            recommendedEvents: snap.discovery.recommendedEvents.map((item) =>
              item.event.id === eventId
                ? { ...item, event: { ...item.event, commentsCount: safeCount } }
                : item
            ),
          },
          cachedAt: Date.now(),
        }
      : snap
  );
}

export function notifyOpportunityMutated(input: {
  action: 'upsert' | 'delete';
  opportunity?: Opportunity;
  opportunityId?: string;
}): void {
  updateAllCachedOpportunitiesSnapshots((snap) => {
    if (input.action === 'delete' && input.opportunityId) {
      return {
        ...snap,
        opportunities: removeItemById(snap.opportunities, input.opportunityId),
        cachedAt: Date.now(),
      };
    }
    if (input.opportunity) {
      const visible =
        input.opportunity.status === 'active' ||
        input.opportunity.status === 'expired';
      return {
        ...snap,
        opportunities: visible
          ? upsertItemById(snap.opportunities, input.opportunity, true)
          : removeItemById(snap.opportunities, input.opportunity.id),
        cachedAt: Date.now(),
      };
    }
    return snap;
  });

  personalisationPoolHandlers?.invalidateAll();
  void deletePersistentContent('opps:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'opportunity_mutated' });
}

export function notifyOpportunitySavedChanged(
  opportunityId: string,
  saved: boolean
): void {
  updateAllCachedOpportunitiesSnapshots((snap) => {
    const nextSaved = new Set(snap.savedIds);
    if (saved) nextSaved.add(opportunityId);
    else nextSaved.delete(opportunityId);
    return {
      ...snap,
      savedIds: nextSaved,
      cachedAt: Date.now(),
    };
  });

  updateAllCachedHomeFeedSnapshots((snap) => {
    if (!snap.discovery) return snap;
    const nextSaved = new Set(snap.discovery.savedOpportunityIds);
    if (saved) nextSaved.add(opportunityId);
    else nextSaved.delete(opportunityId);
    return {
      ...snap,
      discovery: {
        ...snap.discovery,
        savedOpportunityIds: nextSaved,
      },
      cachedAt: Date.now(),
    };
  });
}

export function notifyTrustedContactMutated(): void {
  updateAllCachedTrustedCircleSnapshots((snap) => ({
    ...snap,
    cachedAt: 0,
  }));
  void deletePersistentContent('trusted_circle:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'trusted_circle_mutated' });
}

export function notifyProfileUpdated(input: {
  uid: string;
  username?: string;
  previousUsername?: string;
  projection?: PublicProfileProjection;
  patch?: Partial<PublicProfileProjection>;
}): void {
  foundationProjectionHandlers?.invalidateUid(input.uid);
  personalisationPoolHandlers?.invalidateAll();

  if (input.projection) {
    const proj = input.projection;
    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      postItems: patchAuthorProjectionInPostItems(
        snap.postItems,
        proj,
        input.uid
      ),
    }));
    updateAllCachedMarketplaceSnapshots((snap) => {
      const nextMap = patchAuthorProjectionInMap(snap.sellerMap, proj, input.uid);
      if (nextMap === snap.sellerMap) return snap;
      return {
        ...snap,
        sellerMap: nextMap,
        cachedAt: Date.now(),
      };
    });
    searchCacheHandlers?.patchAuthor(input.uid, proj);
  } else if (input.patch) {
    const patch = input.patch;
    updateAllCachedHomeFeedSnapshots((snap) => {
      let changed = false;
      const nextItems = snap.postItems.map((entry) => {
        if (entry.post.ownerUID !== input.uid || !entry.author) return entry;
        changed = true;
        return {
          ...entry,
          author: { ...entry.author, ...patch },
        };
      });
      return changed ? { ...snap, postItems: nextItems } : snap;
    });
    updateAllCachedMarketplaceSnapshots((snap) => {
      const existing = snap.sellerMap.get(input.uid);
      if (!existing) return snap;
      const updatedProj = { ...existing, ...patch };
      const nextMap = patchAuthorProjectionInMap(
        snap.sellerMap,
        updatedProj,
        input.uid
      );
      if (nextMap === snap.sellerMap) return snap;
      return {
        ...snap,
        sellerMap: nextMap,
        cachedAt: Date.now(),
      };
    });
    if (searchCacheHandlers?.patchAuthorPartial) {
      searchCacheHandlers.patchAuthorPartial(input.uid, patch);
    } else {
      searchCacheHandlers?.clearAuthorCache();
    }
  } else {
    searchCacheHandlers?.clearAuthorCache();
  }

  const hasFreshProfileData = Boolean(input.projection || input.patch);

  updateAllCachedProfileSnapshots((snap) => {
    const resolvedLower = snap.bundle.resolvedUsername.toLowerCase();
    const matchesNew = Boolean(
      input.username && resolvedLower === input.username.toLowerCase()
    );
    const matchesPrev = Boolean(
      input.previousUsername &&
        resolvedLower === input.previousUsername.toLowerCase()
    );
    const matchesOwn =
      snap.bundle.isOwnProfile && snap.viewerKey === input.uid;
    const matchesUidPostsOrListings =
      snap.bundle.posts.some((p) => p.ownerUID === input.uid) ||
      snap.bundle.listings.some((l) => l.ownerUID === input.uid);

    if (!matchesNew && !matchesPrev && !matchesOwn && !matchesUidPostsOrListings) {
      return snap;
    }

    const nextProfile = input.projection
      ? input.projection
      : input.patch
        ? { ...snap.bundle.profile, ...input.patch }
        : snap.bundle.profile;

    const nextLikedPosts = input.projection
      ? patchAuthorProjectionInPostItems(
          snap.bundle.likedPosts,
          input.projection,
          input.uid
        )
      : input.patch
        ? snap.bundle.likedPosts.map((entry) =>
            entry.post.ownerUID === input.uid && entry.author
              ? { ...entry, author: { ...entry.author, ...input.patch } }
              : entry
          )
        : snap.bundle.likedPosts;

    return {
      ...snap,
      username: input.projection?.username ?? input.username ?? snap.username,
      bundle: {
        ...snap.bundle,
        profile: nextProfile,
        resolvedUsername:
          input.projection?.username ??
          input.patch?.username ??
          input.username ??
          snap.bundle.resolvedUsername,
        likedPosts: nextLikedPosts,
      },
      cachedAt: hasFreshProfileData ? Date.now() : 0,
    };
  });

  if (
    input.previousUsername &&
    input.previousUsername.toLowerCase() !== input.username?.toLowerCase()
  ) {
    void deletePersistentContent(
      `profile:pub:v1:${input.previousUsername.toLowerCase()}`
    );
  }
  if (!hasFreshProfileData && input.username) {
    void deletePersistentContent(`profile:pub:v1:${input.username.toLowerCase()}`);
  }
  emitMutation({
    type: 'profile_updated',
    uid: input.uid,
    username: input.username,
  });
}

export function notifyFollowToggled(input: {
  targetUsername: string;
  following: boolean;
}): void {
  const lower = input.targetUsername.trim().toLowerCase();
  updateAllCachedProfileSnapshots((snap) => {
    if (snap.bundle.resolvedUsername.toLowerCase() !== lower) {
      return snap;
    }
    const delta = input.following ? 1 : -1;
    const prevFollowing = snap.bundle.isFollowing;
    if (prevFollowing === input.following) return snap;
    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        isFollowing: input.following,
        profile: {
          ...snap.bundle.profile,
          followersCount: Math.max(
            0,
            (snap.bundle.profile.followersCount ?? 0) + delta
          ),
        },
      },
      cachedAt: Date.now(),
    };
  });

  void purgePersistentContentByPrefix('priv:feed:v1:');
  clearHomeFeedSessionCache('following');
  emitMutation({
    type: 'follow_toggled',
    targetUsername: lower,
    following: input.following,
  });
}

export async function notifyViewerSessionReset(
  previousUid?: string | null
): Promise<void> {
  clearHomeFeedSessionCache();
  clearAnonymousFeedSessionCache();
  clearAllViewerNavigationCaches();
  searchCacheHandlers?.clearAuthorCache();
  foundationProjectionHandlers?.invalidateUid();
  personalisationPoolHandlers?.invalidateAll();
  await clearViewerPersistentCaches(previousUid);
  emitMutation({ type: 'viewer_reset' });
}

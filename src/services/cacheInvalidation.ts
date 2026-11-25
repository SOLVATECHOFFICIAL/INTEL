import type {
  AdminUpdate,
  AnonymousPost,
  CampusEvent,
  CampusPoll,
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
  updateAllCachedAdminUpdatesSnapshots,
  updateAllCachedEventsSnapshots,
  updateAllCachedMarketplaceSnapshots,
  updateAllCachedOpportunitiesSnapshots,
  updateAllCachedProfileSnapshots,
  updateAllCachedSearchSnapshots,
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
  subtractPostLikesSafe,
  upsertItemById,
} from '../utils/cacheSync';

export type CacheMutationEvent =
  | { type: 'community_post_created'; post: CommunityPost; author: PublicProfileProjection | null }
  | { type: 'community_post_updated'; post: CommunityPost }
  | { type: 'community_post_deleted'; postId: string; ownerUID?: string; likesCount?: number }
  | { type: 'community_post_reaction'; postId: string; liked: boolean; likesCount: number }
  | { type: 'community_post_saved'; postId: string; saved: boolean }
  | { type: 'anonymous_post_created'; post: AnonymousPost }
  | { type: 'anonymous_post_updated'; post: AnonymousPost }
  | { type: 'anonymous_post_deleted'; postId: string; ownerUID?: string; likesCount?: number }
  | { type: 'anonymous_post_reaction'; postId: string; liked: boolean; likesCount: number }
  | { type: 'anonymous_post_saved'; postId: string; saved: boolean }
  | { type: 'post_view_updated'; kind: 'ordinary' | 'anonymous' | 'update'; postId: string; viewsCount: number }
  | { type: 'admin_update_created'; update: AdminUpdate; author: PublicProfileProjection | null }
  | { type: 'admin_update_updated'; update: AdminUpdate }
  | { type: 'admin_update_deleted'; updateId: string; likesCount?: number }
  | { type: 'admin_update_reaction'; updateId: string; liked: boolean; likesCount: number }
  | { type: 'admin_update_saved'; updateId: string; saved: boolean }
  | { type: 'admin_update_comment_mutated'; updateId: string; commentsCount: number }
  | { type: 'official_poll_mutated'; poll: CampusPoll }
  | { type: 'official_poll_deleted'; pollId: string; updateId: string }
  | { type: 'marketplace_updates_mutated' }
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
  patchFollowCount?: (targetUsername: string, following: boolean) => void;
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
  patchFollowCount?: (targetUsername: string, following: boolean) => void;
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

export function notifyCommunityPostDeleted(
  postId: string,
  meta?: { ownerUID?: string; likesCount?: number }
): void {
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    postItems: snap.postItems.filter((entry) => entry.post.id !== postId),
    cachedAt: Date.now(),
  }));

  updateAllCachedProfileSnapshots((snap) => {
    const removedPost = snap.bundle.posts.find((p) => p.id === postId);
    const deletedLikes =
      removedPost?.likesCount ??
      (meta?.ownerUID && snap.bundle.isOwnProfile && snap.viewerKey === meta.ownerUID
        ? meta.likesCount ?? 0
        : 0);
    const shouldSubtract =
      Boolean(removedPost) ||
      Boolean(meta?.ownerUID && snap.bundle.isOwnProfile && snap.viewerKey === meta.ownerUID);

    return {
      ...snap,
      bundle: {
        ...snap.bundle,
        posts: removeItemById(snap.bundle.posts, postId),
        likedPosts: snap.bundle.likedPosts.filter((e) => e.post.id !== postId),
        totalLikesReceived: shouldSubtract
          ? subtractPostLikesSafe(snap.bundle.totalLikesReceived, deletedLikes)
          : snap.bundle.totalLikesReceived,
      },
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            posts: snap.savedBundle.posts.filter((e) => e.post.id !== postId),
          }
        : null,
      cachedAt: Date.now(),
    };
  });

  updateCachedPostUiSnapshot('ordinary', postId, () => null);
  void purgePersistentContentByPrefix('feed:posts:v1:');
  void purgePersistentContentByPrefix('profile:pub:v1:');
  searchCacheHandlers?.invalidate();
  emitMutation({
    type: 'community_post_deleted',
    postId,
    ownerUID: meta?.ownerUID,
    likesCount: meta?.likesCount,
  });
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

    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      anonymousItems: (snap.anonymousItems ?? []).map((p) =>
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

  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextOwned = new Set(snap.ownedAnonPostIds ?? []);
    if (actorViewerKey && snap.viewerKey === actorViewerKey) {
      nextOwned.add(clean.id);
    }
    return {
      ...snap,
      anonymousItems: upsertItemById(snap.anonymousItems ?? [], clean, true),
      ownedAnonPostIds: nextOwned,
      cachedAt: Date.now(),
    };
  });

  void deletePersistentContent('anon:posts:v1');
  void purgePersistentContentByPrefix('feed:posts:v1:');
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

  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    anonymousItems: (snap.anonymousItems ?? []).some((p) => p.id === clean.id)
      ? upsertItemById(snap.anonymousItems ?? [], clean, false)
      : snap.anonymousItems,
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

export function notifyAnonymousPostDeleted(
  postId: string,
  meta?: { ownerUID?: string; likesCount?: number }
): void {
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

  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextOwned = new Set(snap.ownedAnonPostIds ?? []);
    nextOwned.delete(postId);
    return {
      ...snap,
      anonymousItems: removeItemById(snap.anonymousItems ?? [], postId),
      ownedAnonPostIds: nextOwned,
      cachedAt: Date.now(),
    };
  });

  updateAllCachedProfileSnapshots((snap) => {
    const removedAnon = snap.anonHistory?.find((p) => p.id === postId);
    const matchesOwner =
      Boolean(removedAnon) ||
      Boolean(meta?.ownerUID && snap.bundle.isOwnProfile && snap.viewerKey === meta.ownerUID);
    const deletedLikes = removedAnon?.likesCount ?? meta?.likesCount ?? 0;

    return {
      ...snap,
      bundle: matchesOwner
        ? {
            ...snap.bundle,
            totalLikesReceived: subtractPostLikesSafe(
              snap.bundle.totalLikesReceived,
              deletedLikes
            ),
            profile: {
              ...snap.bundle.profile,
              anonymousLikesReceivedCount: subtractPostLikesSafe(
                snap.bundle.profile.anonymousLikesReceivedCount ?? 0,
                deletedLikes
              ),
            },
          }
        : snap.bundle,
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
    };
  });

  updateCachedPostUiSnapshot('anonymous', postId, () => null);
  void deletePersistentContent('anon:posts:v1');
  void purgePersistentContentByPrefix('feed:posts:v1:');
  searchCacheHandlers?.invalidate();
  emitMutation({
    type: 'anonymous_post_deleted',
    postId,
    ownerUID: meta?.ownerUID,
    likesCount: meta?.likesCount,
  });
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

  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextLiked = new Set(snap.likedAnonIds ?? []);
    if (liked) nextLiked.add(postId);
    else nextLiked.delete(postId);
    return {
      ...snap,
      likedAnonIds: nextLiked,
      anonymousItems: (snap.anonymousItems ?? []).map((p) =>
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

  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextSaved = new Set(snap.savedAnonIds ?? []);
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

export function notifyPostViewCountUpdated(
  kind: 'ordinary' | 'anonymous' | 'update',
  postId: string,
  viewsCount: number
): void {
  const safeCount = Math.max(0, Math.floor(viewsCount));
  if (kind === 'ordinary') {
    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      postItems: snap.postItems.map((entry) =>
        entry.post.id === postId
          ? { ...entry, post: { ...entry.post, viewsCount: safeCount } }
          : entry
      ),
    }));
    updateAllCachedProfileSnapshots((snap) => ({
      ...snap,
      bundle: {
        ...snap.bundle,
        posts: snap.bundle.posts.map((p) =>
          p.id === postId ? { ...p, viewsCount: safeCount } : p
        ),
        likedPosts: snap.bundle.likedPosts.map((e) =>
          e.post.id === postId
            ? { ...e, post: { ...e.post, viewsCount: safeCount } }
            : e
        ),
      },
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            posts: snap.savedBundle.posts.map((e) =>
              e.post.id === postId
                ? { ...e, post: { ...e.post, viewsCount: safeCount } }
                : e
            ),
          }
        : null,
    }));
  } else if (kind === 'update') {
    updateAllCachedAdminUpdatesSnapshots((snap) => ({
      ...snap,
      updates: snap.updates.map((item) =>
        item.id === postId ? { ...item, viewsCount: safeCount } : item
      ),
    }));
    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      updateItems: (snap.updateItems ?? []).map((entry) =>
        entry.update.id === postId
          ? { ...entry, update: { ...entry.update, viewsCount: safeCount } }
          : entry
      ),
    }));
  } else {
    updateCachedAnonymousFeedSnapshot((snap) => ({
      ...snap,
      anonymousPosts: snap.anonymousPosts.map((p) =>
        p.id === postId ? { ...p, viewsCount: safeCount } : p
      ),
    }));
    updateAllCachedHomeFeedSnapshots((snap) => ({
      ...snap,
      anonymousItems: (snap.anonymousItems ?? []).map((p) =>
        p.id === postId ? { ...p, viewsCount: safeCount } : p
      ),
    }));
    updateAllCachedProfileSnapshots((snap) => ({
      ...snap,
      anonHistory: snap.anonHistory
        ? snap.anonHistory.map((p) =>
            p.id === postId ? { ...p, viewsCount: safeCount } : p
          )
        : null,
      savedBundle: snap.savedBundle
        ? {
            ...snap.savedBundle,
            anonymousPosts: snap.savedBundle.anonymousPosts.map((p) =>
              p.id === postId ? { ...p, viewsCount: safeCount } : p
            ),
          }
        : null,
    }));
  }
  emitMutation({
    type: 'post_view_updated',
    kind,
    postId,
    viewsCount: safeCount,
  });
}

export function notifyMarketplaceUpdatesMutated(): void {
  void deletePersistentContent('mkt:updates:v1');
  emitMutation({ type: 'marketplace_updates_mutated' });
}

// ---------------------------------------------------------------------------
// Official Admin Updates
// ---------------------------------------------------------------------------

export function notifyAdminUpdateCreated(
  update: AdminUpdate,
  author: PublicProfileProjection | null = null
): void {
  updateAllCachedAdminUpdatesSnapshots((snap) => {
    const nextMap = new Map(snap.authorMap);
    if (update.ownerUID && author) {
      nextMap.set(update.ownerUID, author);
    }
    return {
      ...snap,
      updates: upsertItemById(snap.updates, update, true),
      authorMap: nextMap,
      cachedAt: Date.now(),
    };
  });
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    updateItems: [
      { update, author },
      ...(snap.updateItems ?? []).filter((item) => item.update.id !== update.id),
    ],
    cachedAt: Date.now(),
  }));
  void deletePersistentContent('updates:public:v1');
  void purgePersistentContentByPrefix('feed:posts:v1:');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'admin_update_created', update, author });
}

export function notifyAdminUpdateUpdated(update: AdminUpdate): void {
  updateAllCachedAdminUpdatesSnapshots((snap) => ({
    ...snap,
    updates: upsertItemById(snap.updates, update, false),
    cachedAt: Date.now(),
  }));
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    updateItems: (snap.updateItems ?? []).map((item) =>
      item.update.id === update.id ? { ...item, update } : item
    ),
    cachedAt: Date.now(),
  }));
  void deletePersistentContent('updates:public:v1');
  searchCacheHandlers?.invalidate();
  emitMutation({ type: 'admin_update_updated', update });
}

export function notifyAdminUpdateDeleted(
  updateId: string,
  meta?: { likesCount?: number }
): void {
  updateAllCachedAdminUpdatesSnapshots((snap) => ({
    ...snap,
    updates: removeItemById(snap.updates, updateId),
    cachedAt: Date.now(),
  }));
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    updateItems: (snap.updateItems ?? []).filter(
      (item) => item.update.id !== updateId
    ),
    cachedAt: Date.now(),
  }));
  void deletePersistentContent('updates:public:v1');
  void purgePersistentContentByPrefix('feed:posts:v1:');
  searchCacheHandlers?.invalidate();
  emitMutation({
    type: 'admin_update_deleted',
    updateId,
    likesCount: meta?.likesCount,
  });
}

export function notifyAdminUpdateReactionChanged(
  updateId: string,
  liked: boolean,
  likesCount: number
): void {
  const safeCount = Math.max(0, likesCount);
  updateAllCachedAdminUpdatesSnapshots((snap) => {
    const nextLiked = new Set(snap.likedIds);
    if (liked) nextLiked.add(updateId);
    else nextLiked.delete(updateId);
    return {
      ...snap,
      likedIds: nextLiked,
      updates: snap.updates.map((item) =>
        item.id === updateId ? { ...item, likesCount: safeCount } : item
      ),
      cachedAt: Date.now(),
    };
  });
  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextLiked = new Set(snap.likedUpdateIds ?? []);
    if (liked) nextLiked.add(updateId);
    else nextLiked.delete(updateId);
    return {
      ...snap,
      likedUpdateIds: nextLiked,
      updateItems: (snap.updateItems ?? []).map((item) =>
        item.update.id === updateId
          ? { ...item, update: { ...item.update, likesCount: safeCount } }
          : item
      ),
      cachedAt: Date.now(),
    };
  });
  emitMutation({ type: 'admin_update_reaction', updateId, liked, likesCount: safeCount });
}

export function notifyAdminUpdateSavedChanged(
  updateId: string,
  saved: boolean
): void {
  updateAllCachedAdminUpdatesSnapshots((snap) => {
    const nextSaved = new Set(snap.savedIds);
    if (saved) nextSaved.add(updateId);
    else nextSaved.delete(updateId);
    return {
      ...snap,
      savedIds: nextSaved,
      cachedAt: Date.now(),
    };
  });
  updateAllCachedHomeFeedSnapshots((snap) => {
    const nextSaved = new Set(snap.savedUpdateIds ?? []);
    if (saved) nextSaved.add(updateId);
    else nextSaved.delete(updateId);
    return {
      ...snap,
      savedUpdateIds: nextSaved,
      cachedAt: Date.now(),
    };
  });
  emitMutation({ type: 'admin_update_saved', updateId, saved });
}

export function notifyAdminUpdateCommentMutated(
  updateId: string,
  commentsCount: number
): void {
  const safeCount = Math.max(0, commentsCount);
  updateAllCachedAdminUpdatesSnapshots((snap) => ({
    ...snap,
    updates: snap.updates.map((item) =>
      item.id === updateId ? { ...item, commentsCount: safeCount } : item
    ),
    cachedAt: Date.now(),
  }));
  updateAllCachedHomeFeedSnapshots((snap) => ({
    ...snap,
    updateItems: (snap.updateItems ?? []).map((item) =>
      item.update.id === updateId
        ? { ...item, update: { ...item.update, commentsCount: safeCount } }
        : item
    ),
    cachedAt: Date.now(),
  }));
  emitMutation({ type: 'admin_update_comment_mutated', updateId, commentsCount: safeCount });
}

export function notifyOfficialPollMutated(poll: CampusPoll): void {
  emitMutation({ type: 'official_poll_mutated', poll });
}

export function notifyOfficialPollDeleted(pollId: string, updateId: string): void {
  emitMutation({ type: 'official_poll_deleted', pollId, updateId });
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
      updateItems: (snap.updateItems ?? []).map((entry) =>
        entry.update.authorMode === 'public_admin' &&
        entry.update.ownerUID === input.uid
          ? { ...entry, author: proj }
          : entry
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
      const nextUpdateItems = (snap.updateItems ?? []).map((entry) => {
        if (
          entry.update.authorMode !== 'public_admin' ||
          entry.update.ownerUID !== input.uid ||
          !entry.author
        ) {
          return entry;
        }
        changed = true;
        return {
          ...entry,
          author: { ...entry.author, ...patch },
        };
      });
      return changed
        ? { ...snap, postItems: nextItems, updateItems: nextUpdateItems }
        : snap;
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
  if (input.projection || input.patch) {
    const matchUsernameLower = (
      input.previousUsername ||
      input.username ||
      input.projection?.username ||
      input.patch?.username ||
      ''
    )
      .trim()
      .toLowerCase();
    updateAllCachedSearchSnapshots((bundle) => {
      let changed = false;
      const nextPeople = bundle.people.items.map((member) => {
        if (!matchUsernameLower || member.username.toLowerCase() !== matchUsernameLower) {
          return member;
        }
        changed = true;
        return input.projection
          ? input.projection
          : { ...member, ...input.patch };
      });
      const nextPosts = bundle.posts.items.map((entry) => {
        if (entry.post.ownerUID !== input.uid || !entry.author) return entry;
        changed = true;
        return {
          ...entry,
          author: input.projection
            ? input.projection
            : { ...entry.author, ...input.patch },
        };
      });
      const nextSellers = new Map(bundle.marketplaceSellers);
      const existingSeller = nextSellers.get(input.uid);
      if (existingSeller) {
        changed = true;
        nextSellers.set(
          input.uid,
          input.projection
            ? input.projection
            : { ...existingSeller, ...input.patch }
        );
      }
      if (!changed) return bundle;
      return {
        ...bundle,
        people: { ...bundle.people, items: nextPeople },
        posts: { ...bundle.posts, items: nextPosts },
        marketplaceSellers: nextSellers,
      };
    });
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
  const delta = input.following ? 1 : -1;
  updateAllCachedProfileSnapshots((snap) => {
    if (snap.bundle.resolvedUsername.toLowerCase() !== lower) {
      return snap;
    }
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

  searchCacheHandlers?.patchFollowCount?.(lower, input.following);
  foundationProjectionHandlers?.invalidateUid();
  personalisationPoolHandlers?.invalidateAll();

  updateAllCachedSearchSnapshots((bundle) => {
    let changed = false;
    const nextPeople = bundle.people.items.map((member) => {
      if (member.username.toLowerCase() !== lower) return member;
      changed = true;
      return {
        ...member,
        followersCount: Math.max(0, (member.followersCount ?? 0) + delta),
      };
    });
    const nextPosts = bundle.posts.items.map((entry) => {
      if (!entry.author || entry.author.username.toLowerCase() !== lower) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        author: {
          ...entry.author,
          followersCount: Math.max(
            0,
            (entry.author.followersCount ?? 0) + delta
          ),
        },
      };
    });
    const nextSellers = new Map(bundle.marketplaceSellers);
    nextSellers.forEach((seller, sellerUid) => {
      if (seller.username.toLowerCase() === lower) {
        changed = true;
        nextSellers.set(sellerUid, {
          ...seller,
          followersCount: Math.max(0, (seller.followersCount ?? 0) + delta),
        });
      }
    });
    if (!changed) return bundle;
    return {
      ...bundle,
      people: { ...bundle.people, items: nextPeople },
      posts: { ...bundle.posts, items: nextPosts },
      marketplaceSellers: nextSellers,
      updatedAt: Date.now(),
    };
  });

  updateAllCachedHomeFeedSnapshots((snap) => {
    let changed = false;
    const nextPostItems = snap.postItems.map((entry) => {
      if (!entry.author || entry.author.username.toLowerCase() !== lower) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        author: {
          ...entry.author,
          followersCount: Math.max(
            0,
            (entry.author.followersCount ?? 0) + delta
          ),
        },
      };
    });
    const nextUpdateItems = (snap.updateItems ?? []).map((entry) => {
      if (!entry.author || entry.author.username.toLowerCase() !== lower) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        author: {
          ...entry.author,
          followersCount: Math.max(
            0,
            (entry.author.followersCount ?? 0) + delta
          ),
        },
      };
    });
    let nextDiscovery = snap.discovery;
    if (nextDiscovery && nextDiscovery.recommendedPeople.length > 0) {
      let recChanged = false;
      const nextRecPeople = nextDiscovery.recommendedPeople.map((rec) => {
        if (rec.member.username.toLowerCase() !== lower) return rec;
        recChanged = true;
        return {
          ...rec,
          member: {
            ...rec.member,
            followersCount: Math.max(
              0,
              (rec.member.followersCount ?? 0) + delta
            ),
          },
        };
      });
      if (recChanged) {
        changed = true;
        nextDiscovery = {
          ...nextDiscovery,
          recommendedPeople: nextRecPeople,
        };
      }
    }
    if (!changed) return snap;
    return {
      ...snap,
      postItems: nextPostItems,
      updateItems: nextUpdateItems,
      discovery: nextDiscovery,
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Edit3,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import {
  getAnonymousBackgroundTheme,
  getTextPostBackgroundTheme,
} from '../../config/anonymousBackgrounds';
import { buildPostShareUrl } from '../../config/site';
import { useFirebase } from '../../context/firebaseContext';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import { togglePostCommentReaction } from '../../services/events';
import {
  getPostUiSnapshot,
  hydratePostUiSnapshot,
  savePostUiSnapshot,
} from '../../services/navigationStateCache';
import {
  clearPersistentDraft,
  loadPersistentDraft,
  savePersistentDraft,
} from '../../services/persistentCache';
import {
  addPostComment,
  deletePostCascading,
  deletePostComment,
  editPostComment,
  fetchCommentsPageForPost,
  fetchViewerLikedPostIds,
  recordDeduplicatedPostView,
  removeSingleImageFromPost,
  revealAnonymousEntryAuthor,
  toggleAnonymousCommentReaction,
  togglePostReaction,
  toggleSavedPost,
  type CommentWithAuthor,
  type CommentsPageCursor,
  type RevealedAuthorResult,
} from '../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  canActorDeleteOrdinaryPost,
  canModeratorDeleteByBadge,
  collectCommentTreeIds,
  resolveAnonymousPostType,
  resolveOrdinaryPostType,
  type AnonymousComment,
  type AnonymousPost,
  type CommunityPost,
  type PostComment,
  type PublicProfileProjection,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  canRevealAnonymousAuthor,
  formatFirestoreOrAppError,
  toPublicProfileProjection,
  type EffectiveAccountTier,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { mediaMetaToGridItems } from '../../utils/mediaGrid';
import {
  appendOptimisticCommentEntry,
  buildOptimisticCommentEntry,
  computeOptimisticCommentReactionMap,
  computeOptimisticReactionToggle,
  createOptimisticTempId,
  isOptimisticTempId,
  reconcileOptimisticCommentEntry,
  removeCommentTreeEntries,
  restoreCommentEntriesOrdered,
} from '../../utils/optimisticInteractions';
import {
  POST_VIEW_MIN_DWELL_MS,
  POST_VIEW_MIN_INTERSECTION_RATIO,
  formatCompactViewCount,
  hasRecordedPostViewLocally,
  resolveActiveViewActor,
} from '../../utils/postViews';
import { ProfileBadgesRow } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { AvatarMedia } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';
import { LinkifiedText } from '../shared/LinkifiedText';
import { ShareActionMenu } from '../shared/ShareActionMenu';

interface PostCardProps {
  kind: 'ordinary' | 'anonymous';
  post: CommunityPost | AnonymousPost;
  author?: PublicProfileProjection | null;
  viewerUid: string | null;
  viewerTier: EffectiveAccountTier;
  viewerSuspended: boolean;
  isLiked: boolean;
  isSaved?: boolean;
  defaultCommentsOpen?: boolean;
  isHighlighted?: boolean;
  highlightCommentId?: string | null;
  isOwnedAnonymous?: boolean;
  ownedAnonymousCommentIds?: Set<string>;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  returnRoute: ActiveRoute;
  onEditPost?: (post: CommunityPost | AnonymousPost) => void;
  onPostUpdated: (updated: CommunityPost | AnonymousPost) => void;
  onPostDeleted: (postId: string) => void;
  onSaveChanged?: (postId: string, saved: boolean) => void;
  onAnonymousCommentTracked?: (commentId: string, action: 'add' | 'remove') => void;
  onOpenPost?: (postId: string) => void;
}

function formatPostTimestamp(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Just now';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PostCardComponent: React.FC<PostCardProps> = ({
  kind,
  post,
  author,
  viewerUid,
  viewerTier,
  viewerSuspended,
  isLiked,
  isSaved = false,
  defaultCommentsOpen = false,
  isHighlighted = false,
  highlightCommentId = null,
  isOwnedAnonymous = false,
  ownedAnonymousCommentIds,
  onNavigateProfile,
  onRequireAuth,
  returnRoute,
  onEditPost,
  onPostUpdated,
  onPostDeleted,
  onSaveChanged,
  onAnonymousCommentTracked,
  onOpenPost,
}) => {
  const targetCollection = kind === 'ordinary' ? 'posts' : 'anonymousPosts';

  const { user: authUser, profile: viewerProfile } = useFirebase();
  const canRevealAnonymous = canRevealAnonymousAuthor(authUser);
  const viewerAuthorProjection: PublicProfileProjection | null =
    viewerProfile ? toPublicProfileProjection(viewerProfile) : null;
  const viewerKey = viewerUid ?? 'guest';

  const [likedOverride, setLikedOverride] = useState<{
    viewerKey: string;
    base: boolean;
    value: boolean;
  } | null>(null);
  const [likesCountOverride, setLikesCountOverride] = useState<{
    viewerKey: string;
    base: number;
    value: number;
  } | null>(null);
  const [savedOverride, setSavedOverride] = useState<{
    viewerKey: string;
    base: boolean;
    value: boolean;
  } | null>(null);
  const [commentsCountOverride, setCommentsCountOverride] = useState<{
    base: number;
    value: number;
  } | null>(null);

  // In-flight locks to prevent duplicate rapid clicks/submits without blocking instant UI
  const likeInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const commentSubmitLockRef = useRef<Set<string>>(new Set());
  const commentLikeInFlightRef = useRef<Set<string>>(new Set());

  const likedState =
    likedOverride &&
    likedOverride.viewerKey === viewerKey &&
    likedOverride.base === isLiked
      ? likedOverride.value
      : isLiked;
  const likesCount =
    likesCountOverride &&
    likesCountOverride.viewerKey === viewerKey &&
    likesCountOverride.base === post.likesCount
      ? likesCountOverride.value
      : post.likesCount;
  const savedState =
    savedOverride &&
    savedOverride.viewerKey === viewerKey &&
    savedOverride.base === isSaved
      ? savedOverride.value
      : isSaved;
  const commentsCount =
    commentsCountOverride && commentsCountOverride.base === post.commentsCount
      ? commentsCountOverride.value
      : post.commentsCount;

  const rawViewsCount = Math.max(0, Number(post.viewsCount ?? 0));
  const [viewsCountOverride, setViewsCountOverride] = useState<{
    postId: string;
    value: number;
  } | null>(null);
  const effectiveViewsCount =
    viewsCountOverride && viewsCountOverride.postId === post.id
      ? Math.max(viewsCountOverride.value, rawViewsCount)
      : rawViewsCount;
  const articleRef = useRef<HTMLElement | null>(null);
  const recordedViewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeCacheMutations((event) => {
      if (
        event.type === 'post_view_updated' &&
        event.kind === kind &&
        event.postId === post.id
      ) {
        setViewsCountOverride({
          postId: post.id,
          value: event.viewsCount,
        });
      }
    });
  }, [kind, post.id]);

  useEffect(() => {
    const actor = resolveActiveViewActor(viewerUid);
    const viewKey = `${targetCollection}:${post.id}:${actor.dedupKey}`;
    if (recordedViewKeyRef.current === viewKey) return;
    const target = articleRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;

    const triggerQualifiedView = () => {
      if (recordedViewKeyRef.current === viewKey) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      recordedViewKeyRef.current = viewKey;
      const alreadyRecorded = hasRecordedPostViewLocally(
        targetCollection,
        post.id,
        actor.dedupKey
      );
      if (!alreadyRecorded) {
        setViewsCountOverride({
          postId: post.id,
          value: rawViewsCount + 1,
        });
      }
      void recordDeduplicatedPostView({
        kind,
        postId: post.id,
        viewerUid,
        currentViewsCount: rawViewsCount,
      }).then((nextViews) => {
        if (typeof nextViews === 'number') {
          setViewsCountOverride({
            postId: post.id,
            value: nextViews,
          });
        } else if (!alreadyRecorded) {
          setViewsCountOverride((prev) =>
            prev?.postId === post.id ? null : prev
          );
        }
      });
    };

    let dwellTimerId: number | null = null;
    let isQualifyingVisible = false;

    const clearDwellTimer = () => {
      if (dwellTimerId !== null) {
        window.clearTimeout(dwellTimerId);
        dwellTimerId = null;
      }
    };

    const scheduleDwellIfEligible = () => {
      if (dwellTimerId !== null) return;
      if (!isQualifyingVisible || recordedViewKeyRef.current === viewKey) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      dwellTimerId = window.setTimeout(() => {
        dwellTimerId = null;
        if (
          !isQualifyingVisible ||
          recordedViewKeyRef.current === viewKey ||
          (typeof document !== 'undefined' &&
            document.visibilityState === 'hidden')
        ) {
          return;
        }
        observer.disconnect();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        triggerQualifiedView();
      }, POST_VIEW_MIN_DWELL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearDwellTimer();
      } else {
        scheduleDwellIfEligible();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isQualifyingVisible =
          entry.isIntersecting &&
          entry.intersectionRatio >= POST_VIEW_MIN_INTERSECTION_RATIO;
        if (isQualifyingVisible) {
          scheduleDwellIfEligible();
        } else {
          clearDwellTimer();
        }
      },
      { threshold: [POST_VIEW_MIN_INTERSECTION_RATIO] }
    );

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    observer.observe(target);
    return () => {
      clearDwellTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      observer.disconnect();
    };
  }, [kind, targetCollection, post.id, viewerUid, rawViewsCount]);

  const initialUiSnapshot = getPostUiSnapshot(viewerKey, kind, post.id);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(
    () => initialUiSnapshot?.lightboxIndex ?? null
  );
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [commentsManualOpen, setCommentsManualOpen] = useState<boolean | null>(
    () => initialUiSnapshot?.commentsManualOpen ?? null
  );
  const commentsOpen =
    commentsManualOpen ?? Boolean(defaultCommentsOpen || highlightCommentId);
  const [commentsLoading, setCommentsLoading] = useState(
    () =>
      Boolean(
        initialUiSnapshot?.commentsManualOpen ??
          (defaultCommentsOpen || highlightCommentId)
      ) && !initialUiSnapshot?.commentsLoaded
  );
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [comments, setComments] = useState<CommentWithAuthor[]>(
    () => initialUiSnapshot?.comments ?? []
  );
  const [commentsCursor, setCommentsCursor] =
    useState<CommentsPageCursor | null>(
      () => initialUiSnapshot?.commentsCursor ?? null
    );
  const [hasMoreComments, setHasMoreComments] = useState(
    () => initialUiSnapshot?.hasMoreComments ?? false
  );
  const [commentsLoaded, setCommentsLoaded] = useState(
    () => initialUiSnapshot?.commentsLoaded ?? false
  );

  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(
    () => initialUiSnapshot?.replyingToId ?? null
  );
  const [replyBody, setReplyBody] = useState('');
  const [replyTarget, setReplyTarget] = useState<{
    parentCommentId: string;
    replyToCommentId?: string;
    label?: string;
  } | null>(null);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentActionBusyId, setCommentActionBusyId] = useState<string | null>(
    null
  );

  // Supreme Admin anonymous identity reveal
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealedAuthor, setRevealedAuthor] =
    useState<RevealedAuthorResult | null>(null);

  const [cardError, setCardError] = useState<string | null>(null);
  const [guestActionPrompt, setGuestActionPrompt] = useState<string | null>(
    null
  );

  // Comment & reply likes (supports both postComments and anonymousComments)
  const [likedCommentState, setLikedCommentState] = useState<{
    uid: string | null;
    ids: Set<string>;
  }>(() => ({
    uid: viewerUid,
    ids: initialUiSnapshot?.likedCommentIds ?? new Set(),
  }));
  const likedCommentIds = useMemo<Set<string>>(
    () =>
      viewerUid && likedCommentState.uid === viewerUid
        ? likedCommentState.ids
        : new Set<string>(),
    [viewerUid, likedCommentState.uid, likedCommentState.ids]
  );
  const [commentLikesCounts, setCommentLikesCounts] = useState<
    Record<string, number>
  >(() => initialUiSnapshot?.commentLikesCounts ?? {});

  useEffect(() => {
    if (
      commentsManualOpen === null &&
      !commentsLoaded &&
      lightboxIndex === null &&
      replyingToId === null
    ) {
      return;
    }
    savePostUiSnapshot({
      viewerKey,
      kind,
      postId: post.id,
      commentsManualOpen,
      comments,
      commentsCursor,
      hasMoreComments,
      commentsLoaded,
      replyingToId,
      lightboxIndex,
      likedCommentIds,
      commentLikesCounts,
      cachedAt: Date.now(),
    });
  }, [
    viewerKey,
    kind,
    post.id,
    commentsManualOpen,
    comments,
    commentsCursor,
    hasMoreComments,
    commentsLoaded,
    replyingToId,
    lightboxIndex,
    likedCommentIds,
    commentLikesCounts,
  ]);

  // Hydrate persisted Post UI snapshot from IDB after cold reloads
  useEffect(() => {
    if (getPostUiSnapshot(viewerKey, kind, post.id)) {
      return;
    }
    let active = true;
    void hydratePostUiSnapshot(viewerKey, kind, post.id)
      .then((stored) => {
        if (!active || !stored) return;
        setCommentsManualOpen((curr) =>
          curr !== null ? curr : stored.commentsManualOpen
        );
        setComments((curr) => (curr.length > 0 ? curr : stored.comments));
        setCommentsCursor((curr) => curr ?? stored.commentsCursor);
        setHasMoreComments((curr) => curr || stored.hasMoreComments);
        setCommentsLoaded((curr) => {
          const next = curr || stored.commentsLoaded;
          if (next) setCommentsLoading(false);
          return next;
        });
        setReplyingToId((curr) => curr ?? stored.replyingToId);
        if (stored.likedCommentIds.size > 0 && viewerUid) {
          setLikedCommentState((curr) =>
            curr.ids.size > 0
              ? curr
              : { uid: viewerUid, ids: stored.likedCommentIds }
          );
        }
        setCommentLikesCounts((curr) =>
          Object.keys(curr).length > 0 ? curr : stored.commentLikesCounts
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerKey, viewerUid, kind, post.id]);

  // Load & autosave persistent top-level comment draft
  useEffect(() => {
    let active = true;
    void loadPersistentDraft<string>(
      viewerKey,
      `post_comment:${kind}:${post.id}`
    )
      .then((draft) => {
        if (!active || !draft) return;
        setNewCommentBody((curr) => (curr.trim() ? curr : draft));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerKey, kind, post.id]);

  useEffect(() => {
    if (!newCommentBody.trim()) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(
        viewerKey,
        `post_comment:${kind}:${post.id}`,
        newCommentBody
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [viewerKey, kind, post.id, newCommentBody]);

  // Load & autosave persistent reply draft when replying to a comment
  useEffect(() => {
    if (!replyingToId) return;
    let active = true;
    void loadPersistentDraft<string>(
      viewerKey,
      `post_reply:${kind}:${post.id}:${replyingToId}`
    )
      .then((draft) => {
        if (!active || !draft) return;
        setReplyBody((curr) => (curr.trim() ? curr : draft));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerKey, kind, post.id, replyingToId]);

  useEffect(() => {
    if (!replyingToId || !replyBody.trim()) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(
        viewerKey,
        `post_reply:${kind}:${post.id}:${replyingToId}`,
        replyBody
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [viewerKey, kind, post.id, replyingToId, replyBody]);

  const isAdminOrOwner = viewerTier === 'supreme_admin';
  const isOrdinaryOwner =
    kind === 'ordinary' &&
    Boolean(viewerUid) &&
    'ownerUID' in post &&
    post.ownerUID === viewerUid;

  const canEdit =
    !viewerSuspended &&
    Boolean(viewerUid) &&
    (kind === 'ordinary'
      ? isOrdinaryOwner &&
        (viewerTier === 'verified' ||
          viewerTier === 'moderator' ||
          isAdminOrOwner)
      : isOwnedAnonymous);

  const canDelete =
    !viewerSuspended &&
    Boolean(viewerUid) &&
    (kind === 'ordinary'
      ? canActorDeleteOrdinaryPost({
          viewerUid,
          viewerTier,
          viewerSuspended,
          postOwnerUid: 'ownerUID' in post ? post.ownerUID : '',
          authorBadge: author?.badge ?? null,
        })
      : isOwnedAnonymous || isAdminOrOwner || viewerTier === 'moderator');

  const ordinaryPostType =
    kind === 'ordinary' ? resolveOrdinaryPostType(post as CommunityPost) : null;
  const gridItems =
    kind === 'ordinary' && ordinaryPostType === 'text'
      ? []
      : mediaMetaToGridItems(post.mediaItems);

  const isStyledOrdinaryText =
    kind === 'ordinary' &&
    ordinaryPostType === 'text' &&
    (Boolean((post as CommunityPost).backgroundStyle) ||
      (post as CommunityPost).postType === 'text');
  const ordinaryTextTheme = isStyledOrdinaryText
    ? getTextPostBackgroundTheme((post as CommunityPost).backgroundStyle)
    : null;

  const anonPostType =
    kind === 'anonymous'
      ? resolveAnonymousPostType(post as AnonymousPost)
      : null;
  const hasLegacyPerPhotoCaptions =
    kind === 'anonymous' &&
    !('postType' in post && post.postType) &&
    gridItems.some((item) => Boolean(item.caption));

  const isStyledAnonText =
    kind === 'anonymous' &&
    anonPostType === 'text' &&
    'backgroundStyle' in post &&
    Boolean(post.backgroundStyle) &&
    post.backgroundStyle !== 'plain';
  const anonTheme = isStyledAnonText
    ? getAnonymousBackgroundTheme((post as AnonymousPost).backgroundStyle)
    : null;

  useEffect(() => {
    if (!commentsOpen || !viewerUid) {
      return;
    }
    let active = true;
    const commentTarget =
      kind === 'anonymous' ? 'anonymousComments' : 'postComments';
    fetchViewerLikedPostIds(commentTarget, viewerUid)
      .then((ids) => {
        if (active) setLikedCommentState({ uid: viewerUid, ids });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, commentsOpen, viewerUid]);

  useEffect(() => {
    if (!commentsOpen || commentsLoaded) return;
    let active = true;
    fetchCommentsPageForPost(targetCollection, post.id, { pageSize: 15 })
      .then((page) => {
        if (!active) return;
        setComments(page.items);
        setCommentsCursor(page.nextCursor);
        setHasMoreComments(page.hasMore);
        setCommentsLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setCardError(
          formatFirestoreOrAppError(error, 'Unable to load comments right now.')
        );
      })
      .finally(() => {
        if (active) setCommentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [commentsOpen, commentsLoaded, targetCollection, post.id]);

  useEffect(() => {
    if (!isHighlighted && !highlightCommentId) return;
    const raf = window.requestAnimationFrame(() => {
      if (highlightCommentId && commentsLoaded) {
        const commentEl = document.getElementById(
          `comment-${highlightCommentId}`
        );
        if (commentEl) {
          commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      if (isHighlighted && (!highlightCommentId || commentsLoaded)) {
        const postEl = document.getElementById(`post-${post.id}`);
        postEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isHighlighted, highlightCommentId, commentsLoaded, post.id]);

  const loadComments = async () => {
    setCommentsLoading(true);
    setCardError(null);
    try {
      const page = await fetchCommentsPageForPost(targetCollection, post.id, {
        pageSize: 15,
      });
      setComments(page.items);
      setCommentsCursor(page.nextCursor);
      setHasMoreComments(page.hasMore);
      setCommentsLoaded(true);
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Unable to load comments right now.')
      );
    } finally {
      setCommentsLoading(false);
    }
  };

  const handleLoadMoreComments = async () => {
    if (!commentsCursor || loadingMoreComments) return;
    setLoadingMoreComments(true);
    setCardError(null);
    try {
      const page = await fetchCommentsPageForPost(targetCollection, post.id, {
        pageSize: 15,
        cursor: commentsCursor,
      });
      setComments((prev) => {
        const seen = new Set(prev.map((item) => item.comment.id));
        const extra = page.items.filter((item) => !seen.has(item.comment.id));
        return [...prev, ...extra];
      });
      setCommentsCursor(page.nextCursor);
      setHasMoreComments(page.hasMore);
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Unable to load more comments.')
      );
    } finally {
      setLoadingMoreComments(false);
    }
  };

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsManualOpen(next);
    if (next && !commentsLoaded) {
      void loadComments();
    }
  };

  const handleToggleLike = () => {
    setCardError(null);
    setGuestActionPrompt(null);
    if (!viewerUid) {
      setGuestActionPrompt('Sign in to like this post.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot react to posts.');
      return;
    }
    if (likeInFlightRef.current) return;

    likeInFlightRef.current = true;
    const prevLiked = likedState;
    const prevCount = likesCount;
    const { nextLiked, nextCount } = computeOptimisticReactionToggle({
      currentlyLiked: prevLiked,
      currentCount: prevCount,
    });

    // Immediate optimistic UI update
    setLikedOverride({ viewerKey, base: isLiked, value: nextLiked });
    setLikesCountOverride({ viewerKey, base: post.likesCount, value: nextCount });
    onPostUpdated({ ...post, likesCount: nextCount });

    void togglePostReaction({
      kind: targetCollection,
      postId: post.id,
      actorUid: viewerUid,
      currentlyLiked: prevLiked,
    })
      .then((result) => {
        setLikedOverride({ viewerKey, base: isLiked, value: result.liked });
        setLikesCountOverride({
          viewerKey,
          base: post.likesCount,
          value: result.likesCount,
        });
        onPostUpdated({ ...post, likesCount: result.likesCount });
      })
      .catch((error) => {
        setLikedOverride({ viewerKey, base: isLiked, value: prevLiked });
        setLikesCountOverride({
          viewerKey,
          base: post.likesCount,
          value: prevCount,
        });
        onPostUpdated({ ...post, likesCount: prevCount });
        setCardError(
          formatFirestoreOrAppError(
            error,
            'Could not update your like right now.'
          )
        );
      })
      .finally(() => {
        likeInFlightRef.current = false;
      });
  };

  const handleToggleSave = () => {
    setCardError(null);
    setGuestActionPrompt(null);
    if (!viewerUid) {
      setGuestActionPrompt('Sign in to save posts to your private collection.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot bookmark posts.');
      return;
    }
    if (saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    const prevSaved = savedState;
    const nextSaved = !prevSaved;

    // Immediate optimistic UI update
    setSavedOverride({ viewerKey, base: isSaved, value: nextSaved });
    onSaveChanged?.(post.id, nextSaved);

    void toggleSavedPost({
      actorUid: viewerUid,
      targetCollection,
      targetId: post.id,
      currentlySaved: prevSaved,
    })
      .then((result) => {
        setSavedOverride({ viewerKey, base: isSaved, value: result.saved });
        onSaveChanged?.(post.id, result.saved);
      })
      .catch((error) => {
        setSavedOverride({ viewerKey, base: isSaved, value: prevSaved });
        onSaveChanged?.(post.id, prevSaved);
        setCardError(
          formatFirestoreOrAppError(
            error,
            'Could not update bookmark right now.'
          )
        );
      })
      .finally(() => {
        saveInFlightRef.current = false;
      });
  };

  const handleDeletePost = async () => {
    if (!viewerUid || deleteBusy) return;
    setDeleteBusy(true);
    setCardError(null);
    try {
      await deletePostCascading({
        kind: targetCollection,
        post,
        actorUid: viewerUid,
      });
      onPostDeleted(post.id);
    } catch (error) {
      setConfirmDeletePost(false);
      const formatted = formatFirestoreOrAppError(
        error,
        'You do not have permission to delete this post.'
      );
      if (
        kind === 'anonymous' &&
        viewerTier === 'moderator' &&
        /Permission denied/i.test(formatted)
      ) {
        setCardError(
          'This anonymous post cannot be removed by a Moderator under platform moderation rules.'
        );
      } else {
        setCardError(formatted);
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleQuickRemoveImage = async (imageId: string) => {
    if (!canEdit) return;
    setCardError(null);
    try {
      const updated = await removeSingleImageFromPost({
        kind: targetCollection,
        post,
        imageIdToRemove: imageId,
      });
      onPostUpdated(updated);
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(
          error,
          'Could not remove that photograph.'
        )
      );
    }
  };

  const handleAddComment = (
    text: string,
    parentCommentId?: string,
    replyToCommentId?: string
  ) => {
    setCardError(null);
    setGuestActionPrompt(null);
    if (!viewerUid) {
      setGuestActionPrompt('Sign in to post a comment or reply.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot post comments.');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    if (parentCommentId && isOptimisticTempId(parentCommentId)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setCardError(
        'You are offline. Your comment draft is saved safely — reconnect to post.'
      );
      return;
    }

    const lockKey = `${parentCommentId ?? 'root'}:${trimmed}`;
    if (commentSubmitLockRef.current.has(lockKey)) return;
    commentSubmitLockRef.current.add(lockKey);

    const tempId = createOptimisticTempId();
    const optimisticEntry = buildOptimisticCommentEntry({
      tempId,
      targetCollection,
      postId: post.id,
      actorUid: viewerUid,
      body: trimmed,
      parentCommentId,
      author: kind === 'ordinary' ? viewerAuthorProjection : null,
    });

    const previousCount = commentsCount;
    setComments((prev) => appendOptimisticCommentEntry(prev, optimisticEntry));
    setCommentsCountOverride({
      base: post.commentsCount,
      value: previousCount + 1,
    });
    onPostUpdated({ ...post, commentsCount: previousCount + 1 });

    if (parentCommentId) {
      setReplyBody('');
      setReplyingToId(null);
      setReplyTarget(null);
    } else {
      setNewCommentBody('');
    }

    const roleForWrite = viewerTier === 'guest' ? 'member' : viewerTier;
    void addPostComment({
      kind: targetCollection,
      postId: post.id,
      body: trimmed,
      parentCommentId,
      replyToCommentId,
      actorUid: viewerUid,
      actorRole: roleForWrite,
    })
      .then((result) => {
        setComments((prev) =>
          reconcileOptimisticCommentEntry(
            prev,
            tempId,
            result.comment,
            kind === 'ordinary' ? viewerAuthorProjection : null
          )
        );
        setCommentsCountOverride({
          base: post.commentsCount,
          value: result.commentsCount,
        });
        onPostUpdated({ ...post, commentsCount: result.commentsCount });
        if (parentCommentId) {
          void clearPersistentDraft(
            viewerKey,
            `post_reply:${kind}:${post.id}:${parentCommentId}`
          );
        } else {
          void clearPersistentDraft(
            viewerKey,
            `post_comment:${kind}:${post.id}`
          );
        }
        if (kind === 'anonymous') {
          onAnonymousCommentTracked?.(result.comment.id, 'add');
        }
      })
      .catch((error) => {
        setComments((prev) =>
          prev.filter((entry) => entry.comment.id !== tempId)
        );
        setCommentsCountOverride({
          base: post.commentsCount,
          value: previousCount,
        });
        onPostUpdated({ ...post, commentsCount: previousCount });
        if (parentCommentId) {
          setReplyingToId(parentCommentId);
          setReplyBody((curr) => curr || trimmed);
        } else {
          setNewCommentBody((curr) => curr || trimmed);
        }
        setCardError(
          formatFirestoreOrAppError(error, 'Could not post your comment.')
        );
      })
      .finally(() => {
        commentSubmitLockRef.current.delete(lockKey);
      });
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    if (
      !editingCommentBody.trim() ||
      commentActionBusyId ||
      isOptimisticTempId(commentId)
    ) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setCardError('You are offline. Reconnect to save your comment edit.');
      return;
    }
    const trimmed = editingCommentBody.trim();
    const prevComments = comments;
    setComments((prev) =>
      prev.map((entry) =>
        entry.comment.id === commentId
          ? {
              ...entry,
              comment: {
                ...entry.comment,
                body: trimmed,
                updatedAt: Date.now(),
              },
            }
          : entry
      )
    );
    setEditingCommentId(null);
    setEditingCommentBody('');
    setCommentActionBusyId(commentId);
    setCardError(null);
    try {
      await editPostComment({
        kind: targetCollection,
        commentId,
        body: trimmed,
      });
    } catch (error) {
      setComments(prevComments);
      setCardError(
        formatFirestoreOrAppError(error, 'Could not save comment edit.')
      );
    } finally {
      setCommentActionBusyId(null);
    }
  };

  const canModeratorDeleteOrdinaryComment = (
    targetComment: PostComment,
    targetAuthor: PublicProfileProjection | null
  ): boolean => {
    if (!viewerUid || viewerSuspended) return false;
    if (targetComment.ownerUID === viewerUid || isAdminOrOwner) return true;
    if (viewerTier === 'moderator' && targetAuthor) {
      return canModeratorDeleteByBadge(targetAuthor.badge);
    }
    return false;
  };

  const handleDeleteComment = (comment: PostComment | AnonymousComment) => {
    if (!viewerUid || commentActionBusyId || isOptimisticTempId(comment.id)) {
      return;
    }
    setCardError(null);

    const treeIds = collectCommentTreeIds(
      comments.map((entry) => entry.comment),
      comment.id
    ).filter((id) => id !== comment.id && !isOptimisticTempId(id));

    const entryById = new Map(
      comments.map((entry) => [entry.comment.id, entry])
    );

    const childReplyIds = treeIds.filter((replyId) => {
      const entry = entryById.get(replyId);
      if (!entry) return false;
      if (entry.comment.parentCommentId === comment.id) return true;
      if (kind === 'ordinary') {
        return canModeratorDeleteOrdinaryComment(
          entry.comment as PostComment,
          entry.author
        );
      }
      return isAdminOrOwner || Boolean(ownedAnonymousCommentIds?.has(replyId));
    });

    const deletedSet = new Set([comment.id, ...childReplyIds]);
    const { remaining, removed } = removeCommentTreeEntries(
      comments,
      deletedSet
    );
    const previousCount = commentsCount;

    setComments(remaining);
    setCommentsCountOverride({
      base: post.commentsCount,
      value: Math.max(0, previousCount - deletedSet.size),
    });
    onPostUpdated({
      ...post,
      commentsCount: Math.max(0, previousCount - deletedSet.size),
    });
    setCommentActionBusyId(comment.id);

    void deletePostComment({
      kind: targetCollection,
      postId: post.id,
      commentId: comment.id,
      replyIdsToRemove: childReplyIds,
      actorUid: viewerUid,
    })
      .then((nextCount) => {
        setCommentsCountOverride({ base: post.commentsCount, value: nextCount });
        onPostUpdated({ ...post, commentsCount: nextCount });
        if (kind === 'anonymous') {
          onAnonymousCommentTracked?.(comment.id, 'remove');
          for (const rId of childReplyIds) {
            onAnonymousCommentTracked?.(rId, 'remove');
          }
        }
      })
      .catch((error) => {
        setComments((curr) => restoreCommentEntriesOrdered(curr, removed));
        setCommentsCountOverride({
          base: post.commentsCount,
          value: previousCount,
        });
        onPostUpdated({ ...post, commentsCount: previousCount });
        const formatted = formatFirestoreOrAppError(
          error,
          'You do not have permission to delete that comment.'
        );
        if (
          kind === 'anonymous' &&
          viewerTier === 'moderator' &&
          /Permission denied/i.test(formatted)
        ) {
          setCardError(
            'This anonymous comment cannot be removed by a Moderator under platform moderation rules.'
          );
        } else {
          setCardError(formatted);
        }
      })
      .finally(() => {
        setCommentActionBusyId(null);
      });
  };

  const handleRevealAuthor = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!viewerUid || !canRevealAnonymous || revealBusy) return;
    setRevealBusy(true);
    setCardError(null);
    try {
      const res = await revealAnonymousEntryAuthor({
        entryId: post.id,
        revealedByUid: viewerUid,
        reason: revealReason,
      });
      setRevealedAuthor(res);
      setRevealReason('');
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(
          error,
          'Unable to reveal anonymous author identity.'
        )
      );
    } finally {
      setRevealBusy(false);
    }
  };

  const handleToggleCommentLike = (
    comment: PostComment | AnonymousComment
  ) => {
    setCardError(null);
    setGuestActionPrompt(null);
    if (!viewerUid) {
      setGuestActionPrompt('Sign in to like comments and replies.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot react to comments.');
      return;
    }
    if (
      isOptimisticTempId(comment.id) ||
      commentLikeInFlightRef.current.has(comment.id)
    ) {
      return;
    }

    commentLikeInFlightRef.current.add(comment.id);
    const prevLikedSet = new Set(likedCommentIds);
    const prevCountsMap = { ...commentLikesCounts };
    const baseCount = Number(comment.likesCount ?? 0);

    const optimistic = computeOptimisticCommentReactionMap({
      commentId: comment.id,
      likedSet: prevLikedSet,
      countsMap: prevCountsMap,
      baseCount,
    });

    // Immediate optimistic update
    setLikedCommentState({ uid: viewerUid, ids: optimistic.nextLikedSet });
    setCommentLikesCounts(optimistic.nextCountsMap);
    setComments((prev) =>
      prev.map((entry) =>
        entry.comment.id === comment.id
          ? {
              ...entry,
              comment: {
                ...entry.comment,
                likesCount: optimistic.nextCount,
              },
            }
          : entry
      )
    );

    const request =
      kind === 'anonymous'
        ? toggleAnonymousCommentReaction({
            commentId: comment.id,
            actorUid: viewerUid,
            currentlyLiked: prevLikedSet.has(comment.id),
          })
        : togglePostCommentReaction({
            commentId: comment.id,
            actorUid: viewerUid,
          });

    void request
      .then((res) => {
        setLikedCommentState((prev) => {
          const base = prev.uid === viewerUid ? prev.ids : new Set<string>();
          const next = new Set(base);
          if (res.liked) next.add(comment.id);
          else next.delete(comment.id);
          return { uid: viewerUid, ids: next };
        });
        setCommentLikesCounts((prev) => ({
          ...prev,
          [comment.id]: res.likesCount,
        }));
        setComments((prev) =>
          prev.map((entry) =>
            entry.comment.id === comment.id
              ? {
                  ...entry,
                  comment: {
                    ...entry.comment,
                    likesCount: res.likesCount,
                  },
                }
              : entry
          )
        );
      })
      .catch((error) => {
        // Rollback on failure
        setLikedCommentState({ uid: viewerUid, ids: prevLikedSet });
        setCommentLikesCounts(prevCountsMap);
        setComments((prev) =>
          prev.map((entry) =>
            entry.comment.id === comment.id
              ? {
                  ...entry,
                  comment: {
                    ...entry.comment,
                    likesCount: baseCount,
                  },
                }
              : entry
          )
        );
        setCardError(
          formatFirestoreOrAppError(
            error,
            'Could not update comment like right now.'
          )
        );
      })
      .finally(() => {
        commentLikeInFlightRef.current.delete(comment.id);
      });
  };

  const loadedCommentIds = new Set(comments.map((entry) => entry.comment.id));
  const topLevelComments = comments.filter(
    (entry) =>
      !entry.comment.parentCommentId ||
      !loadedCommentIds.has(entry.comment.parentCommentId)
  );
  const repliesByParent = new Map<string, CommentWithAuthor[]>();
  for (const entry of comments) {
    if (
      entry.comment.parentCommentId &&
      loadedCommentIds.has(entry.comment.parentCommentId)
    ) {
      const list = repliesByParent.get(entry.comment.parentCommentId) ?? [];
      list.push(entry);
      repliesByParent.set(entry.comment.parentCommentId, list);
    }
  }

  return (
    <article
      ref={articleRef}
      id={`post-${post.id}`}
      className={`min-w-0 max-w-full overflow-hidden rounded-2xl border bg-white p-4 shadow-xs transition-colors sm:p-5 dark:bg-slate-900 ${
        isHighlighted && !highlightCommentId
          ? 'border-[#1E88E5] ring-2 ring-[#1E88E5]/25'
          : 'border-slate-200 dark:border-slate-800'
      }`}
      data-testid={`post-card-${post.id}`}
    >
      {/* Header Row: Author / Anonymous Identity + Category + Timestamp */}
      <div className="flex items-start justify-between gap-3">
        {kind === 'ordinary' ? (
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() =>
                author?.username && onNavigateProfile?.(author.username)
              }
              disabled={!author?.username}
              className="shrink-0"
              aria-label={
                author ? `View ${author.fullName}'s profile` : 'Member profile'
              }
            >
              <AvatarMedia
                fullName={author?.fullName || 'Campus Contributor'}
                photoImageId={author?.photoImageId}
                photoUrl={author?.photoUrl}
                sizeClass="h-10 w-10"
              />
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {author ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onNavigateProfile?.(author.username)}
                      className="inline-flex min-w-0 items-center text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5] dark:text-slate-100 dark:hover:text-sky-400"
                    >
                      <span className="truncate">{author.fullName}</span>
                    </button>
                    <ProfileBadgesRow profile={author} size="xs" />
                  </span>
                ) : (
                  <span className="text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    Campus Contributor
                  </span>
                )}

                {author && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    @{author.username}
                  </span>
                )}

                {author?.username && (
                  <TikTokFollowButton
                    targetUsername={author.username}
                    compact
                    onRequireAuth={() => onRequireAuth('login', returnRoute)}
                  />
                )}
              </div>

              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{post.category}</span>
                {'isOfficial' in post && post.isOfficial && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-semibold text-[#1E88E5] dark:text-sky-400">
                      Official Update
                    </span>
                  </>
                )}
                {'isPinned' in post && post.isPinned && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">Pinned</span>
                  </>
                )}
                <span aria-hidden="true"> · </span>
                <span>{formatPostTimestamp(post.createdAt)}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-white dark:bg-slate-800">
              <Shield className="h-4 w-4 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                Anonymous
                {isOwnedAnonymous ? ' (You)' : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{post.category}</span>
                <span aria-hidden="true"> · </span>
                <span>Identity hidden</span>
                <span aria-hidden="true"> · </span>
                <span>{formatPostTimestamp(post.createdAt)}</span>
              </p>
            </div>
          </div>
        )}

        {/* Share + Permitted Edit / Delete / Supreme Admin Reveal Triggers */}
        <div className="flex shrink-0 items-center gap-1">
          <ShareActionMenu
            shareUrl={buildPostShareUrl(kind, post.id)}
            title={
              'title' in post && post.title?.trim()
                ? post.title.trim()
                : kind === 'anonymous'
                ? `Anonymous post on LASUED Intel (${post.category})`
                : `Post by ${author?.fullName || 'LASUED member'} on LASUED Intel`
            }
            text={
              post.body.trim().slice(0, 120) ||
              (kind === 'anonymous'
                ? 'Anonymous post on LASUED Intel'
                : 'LASUED Intel campus post')
            }
            align="right"
            ariaLabel="Share post"
            testId={`post-share-btn-${post.id}`}
          />
          {kind === 'anonymous' && canRevealAnonymous && (
            <button
              type="button"
              onClick={() => setRevealOpen((prev) => !prev)}
              aria-label="Reveal anonymous identity (Supreme Admin)"
              title="Reveal identity (logged to audit)"
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#1565C0] hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/50"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Audit</span>
            </button>
          )}
          {canEdit && onEditPost && (
            <button
              type="button"
              onClick={() => onEditPost(post)}
              aria-label="Edit post"
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirmDeletePost((prev) => !prev)}
              aria-label="Delete post"
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Delete Post Confirmation */}
      {confirmDeletePost && (
        <div className="mt-3 flex flex-col justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 sm:flex-row sm:items-center dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <span>
            Delete this post along with its comments and photos?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => void handleDeletePost()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {deleteBusy && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              )}
              Confirm Delete
            </button>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => setConfirmDeletePost(false)}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Supreme Admin Identity Audit Form */}
      {kind === 'anonymous' && canRevealAnonymous && revealOpen && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs dark:border-sky-900/60 dark:bg-sky-950/40">
          <form onSubmit={handleRevealAuthor} className="space-y-2">
            <label className="block font-semibold text-[#0B1A2E] dark:text-slate-100">
              Admin Audit Reveal (logged)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                minLength={5}
                maxLength={BLUEPRINT_LIMITS.auditReasonMax}
                value={revealReason}
                onChange={(e) => setRevealReason(e.target.value)}
                placeholder="Reason for safety review (min 5 chars)..."
                className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs text-[#0B1A2E] dark:border-sky-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={revealBusy || revealReason.trim().length < 5}
                className="lasued-accent-gradient inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {revealBusy && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                )}
                Reveal Identity
              </button>
            </div>
          </form>
          {revealedAuthor && (
            <p className="mt-2 font-medium text-[#0B1A2E] dark:text-slate-100">
              Author:{' '}
              {revealedAuthor.profile
                ? `${revealedAuthor.profile.fullName} (@${revealedAuthor.profile.username})`
                : revealedAuthor.authorUid}{' '}
              · Role: {revealedAuthor.authorRole}
            </p>
          )}
        </div>
      )}

      {/* Post Body & Media Presentation (Strictly separated per post format) */}
      {kind === 'ordinary' ? (
        ordinaryPostType === 'text' ? (
          isStyledOrdinaryText && ordinaryTextTheme ? (
            <div
              className="mt-3.5 flex min-h-[168px] flex-col items-center justify-center rounded-xl p-6 text-center"
              style={{ background: ordinaryTextTheme.backgroundCss }}
              data-testid={`ordinary-text-card-${ordinaryTextTheme.id}`}
            >
              {'title' in post && post.title && (
                <h2
                  className={`overflow-wrap-anywhere mb-2 max-w-full font-display text-base font-bold sm:text-lg ${ordinaryTextTheme.textColorClass}`}
                >
                  {post.title}
                </h2>
              )}
              {post.body.trim().length > 0 && (
                <LinkifiedText
                  text={post.body}
                  tone={ordinaryTextTheme.isDark ? 'on-dark' : 'on-light-card'}
                  className={`overflow-wrap-anywhere max-w-full whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${ordinaryTextTheme.textColorClass}`}
                />
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {'title' in post && post.title && (
                <h2 className="overflow-wrap-anywhere font-display text-base font-bold text-[#0B1A2E] dark:text-slate-100">
                  {post.title}
                </h2>
              )}
              {post.body.trim().length > 0 && (
                <LinkifiedText
                  text={post.body}
                  className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                />
              )}
            </div>
          )
        ) : (
          /* Ordinary Photo Post: Shared Caption ABOVE Photos, Zero Coloured Backgrounds, Zero Per-Photo Captions */
          <div className="mt-3 space-y-3" data-testid="ordinary-photo-post-body">
            {('title' in post && post.title) || post.body.trim().length > 0 ? (
              <div className="space-y-1.5">
                {'title' in post && post.title && (
                  <h2 className="overflow-wrap-anywhere font-display text-base font-bold text-[#0B1A2E] dark:text-slate-100">
                    {post.title}
                  </h2>
                )}
                {post.body.trim().length > 0 && (
                  <LinkifiedText
                    text={post.body}
                    className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                  />
                )}
              </div>
            ) : null}

            {gridItems.length > 0 && (
              <SquareImageGrid
                items={gridItems}
                postLabel={author?.fullName || 'Community post'}
                showPerPhotoCaptions={false}
                onImageClick={(index) => setLightboxIndex(index)}
                onRemoveImage={
                  canEdit && gridItems.length > 1
                    ? (imageId) => void handleQuickRemoveImage(imageId)
                    : undefined
                }
              />
            )}
          </div>
        )
      ) : anonPostType === 'photo' ? (
        /* Anonymous Photo Post: Shared Caption ABOVE Photos, Zero Coloured Backgrounds */
        <div className="mt-3 space-y-3" data-testid="anon-photo-post-body">
          {post.body.trim().length > 0 && (
            <LinkifiedText
              text={post.body}
              className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
            />
          )}
          {gridItems.length > 0 && (
            <SquareImageGrid
              items={gridItems}
              postLabel="Anonymous post"
              showPerPhotoCaptions={hasLegacyPerPhotoCaptions}
              onImageClick={(index) => setLightboxIndex(index)}
              onRemoveImage={
                canEdit &&
                (gridItems.length > 1 || post.body.trim().length > 0)
                  ? (imageId) => void handleQuickRemoveImage(imageId)
                  : undefined
              }
            />
          )}
        </div>
      ) : isStyledAnonText && anonTheme ? (
        /* Anonymous Text-Only Post with Styled Background */
        <div
          className="mt-3.5 flex min-h-[168px] items-center justify-center rounded-xl p-6 text-center"
          style={{ background: anonTheme.backgroundCss }}
          data-testid={`anon-styled-card-${anonTheme.id}`}
        >
          <LinkifiedText
            text={post.body}
            tone={anonTheme.isDark ? 'on-dark' : 'on-light-card'}
            className={`overflow-wrap-anywhere max-w-full whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${anonTheme.textColorClass}`}
          />
        </div>
      ) : (
        /* Anonymous Text-Only Post (Plain / Default) */
        <div className="mt-3 space-y-1.5">
          {post.body.trim().length > 0 && (
            <LinkifiedText
              text={post.body}
              className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
            />
          )}
        </div>
      )}

      {cardError && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {cardError}
        </div>
      )}

      {guestActionPrompt && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-200">
          <span>{guestActionPrompt}</span>
          <button
            type="button"
            onClick={() => onRequireAuth('login', returnRoute)}
            className="font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Post Actions Footer: Left = View Counter | Right = Save -> Like -> Comment */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <div
          className="inline-flex min-h-[36px] items-center gap-1.5 px-1 text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400"
          title="Unique post views"
        >
          <Eye className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <span>{formatCompactViewCount(effectiveViewsCount)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={handleToggleSave}
            aria-pressed={savedState}
            aria-label={savedState ? 'Remove bookmark' : 'Save post'}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
              savedState
                ? 'lasued-accent-gradient text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Bookmark
              className={`h-4 w-4 ${savedState ? 'fill-white' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              {savedState ? 'Saved' : 'Save'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleToggleLike}
            aria-pressed={likedState}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
              likedState
                ? 'bg-[#1E88E5]/10 text-[#1E88E5] dark:bg-sky-500/15 dark:text-sky-400'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Heart
              className={`h-4 w-4 ${likedState ? 'fill-[#1E88E5] dark:fill-sky-400' : ''}`}
              aria-hidden="true"
            />
            <span className="tabular-nums">{likesCount}</span>
            <span>{likedState ? 'Liked' : 'Like'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleComments}
            aria-expanded={commentsOpen}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E] sm:px-3 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{commentsCount}</span>
            <span>Comments</span>
            {commentsOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          {onOpenPost && (
            <button
              type="button"
              onClick={() => onOpenPost(post.id)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:border-[#1E88E5] hover:text-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-400 dark:hover:text-sky-400"
            >
              Open Post
            </button>
          )}
        </div>
      </div>

      {/* Expandable Comments & Nested Replies Drawer */}
      {commentsOpen && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {/* Add Top-Level Comment */}
          <div className="flex items-start gap-2">
            <input
              type="text"
              maxLength={BLUEPRINT_LIMITS.commentBodyMax}
              value={newCommentBody}
              onChange={(e) => setNewCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddComment(newCommentBody);
                }
              }}
              placeholder={
                kind === 'anonymous'
                  ? 'Add an anonymous comment...'
                  : 'Write a comment...'
              }
              className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
            <button
              type="button"
              disabled={!newCommentBody.trim()}
              onClick={() => handleAddComment(newCommentBody)}
              className="lasued-action-gradient inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5 text-white" aria-hidden="true" />
              Post
            </button>
          </div>

          {commentsLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
              Loading comments...
            </div>
          ) : topLevelComments.length === 0 ? (
            <p className="py-1 text-xs text-slate-500 dark:text-slate-400">
              No comments yet. Start the conversation.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topLevelComments.map(({ comment, author: commentAuthor }) => {
                const replies = repliesByParent.get(comment.id) ?? [];
                const canModifyComment =
                  !viewerSuspended &&
                  Boolean(viewerUid) &&
                  (kind === 'ordinary'
                    ? (comment as PostComment).ownerUID === viewerUid
                    : Boolean(ownedAnonymousCommentIds?.has(comment.id)));
                const canDeleteComment =
                  !viewerSuspended &&
                  Boolean(viewerUid) &&
                  (kind === 'ordinary'
                    ? canModeratorDeleteOrdinaryComment(
                        comment as PostComment,
                        commentAuthor
                      )
                    : canModifyComment ||
                      isAdminOrOwner ||
                      viewerTier === 'moderator');

                const isCommentHighlighted = highlightCommentId === comment.id;

                return (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={`rounded-xl border p-3 transition-colors ${
                      isCommentHighlighted
                        ? 'border-[#1E88E5] bg-[#1E88E5]/5 ring-2 ring-[#1E88E5]/20 dark:bg-sky-950/30'
                        : 'border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {kind === 'ordinary' && commentAuthor ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateProfile?.(commentAuthor.username)
                                }
                                className="font-bold text-[#0B1A2E] hover:text-[#1E88E5] dark:text-slate-100 dark:hover:text-sky-400"
                              >
                                {commentAuthor.fullName}
                              </button>
                              <ProfileBadgesRow profile={commentAuthor} size="xs" />
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateProfile?.(commentAuthor.username)
                              }
                              className="font-normal text-slate-500 hover:text-[#1E88E5] dark:text-slate-400 dark:hover:text-sky-400"
                            >
                              @{commentAuthor.username}
                            </button>
                            <TikTokFollowButton
                              targetUsername={commentAuthor.username}
                              compact
                              onRequireAuth={() =>
                                onRequireAuth('login', returnRoute)
                              }
                            />
                          </>
                        ) : (
                          <span className="font-bold text-[#0B1A2E] dark:text-slate-100">
                            {kind === 'anonymous'
                              ? ownedAnonymousCommentIds?.has(comment.id)
                                ? 'Anonymous (You)'
                                : 'Anonymous'
                              : 'Campus Member'}
                          </span>
                        )}
                        <span className="text-slate-400 dark:text-slate-500">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {formatPostTimestamp(comment.createdAt)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={isOptimisticTempId(comment.id)}
                          onClick={() => handleToggleCommentLike(comment)}
                          aria-pressed={likedCommentIds.has(comment.id)}
                          className={`inline-flex items-center gap-1 font-semibold ${
                            likedCommentIds.has(comment.id)
                              ? 'text-[#1E88E5] dark:text-sky-400'
                              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          <Heart
                            className={`h-3 w-3 ${
                              likedCommentIds.has(comment.id)
                                ? 'fill-[#1E88E5] dark:fill-sky-400'
                                : ''
                            }`}
                            aria-hidden="true"
                          />
                          <span className="tabular-nums">
                            {commentLikesCounts[comment.id] ??
                              Number(comment.likesCount ?? 0)}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isOptimisticTempId(comment.id)}
                          onClick={() => {
                            if (!viewerUid) {
                              setGuestActionPrompt(
                                'Sign in to reply to comments.'
                              );
                              return;
                            }
                            setReplyingToId((prev) =>
                              prev === comment.id ? null : comment.id
                            );
                            setReplyTarget(null);
                            setReplyBody('');
                          }}
                          className="font-semibold text-[#1E88E5] hover:underline disabled:opacity-50 dark:text-sky-400"
                        >
                          Reply
                        </button>
                        {canModifyComment && !isOptimisticTempId(comment.id) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditingCommentBody(comment.body);
                            }}
                            className="font-semibold text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteComment && !isOptimisticTempId(comment.id) && (
                          <button
                            type="button"
                            disabled={commentActionBusyId === comment.id}
                            onClick={() => handleDeleteComment(comment)}
                            className="font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {editingCommentId === comment.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingCommentBody}
                          maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                          onChange={(e) => setEditingCommentBody(e.target.value)}
                          className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          disabled={commentActionBusyId === comment.id}
                          onClick={() => void handleSaveCommentEdit(comment.id)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#1E88E5] px-2.5 text-xs font-semibold text-white"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCommentId(null)}
                          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <LinkifiedText
                        text={comment.body}
                        className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300"
                      />
                    )}

                    {/* Reply Input */}
                    {replyingToId === comment.id && (
                      <div className="mt-2 space-y-1.5 pl-4">
                        {replyTarget?.parentCommentId === comment.id &&
                          replyTarget.label && (
                            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                              <span>
                                Replying to{' '}
                                <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">
                                  {replyTarget.label}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setReplyTarget(null)}
                                className="font-semibold text-slate-500 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={replyBody}
                            maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                            onChange={(e) => setReplyBody(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleAddComment(
                                  replyBody,
                                  comment.id,
                                  replyTarget?.parentCommentId === comment.id
                                    ? replyTarget.replyToCommentId
                                    : undefined
                                );
                              }
                            }}
                            placeholder={
                              replyTarget?.parentCommentId === comment.id &&
                              replyTarget.label
                                ? `Reply to ${replyTarget.label}...`
                                : 'Write a reply...'
                            }
                            className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                          />
                          <button
                            type="button"
                            disabled={!replyBody.trim()}
                            onClick={() =>
                              handleAddComment(
                                replyBody,
                                comment.id,
                                replyTarget?.parentCommentId === comment.id
                                  ? replyTarget.replyToCommentId
                                  : undefined
                              )
                            }
                            className="min-h-[36px] rounded-lg bg-[#0B1A2E] px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Nested Replies */}
                    {replies.length > 0 && (
                      <div className="mt-2.5 space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                        {replies.map(
                          ({ comment: reply, author: replyAuthor }) => {
                            const canModifyReply =
                              !viewerSuspended &&
                              Boolean(viewerUid) &&
                              (kind === 'ordinary'
                                ? (reply as PostComment).ownerUID === viewerUid
                                : Boolean(
                                    ownedAnonymousCommentIds?.has(reply.id)
                                  ));
                            const canDeleteReply =
                              !viewerSuspended &&
                              Boolean(viewerUid) &&
                              (kind === 'ordinary'
                                ? canModeratorDeleteOrdinaryComment(
                                    reply as PostComment,
                                    replyAuthor
                                  )
                                : canModifyReply ||
                                  isAdminOrOwner ||
                                  viewerTier === 'moderator');

                            const isReplyHighlighted =
                              highlightCommentId === reply.id;

                            return (
                              <div
                                key={reply.id}
                                id={`comment-${reply.id}`}
                                className={`rounded-lg p-2.5 transition-colors ${
                                  isReplyHighlighted
                                    ? 'border border-[#1E88E5] bg-[#1E88E5]/5 ring-2 ring-[#1E88E5]/20 dark:bg-sky-950/30'
                                    : 'bg-white dark:bg-slate-900/90'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <CornerDownRight
                                      className="h-3 w-3 text-slate-400 dark:text-slate-500"
                                      aria-hidden="true"
                                    />
                                    {kind === 'ordinary' && replyAuthor ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onNavigateProfile?.(
                                              replyAuthor.username
                                            )
                                          }
                                          className="font-bold text-[#0B1A2E] hover:text-[#1E88E5] dark:text-slate-100 dark:hover:text-sky-400"
                                        >
                                          {replyAuthor.fullName}
                                        </button>
                                        <ProfileBadgesRow
                                          profile={replyAuthor}
                                          size="xs"
                                        />
                                        <TikTokFollowButton
                                          targetUsername={replyAuthor.username}
                                          compact
                                          onRequireAuth={() =>
                                            onRequireAuth('login', returnRoute)
                                          }
                                        />
                                      </>
                                    ) : (
                                      <span className="font-bold text-[#0B1A2E] dark:text-slate-100">
                                        {kind === 'anonymous'
                                          ? ownedAnonymousCommentIds?.has(
                                              reply.id
                                            )
                                            ? 'Anonymous (You)'
                                            : 'Anonymous'
                                          : 'Campus Member'}
                                      </span>
                                    )}
                                    <span className="text-slate-400 dark:text-slate-500">·</span>
                                    <span className="text-slate-500 dark:text-slate-400">
                                      {formatPostTimestamp(reply.createdAt)}
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={isOptimisticTempId(reply.id)}
                                      onClick={() => handleToggleCommentLike(reply)}
                                      aria-pressed={likedCommentIds.has(reply.id)}
                                      className={`inline-flex items-center gap-1 font-semibold ${
                                        likedCommentIds.has(reply.id)
                                          ? 'text-[#1E88E5] dark:text-sky-400'
                                          : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white'
                                      }`}
                                    >
                                      <Heart
                                        className={`h-3 w-3 ${
                                          likedCommentIds.has(reply.id)
                                            ? 'fill-[#1E88E5] dark:fill-sky-400'
                                            : ''
                                        }`}
                                        aria-hidden="true"
                                      />
                                      <span className="tabular-nums">
                                        {commentLikesCounts[reply.id] ??
                                          Number(reply.likesCount ?? 0)}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isOptimisticTempId(reply.id)}
                                      onClick={() => {
                                        if (!viewerUid) {
                                          setGuestActionPrompt(
                                            'Sign in to reply to comments.'
                                          );
                                          return;
                                        }
                                        const mentionPrefix =
                                          kind === 'ordinary' && replyAuthor
                                            ? `@${replyAuthor.username} `
                                            : '';
                                        setReplyingToId(comment.id);
                                        setReplyTarget({
                                          parentCommentId: comment.id,
                                          replyToCommentId: reply.id,
                                          label:
                                            kind === 'ordinary' && replyAuthor
                                              ? `@${replyAuthor.username}`
                                              : 'anonymous reply',
                                        });
                                        if (mentionPrefix) {
                                          setReplyBody((curr) =>
                                            curr.trim() ? curr : mentionPrefix
                                          );
                                        }
                                      }}
                                      className="font-semibold text-[#1E88E5] hover:underline disabled:opacity-50 dark:text-sky-400"
                                    >
                                      Reply
                                    </button>
                                    {canModifyReply &&
                                      !isOptimisticTempId(reply.id) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCommentId(reply.id);
                                            setEditingCommentBody(reply.body);
                                          }}
                                          className="font-semibold text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
                                        >
                                          Edit
                                        </button>
                                      )}
                                    {canDeleteReply &&
                                      !isOptimisticTempId(reply.id) && (
                                        <button
                                          type="button"
                                          disabled={
                                            commentActionBusyId === reply.id
                                          }
                                          onClick={() =>
                                            handleDeleteComment(reply)
                                          }
                                          className="font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                                        >
                                          Delete
                                        </button>
                                      )}
                                  </div>
                                </div>

                                {editingCommentId === reply.id ? (
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={editingCommentBody}
                                      maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                                      onChange={(e) =>
                                        setEditingCommentBody(e.target.value)
                                      }
                                      className="min-h-[34px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleSaveCommentEdit(reply.id)
                                      }
                                      className="min-h-[34px] rounded-lg bg-[#1E88E5] px-2.5 text-xs font-semibold text-white"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <LinkifiedText
                                    text={reply.body}
                                    className="mt-1 whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300"
                                  />
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {hasMoreComments && (
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={loadingMoreComments}
                    onClick={() => void handleLoadMoreComments()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    {loadingMoreComments && (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    )}
                    Load more comments
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {lightboxIndex !== null && gridItems.length > 0 && (
        <FullScreenImageLightbox
          items={gridItems}
          initialIndex={lightboxIndex}
          postTitle={'title' in post ? post.title : undefined}
          postCaption={post.body.trim() || undefined}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  );
};

export const PostCard = React.memo(PostCardComponent);

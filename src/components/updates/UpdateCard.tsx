import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Edit3,
  Heart,
  Loader2,
  MessageCircle,
  MoreVertical,
  Pin,
  Send,
  Trash2,
} from 'lucide-react';
import { getTextPostBackgroundTheme } from '../../config/anonymousBackgrounds';
import { buildUpdateShareUrl } from '../../config/site';
import { useFirebase } from '../../context/firebaseContext';
import {
  addOfficialUpdateComment,
  deleteOfficialUpdateCascading,
  deleteOfficialUpdateComment,
  editOfficialUpdateComment,
  fetchOfficialUpdateComments,
  toggleOfficialUpdatePin,
  toggleOfficialUpdateReaction,
} from '../../services/adminUpdates';
import { togglePostCommentReaction } from '../../services/events';
import {
  fetchViewerLikedPostIds,
  toggleSavedPost,
  type CommentWithAuthor,
} from '../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  collectCommentTreeIds,
  resolveAdminUpdateFormat,
  type AdminUpdate,
  type PostComment,
  type PublicProfileProjection,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
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
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { AvatarMedia } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';
import { ShareActionMenu } from '../shared/ShareActionMenu';

const CATEGORY_LABELS: Record<string, string> = {
  announcement: 'Announcement',
  academic: 'Academic',
  campus_life: 'Campus Life',
  security: 'Security Notice',
  urgent: 'Urgent',
};

function formatUpdateTimestamp(value: unknown): string {
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

export interface UpdateCardProps {
  update: AdminUpdate;
  author?: PublicProfileProjection | null;
  viewerUid: string | null;
  viewerTier: EffectiveAccountTier;
  viewerSuspended: boolean;
  isLiked: boolean;
  isSaved?: boolean;
  defaultCommentsOpen?: boolean;
  isHighlighted?: boolean;
  highlightCommentId?: string | null;
  onEditUpdate?: (update: AdminUpdate) => void;
  onUpdateMutated?: (updated: AdminUpdate) => void;
  onUpdateDeleted?: (updateId: string) => void;
  onSaveChanged?: (updateId: string, saved: boolean) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  returnRoute?: ActiveRoute;
}

export const UpdateCard: React.FC<UpdateCardProps> = ({
  update,
  author = null,
  viewerUid,
  viewerTier,
  viewerSuspended,
  isLiked,
  isSaved = false,
  defaultCommentsOpen = false,
  isHighlighted = false,
  highlightCommentId = null,
  onEditUpdate,
  onUpdateMutated,
  onUpdateDeleted,
  onSaveChanged,
  onNavigateProfile,
  onRequireAuth,
  returnRoute = 'updates',
}) => {
  const { profile: viewerProfile } = useFirebase();
  const isSupremeAdmin = viewerTier === 'supreme_admin' && !viewerSuspended;
  const isModerator = viewerTier === 'moderator' && !viewerSuspended;

  const isOfficialDesk = update.authorMode === 'official_desk';
  const displayAuthorName =
    !isOfficialDesk && author?.fullName
      ? author.fullName
      : update.authorDisplayName;
  const displayAuthorImageId = !isOfficialDesk
    ? author?.photoImageId ?? update.authorPhotoImageId
    : undefined;
  const displayAuthorPhotoUrl = isOfficialDesk
    ? update.authorPhotoUrl || '/pwa-192x192.png'
    : author?.photoUrl ?? update.authorPhotoUrl;
  const displayBadge: 'supreme_admin' | 'verified' = isOfficialDesk
    ? 'verified'
    : update.authorBadge;

  const format = resolveAdminUpdateFormat(update);
  const textTheme =
    format === 'text' && update.backgroundStyle
      ? getTextPostBackgroundTheme(update.backgroundStyle)
      : null;
  const gridItems =
    format === 'photo'
      ? mediaMetaToGridItems(update.mediaItems)
      : [];

  const [likedOverride, setLikedOverride] = useState<{
    base: boolean;
    value: boolean;
  } | null>(null);
  const [likesCountOverride, setLikesCountOverride] = useState<{
    base: number;
    value: number;
  } | null>(null);
  const [savedOverride, setSavedOverride] = useState<{
    base: boolean;
    value: boolean;
  } | null>(null);
  const [commentsCountOverride, setCommentsCountOverride] = useState<{
    base: number;
    value: number;
  } | null>(null);

  const likedState =
    likedOverride && likedOverride.base === isLiked
      ? likedOverride.value
      : isLiked;
  const likesCount =
    likesCountOverride && likesCountOverride.base === update.likesCount
      ? likesCountOverride.value
      : update.likesCount;
  const savedState =
    savedOverride && savedOverride.base === isSaved
      ? savedOverride.value
      : isSaved;
  const commentsCount =
    commentsCountOverride && commentsCountOverride.base === update.commentsCount
      ? commentsCountOverride.value
      : update.commentsCount;

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [guestPrompt, setGuestPrompt] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set());
  const [commentLikesCounts, setCommentLikesCounts] = useState<
    Record<string, number>
  >({});

  const menuRef = useRef<HTMLDivElement | null>(null);
  const likeLockRef = useRef(false);
  const saveLockRef = useRef(false);
  const commentSubmitLockRef = useRef<Set<string>>(new Set());
  const commentLikeLockRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const loadComments = async () => {
    setCommentsLoading(true);
    try {
      const [fetchedComments, viewerLikes] = await Promise.all([
        fetchOfficialUpdateComments(update.id),
        viewerUid
          ? fetchViewerLikedPostIds('postComments', viewerUid).catch(
              () => new Set<string>()
            )
          : Promise.resolve(new Set<string>()),
      ]);
      setComments(fetchedComments);
      setLikedCommentIds(viewerLikes);
      const countMap: Record<string, number> = {};
      for (const entry of fetchedComments) {
        countMap[entry.comment.id] = Number(entry.comment.likesCount ?? 0);
      }
      setCommentLikesCounts(countMap);
      setCommentsLoaded(true);
    } catch (err) {
      setCardError(
        formatFirestoreOrAppError(err, 'Could not load comments right now.')
      );
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    if (!defaultCommentsOpen || commentsLoaded || commentsLoading) return;
    const timer = window.setTimeout(() => {
      void loadComments();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCommentsOpen, update.id]);

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && !commentsLoaded && !commentsLoading) {
      void loadComments();
    }
  };

  const handleToggleLike = () => {
    setCardError(null);
    setGuestPrompt(null);
    if (!viewerUid) {
      setGuestPrompt('Sign in to like official campus updates.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot react to updates.');
      return;
    }
    if (likeLockRef.current) return;
    likeLockRef.current = true;

    const prevLiked = likedState;
    const prevCount = likesCount;
    const { nextLiked, nextCount } = computeOptimisticReactionToggle({
      currentlyLiked: prevLiked,
      currentCount: prevCount,
    });

    setLikedOverride({ base: isLiked, value: nextLiked });
    setLikesCountOverride({ base: update.likesCount, value: nextCount });
    onUpdateMutated?.({ ...update, likesCount: nextCount });

    void toggleOfficialUpdateReaction({
      updateId: update.id,
      actorUid: viewerUid,
    })
      .then((res) => {
        setLikedOverride({ base: isLiked, value: res.liked });
        setLikesCountOverride({ base: update.likesCount, value: res.likesCount });
        onUpdateMutated?.({ ...update, likesCount: res.likesCount });
      })
      .catch((err) => {
        setLikedOverride({ base: isLiked, value: prevLiked });
        setLikesCountOverride({ base: update.likesCount, value: prevCount });
        onUpdateMutated?.({ ...update, likesCount: prevCount });
        setCardError(
          formatFirestoreOrAppError(err, 'Could not update your reaction.')
        );
      })
      .finally(() => {
        likeLockRef.current = false;
      });
  };

  const handleToggleSave = () => {
    setCardError(null);
    setGuestPrompt(null);
    if (!viewerUid) {
      setGuestPrompt('Sign in to bookmark official campus updates.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot save updates.');
      return;
    }
    if (saveLockRef.current) return;
    saveLockRef.current = true;

    const prevSaved = savedState;
    const nextSaved = !prevSaved;
    setSavedOverride({ base: isSaved, value: nextSaved });
    onSaveChanged?.(update.id, nextSaved);

    void toggleSavedPost({
      actorUid: viewerUid,
      targetCollection: 'updates',
      targetId: update.id,
      currentlySaved: prevSaved,
    })
      .then((res) => {
        setSavedOverride({ base: isSaved, value: res.saved });
        onSaveChanged?.(update.id, res.saved);
      })
      .catch((err) => {
        setSavedOverride({ base: isSaved, value: prevSaved });
        onSaveChanged?.(update.id, prevSaved);
        setCardError(
          formatFirestoreOrAppError(err, 'Could not update bookmark state.')
        );
      })
      .finally(() => {
        saveLockRef.current = false;
      });
  };

  const handleAddComment = (rawBody: string, parentCommentId?: string) => {
    setCardError(null);
    setGuestPrompt(null);
    if (!viewerUid) {
      setGuestPrompt('Sign in to comment on official updates.');
      return;
    }
    if (viewerSuspended) {
      setCardError('Suspended accounts cannot comment.');
      return;
    }
    const clean = rawBody.trim();
    if (!clean) return;
    const lockKey = parentCommentId ? `reply:${parentCommentId}` : 'top';
    if (commentSubmitLockRef.current.has(lockKey)) return;
    commentSubmitLockRef.current.add(lockKey);

    const tempId = createOptimisticTempId('upd_cmt');
    const viewerProj = viewerProfile
      ? toPublicProfileProjection(viewerProfile)
      : null;
    const optimisticEntry = buildOptimisticCommentEntry({
      tempId,
      targetCollection: 'updates',
      postId: update.id,
      actorUid: viewerUid,
      body: clean,
      parentCommentId,
      author: viewerProj,
    });

    const previousCount = commentsCount;
    setComments((prev) =>
      appendOptimisticCommentEntry(prev, optimisticEntry)
    );
    setCommentsCountOverride({
      base: update.commentsCount,
      value: previousCount + 1,
    });
    onUpdateMutated?.({ ...update, commentsCount: previousCount + 1 });

    if (parentCommentId) {
      setReplyingToId(null);
      setReplyBody('');
    } else {
      setNewCommentBody('');
    }

    void addOfficialUpdateComment({
      updateId: update.id,
      body: clean,
      parentCommentId,
      actorUid: viewerUid,
    })
      .then((res) => {
        setComments((prev) =>
          reconcileOptimisticCommentEntry(
            prev,
            tempId,
            res.comment,
            viewerProj
          )
        );
        setCommentsCountOverride({
          base: update.commentsCount,
          value: res.commentsCount,
        });
        onUpdateMutated?.({ ...update, commentsCount: res.commentsCount });
      })
      .catch((err) => {
        setComments((prev) =>
          prev.filter((entry) => entry.comment.id !== tempId)
        );
        setCommentsCountOverride({
          base: update.commentsCount,
          value: previousCount,
        });
        onUpdateMutated?.({ ...update, commentsCount: previousCount });
        setCardError(
          formatFirestoreOrAppError(err, 'Could not post comment.')
        );
      })
      .finally(() => {
        commentSubmitLockRef.current.delete(lockKey);
      });
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    if (!editingCommentBody.trim() || commentBusyId) return;
    const trimmed = editingCommentBody.trim();
    const prev = comments;
    setComments((curr) =>
      curr.map((e) =>
        e.comment.id === commentId
          ? {
              ...e,
              comment: { ...e.comment, body: trimmed, updatedAt: Date.now() },
            }
          : e
      )
    );
    setEditingCommentId(null);
    setEditingCommentBody('');
    setCommentBusyId(commentId);
    try {
      await editOfficialUpdateComment({ commentId, body: trimmed });
    } catch (err) {
      setComments(prev);
      setCardError(
        formatFirestoreOrAppError(err, 'Could not save comment edit.')
      );
    } finally {
      setCommentBusyId(null);
    }
  };

  const handleDeleteComment = (comment: PostComment) => {
    if (!viewerUid || commentBusyId || isOptimisticTempId(comment.id)) return;
    const treeIds = collectCommentTreeIds(
      comments.map((entry) => entry.comment),
      comment.id
    ).filter((id) => !isOptimisticTempId(id));

    const deletedSet = new Set(treeIds);
    const { remaining, removed } = removeCommentTreeEntries(
      comments,
      deletedSet
    );
    const prevCount = commentsCount;

    setComments(remaining);
    setCommentsCountOverride({
      base: update.commentsCount,
      value: Math.max(0, prevCount - deletedSet.size),
    });
    onUpdateMutated?.({
      ...update,
      commentsCount: Math.max(0, prevCount - deletedSet.size),
    });
    setCommentBusyId(comment.id);

    const replyIdsToRemove = treeIds.filter((id) => id !== comment.id);
    void deleteOfficialUpdateComment({
      updateId: update.id,
      commentId: comment.id,
      replyIdsToRemove,
    })
      .then((nextCount) => {
        setCommentsCountOverride({
          base: update.commentsCount,
          value: nextCount,
        });
        onUpdateMutated?.({ ...update, commentsCount: nextCount });
      })
      .catch((err) => {
        setComments((curr) => restoreCommentEntriesOrdered(curr, removed));
        setCommentsCountOverride({
          base: update.commentsCount,
          value: prevCount,
        });
        onUpdateMutated?.({ ...update, commentsCount: prevCount });
        setCardError(
          formatFirestoreOrAppError(err, 'Could not delete comment.')
        );
      })
      .finally(() => {
        setCommentBusyId(null);
      });
  };

  const handleToggleCommentLike = (comment: PostComment) => {
    if (!viewerUid) {
      setGuestPrompt('Sign in to like comments.');
      return;
    }
    if (viewerSuspended || isOptimisticTempId(comment.id)) return;
    if (commentLikeLockRef.current.has(comment.id)) return;
    commentLikeLockRef.current.add(comment.id);

    const prevLikedSet = new Set(likedCommentIds);
    const prevCountsMap = { ...commentLikesCounts };
    const optimistic = computeOptimisticCommentReactionMap({
      commentId: comment.id,
      likedSet: prevLikedSet,
      countsMap: prevCountsMap,
      baseCount: Number(comment.likesCount ?? 0),
    });

    setLikedCommentIds(optimistic.nextLikedSet);
    setCommentLikesCounts(optimistic.nextCountsMap);

    void togglePostCommentReaction({
      commentId: comment.id,
      actorUid: viewerUid,
    })
      .then((res) => {
        setLikedCommentIds((curr) => {
          const next = new Set(curr);
          if (res.liked) next.add(comment.id);
          else next.delete(comment.id);
          return next;
        });
        setCommentLikesCounts((curr) => ({
          ...curr,
          [comment.id]: res.likesCount,
        }));
      })
      .catch(() => {
        setLikedCommentIds(prevLikedSet);
        setCommentLikesCounts(prevCountsMap);
      })
      .finally(() => {
        commentLikeLockRef.current.delete(comment.id);
      });
  };

  const handleTogglePin = async () => {
    if (!isSupremeAdmin || !viewerUid || adminActionBusy) return;
    setMenuOpen(false);
    setAdminActionBusy(true);
    setCardError(null);
    try {
      const updated = await toggleOfficialUpdatePin({
        update,
        actorUid: viewerUid,
        actorRole: 'supreme_admin',
      });
      onUpdateMutated?.(updated);
    } catch (err) {
      setCardError(
        formatFirestoreOrAppError(err, 'Could not change pin status.')
      );
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleDeleteUpdate = async () => {
    if (!isSupremeAdmin || !viewerUid || adminActionBusy) return;
    setAdminActionBusy(true);
    setCardError(null);
    try {
      await deleteOfficialUpdateCascading({
        updateId: update.id,
        likesCount: update.likesCount ?? 0,
        mediaImageIds: (update.mediaItems ?? []).map((m) => m.imageId),
        actorUid: viewerUid,
        actorRole: 'supreme_admin',
        targetLabel: update.title || update.body.slice(0, 120),
      });
      onUpdateDeleted?.(update.id);
    } catch (err) {
      setCardError(
        formatFirestoreOrAppError(err, 'Could not delete official update.')
      );
    } finally {
      setAdminActionBusy(false);
    }
  };

  const loadedIds = new Set(comments.map((c) => c.comment.id));
  const topComments = comments.filter(
    (entry) =>
      !entry.comment.parentCommentId ||
      !loadedIds.has(entry.comment.parentCommentId)
  );
  const repliesByParent = new Map<string, CommentWithAuthor[]>();
  for (const entry of comments) {
    if (
      entry.comment.parentCommentId &&
      loadedIds.has(entry.comment.parentCommentId)
    ) {
      const list = repliesByParent.get(entry.comment.parentCommentId) ?? [];
      list.push(entry);
      repliesByParent.set(entry.comment.parentCommentId, list);
    }
  }

  const shareUrl = buildUpdateShareUrl(update.id);
  const shareTitle = update.title?.trim() || `Official Update · ${displayAuthorName}`;
  const shareText = update.body.trim().slice(0, 140) || shareTitle;

  return (
    <article
      id={`update-${update.id}`}
      data-testid={`update-card-${update.id}`}
      className={`min-w-0 max-w-full overflow-hidden rounded-2xl border bg-white p-4 shadow-xs transition-colors sm:p-5 ${
        isHighlighted
          ? 'border-[#1E88E5] ring-2 ring-[#1E88E5]/25'
          : 'border-slate-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {isOfficialDesk ? (
            <img
              src={displayAuthorPhotoUrl || '/pwa-192x192.png'}
              alt={displayAuthorName}
              className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-[#0B1A2E] object-cover"
            />
          ) : (
            <button
              type="button"
              disabled={!author?.username}
              onClick={() =>
                author?.username && onNavigateProfile?.(author.username)
              }
              className="shrink-0"
              aria-label={`View ${displayAuthorName}'s profile`}
            >
              <AvatarMedia
                fullName={displayAuthorName}
                photoImageId={displayAuthorImageId}
                photoUrl={displayAuthorPhotoUrl}
                sizeClass="h-10 w-10"
              />
            </button>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {!isOfficialDesk && author?.username ? (
                <button
                  type="button"
                  onClick={() => onNavigateProfile?.(author.username)}
                  className="truncate text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                >
                  {displayAuthorName}
                </button>
              ) : (
                <span className="truncate text-sm font-bold text-[#0B1A2E]">
                  {displayAuthorName}
                </span>
              )}

              <RoleBadge badge={displayBadge} size="xs" />

              {!isOfficialDesk && author?.username && (
                <span className="text-xs text-slate-500">
                  @{author.username}
                </span>
              )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold text-[#1E88E5]">
                {CATEGORY_LABELS[update.category] ?? update.category}
              </span>
              {update.isPinned && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#0B1A2E]">
                    <Pin className="h-3 w-3 text-[#1E88E5]" aria-hidden="true" />
                    Pinned
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{formatUpdateTimestamp(update.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Share + Supreme Admin Menu */}
        <div className="flex shrink-0 items-center gap-1">
          <ShareActionMenu
            shareUrl={shareUrl}
            title={shareTitle}
            text={shareText}
            ariaLabel={`Share official update: ${shareTitle}`}
            testId={`update-share-btn-${update.id}`}
          />

          {isSupremeAdmin && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                disabled={adminActionBusy}
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label="Administrator update options"
                aria-expanded={menuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E] disabled:opacity-50"
              >
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </button>

              {menuOpen && (
                <div className="absolute top-full right-0 z-30 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  {onEditUpdate && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEditUpdate(update);
                      }}
                      className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-[#1E88E5]" />
                      <span>Edit update</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleTogglePin()}
                    className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
                  >
                    <Pin className="h-3.5 w-3.5 text-[#1E88E5]" />
                    <span>{update.isPinned ? 'Unpin update' : 'Pin to top'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                    className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete update</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inline Delete Confirmation */}
      {confirmDelete && isSupremeAdmin && (
        <div className="mt-3 flex flex-col justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 sm:flex-row sm:items-center">
          <span>
            Permanently delete this official update and its attached media and
            comments?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={adminActionBusy}
              onClick={() => void handleDeleteUpdate()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {adminActionBusy && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              )}
              Confirm Delete
            </button>
            <button
              type="button"
              disabled={adminActionBusy}
              onClick={() => setConfirmDelete(false)}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-[#0B1A2E]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Body Presentation (Strictly separated Photo vs Text-Only formats) */}
      {format === 'photo' ? (
        <div className="mt-3 space-y-3" data-testid="update-photo-body">
          {(update.title?.trim() || update.body.trim()) && (
            <div className="space-y-1.5">
              {update.title?.trim() && (
                <h3 className="overflow-wrap-anywhere font-display text-base font-bold text-[#0B1A2E]">
                  {update.title}
                </h3>
              )}
              {update.body.trim() && (
                <p className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {update.body}
                </p>
              )}
            </div>
          )}

          {gridItems.length > 0 && (
            <SquareImageGrid
              items={gridItems}
              postLabel={update.title?.trim() || displayAuthorName}
              showPerPhotoCaptions={false}
              onImageClick={(index) => setLightboxIndex(index)}
            />
          )}
        </div>
      ) : textTheme ? (
        <div
          className="mt-3.5 flex min-h-[168px] flex-col items-center justify-center rounded-xl p-6 text-center"
          style={{ background: textTheme.backgroundCss }}
          data-testid={`update-text-card-${textTheme.id}`}
        >
          {update.title?.trim() && (
            <h3
              className={`overflow-wrap-anywhere mb-2 max-w-full font-display text-base font-bold sm:text-lg ${textTheme.textColorClass}`}
            >
              {update.title}
            </h3>
          )}
          <p
            className={`overflow-wrap-anywhere max-w-full whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${textTheme.textColorClass}`}
          >
            {update.body}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {update.title?.trim() && (
            <h3 className="overflow-wrap-anywhere font-display text-base font-bold text-[#0B1A2E]">
              {update.title}
            </h3>
          )}
          <p className="overflow-wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {update.body}
          </p>
        </div>
      )}

      {cardError && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
        >
          {cardError}
        </div>
      )}

      {guestPrompt && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
          <span>{guestPrompt}</span>
          <button
            type="button"
            onClick={() => onRequireAuth('login', returnRoute)}
            className="font-semibold text-[#1E88E5] hover:underline"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Actions Footer */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <button
          type="button"
          onClick={handleToggleSave}
          aria-pressed={savedState}
          aria-label={savedState ? 'Remove bookmark' : 'Save update'}
          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
            savedState
              ? 'lasued-accent-gradient text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]'
          }`}
        >
          <Bookmark
            className={`h-4 w-4 ${savedState ? 'fill-white' : ''}`}
            aria-hidden="true"
          />
          <span>{savedState ? 'Saved' : 'Save'}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleLike}
            aria-pressed={likedState}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              likedState
                ? 'bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]'
            }`}
          >
            <Heart
              className={`h-4 w-4 ${likedState ? 'fill-[#1E88E5]' : ''}`}
              aria-hidden="true"
            />
            <span className="tabular-nums">{likesCount}</span>
            <span>{likedState ? 'Liked' : 'Like'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleComments}
            aria-expanded={commentsOpen}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
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
        </div>
      </div>

      {/* Expandable Comments Section */}
      {commentsOpen && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
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
              placeholder="Write a comment on this update..."
              className="min-h-[40px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
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
            <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E88E5]" />
              Loading comments...
            </div>
          ) : topComments.length === 0 ? (
            <p className="py-1 text-xs text-slate-500">
              No comments yet. Start the discussion.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topComments.map(({ comment, author: commentAuthor }) => {
                const postCmt = comment as PostComment;
                const replies = repliesByParent.get(postCmt.id) ?? [];
                const canModify =
                  !viewerSuspended &&
                  Boolean(viewerUid) &&
                  postCmt.ownerUID === viewerUid;
                const canDelete =
                  !viewerSuspended &&
                  Boolean(viewerUid) &&
                  (canModify || isSupremeAdmin || isModerator);

                return (
                  <div
                    key={postCmt.id}
                    id={`comment-${postCmt.id}`}
                    className={`rounded-xl border p-3 ${
                      highlightCommentId === postCmt.id
                        ? 'border-[#1E88E5] bg-[#1E88E5]/5 ring-2 ring-[#1E88E5]/20'
                        : 'border-slate-100 bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {commentAuthor ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateProfile?.(commentAuthor.username)
                              }
                              className="font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                            >
                              {commentAuthor.fullName}
                            </button>
                            <ProfileBadgesRow
                              profile={commentAuthor}
                              size="xs"
                            />
                            <TikTokFollowButton
                              targetUsername={commentAuthor.username}
                              compact
                              onRequireAuth={() =>
                                onRequireAuth('login', returnRoute)
                              }
                            />
                          </>
                        ) : (
                          <span className="font-bold text-[#0B1A2E]">
                            Campus Member
                          </span>
                        )}
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">
                          {formatUpdateTimestamp(postCmt.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={isOptimisticTempId(postCmt.id)}
                          onClick={() => handleToggleCommentLike(postCmt)}
                          className={`inline-flex items-center gap-1 font-semibold ${
                            likedCommentIds.has(postCmt.id)
                              ? 'text-[#1E88E5]'
                              : 'text-slate-600 hover:text-[#0B1A2E]'
                          }`}
                        >
                          <Heart
                            className={`h-3 w-3 ${
                              likedCommentIds.has(postCmt.id)
                                ? 'fill-[#1E88E5]'
                                : ''
                            }`}
                          />
                          <span className="tabular-nums">
                            {commentLikesCounts[postCmt.id] ??
                              Number(postCmt.likesCount ?? 0)}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isOptimisticTempId(postCmt.id)}
                          onClick={() => {
                            if (!viewerUid) {
                              setGuestPrompt('Sign in to reply to comments.');
                              return;
                            }
                            setReplyingToId((prev) =>
                              prev === postCmt.id ? null : postCmt.id
                            );
                            setReplyBody('');
                          }}
                          className="font-semibold text-[#1E88E5] hover:underline"
                        >
                          Reply
                        </button>
                        {canModify && !isOptimisticTempId(postCmt.id) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(postCmt.id);
                              setEditingCommentBody(postCmt.body);
                            }}
                            className="font-semibold text-slate-600 hover:text-[#0B1A2E]"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && !isOptimisticTempId(postCmt.id) && (
                          <button
                            type="button"
                            disabled={commentBusyId === postCmt.id}
                            onClick={() => handleDeleteComment(postCmt)}
                            className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {editingCommentId === postCmt.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingCommentBody}
                          maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                          onChange={(e) => setEditingCommentBody(e.target.value)}
                          className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveCommentEdit(postCmt.id)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#1E88E5] px-2.5 text-xs font-semibold text-white"
                        >
                          <Check className="h-3 w-3" />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCommentId(null)}
                          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                        {postCmt.body}
                      </p>
                    )}

                    {replyingToId === postCmt.id && (
                      <div className="mt-2 flex items-center gap-2 pl-4">
                        <input
                          type="text"
                          value={replyBody}
                          maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                          onChange={(e) => setReplyBody(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAddComment(replyBody, postCmt.id);
                            }
                          }}
                          placeholder="Write a reply..."
                          className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={!replyBody.trim()}
                          onClick={() =>
                            handleAddComment(replyBody, postCmt.id)
                          }
                          className="min-h-[36px] rounded-lg bg-[#0B1A2E] px-3 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Reply
                        </button>
                      </div>
                    )}

                    {replies.length > 0 && (
                      <div className="mt-2.5 space-y-2 border-l-2 border-slate-200 pl-3">
                        {replies.map(
                          ({ comment: reply, author: replyAuthor }) => {
                            const replyCmt = reply as PostComment;
                            const canModifyReply =
                              !viewerSuspended &&
                              Boolean(viewerUid) &&
                              replyCmt.ownerUID === viewerUid;
                            const canDeleteReply =
                              !viewerSuspended &&
                              Boolean(viewerUid) &&
                              (canModifyReply ||
                                isSupremeAdmin ||
                                isModerator);

                            return (
                              <div
                                key={replyCmt.id}
                                id={`comment-${replyCmt.id}`}
                                className="rounded-lg bg-white p-2.5"
                              >
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <CornerDownRight className="h-3 w-3 text-slate-400" />
                                    {replyAuthor ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onNavigateProfile?.(
                                              replyAuthor.username
                                            )
                                          }
                                          className="font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                                        >
                                          {replyAuthor.fullName}
                                        </button>
                                        <ProfileBadgesRow
                                          profile={replyAuthor}
                                          size="xs"
                                        />
                                      </>
                                    ) : (
                                      <span className="font-bold text-[#0B1A2E]">
                                        Campus Member
                                      </span>
                                    )}
                                    <span className="text-slate-400">·</span>
                                    <span className="text-slate-500">
                                      {formatUpdateTimestamp(replyCmt.createdAt)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={isOptimisticTempId(replyCmt.id)}
                                      onClick={() =>
                                        handleToggleCommentLike(replyCmt)
                                      }
                                      className={`inline-flex items-center gap-1 font-semibold ${
                                        likedCommentIds.has(replyCmt.id)
                                          ? 'text-[#1E88E5]'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      <Heart
                                        className={`h-3 w-3 ${
                                          likedCommentIds.has(replyCmt.id)
                                            ? 'fill-[#1E88E5]'
                                            : ''
                                        }`}
                                      />
                                      <span className="tabular-nums">
                                        {commentLikesCounts[replyCmt.id] ??
                                          Number(replyCmt.likesCount ?? 0)}
                                      </span>
                                    </button>
                                    {canDeleteReply &&
                                      !isOptimisticTempId(replyCmt.id) && (
                                        <button
                                          type="button"
                                          disabled={commentBusyId === replyCmt.id}
                                          onClick={() =>
                                            handleDeleteComment(replyCmt)
                                          }
                                          className="font-semibold text-red-700 hover:underline"
                                        >
                                          Delete
                                        </button>
                                      )}
                                  </div>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                                  {replyCmt.body}
                                </p>
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {lightboxIndex !== null && gridItems.length > 0 && (
        <FullScreenImageLightbox
          items={gridItems}
          initialIndex={lightboxIndex}
          postTitle={update.title?.trim() || undefined}
          postCaption={update.body.trim() || undefined}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  );
};

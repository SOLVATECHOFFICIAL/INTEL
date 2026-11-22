import React, { useEffect, useState } from 'react';
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
import { getAnonymousBackgroundTheme } from '../../config/anonymousBackgrounds';
import {
  addPostComment,
  deletePostCascading,
  deletePostComment,
  editPostComment,
  fetchCommentsForPost,
  removeSingleImageFromPost,
  revealAnonymousEntryAuthor,
  togglePostReaction,
  toggleSavedPost,
  type CommentWithAuthor,
  type RevealedAuthorResult,
} from '../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  canActorDeleteOrdinaryPost,
  canModeratorDeleteByBadge,
  collectCommentTreeIds,
  type AnonymousComment,
  type AnonymousPost,
  type CommunityPost,
  type PostComment,
  type PublicProfileProjection,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  formatFirestoreOrAppError,
  type EffectiveAccountTier,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { mediaMetaToGridItems } from '../../utils/mediaGrid';
import { RoleBadge } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';

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
}

function formatPostTimestamp(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Just now';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const PostCard: React.FC<PostCardProps> = ({
  kind,
  post,
  author,
  viewerUid,
  viewerTier,
  viewerSuspended,
  isLiked,
  isSaved = false,
  defaultCommentsOpen = false,
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
}) => {
  const targetCollection = kind === 'ordinary' ? 'posts' : 'anonymousPosts';

  const [likedState, setLikedState] = useState(isLiked);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [savedState, setSavedState] = useState(isSaved);
  const [saveBusy, setSaveBusy] = useState(false);
  const [commentsCount, setCommentsCount] = useState(post.commentsCount);
  const [likeBusy, setLikeBusy] = useState(false);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [commentsLoading, setCommentsLoading] = useState(defaultCommentsOpen);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);

  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

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

  const isAdminOrOwner =
    viewerTier === 'supreme_admin' || viewerTier === 'owner';
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

  const gridItems = mediaMetaToGridItems(post.mediaItems);
  const isStyledAnonText =
    kind === 'anonymous' &&
    gridItems.length === 0 &&
    'backgroundStyle' in post &&
    Boolean(post.backgroundStyle) &&
    post.backgroundStyle !== 'plain';
  const anonTheme = isStyledAnonText
    ? getAnonymousBackgroundTheme((post as AnonymousPost).backgroundStyle)
    : null;

  useEffect(() => {
    if (!defaultCommentsOpen || commentsLoaded) return;
    let active = true;
    fetchCommentsForPost(targetCollection, post.id)
      .then((items) => {
        if (!active) return;
        setComments(items);
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
  }, [defaultCommentsOpen, commentsLoaded, targetCollection, post.id]);

  const loadComments = async () => {
    setCommentsLoading(true);
    setCardError(null);
    try {
      const items = await fetchCommentsForPost(targetCollection, post.id);
      setComments(items);
      setCommentsLoaded(true);
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Unable to load comments right now.')
      );
    } finally {
      setCommentsLoading(false);
    }
  };

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next && !commentsLoaded) {
      void loadComments();
    }
  };

  const handleToggleLike = async () => {
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
    if (likeBusy) return;

    setLikeBusy(true);
    try {
      const result = await togglePostReaction({
        kind: targetCollection,
        postId: post.id,
        actorUid: viewerUid,
      });
      setLikedState(result.liked);
      setLikesCount(result.likesCount);
      onPostUpdated({ ...post, likesCount: result.likesCount });
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Could not update your like right now.')
      );
    } finally {
      setLikeBusy(false);
    }
  };

  const handleToggleSave = async () => {
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
    if (saveBusy) return;

    setSaveBusy(true);
    try {
      const result = await toggleSavedPost({
        actorUid: viewerUid,
        targetCollection,
        targetId: post.id,
        currentlySaved: savedState,
      });
      setSavedState(result.saved);
      onSaveChanged?.(post.id, result.saved);
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Could not update bookmark right now.')
      );
    } finally {
      setSaveBusy(false);
    }
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

  const handleAddComment = async (
    text: string,
    parentCommentId?: string
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
    if (!text.trim() || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
      const roleForWrite =
        viewerTier === 'guest' ? 'member' : viewerTier;
      const result = await addPostComment({
        kind: targetCollection,
        postId: post.id,
        body: text,
        parentCommentId,
        actorUid: viewerUid,
        actorRole: roleForWrite,
      });
      setCommentsCount(result.commentsCount);
      onPostUpdated({ ...post, commentsCount: result.commentsCount });
      if (kind === 'anonymous') {
        onAnonymousCommentTracked?.(result.comment.id, 'add');
      }
      if (parentCommentId) {
        setReplyBody('');
        setReplyingToId(null);
      } else {
        setNewCommentBody('');
      }
      await loadComments();
    } catch (error) {
      setCardError(
        formatFirestoreOrAppError(error, 'Could not post your comment.')
      );
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    if (!editingCommentBody.trim() || commentActionBusyId) return;
    setCommentActionBusyId(commentId);
    setCardError(null);
    try {
      await editPostComment({
        kind: targetCollection,
        commentId,
        body: editingCommentBody,
      });
      setComments((prev) =>
        prev.map((entry) =>
          entry.comment.id === commentId
            ? {
                ...entry,
                comment: {
                  ...entry.comment,
                  body: editingCommentBody.trim(),
                  updatedAt: Date.now(),
                },
              }
            : entry
        )
      );
      setEditingCommentId(null);
      setEditingCommentBody('');
    } catch (error) {
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

  const handleDeleteComment = async (comment: PostComment | AnonymousComment) => {
    if (!viewerUid || commentActionBusyId) return;
    setCommentActionBusyId(comment.id);
    setCardError(null);

    const treeIds = collectCommentTreeIds(
      comments.map((entry) => entry.comment),
      comment.id
    ).filter((id) => id !== comment.id);

    const entryById = new Map(
      comments.map((entry) => [entry.comment.id, entry])
    );

    const childReplyIds = treeIds.filter((replyId) => {
      const entry = entryById.get(replyId);
      if (!entry) return false;
      if (kind === 'ordinary') {
        return canModeratorDeleteOrdinaryComment(
          entry.comment as PostComment,
          entry.author
        );
      }
      return true;
    });
    try {
      const nextCount = await deletePostComment({
        kind: targetCollection,
        postId: post.id,
        commentId: comment.id,
        replyIdsToRemove: childReplyIds,
        actorUid: viewerUid,
      });
      setCommentsCount(nextCount);
      onPostUpdated({ ...post, commentsCount: nextCount });
      if (kind === 'anonymous') {
        onAnonymousCommentTracked?.(comment.id, 'remove');
        for (const rId of childReplyIds) {
          onAnonymousCommentTracked?.(rId, 'remove');
        }
      }
      const deletedSet = new Set([comment.id, ...childReplyIds]);
      setComments((prev) =>
        prev.filter((entry) => !deletedSet.has(entry.comment.id))
      );
    } catch (error) {
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
    } finally {
      setCommentActionBusyId(null);
    }
  };

  const handleRevealAuthor = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!viewerUid || !isAdminOrOwner || revealBusy) return;
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

  const topLevelComments = comments.filter(
    (entry) => !entry.comment.parentCommentId
  );
  const repliesByParent = new Map<string, CommentWithAuthor[]>();
  for (const entry of comments) {
    if (entry.comment.parentCommentId) {
      const list = repliesByParent.get(entry.comment.parentCommentId) ?? [];
      list.push(entry);
      repliesByParent.set(entry.comment.parentCommentId, list);
    }
  }

  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
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
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigateProfile?.(author.username)}
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                    >
                      <span className="truncate">{author.fullName}</span>
                    </button>
                    <RoleBadge badge={author.badge} size="xs" />
                  </>
                ) : (
                  <span className="text-sm font-bold text-[#0B1A2E]">
                    Campus Contributor
                  </span>
                )}

                {author && (
                  <span className="text-xs text-slate-500">
                    @{author.username}
                  </span>
                )}
              </div>

              <p className="mt-0.5 text-xs text-slate-500">
                <span>{post.category}</span>
                {'isOfficial' in post && post.isOfficial && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-semibold text-[#1E88E5]">
                      Official Update
                    </span>
                  </>
                )}
                {'isPinned' in post && post.isPinned && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-semibold text-[#0B1A2E]">Pinned</span>
                  </>
                )}
                <span aria-hidden="true"> · </span>
                <span>{formatPostTimestamp(post.createdAt)}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-white">
              <Shield className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#0B1A2E]">
                Anonymous
                {isOwnedAnonymous ? ' (You)' : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                <span>{post.category}</span>
                <span aria-hidden="true"> · </span>
                <span>Identity hidden</span>
                <span aria-hidden="true"> · </span>
                <span>{formatPostTimestamp(post.createdAt)}</span>
              </p>
            </div>
          </div>
        )}

        {/* Permitted Edit / Delete / Supreme Admin Reveal Triggers */}
        <div className="flex shrink-0 items-center gap-1">
          {kind === 'anonymous' && isAdminOrOwner && (
            <button
              type="button"
              onClick={() => setRevealOpen((prev) => !prev)}
              aria-label="Reveal anonymous identity (Supreme Admin)"
              title="Reveal identity (logged to audit)"
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-purple-700 hover:bg-purple-50"
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
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]"
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
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Delete Post Confirmation */}
      {confirmDeletePost && (
        <div className="mt-3 flex flex-col justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 sm:flex-row sm:items-center">
          <span>
            Delete this post along with its comments, reactions, and image
            documents?
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
              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-[#0B1A2E]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Supreme Admin Identity Audit Form */}
      {kind === 'anonymous' && isAdminOrOwner && revealOpen && (
        <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3 text-xs">
          <form onSubmit={handleRevealAuthor} className="space-y-2">
            <label className="block font-semibold text-purple-950">
              Supreme Admin Audit Reveal (logged permanently)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                minLength={5}
                maxLength={BLUEPRINT_LIMITS.auditReasonMax}
                value={revealReason}
                onChange={(e) => setRevealReason(e.target.value)}
                placeholder="Reason for safety/policy review (min 5 chars)..."
                className="min-h-[38px] flex-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <button
                type="submit"
                disabled={revealBusy || revealReason.trim().length < 5}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-purple-800 px-3.5 py-1.5 font-semibold text-white hover:bg-purple-900 disabled:opacity-50"
              >
                {revealBusy && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                )}
                Reveal Identity
              </button>
            </div>
          </form>
          {revealedAuthor && (
            <p className="mt-2 font-medium text-purple-950">
              Author:{' '}
              {revealedAuthor.profile
                ? `${revealedAuthor.profile.fullName} (@${revealedAuthor.profile.username})`
                : revealedAuthor.authorUid}{' '}
              · Role: {revealedAuthor.authorRole}
            </p>
          )}
        </div>
      )}

      {/* Media Grid FIRST, then General Caption BELOW (Part 4) */}
      {gridItems.length > 0 && (
        <div className="mt-3.5">
          <SquareImageGrid
            items={gridItems}
            postLabel={
              kind === 'anonymous'
                ? 'Anonymous post'
                : author?.fullName || 'Community post'
            }
            onImageClick={(index) => setLightboxIndex(index)}
            onRemoveImage={
              canEdit && (gridItems.length > 1 || post.body.trim().length > 0)
                ? (imageId) => void handleQuickRemoveImage(imageId)
                : undefined
            }
          />
        </div>
      )}

      {/* Post Title + Caption BELOW Image Grid (or Styled Text-Only Anonymous Card) */}
      {isStyledAnonText && anonTheme ? (
        <div
          className="mt-3.5 flex min-h-[168px] items-center justify-center rounded-xl p-6 text-center"
          style={{ background: anonTheme.backgroundCss }}
          data-testid={`anon-styled-card-${anonTheme.id}`}
        >
          <p
            className={`max-w-lg whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${anonTheme.textColorClass}`}
          >
            {post.body}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {'title' in post && post.title && (
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              {post.title}
            </h2>
          )}
          {post.body.trim().length > 0 && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {post.body}
            </p>
          )}
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

      {guestActionPrompt && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
          <span>{guestActionPrompt}</span>
          <button
            type="button"
            onClick={() => onRequireAuth('login', returnRoute)}
            className="font-semibold text-[#1E88E5] hover:underline"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Post Actions Footer */}
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            disabled={likeBusy}
            onClick={() => void handleToggleLike()}
            aria-pressed={likedState}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
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
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
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

        <button
          type="button"
          disabled={saveBusy}
          onClick={() => void handleToggleSave()}
          aria-pressed={savedState}
          aria-label={savedState ? 'Remove bookmark' : 'Save post'}
          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            savedState
              ? 'bg-[#0B1A2E] text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]'
          }`}
        >
          {saveBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Bookmark
              className={`h-4 w-4 ${savedState ? 'fill-white' : ''}`}
              aria-hidden="true"
            />
          )}
          <span className="hidden sm:inline">
            {savedState ? 'Saved' : 'Save'}
          </span>
        </button>
      </div>

      {/* Expandable Comments & Nested Replies Drawer */}
      {commentsOpen && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {/* Add Top-Level Comment */}
          <div className="flex items-start gap-2">
            <input
              type="text"
              maxLength={BLUEPRINT_LIMITS.commentBodyMax}
              value={newCommentBody}
              disabled={commentSubmitting}
              onChange={(e) => setNewCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleAddComment(newCommentBody);
                }
              }}
              placeholder={
                kind === 'anonymous'
                  ? 'Add an anonymous comment...'
                  : 'Write a comment...'
              }
              className="min-h-[40px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
            />
            <button
              type="button"
              disabled={commentSubmitting || !newCommentBody.trim()}
              onClick={() => void handleAddComment(newCommentBody)}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-50"
            >
              {commentSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
              )}
              Post
            </button>
          </div>

          {commentsLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
              Loading comments...
            </div>
          ) : topLevelComments.length === 0 ? (
            <p className="py-1 text-xs text-slate-500">
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

                return (
                  <div
                    key={comment.id}
                    className="rounded-xl border border-slate-100 bg-slate-50/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {kind === 'ordinary' && commentAuthor ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateProfile?.(commentAuthor.username)
                              }
                              className="font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                            >
                              {commentAuthor.fullName}{' '}
                              <span className="font-normal text-slate-500">
                                @{commentAuthor.username}
                              </span>
                            </button>
                            <RoleBadge badge={commentAuthor.badge} size="xs" />
                          </>
                        ) : (
                          <span className="font-bold text-[#0B1A2E]">
                            {kind === 'anonymous'
                              ? ownedAnonymousCommentIds?.has(comment.id)
                                ? 'Anonymous (You)'
                                : 'Anonymous'
                              : 'Campus Member'}
                          </span>
                        )}
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">
                          {formatPostTimestamp(comment.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingToId((prev) =>
                              prev === comment.id ? null : comment.id
                            );
                            setReplyBody('');
                          }}
                          className="font-semibold text-[#1E88E5] hover:underline"
                        >
                          Reply
                        </button>
                        {canModifyComment && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditingCommentBody(comment.body);
                            }}
                            className="font-semibold text-slate-600 hover:text-[#0B1A2E]"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteComment && (
                          <button
                            type="button"
                            disabled={commentActionBusyId === comment.id}
                            onClick={() => void handleDeleteComment(comment)}
                            className="font-semibold text-red-700 hover:underline disabled:opacity-50"
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
                          className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E]"
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
                          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                        {comment.body}
                      </p>
                    )}

                    {/* Reply Input */}
                    {replyingToId === comment.id && (
                      <div className="mt-2 flex items-center gap-2 pl-4">
                        <input
                          type="text"
                          value={replyBody}
                          maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Write a reply..."
                          className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E]"
                        />
                        <button
                          type="button"
                          disabled={commentSubmitting || !replyBody.trim()}
                          onClick={() =>
                            void handleAddComment(replyBody, comment.id)
                          }
                          className="min-h-[36px] rounded-lg bg-[#0B1A2E] px-3 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Reply
                        </button>
                      </div>
                    )}

                    {/* Nested Replies */}
                    {replies.length > 0 && (
                      <div className="mt-2.5 space-y-2 border-l-2 border-slate-200 pl-3">
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

                            return (
                              <div
                                key={reply.id}
                                className="rounded-lg bg-white p-2.5"
                              >
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <CornerDownRight
                                      className="h-3 w-3 text-slate-400"
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
                                          className="font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                                        >
                                          {replyAuthor.fullName}
                                        </button>
                                        <RoleBadge
                                          badge={replyAuthor.badge}
                                          size="xs"
                                        />
                                      </>
                                    ) : (
                                      <span className="font-bold text-[#0B1A2E]">
                                        {kind === 'anonymous'
                                          ? ownedAnonymousCommentIds?.has(
                                              reply.id
                                            )
                                            ? 'Anonymous (You)'
                                            : 'Anonymous'
                                          : 'Campus Member'}
                                      </span>
                                    )}
                                    <span className="text-slate-400">·</span>
                                    <span className="text-slate-500">
                                      {formatPostTimestamp(reply.createdAt)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    {canModifyReply && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCommentId(reply.id);
                                          setEditingCommentBody(reply.body);
                                        }}
                                        className="font-semibold text-slate-600 hover:text-[#0B1A2E]"
                                      >
                                        Edit
                                      </button>
                                    )}
                                    {canDeleteReply && (
                                      <button
                                        type="button"
                                        disabled={
                                          commentActionBusyId === reply.id
                                        }
                                        onClick={() =>
                                          void handleDeleteComment(reply)
                                        }
                                        className="font-semibold text-red-700 hover:underline disabled:opacity-50"
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
                                      className="min-h-[34px] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
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
                                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                                    {reply.body}
                                  </p>
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
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  );
};

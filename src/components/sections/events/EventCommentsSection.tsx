import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CornerDownRight,
  Heart,
  Loader2,
  MessageCircle,
  Send,
} from 'lucide-react';
import { useFirebase } from '../../../context/firebaseContext';
import {
  addEventComment,
  deleteEventComment,
  editEventComment,
  fetchEventComments,
  togglePostCommentReaction,
} from '../../../services/events';
import {
  getThreadCommentsSnapshot,
  hydrateThreadCommentsSnapshot,
  saveThreadCommentsSnapshot,
} from '../../../services/navigationStateCache';
import {
  clearPersistentDraft,
  loadPersistentDraft,
  savePersistentDraft,
} from '../../../services/persistentCache';
import {
  fetchViewerLikedPostIds,
  type CommentWithAuthor,
} from '../../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  canModeratorDeleteByBadge,
  collectCommentTreeIds,
  type PostComment,
  type PublicProfileProjection,
} from '../../../types/database';
import {
  formatFirestoreOrAppError,
  toPublicProfileProjection,
} from '../../../utils/authValidation';
import { extractTimestampMs } from '../../../utils/contextualSearch';
import { reuseSetIfUnchanged } from '../../../utils/cacheSync';
import {
  appendOptimisticCommentEntry,
  buildOptimisticCommentEntry,
  computeOptimisticCommentReactionMap,
  createOptimisticTempId,
  isOptimisticTempId,
  reconcileOptimisticCommentEntry,
  removeCommentTreeEntries,
  restoreCommentEntriesOrdered,
} from '../../../utils/optimisticInteractions';
import { ProfileBadgesRow } from '../../RoleBadge';

interface EventCommentsSectionProps {
  eventId: string;
  commentsCount: number;
  autoFocusInput?: boolean;
  highlightCommentId?: string | null;
  onCommentsCountChange: (nextCount: number) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireGuestAuth: (message: string) => void;
}

function formatCommentTime(value: unknown): string {
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

export const EventCommentsSection: React.FC<EventCommentsSectionProps> = ({
  eventId,
  commentsCount,
  autoFocusInput = false,
  highlightCommentId = null,
  onCommentsCountChange,
  onNavigateProfile,
  onRequireGuestAuth,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();
  const viewerUid = user?.uid ?? null;
  const viewerKey = viewerUid ?? 'guest';
  const isAdminOrOwner = effectiveTier === 'supreme_admin';

  const currentThreadKey = `${viewerKey}:events:${eventId}`;
  const initialThreadSnap = getThreadCommentsSnapshot(
    viewerKey,
    'events',
    eventId
  );

  const [comments, setComments] = useState<CommentWithAuthor[]>(
    () => initialThreadSnap?.comments ?? []
  );
  const [loading, setLoading] = useState(() => !initialThreadSnap);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hydratedThreadKey, setHydratedThreadKey] = useState<string | null>(
    () => (initialThreadSnap ? currentThreadKey : null)
  );

  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Optimistic comment/reply likes state
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(
    () => initialThreadSnap?.likedCommentIds ?? new Set()
  );
  const [commentLikesCounts, setCommentLikesCounts] = useState<
    Record<string, number>
  >(() => initialThreadSnap?.commentLikesCounts ?? {});

  // Locks to prevent duplicate concurrent submissions or rapid duplicate likes
  const submitLockRef = useRef<Set<string>>(new Set());
  const commentLikeInFlightRef = useRef<Set<string>>(new Set());
  const mainInputRef = useRef<HTMLInputElement | null>(null);

  const viewerAuthorProjection: PublicProfileProjection | null = profile
    ? toPublicProfileProjection(profile)
    : null;

  useEffect(() => {
    let active = true;
    let networkSettled = false;

    void hydrateThreadCommentsSnapshot(viewerKey, 'events', eventId)
      .then((cached) => {
        if (!active || networkSettled || !cached) return;
        setComments(cached.comments);
        setLikedCommentIds((prev) =>
          reuseSetIfUnchanged(prev, cached.likedCommentIds)
        );
        setCommentLikesCounts(cached.commentLikesCounts ?? {});
        setHydratedThreadKey(currentThreadKey);
        setLoading(false);
      })
      .catch(() => undefined);

    const likesPromise = viewerUid
      ? fetchViewerLikedPostIds('postComments', viewerUid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    Promise.all([fetchEventComments(eventId), likesPromise])
      .then(([loadedComments, likedIds]) => {
        networkSettled = true;
        if (!active) return;
        setComments(loadedComments);
        setLikedCommentIds((prev) => reuseSetIfUnchanged(prev, likedIds));
        setHydratedThreadKey(currentThreadKey);
        setErrorMessage(null);
      })
      .catch((error) => {
        networkSettled = true;
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load comments for this event.'
          )
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId, viewerUid, viewerKey, currentThreadKey]);

  useEffect(() => {
    if (loading || hydratedThreadKey !== currentThreadKey) return;
    saveThreadCommentsSnapshot({
      viewerKey,
      targetCollection: 'events',
      targetId: eventId,
      comments,
      commentsCursor: null,
      hasMoreComments: false,
      likedCommentIds,
      commentLikesCounts,
      cachedAt: Date.now(),
    });
  }, [
    viewerKey,
    eventId,
    currentThreadKey,
    hydratedThreadKey,
    loading,
    comments,
    likedCommentIds,
    commentLikesCounts,
  ]);

  // Persistent draft load & autosave for event comment & active reply
  useEffect(() => {
    let active = true;
    void loadPersistentDraft<string>(viewerKey, `event_comment:${eventId}`)
      .then((draft) => {
        if (!active || !draft) return;
        setNewCommentBody((curr) => (curr.trim() ? curr : draft));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerKey, eventId]);

  useEffect(() => {
    if (!newCommentBody.trim()) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(
        viewerKey,
        `event_comment:${eventId}`,
        newCommentBody
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [viewerKey, eventId, newCommentBody]);

  useEffect(() => {
    if (!replyingToId) return;
    let active = true;
    void loadPersistentDraft<string>(
      viewerKey,
      `event_reply:${eventId}:${replyingToId}`
    )
      .then((draft) => {
        if (!active || !draft) return;
        setReplyBody((curr) => (curr.trim() ? curr : draft));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerKey, eventId, replyingToId]);

  useEffect(() => {
    if (!replyingToId || !replyBody.trim()) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(
        viewerKey,
        `event_reply:${eventId}:${replyingToId}`,
        replyBody
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [viewerKey, eventId, replyingToId, replyBody]);

  useEffect(() => {
    if (autoFocusInput && !loading && mainInputRef.current) {
      mainInputRef.current.focus();
    }
  }, [autoFocusInput, loading]);

  useEffect(() => {
    if (loading || !highlightCommentId) return;
    const raf = window.requestAnimationFrame(() => {
      const targetEl = document.getElementById(`comment-${highlightCommentId}`);
      targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [loading, highlightCommentId]);

  const canDeleteCommentEntry = (
    targetComment: PostComment,
    targetAuthor: PublicProfileProjection | null
  ): boolean => {
    if (!viewerUid || isSuspended || isOptimisticTempId(targetComment.id)) {
      return false;
    }
    if (targetComment.ownerUID === viewerUid || isAdminOrOwner) return true;
    if (effectiveTier === 'moderator' && targetAuthor) {
      return canModeratorDeleteByBadge(targetAuthor.badge);
    }
    return false;
  };

  const handleSubmitComment = (rawText: string, parentCommentId?: string) => {
    setErrorMessage(null);
    if (!viewerUid) {
      onRequireGuestAuth('Sign in to comment or reply on campus events.');
      return;
    }
    if (isSuspended) {
      setErrorMessage('Suspended accounts cannot comment on events.');
      return;
    }

    const trimmed = rawText.trim();
    if (!trimmed) return;
    if (parentCommentId && isOptimisticTempId(parentCommentId)) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMessage(
        'You are offline. Your comment draft is saved safely — reconnect to post.'
      );
      return;
    }

    const lockKey = `${parentCommentId ?? 'root'}:${trimmed}`;
    if (submitLockRef.current.has(lockKey)) {
      return;
    }
    submitLockRef.current.add(lockKey);

    const tempId = createOptimisticTempId();
    const optimisticEntry = buildOptimisticCommentEntry({
      tempId,
      targetCollection: 'events',
      postId: eventId,
      actorUid: viewerUid,
      body: trimmed,
      parentCommentId,
      author: viewerAuthorProjection,
    });

    const previousCount = commentsCount;
    setComments((prev) => appendOptimisticCommentEntry(prev, optimisticEntry));
    onCommentsCountChange(previousCount + 1);

    if (parentCommentId) {
      setReplyBody('');
      setReplyingToId(null);
    } else {
      setNewCommentBody('');
    }

    void addEventComment({
      eventId,
      body: trimmed,
      parentCommentId,
      actorUid: viewerUid,
    })
      .then((res) => {
        setComments((prev) =>
          reconcileOptimisticCommentEntry(
            prev,
            tempId,
            res.comment,
            viewerAuthorProjection
          )
        );
        onCommentsCountChange(res.commentsCount);
        if (parentCommentId) {
          void clearPersistentDraft(
            viewerKey,
            `event_reply:${eventId}:${parentCommentId}`
          );
        } else {
          void clearPersistentDraft(viewerKey, `event_comment:${eventId}`);
        }
      })
      .catch((error) => {
        // Rollback optimistic comment and restore draft text for retry
        setComments((prev) => prev.filter((item) => item.comment.id !== tempId));
        onCommentsCountChange(previousCount);
        if (parentCommentId) {
          setReplyingToId(parentCommentId);
          setReplyBody((curr) => curr || trimmed);
        } else {
          setNewCommentBody((curr) => curr || trimmed);
        }
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Could not save your comment. Please try again.'
          )
        );
      })
      .finally(() => {
        submitLockRef.current.delete(lockKey);
      });
  };

  const handleToggleCommentLike = (comment: PostComment) => {
    setErrorMessage(null);
    if (!viewerUid) {
      onRequireGuestAuth('Sign in to like comments and replies.');
      return;
    }
    if (isSuspended) {
      setErrorMessage('Suspended accounts cannot react to comments.');
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

    setLikedCommentIds(optimistic.nextLikedSet);
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
        setLikedCommentIds(prevLikedSet);
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
        setErrorMessage(
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

  const handleSaveEdit = (commentId: string) => {
    const trimmed = editingBody.trim();
    if (!trimmed || actionBusyId || isOptimisticTempId(commentId)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMessage('You are offline. Reconnect to save your comment edit.');
      return;
    }

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
    setEditingId(null);
    setEditingBody('');
    setActionBusyId(commentId);
    setErrorMessage(null);

    void editEventComment({ commentId, body: trimmed })
      .catch((error) => {
        setComments(prevComments);
        setErrorMessage(
          formatFirestoreOrAppError(error, 'Could not save comment edit.')
        );
      })
      .finally(() => {
        setActionBusyId(null);
      });
  };

  const handleDeleteComment = (comment: PostComment) => {
    if (!viewerUid || actionBusyId || isOptimisticTempId(comment.id)) return;

    const treeIds = collectCommentTreeIds(
      comments.map((e) => e.comment),
      comment.id
    ).filter((id) => id !== comment.id && !isOptimisticTempId(id));

    const entryById = new Map(comments.map((e) => [e.comment.id, e]));
    const removableReplies = treeIds.filter((replyId) => {
      const target = entryById.get(replyId);
      if (!target) return false;
      if (target.comment.parentCommentId === comment.id) return true;
      return canDeleteCommentEntry(
        target.comment as PostComment,
        target.author
      );
    });

    const deletedSet = new Set([comment.id, ...removableReplies]);
    const { remaining, removed } = removeCommentTreeEntries(comments, deletedSet);
    const previousCount = commentsCount;

    setComments(remaining);
    onCommentsCountChange(Math.max(0, previousCount - deletedSet.size));
    setActionBusyId(comment.id);
    setErrorMessage(null);

    void deleteEventComment({
      eventId,
      commentId: comment.id,
      replyIdsToRemove: removableReplies,
    })
      .then((serverCount) => {
        onCommentsCountChange(serverCount);
      })
      .catch((error) => {
        setComments((curr) => restoreCommentEntriesOrdered(curr, removed));
        onCommentsCountChange(previousCount);
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'You do not have permission to delete this comment.'
          )
        );
      })
      .finally(() => {
        setActionBusyId(null);
      });
  };

  const loadedCommentIds = new Set(comments.map((e) => e.comment.id));
  const topLevel = comments.filter(
    (e) =>
      !e.comment.parentCommentId ||
      !loadedCommentIds.has(e.comment.parentCommentId)
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
    <section
      id="event-comments-section"
      aria-labelledby="event-comments-heading"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="event-comments-heading"
          className="flex items-center gap-2 font-display text-base font-bold text-[#0B1A2E]"
        >
          <MessageCircle className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          <span>Discussion</span>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            ({commentsCount})
          </span>
        </h3>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {/* Top-Level Comment Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmitComment(newCommentBody);
        }}
        className="flex items-start gap-2"
      >
        <input
          ref={mainInputRef}
          type="text"
          maxLength={BLUEPRINT_LIMITS.commentBodyMax}
          value={newCommentBody}
          onChange={(e) => setNewCommentBody(e.target.value)}
          placeholder={
            viewerUid
              ? 'Ask a question or share a comment about this event...'
              : 'Sign in to comment on this event...'
          }
          className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
        />
        <button
          type="submit"
          disabled={!newCommentBody.trim()}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
          Post
        </button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
          <Loader2
            className="h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading event comments...
        </div>
      ) : topLevel.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">
          No comments yet. Ask a question or start the conversation.
        </p>
      ) : (
        <div className="space-y-3">
          {topLevel.map(({ comment: rawComment, author }) => {
            const comment = rawComment as PostComment;
            const replies = repliesByParent.get(comment.id) ?? [];
            const isOwner = Boolean(viewerUid && comment.ownerUID === viewerUid);
            const canEdit = !isSuspended && isOwner && !isOptimisticTempId(comment.id);
            const canDelete = canDeleteCommentEntry(comment, author);
            const liked = likedCommentIds.has(comment.id);
            const likeCount =
              commentLikesCounts[comment.id] ?? Number(comment.likesCount ?? 0);

            return (
              <div
                key={comment.id}
                id={`comment-${comment.id}`}
                className={`rounded-xl border p-3.5 transition-colors ${
                  highlightCommentId === comment.id
                    ? 'border-[#1E88E5] bg-[#1E88E5]/5 ring-2 ring-[#1E88E5]/20'
                    : 'border-slate-100 bg-slate-50/80'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {author ? (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onNavigateProfile?.(author.username)}
                            className="font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                          >
                            {author.fullName}
                          </button>
                          <ProfileBadgesRow profile={author} size="xs" />
                        </span>
                        <button
                          type="button"
                          onClick={() => onNavigateProfile?.(author.username)}
                          className="font-normal text-slate-500 hover:text-[#1E88E5]"
                        >
                          @{author.username}
                        </button>
                      </>
                    ) : (
                      <span className="font-bold text-[#0B1A2E]">
                        Campus Member
                      </span>
                    )}
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">
                      {formatCommentTime(comment.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                    <button
                      type="button"
                      disabled={isOptimisticTempId(comment.id)}
                      onClick={() => handleToggleCommentLike(comment)}
                      aria-pressed={liked}
                      className={`inline-flex items-center gap-1 font-semibold ${
                        liked
                          ? 'text-[#1E88E5]'
                          : 'text-slate-600 hover:text-[#0B1A2E]'
                      }`}
                    >
                      <Heart
                        className={`h-3.5 w-3.5 ${liked ? 'fill-[#1E88E5]' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="tabular-nums">{likeCount}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isOptimisticTempId(comment.id)}
                      onClick={() => {
                        if (!viewerUid) {
                          onRequireGuestAuth('Sign in to reply to comments.');
                          return;
                        }
                        setReplyingToId((curr) =>
                          curr === comment.id ? null : comment.id
                        );
                        setReplyBody('');
                      }}
                      className="font-semibold text-[#1E88E5] hover:underline disabled:opacity-50"
                    >
                      Reply
                    </button>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditingBody(comment.body);
                        }}
                        className="font-semibold text-slate-600 hover:text-[#0B1A2E]"
                      >
                        Edit
                      </button>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        disabled={actionBusyId === comment.id}
                        onClick={() => handleDeleteComment(comment)}
                        className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {editingId === comment.id ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={editingBody}
                      maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                      onChange={(e) => setEditingBody(e.target.value)}
                      className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E]"
                    />
                    <button
                      type="button"
                      disabled={actionBusyId === comment.id}
                      onClick={() => handleSaveEdit(comment.id)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#1E88E5] px-2.5 text-xs font-semibold text-white"
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                    {comment.body}
                  </p>
                )}

                {replyingToId === comment.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSubmitComment(replyBody, comment.id);
                    }}
                    className="mt-2.5 flex items-center gap-2 pl-4"
                  >
                    <input
                      type="text"
                      value={replyBody}
                      maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder="Write a reply..."
                      className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-[#0B1A2E]"
                    />
                    <button
                      type="submit"
                      disabled={!replyBody.trim()}
                      className="min-h-[36px] rounded-lg bg-[#0B1A2E] px-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Reply
                    </button>
                  </form>
                )}

                {replies.length > 0 && (
                  <div className="mt-2.5 space-y-2 border-l-2 border-slate-200 pl-3">
                    {replies.map(({ comment: rawReply, author: replyAuthor }) => {
                      const reply = rawReply as PostComment;
                      const isReplyOwner = Boolean(
                        viewerUid && reply.ownerUID === viewerUid
                      );
                      const canEditReply =
                        !isSuspended &&
                        isReplyOwner &&
                        !isOptimisticTempId(reply.id);
                      const canDeleteReply = canDeleteCommentEntry(
                        reply,
                        replyAuthor
                      );
                      const replyLiked = likedCommentIds.has(reply.id);
                      const replyLikeCount =
                        commentLikesCounts[reply.id] ??
                        Number(reply.likesCount ?? 0);

                      return (
                        <div
                          key={reply.id}
                          id={`comment-${reply.id}`}
                          className={`rounded-lg p-2.5 transition-colors ${
                            highlightCommentId === reply.id
                              ? 'border border-[#1E88E5] bg-[#1E88E5]/5 ring-2 ring-[#1E88E5]/20'
                              : 'bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <CornerDownRight
                                className="h-3 w-3 text-slate-400"
                                aria-hidden="true"
                              />
                              {replyAuthor ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onNavigateProfile?.(replyAuthor.username)
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
                                {formatCommentTime(reply.createdAt)}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={isOptimisticTempId(reply.id)}
                                onClick={() => handleToggleCommentLike(reply)}
                                aria-pressed={replyLiked}
                                className={`inline-flex items-center gap-1 font-semibold ${
                                  replyLiked
                                    ? 'text-[#1E88E5]'
                                    : 'text-slate-600 hover:text-[#0B1A2E]'
                                }`}
                              >
                                <Heart
                                  className={`h-3 w-3 ${
                                    replyLiked ? 'fill-[#1E88E5]' : ''
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="tabular-nums">
                                  {replyLikeCount}
                                </span>
                              </button>

                              {canEditReply && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(reply.id);
                                    setEditingBody(reply.body);
                                  }}
                                  className="font-semibold text-slate-600 hover:text-[#0B1A2E]"
                                >
                                  Edit
                                </button>
                              )}

                              {canDeleteReply && (
                                <button
                                  type="button"
                                  disabled={actionBusyId === reply.id}
                                  onClick={() => handleDeleteComment(reply)}
                                  className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>

                          {editingId === reply.id ? (
                            <div className="mt-1.5 flex items-center gap-2">
                              <input
                                type="text"
                                value={editingBody}
                                maxLength={BLUEPRINT_LIMITS.commentBodyMax}
                                onChange={(e) => setEditingBody(e.target.value)}
                                className="min-h-[34px] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-[#0B1A2E]"
                              />
                              <button
                                type="button"
                                disabled={actionBusyId === reply.id}
                                onClick={() => handleSaveEdit(reply.id)}
                                className="min-h-[34px] rounded-lg bg-[#1E88E5] px-2.5 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="min-h-[34px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                              {reply.body}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Loader2,
  Lock,
  MessageSquare,
  Pin,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  adminDeleteCommentWithAudit,
  adminDeleteCommunityPostWithAudit,
  adminTogglePostFlagsWithAudit,
  resolveAnonymousReportWithAudit,
  type AdminCommunityPostItem,
  type AdminPostCommentItem,
} from '../../services/adminDashboard';
import {
  revealAnonymousEntryAuthor,
  type RevealedAuthorResult,
} from '../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  canActorDeleteOrdinaryPost,
  type AnonymousComment,
  type AnonymousPost,
  type AnonymousReport,
  type CommunityPost,
  type PostComment,
  type UserRole,
} from '../../types/database';
import { canActorDeleteCommentByBadge } from '../../utils/adminPermissions';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { ProfileBadgesRow } from '../RoleBadge';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminContentTabProps {
  ordinaryPosts: AdminCommunityPostItem[];
  anonymousPosts: AnonymousPost[];
  ordinaryComments: AdminPostCommentItem[];
  anonymousComments: AdminPostCommentItem[];
  anonymousReports: AnonymousReport[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  isFullAdmin: boolean;
  canRevealAnonymous?: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

type ContentSubTab =
  | 'ordinary_posts'
  | 'anonymous_posts'
  | 'post_comments'
  | 'anonymous_comments'
  | 'anonymous_reports';

function formatShortTime(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Pending timestamp';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AdminContentTab: React.FC<AdminContentTabProps> = ({
  ordinaryPosts,
  anonymousPosts,
  ordinaryComments,
  anonymousComments,
  anonymousReports,
  loading,
  actorUid,
  actorRole,
  isFullAdmin,
  canRevealAnonymous = false,
  onSuccess,
  onError,
  onReload,
}) => {
  const [subTab, setSubTab] = useState<ContentSubTab>('ordinary_posts');
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'posts'; post: CommunityPost; label: string }
    | { kind: 'anonymousPosts'; post: AnonymousPost; label: string }
    | { kind: 'postComments'; comment: PostComment; label: string }
    | { kind: 'anonymousComments'; comment: AnonymousComment; label: string }
    | null
  >(null);

  // Strictly Supreme Admin / Owner only: Anonymous Safety Reveal
  const [lookupEntryId, setLookupEntryId] = useState('');
  const [lookupReason, setLookupReason] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [revealedResult, setRevealedResult] =
    useState<RevealedAuthorResult | null>(null);

  const authorBadgeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of ordinaryPosts) {
      if (item.author) map.set(item.post.ownerUID, item.author.badge);
    }
    for (const item of ordinaryComments) {
      const c = item.comment as PostComment;
      if (item.author) map.set(c.ownerUID, item.author.badge);
    }
    return map;
  }, [ordinaryPosts, ordinaryComments]);

  const term = searchQuery.trim().toLowerCase();

  const filteredOrdinaryPosts = useMemo(
    () =>
      ordinaryPosts.filter(({ post, author }) => {
        if (!term) return true;
        return [
          post.title ?? '',
          post.body,
          post.category,
          author?.fullName ?? '',
          author?.username ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);
      }),
    [ordinaryPosts, term]
  );

  const filteredAnonymousPosts = useMemo(
    () =>
      anonymousPosts.filter((post) => {
        if (!term) return true;
        return (
          post.body.toLowerCase().includes(term) ||
          post.category.toLowerCase().includes(term) ||
          post.id.toLowerCase().includes(term)
        );
      }),
    [anonymousPosts, term]
  );

  const filteredOrdinaryComments = useMemo(
    () =>
      ordinaryComments.filter(({ comment, author }) => {
        if (!term) return true;
        return [
          comment.body,
          comment.postId,
          author?.fullName ?? '',
          author?.username ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);
      }),
    [ordinaryComments, term]
  );

  const filteredAnonymousComments = useMemo(
    () =>
      anonymousComments.filter(({ comment }) => {
        if (!term) return true;
        return (
          comment.body.toLowerCase().includes(term) ||
          comment.postId.toLowerCase().includes(term) ||
          comment.id.toLowerCase().includes(term)
        );
      }),
    [anonymousComments, term]
  );

  const pendingReportsCount = useMemo(
    () => anonymousReports.filter((r) => r.status === 'pending').length,
    [anonymousReports]
  );

  const filteredAnonymousReports = useMemo(
    () =>
      anonymousReports.filter((report) => {
        if (!term) return true;
        return [
          report.excerpt,
          report.details ?? '',
          report.reason,
          report.status,
          report.targetId,
          report.postId,
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);
      }),
    [anonymousReports, term]
  );

  const handleResolveReport = async (
    report: AnonymousReport,
    decision: 'reviewed_removed' | 'dismissed'
  ) => {
    if (busyId) return;
    setBusyId(report.id);
    try {
      const targetPost =
        report.targetType === 'anonymousPost'
          ? anonymousPosts.find((p) => p.id === report.targetId) ?? null
          : null;
      const allAnonComments = anonymousComments.map(
        (item) => item.comment as AnonymousComment
      );
      const targetComment =
        report.targetType === 'anonymousComment'
          ? allAnonComments.find((c) => c.id === report.targetId) ?? null
          : null;

      await resolveAnonymousReportWithAudit({
        report,
        decision,
        actorUid,
        actorRole,
        resolutionNote: reasonNote,
        targetPost,
        targetComment,
        allAnonymousComments: allAnonComments,
      });

      onSuccess(
        decision === 'reviewed_removed'
          ? 'Reported anonymous content removed and report resolved.'
          : 'Anonymous report dismissed and logged.'
      );
      setReasonNote('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not resolve this anonymous report.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleFlagToggle = async (
    post: CommunityPost,
    changes: { isPinned?: boolean; isOfficial?: boolean }
  ) => {
    if (!isFullAdmin || busyId) return;
    setBusyId(post.id);
    try {
      await adminTogglePostFlagsWithAudit({
        post,
        ...changes,
        actorUid,
        actorRole,
      });
      onSuccess('Post governance flags updated and logged.');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not update post flags.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || busyId) return;
    const id =
      pendingDelete.kind === 'posts' || pendingDelete.kind === 'anonymousPosts'
        ? pendingDelete.post.id
        : pendingDelete.comment.id;
    setBusyId(id);

    try {
      if (
        pendingDelete.kind === 'posts' ||
        pendingDelete.kind === 'anonymousPosts'
      ) {
        await adminDeleteCommunityPostWithAudit({
          kind: pendingDelete.kind,
          post: pendingDelete.post,
          actorUid,
          actorRole,
          reason: reasonNote,
        });
      } else if (pendingDelete.kind === 'postComments') {
        await adminDeleteCommentWithAudit({
          kind: 'posts',
          comment: pendingDelete.comment,
          allCommentsInSameKind: ordinaryComments.map(
            (i) => i.comment as PostComment
          ),
          authorBadgesByUid: authorBadgeMap,
          actorUid,
          actorRole,
          reason: reasonNote,
        });
      } else {
        await adminDeleteCommentWithAudit({
          kind: 'anonymousPosts',
          comment: pendingDelete.comment,
          allCommentsInSameKind: anonymousComments.map(
            (i) => i.comment as AnonymousComment
          ),
          actorUid,
          actorRole,
          reason: reasonNote,
        });
      }

      onSuccess(`Deleted "${pendingDelete.label}".`);
      setPendingDelete(null);
      setReasonNote('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Permission denied or unable to remove this item.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRevealLookup = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!canRevealAnonymous || !lookupEntryId.trim() || lookupBusy) return;
    setLookupBusy(true);
    setRevealedResult(null);
    try {
      const result = await revealAnonymousEntryAuthor({
        entryId: lookupEntryId.trim(),
        revealedByUid: actorUid,
        reason: lookupReason,
      });
      setRevealedResult(result);
      setLookupReason('');
      onSuccess(
        `Safety lookup recorded in anonymousAuditLogs for ${result.entryId}.`
      );
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Unable to resolve anonymous author for that ID.'
        )
      );
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {!isFullAdmin && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-[#0B1A2E]">
          <strong>Moderator Boundaries:</strong> You can delete posts and
          comments made by <strong>ordinary members</strong> only. Content from
          Verified, Moderator, and Admin accounts is protected. Anonymous author
          identities remain strictly hidden from Moderators.
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            {
              id: 'ordinary_posts',
              label: `Ordinary Posts (${ordinaryPosts.length})`,
              icon: FileText,
            },
            {
              id: 'anonymous_posts',
              label: `Anonymous Posts (${anonymousPosts.length})`,
              icon: EyeOff,
            },
            {
              id: 'post_comments',
              label: `Post Comments (${ordinaryComments.length})`,
              icon: MessageSquare,
            },
            {
              id: 'anonymous_comments',
              label: `Anon Comments (${anonymousComments.length})`,
              icon: EyeOff,
            },
            {
              id: 'anonymous_reports',
              label: `Anon Reports (${pendingReportsCount} pending)`,
              icon: Flag,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="admin-content-search"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Filter content
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="admin-content-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search text, category, entry ID, or author..."
              className="block min-h-[42px] w-full rounded-xl border border-slate-300 py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor="admin-content-reason"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Moderation audit reason (optional)
          </label>
          <input
            id="admin-content-reason"
            type="text"
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Reason logged when deleting an entry..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading community content...
        </div>
      ) : subTab === 'ordinary_posts' ? (
        filteredOrdinaryPosts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
            No ordinary community posts match your filter.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredOrdinaryPosts.map(({ post, author }) => {
              const canDelete = canActorDeleteOrdinaryPost({
                viewerUid: actorUid,
                viewerTier: actorRole,
                viewerSuspended: false,
                postOwnerUid: post.ownerUID,
                authorBadge: author?.badge,
                authorRole: post.authorRole,
              });
              const isBusy = busyId === post.id;

              return (
                <article
                  key={post.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                          {post.category}
                        </span>
                        {post.isPinned && (
                          <span className="rounded-md bg-[#1E88E5]/10 px-2 py-0.5 font-semibold text-[#1E88E5]">
                            Pinned
                          </span>
                        )}
                        {post.isOfficial && (
                          <span className="rounded-md bg-[#0B1A2E] px-2 py-0.5 font-semibold text-white">
                            Official
                          </span>
                        )}
                        <span className="text-slate-500">
                          {formatShortTime(post.createdAt)}
                        </span>
                      </div>

                      {post.title && (
                        <h3 className="mt-1.5 font-display text-sm font-bold text-[#0B1A2E]">
                          {post.title}
                        </h3>
                      )}
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-700">
                        {post.body || '(Image-only campus post)'}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>
                          By{' '}
                          <strong className="text-[#0B1A2E]">
                            {author
                              ? `${author.fullName} (@${author.username})`
                              : post.ownerUID}
                          </strong>
                        </span>
                        {author && (
                          <ProfileBadgesRow profile={author} size="xs" />
                        )}
                        <span className="tabular-nums">
                          · {post.likesCount} likes · {post.commentsCount}{' '}
                          comments
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isFullAdmin && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleFlagToggle(post, {
                                isPinned: !post.isPinned,
                              })
                            }
                            className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${
                              post.isPinned
                                ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
                                : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50'
                            }`}
                          >
                            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
                            {post.isPinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleFlagToggle(post, {
                                isOfficial: !post.isOfficial,
                              })
                            }
                            className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${
                              post.isOfficial
                                ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                                : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50'
                            }`}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            {post.isOfficial ? 'Official' : 'Mark Official'}
                          </button>
                        </>
                      )}

                      {canDelete ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            setPendingDelete({
                              kind: 'posts',
                              post,
                              label: post.title || post.body.slice(0, 60) || post.id,
                            })
                          }
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Protected Tier
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : subTab === 'anonymous_posts' ? (
        filteredAnonymousPosts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
            No anonymous posts match your filter.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredAnonymousPosts.map((post) => (
              <article
                key={post.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-[#0B1A2E] px-2 py-0.5 font-semibold text-white">
                        Anonymous · {post.category}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        ID: {post.id}
                      </span>
                      <span className="text-slate-500">
                        {formatShortTime(post.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-800">
                      {post.body || '(Image-only anonymous submission)'}
                    </p>
                    <p className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
                      {post.likesCount} likes · {post.commentsCount} comments ·
                      Zero author PII stored on post document
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canRevealAnonymous && (
                      <button
                        type="button"
                        onClick={() => setLookupEntryId(post.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-900 hover:bg-purple-100"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Inspect ID
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === post.id}
                      onClick={() =>
                        setPendingDelete({
                          kind: 'anonymousPosts',
                          post,
                          label: post.body.slice(0, 60) || post.id,
                        })
                      }
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      ) : subTab === 'post_comments' ? (
        filteredOrdinaryComments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
            No post comments match your filter.
          </p>
        ) : (
          <div className="space-y-2.5">
            {filteredOrdinaryComments.map(({ comment, author }) => {
              const postComment = comment as PostComment;
              const canDelete =
                postComment.ownerUID === actorUid ||
                canActorDeleteCommentByBadge(actorRole, author?.badge);

              return (
                <div
                  key={comment.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <strong className="text-[#0B1A2E]">
                        {author
                          ? `${author.fullName} (@${author.username})`
                          : postComment.ownerUID}
                      </strong>
                      {author && (
                        <ProfileBadgesRow profile={author} size="xs" />
                      )}
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-500">
                        {formatShortTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{comment.body}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Post: {comment.postId}
                    </p>
                  </div>

                  {canDelete ? (
                    <button
                      type="button"
                      disabled={busyId === comment.id}
                      onClick={() =>
                        setPendingDelete({
                          kind: 'postComments',
                          comment: postComment,
                          label: comment.body.slice(0, 60),
                        })
                      }
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      Protected Tier
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : subTab === 'anonymous_comments' ? (
        filteredAnonymousComments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
            No anonymous comments match your filter.
          </p>
        ) : (
          <div className="space-y-2.5">
            {filteredAnonymousComments.map(({ comment }) => {
              const anonComment = comment as AnonymousComment;
              return (
                <div
                  key={comment.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-[#0B1A2E]">
                        Anonymous Reply
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        ID: {comment.id}
                      </span>
                      <span className="text-slate-500">
                        {formatShortTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-800">{comment.body}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Thread: {comment.postId}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {canRevealAnonymous && (
                      <button
                        type="button"
                        onClick={() => setLookupEntryId(comment.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-900 hover:bg-purple-100"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Inspect ID
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === comment.id}
                      onClick={() =>
                        setPendingDelete({
                          kind: 'anonymousComments',
                          comment: anonComment,
                          label: comment.body.slice(0, 60),
                        })
                      }
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredAnonymousReports.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
          No anonymous moderation reports match your filter.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredAnonymousReports.map((report) => {
            const isPending = report.status === 'pending';
            const isBusy = busyId === report.id;
            return (
              <article
                key={report.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 font-semibold ${
                          report.status === 'pending'
                            ? 'bg-amber-100 text-amber-900'
                            : report.status === 'reviewed_removed'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {report.status === 'pending'
                          ? 'Pending Review'
                          : report.status === 'reviewed_removed'
                          ? 'Content Removed'
                          : 'Dismissed'}
                      </span>
                      <span className="rounded-md bg-[#0B1A2E] px-2 py-0.5 font-semibold text-white">
                        {report.targetType === 'anonymousPost'
                          ? 'Anonymous Post'
                          : 'Anonymous Comment'}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                        Reason: {report.reason.replace(/_/g, ' ')}
                      </span>
                      <span className="text-slate-500">
                        {formatShortTime(report.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-800">
                      {report.excerpt}
                    </p>
                    {report.details && (
                      <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                        Reporter note: {report.details}
                      </p>
                    )}
                    <p className="font-mono text-[11px] text-slate-400">
                      Entry: {report.targetId} · Thread: {report.postId}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canRevealAnonymous && (
                      <button
                        type="button"
                        onClick={() => setLookupEntryId(report.targetId)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-900 hover:bg-purple-100"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Inspect ID
                      </button>
                    )}
                    {isPending && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handleResolveReport(report, 'reviewed_removed')
                          }
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Remove Content &amp; Resolve
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handleResolveReport(report, 'dismissed')
                          }
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                        >
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-slate-500"
                            aria-hidden="true"
                          />
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Supreme Admin / Owner ONLY: Anonymous Safety Identity Reveal */}
      {canRevealAnonymous && (
        <form
          onSubmit={handleRevealLookup}
          className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/50 p-4"
        >
          <div>
            <h3 className="font-display text-sm font-bold text-purple-950">
              Supreme Admin Anonymous Safety Lookup
            </h3>
            <p className="text-xs text-purple-900/80">
              Restricted strictly to Supreme Admins and the Platform Owner.
              Moderators cannot access this control. Every lookup records an
              immutable entry in <code>anonymousAuditLogs</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              required
              value={lookupEntryId}
              onChange={(e) => setLookupEntryId(e.target.value)}
              placeholder="Anonymous post or comment ID..."
              className="min-h-[40px] rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
            <input
              type="text"
              required
              minLength={BLUEPRINT_LIMITS.auditReasonMin}
              maxLength={BLUEPRINT_LIMITS.auditReasonMax}
              value={lookupReason}
              onChange={(e) => setLookupReason(e.target.value)}
              placeholder="Safety justification (min 5 chars)..."
              className="min-h-[40px] rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
          </div>

          <button
            type="submit"
            disabled={
              lookupBusy ||
              !lookupEntryId.trim() ||
              lookupReason.trim().length < BLUEPRINT_LIMITS.auditReasonMin
            }
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-purple-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            {lookupBusy && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            Reveal Author &amp; Log Audit
          </button>

          {revealedResult && (
            <div className="rounded-lg border border-purple-200 bg-white p-3 text-xs text-[#0B1A2E]">
              Resolved author:{' '}
              <strong>
                {revealedResult.profile
                  ? `${revealedResult.profile.fullName} (@${revealedResult.profile.username})`
                  : revealedResult.authorUid}
              </strong>{' '}
              · Stored role: <strong>{revealedResult.authorRole}</strong>
            </div>
          )}
        </form>
      )}

      <AdminConfirmDialog
        open={Boolean(pendingDelete)}
        title="Confirm Content Deletion"
        description={
          pendingDelete
            ? `Permanently delete "${pendingDelete.label}"? Cascading cleanup removes attached media and comments where applicable, and logs this moderation action.`
            : ''
        }
        confirmLabel="Delete Permanently"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

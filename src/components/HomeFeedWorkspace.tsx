import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MessageSquare,
  PenSquare,
  Search,
  ShieldAlert,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  fetchCommunityFeedPage,
  type CommunityFeedCursor,
  type CommunityPostWithAuthor,
} from '../services/firestoreFoundation';
import {
  fetchSinglePublishedPostWithAuthor,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
} from '../services/socialPosts';
import type {
  CommunityPost,
  OrdinaryPostType,
  UserRole,
} from '../types/database';
import {
  ActiveRoute,
  FeedTabId,
  ProfileTab,
  SearchScopeId,
  SectionId,
} from '../types/platform';
import {
  canCreateAnonymousEntry,
  canPublishOrdinaryPostStrict,
  toPublicProfileProjection,
} from '../utils/authValidation';
import { getSectionById } from '../utils/sectionState';
import { ContextualSearchBar } from './ContextualSearchBar';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { PostCard } from './posts/PostCard';
import { PostComposer } from './posts/PostComposer';

interface HomeFeedWorkspaceProps {
  activeFeedTab: FeedTabId;
  selectedPostId?: string | null;
  selectedCommentId?: string | null;
  onSelectFeedTab: (tab: FeedTabId) => void;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const FEED_TABS: { id: FeedTabId; label: string }[] = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'latest', label: 'Latest' },
];

const FEED_PAGE_SIZE = 10;

export const HomeFeedWorkspace: React.FC<HomeFeedWorkspaceProps> = ({
  activeFeedTab,
  selectedPostId = null,
  selectedCommentId = null,
  onSelectFeedTab,
  onNavigate,
  onRequireAuth,
}) => {
  const { user, profile, roleRecord, effectiveTier, isSuspended, authReady } =
    useFirebase();
  const [postItems, setPostItems] = useState<CommunityPostWithAuthor[]>([]);
  const [deepLinkedPost, setDeepLinkedPost] = useState<{
    targetId: string;
    item: CommunityPostWithAuthor | null;
  } | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [followingCount, setFollowingCount] = useState<number>(0);
  const [followedUids, setFollowedUids] = useState<string[]>([]);
  const [feedCursor, setFeedCursor] = useState<CommunityFeedCursor | null>(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [retryToken, setRetryToken] = useState(0);
  const [composerFeedback, setComposerFeedback] = useState<{
    kind:
      | 'guest'
      | 'ordinary_restricted'
      | 'anonymous_published'
      | 'ordinary_published'
      | 'suspended';
    message?: string;
  } | null>(null);
  const [composerModal, setComposerModal] = useState<{
    mode: 'ordinary' | 'anonymous';
    ordinaryType?: OrdinaryPostType;
    editPost?: CommunityPost;
  } | null>(null);

  useEffect(() => {
    let active = true;

    const likedPromise = user?.uid
      ? fetchViewerLikedPostIds('posts', user.uid).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>());

    const savedPromise = user?.uid
      ? fetchViewerSavedPostIds('posts', user.uid).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>());

    if (activeFeedTab === 'following' && !user) {
      return () => {
        active = false;
      };
    }

    Promise.all([
      fetchCommunityFeedPage({
        tab: activeFeedTab,
        viewerUid: user?.uid ?? null,
        pageSize: FEED_PAGE_SIZE,
      }),
      likedPromise,
      savedPromise,
    ])
      .then(([page, likedIds, savedIds]) => {
        if (!active) return;
        setFollowingCount(page.followingCount);
        setFollowedUids(page.followedUids);
        setPostItems(page.items);
        setFeedCursor(page.nextCursor);
        setHasMorePosts(page.hasMore);
        setLikedPostIds(likedIds);
        setSavedPostIds(savedIds);
        setLoadState('ready');
      })
      .catch(() => {
        if (!active) return;
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [activeFeedTab, user, retryToken]);

  useEffect(() => {
    if (
      !selectedPostId ||
      loadState !== 'ready' ||
      postItems.some((item) => item.post.id === selectedPostId)
    ) {
      return;
    }
    let active = true;
    fetchSinglePublishedPostWithAuthor(selectedPostId)
      .then((found) => {
        if (!active) return;
        setDeepLinkedPost({ targetId: selectedPostId, item: found });
      })
      .catch(() => {
        if (!active) return;
        setDeepLinkedPost({ targetId: selectedPostId, item: null });
      });
    return () => {
      active = false;
    };
  }, [selectedPostId, loadState, postItems]);

  const displayedPostItems =
    selectedPostId &&
    deepLinkedPost?.targetId === selectedPostId &&
    deepLinkedPost.item &&
    !postItems.some((item) => item.post.id === selectedPostId)
      ? [deepLinkedPost.item, ...postItems]
      : postItems;

  const loadFeed = () => {
    setLoadState('loading');
    setFeedCursor(null);
    setHasMorePosts(false);
    setRetryToken((prev) => prev + 1);
  };

  const handleLoadMore = async () => {
    if (!feedCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityFeedPage({
        tab: activeFeedTab,
        viewerUid: user?.uid ?? null,
        pageSize: FEED_PAGE_SIZE,
        cursor: feedCursor,
        followedUids,
      });
      setPostItems((prev) => {
        const seen = new Set(prev.map((item) => item.post.id));
        const extra = page.items.filter((item) => !seen.has(item.post.id));
        return [...prev, ...extra];
      });
      setFeedCursor(page.nextCursor);
      setHasMorePosts(page.hasMore);
    } catch {
      setComposerFeedback({
        kind: 'suspended',
        message: 'Unable to load additional campus updates right now.',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const activeSection = getSectionById(activeFeedTab as SectionId);
  const canPublishOrdinary = canPublishOrdinaryPostStrict({
    user,
    tier: effectiveTier,
    profile,
    roleRecord,
    suspended: isSuspended,
  });
  const canPostAnonymously = canCreateAnonymousEntry(effectiveTier, isSuspended);
  const actorRole: UserRole = (
    effectiveTier === 'guest' ? 'member' : effectiveTier
  ) as UserRole;

  const handleComposerAction = (action: 'write' | 'photo' | 'anonymous') => {
    setComposerFeedback(null);

    if (!user) {
      setComposerFeedback({ kind: 'guest' });
      return;
    }

    if (isSuspended) {
      setComposerFeedback({
        kind: 'suspended',
        message:
          'Your account is currently suspended and cannot publish or interact with campus posts.',
      });
      return;
    }

    if (action === 'anonymous') {
      if (canPostAnonymously) {
        setComposerModal({ mode: 'anonymous' });
      }
      return;
    }

    if (!canPublishOrdinary) {
      setComposerFeedback({
        kind: 'ordinary_restricted',
        message:
          'Ordinary community feed updates can only be published by Verified members, Moderators, or Supreme Admins with a valid verified badge. As a registered Member, you can still comment, react, and post in Anonymous.',
      });
      return;
    }

    setComposerModal({
      mode: 'ordinary',
      ordinaryType: action === 'photo' ? 'photo' : 'text',
    });
  };

  return (
    <div className="min-w-0 flex-1 space-y-5">
      {/* Contextual Home Search (Members & Public Ordinary Posts) */}
      <ContextualSearchBar
        scope="home"
        embedded
        onNavigate={onNavigate}
        onRequireAuth={onRequireAuth}
        returnRoute={activeFeedTab}
      />

      {/* Prominent Marketplace Shortcut near the top of Homepage */}
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] text-white">
            <ShoppingBag className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-[#0B1A2E]">
              Campus Marketplace
            </p>
            <p className="text-xs text-slate-600">
              Browse student textbooks, accommodation, gadgets, and campus services.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('marketplace')}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0]"
        >
          Open Marketplace
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Main Feed Navigation Tabs: For You · Following · Latest */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div
          role="tablist"
          aria-label="Community feed tabs"
          className="grid grid-cols-3 border-b border-slate-200"
        >
          {FEED_TABS.map((tab) => {
            const isSelected = activeFeedTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setComposerFeedback(null);
                  if (tab.id !== activeFeedTab && !(tab.id === 'following' && !user)) {
                    setLoadState('loading');
                    setFeedCursor(null);
                    setHasMorePosts(false);
                  }
                  onSelectFeedTab(tab.id);
                }}
                className={`relative min-h-[48px] px-3 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'text-[#1E88E5]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                {tab.label}
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-4 bottom-0 left-4 h-0.5 rounded-full bg-[#1E88E5]"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Campus Feed Composer */}
        <div className="p-4 sm:p-5">
          <button
            type="button"
            onClick={() => handleComposerAction('write')}
            className="flex min-h-[48px] w-full items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
          >
            What&apos;s happening on campus?
          </button>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleComposerAction('write')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
              >
                <PenSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Text Post
              </button>

              <button
                type="button"
                onClick={() => handleComposerAction('photo')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
              >
                <ImagePlus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Photo Post
              </button>
            </div>

            {/* Visibly separate Anonymous action */}
            <button
              type="button"
              onClick={() => handleComposerAction('anonymous')}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844]"
            >
              <MessageSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Post Anonymously
            </button>
          </div>

          {composerFeedback?.kind === 'guest' && (
            <div className="mt-4">
              <GuestPromptCard
                title="Sign in to join the campus conversation"
                description="Guests can browse all public updates freely. Sign in or create an account to post anonymously, comment, react, or follow members."
                returnRoute={activeFeedTab}
                onRequireAuth={onRequireAuth}
                onDismiss={() => setComposerFeedback(null)}
              />
            </div>
          )}

          {composerFeedback && composerFeedback.kind !== 'guest' && (
            <div
              role="status"
              className={`mt-4 flex flex-col justify-between gap-3 rounded-xl border p-3.5 text-sm sm:flex-row sm:items-center ${
                composerFeedback.kind === 'suspended'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : composerFeedback.kind === 'anonymous_published' ||
                    composerFeedback.kind === 'ordinary_published'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {composerFeedback.kind === 'anonymous_published' ||
                composerFeedback.kind === 'ordinary_published' ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                    aria-hidden="true"
                  />
                ) : (
                  <ShieldAlert
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      composerFeedback.kind === 'suspended'
                        ? 'text-red-700'
                        : 'text-[#1E88E5]'
                    }`}
                    aria-hidden="true"
                  />
                )}
                <span>{composerFeedback.message}</span>
              </div>
              {composerFeedback.kind === 'anonymous_published' && (
                <button
                  type="button"
                  onClick={() => onNavigate('anonymous')}
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-[#132844]"
                >
                  Open Anonymous
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Feed Content Stream */}
      <section
        aria-labelledby="feed-stream-heading"
        className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
      >
        <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h1
              id="feed-stream-heading"
              className="font-display text-lg font-bold text-[#0B1A2E] sm:text-xl"
            >
              {activeSection.title}
            </h1>
            <p className="mt-0.5 text-sm text-slate-600">
              {activeSection.summary}
            </p>
          </div>
          {!authReady && (
            <span className="text-xs text-slate-500">Checking account...</span>
          )}
        </div>

        <div className="mt-5">
          {activeFeedTab === 'following' && !user ? (
            <GuestPromptCard
              title="Sign in to follow campus accounts"
              description="Your Following feed displays ordinary public updates from members, departments, and verified contributors you follow. Browse For You or Latest as a guest, or sign in to build your feed."
              returnRoute="following"
              onRequireAuth={onRequireAuth}
            />
          ) : loadState === 'loading' ? (
            <LoadingState sectionTitle={activeSection.title} />
          ) : loadState === 'error' ? (
            <ErrorState section={activeSection} onRetry={() => void loadFeed()} />
          ) : activeFeedTab === 'following' && postItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
              <Users
                className="mx-auto mb-2.5 h-6 w-6 text-[#1E88E5]"
                aria-hidden="true"
              />
              <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                {followingCount === 0
                  ? 'You are not following anyone yet'
                  : 'No ordinary posts from accounts you follow yet'}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                {followingCount === 0
                  ? 'Search for classmates, lecturers, and verified campus contributors to follow their public updates.'
                  : `You follow ${followingCount} ${
                      followingCount === 1 ? 'account' : 'accounts'
                    }. Ordinary public posts they publish appear here (anonymous posts never appear here).`}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('search', { searchScope: 'home' })}
                className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1565C0]"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Find Members to Follow
              </button>
            </div>
          ) : displayedPostItems.length === 0 ? (
            <EmptyState section={activeSection} />
          ) : (
            <div className="space-y-4">
              {displayedPostItems.length === 0 ? null : displayedPostItems.map(({ post, author }) => {
                const resolvedAuthor =
                  profile && post.ownerUID === profile.uid
                    ? toPublicProfileProjection(profile)
                    : author;

                return (
                  <PostCard
                    key={post.id}
                    kind="ordinary"
                    post={post}
                    author={resolvedAuthor}
                    viewerUid={user?.uid ?? null}
                    viewerTier={effectiveTier}
                    viewerSuspended={isSuspended}
                    isLiked={likedPostIds.has(post.id)}
                    isSaved={savedPostIds.has(post.id)}
                    isHighlighted={post.id === selectedPostId}
                    highlightCommentId={
                      post.id === selectedPostId ? selectedCommentId : null
                    }
                    onSaveChanged={(postId, saved) =>
                      setSavedPostIds((prev) => {
                        const next = new Set(prev);
                        if (saved) next.add(postId);
                        else next.delete(postId);
                        return next;
                      })
                    }
                    onNavigateProfile={(uname) =>
                      onNavigate('profile', { username: uname })
                    }
                    onRequireAuth={onRequireAuth}
                    returnRoute={activeFeedTab}
                    onEditPost={(targetPost) =>
                      setComposerModal({
                        mode: 'ordinary',
                        editPost: targetPost as CommunityPost,
                      })
                    }
                    onPostUpdated={(updated) =>
                      setPostItems((prev) =>
                        prev.map((item) =>
                          item.post.id === updated.id
                            ? { ...item, post: updated as CommunityPost }
                            : item
                        )
                      )
                    }
                    onPostDeleted={(deletedId) =>
                      setPostItems((prev) =>
                        prev.filter((item) => item.post.id !== deletedId)
                      )
                    }
                  />
                );
              })}

              {hasMorePosts && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void handleLoadMore()}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                  >
                    {loadingMore && (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                        aria-hidden="true"
                      />
                    )}
                    {loadingMore ? 'Loading more...' : 'Load more updates'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {composerModal && user && (
        <PostComposer
          mode={composerModal.mode}
          initialOrdinaryType={composerModal.ordinaryType}
          actorUid={user.uid}
          actorRole={actorRole}
          actorName={profile?.fullName || user.displayName || undefined}
          actorUsername={profile?.username}
          initialPost={composerModal.editPost ?? null}
          onSuccess={(saved) => {
            if (composerModal.mode === 'anonymous') {
              setComposerModal(null);
              setComposerFeedback({
                kind: 'anonymous_published',
                message:
                  'Your anonymous post was published safely with zero identity links.',
              });
              return;
            }

            const savedCommunity = saved as CommunityPost;
            if (composerModal.editPost) {
              setPostItems((prev) =>
                prev.map((item) =>
                  item.post.id === savedCommunity.id
                    ? { ...item, post: savedCommunity }
                    : item
                )
              );
              setComposerFeedback({
                kind: 'ordinary_published',
                message: 'Your community update has been updated.',
              });
            } else {
              if (activeFeedTab !== 'following') {
                const authorProjection = profile
                  ? toPublicProfileProjection(profile)
                  : null;
                setPostItems((prev) => [
                  { post: savedCommunity, author: authorProjection },
                  ...prev.filter((item) => item.post.id !== savedCommunity.id),
                ]);
              }
              setComposerFeedback({
                kind: 'ordinary_published',
                message: 'Your community update is now live.',
              });
            }
            setComposerModal(null);
          }}
          onClose={() => setComposerModal(null)}
        />
      )}
    </div>
  );
};

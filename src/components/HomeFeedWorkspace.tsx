import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Heart,
  ImagePlus,
  MessageCircle,
  MessageSquare,
  PenSquare,
  Search,
  ShieldAlert,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  fetchFollowingFeedPosts,
  fetchPublicCommunityFeedWithAuthors,
  type CommunityPostWithAuthor,
} from '../services/firestoreFoundation';
import {
  ActiveRoute,
  FeedTabId,
  SearchScopeId,
  SectionId,
} from '../types/platform';
import {
  canCreateAnonymousEntry,
  canPublishOrdinaryFeedUpdate,
} from '../utils/authValidation';
import { getSectionById } from '../utils/sectionState';
import { ContextualSearchBar } from './ContextualSearchBar';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { GuestPromptCard } from './auth/GuestPromptCard';

interface HomeFeedWorkspaceProps {
  activeFeedTab: FeedTabId;
  onSelectFeedTab: (tab: FeedTabId) => void;
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string; searchScope?: SearchScopeId }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const FEED_TABS: { id: FeedTabId; label: string }[] = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'latest', label: 'Latest' },
];

export const HomeFeedWorkspace: React.FC<HomeFeedWorkspaceProps> = ({
  activeFeedTab,
  onSelectFeedTab,
  onNavigate,
  onRequireAuth,
}) => {
  const { user, effectiveTier, isSuspended, authReady } = useFirebase();
  const [postItems, setPostItems] = useState<CommunityPostWithAuthor[]>([]);
  const [followingCount, setFollowingCount] = useState<number>(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [retryToken, setRetryToken] = useState(0);
  const [composerFeedback, setComposerFeedback] = useState<{
    kind:
      | 'guest'
      | 'ordinary_restricted'
      | 'anonymous_ready'
      | 'verified_ready'
      | 'suspended';
    message?: string;
  } | null>(null);
  const [interactionGuestPrompt, setInteractionGuestPrompt] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;

    if (activeFeedTab === 'following') {
      if (!user) {
        return () => {
          active = false;
        };
      }

      fetchFollowingFeedPosts(user.uid, 20)
        .then((res) => {
          if (!active) return;
          setFollowingCount(res.followingCount);
          setPostItems(res.items);
          setLoadState('ready');
        })
        .catch(() => {
          if (!active) return;
          setLoadState('error');
        });

      return () => {
        active = false;
      };
    }

    fetchPublicCommunityFeedWithAuthors(20)
      .then((items) => {
        if (!active) return;
        setPostItems(items);
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

  const loadFeed = () => {
    setLoadState('loading');
    setRetryToken((prev) => prev + 1);
  };

  const activeSection = getSectionById(activeFeedTab as SectionId);
  const canPublishOrdinary = canPublishOrdinaryFeedUpdate(
    effectiveTier,
    isSuspended
  );
  const canPostAnonymously = canCreateAnonymousEntry(effectiveTier, isSuspended);

  const handleComposerAction = (action: 'write' | 'photo' | 'anonymous') => {
    setInteractionGuestPrompt(null);

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
        setComposerFeedback({
          kind: 'anonymous_ready',
          message:
            'Your authenticated account is eligible to publish in Anonymous. The full anonymous composer opens in the dedicated Anonymous rollout.',
        });
      }
      return;
    }

    if (!canPublishOrdinary) {
      setComposerFeedback({
        kind: 'ordinary_restricted',
        message:
          'Ordinary community feed updates can only be published by Verified members, Moderators, or Supreme Admins. As a registered Member, you can still comment, react, and post in Anonymous.',
      });
      return;
    }

    setComposerFeedback({
      kind: 'verified_ready',
      message:
        'Your account holds publishing permissions for ordinary community updates. Full post publishing workflows will be connected in the feed publishing phase.',
    });
  };

  const handlePostInteraction = (actionName: string) => {
    if (!user) {
      setInteractionGuestPrompt(
        `Sign in or create a free LASUED Intel account to ${actionName}.`
      );
      return;
    }
    if (isSuspended) {
      setComposerFeedback({
        kind: 'suspended',
        message:
          'Your account is currently suspended and restricted from post interactions.',
      });
      return;
    }
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

      {/* Prominent Marketplace Shortcut near the top of Homepage (Part 8) */}
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
                  setInteractionGuestPrompt(null);
                  if (tab.id !== activeFeedTab && !(tab.id === 'following' && !user)) {
                    setLoadState('loading');
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

        {/* Facebook-inspired Post Composer (Part 7) */}
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
                Write an update
              </button>

              <button
                type="button"
                onClick={() => handleComposerAction('photo')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
              >
                <ImagePlus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Add a photograph
              </button>
            </div>

            {/* Visibly separate Anonymous action */}
            <button
              type="button"
              onClick={() => handleComposerAction('anonymous')}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844]"
            >
              <MessageSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Anonymous
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
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <ShieldAlert
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    composerFeedback.kind === 'suspended'
                      ? 'text-red-700'
                      : 'text-[#1E88E5]'
                  }`}
                  aria-hidden="true"
                />
                <span>{composerFeedback.message}</span>
              </div>
              {composerFeedback.kind === 'anonymous_ready' && (
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

        {interactionGuestPrompt && (
          <div className="mt-4">
            <GuestPromptCard
              title="Account required for this action"
              description={interactionGuestPrompt}
              returnRoute={activeFeedTab}
              onRequireAuth={onRequireAuth}
              onDismiss={() => setInteractionGuestPrompt(null)}
            />
          </div>
        )}

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
          ) : postItems.length === 0 ? (
            <div className="space-y-4">
              <EmptyState section={activeSection} />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-xs text-slate-600">
                  {user
                    ? 'Community reactions, comments, and saves activate as verified updates are published.'
                    : 'Browsing as a guest. Sign in to like, comment, save posts, or follow members.'}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePostInteraction('like posts')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                    Like
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePostInteraction('comment on posts')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Comment
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePostInteraction('save posts')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {postItems.map(({ post, author }) => (
                <article
                  key={post.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    {author ? (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('profile', { username: author.username })
                        }
                        className="inline-flex items-center gap-1.5 font-semibold text-[#0B1A2E] hover:text-[#1E88E5]"
                      >
                        <span>{author.fullName}</span>
                        {author.badge !== 'none' && (
                          <BadgeCheck
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                        )}
                        <span className="font-normal text-slate-500">
                          @{author.username}
                        </span>
                      </button>
                    ) : (
                      <span>Campus Contributor</span>
                    )}
                    <span>
                      {post.category} ·{' '}
                      {post.isOfficial ? 'Official Update' : 'Community'}
                    </span>
                  </div>
                  {post.title && (
                    <h2 className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]">
                      {post.title}
                    </h2>
                  )}
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                    {post.body}
                  </p>
                  <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => handlePostInteraction('like this post')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <Heart className="h-4 w-4" aria-hidden="true" />
                      <span>{post.likesCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handlePostInteraction('comment on this post')
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      <span>{post.commentsCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePostInteraction('save this post')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <Bookmark className="h-4 w-4" aria-hidden="true" />
                      <span>Save</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import {
  EyeOff,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  Type,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  fetchPublicAnonymousFeedPage,
  type AnonymousFeedPageCursor,
} from '../services/firestoreFoundation';
import {
  fetchMyAnonymousHistory,
  fetchOwnedAnonymousEntries,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
} from '../services/socialPosts';
import type { AnonymousPost, UserRole } from '../types/database';
import {
  ActiveRoute,
  ProfileTab,
  SearchScopeId,
  SectionId,
  ViewState,
} from '../types/platform';
import { getSectionById } from '../utils/sectionState';
import { ContextualSearchBar } from './ContextualSearchBar';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { PostCard } from './posts/PostCard';
import { PostComposer } from './posts/PostComposer';
import { SectionIcon } from './SectionIcon';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { EventsSection } from './sections/EventsSection';
import { MarketplaceSection } from './sections/MarketplaceSection';
import { OpportunitiesSection } from './sections/OpportunitiesSection';
import { TrustedCircleSection } from './sections/TrustedCircleSection';

interface SectionWorkspaceProps {
  sectionId: Exclude<SectionId, 'for-you' | 'following' | 'latest'>;
  selectedOpportunityId?: string | null;
  selectedEventId?: string | null;
  sectionStates: Record<SectionId, ViewState>;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
      opportunityId?: string | null;
      eventId?: string | null;
    }
  ) => void;
  onRetry: (sectionId: SectionId) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const SectionWorkspace: React.FC<SectionWorkspaceProps> = ({
  sectionId,
  selectedOpportunityId = null,
  selectedEventId = null,
  sectionStates,
  onNavigate,
  onRetry,
  onRequireAuth,
}) => {
  const { user, effectiveTier, isSuspended } = useFirebase();
  const activeSection = getSectionById(sectionId);
  const fallbackState = sectionStates[activeSection.id];

  const [anonymousPosts, setAnonymousPosts] = useState<AnonymousPost[]>([]);
  const [anonCursor, setAnonCursor] = useState<AnonymousFeedPageCursor | null>(
    null
  );
  const [hasMoreAnon, setHasMoreAnon] = useState(false);
  const [loadingMoreAnon, setLoadingMoreAnon] = useState(false);

  const [anonViewTab, setAnonViewTab] = useState<'feed' | 'mine'>('feed');
  const [myAnonState, setMyAnonState] = useState<{
    loadedKey: string | null;
    items: AnonymousPost[];
    error: string | null;
  }>({ loadedKey: null, items: [], error: null });

  const [likedAnonIds, setLikedAnonIds] = useState<Set<string>>(new Set());
  const [savedAnonIds, setSavedAnonIds] = useState<Set<string>>(new Set());
  const [ownedAnonPostIds, setOwnedAnonPostIds] = useState<Set<string>>(
    new Set()
  );
  const [ownedAnonCommentIds, setOwnedAnonCommentIds] = useState<Set<string>>(
    new Set()
  );
  const [anonLoadState, setAnonLoadState] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [retryToken, setRetryToken] = useState(0);
  const [actionPrompt, setActionPrompt] = useState<
    'none' | 'guest' | 'suspended'
  >('none');
  const [composerModal, setComposerModal] = useState<{
    open: boolean;
    editPost?: AnonymousPost;
  }>({ open: false });

  const activeAnonTab = user ? anonViewTab : 'feed';
  const myAnonTargetKey = user?.uid ? `${user.uid}:${retryToken}` : null;
  const myAnonLoading =
    sectionId === 'anonymous' &&
    activeAnonTab === 'mine' &&
    Boolean(myAnonTargetKey) &&
    myAnonState.loadedKey !== myAnonTargetKey;
  const myAnonPosts =
    myAnonTargetKey && myAnonState.loadedKey === myAnonTargetKey
      ? myAnonState.items
      : [];
  const myAnonError =
    myAnonTargetKey && myAnonState.loadedKey === myAnonTargetKey
      ? myAnonState.error
      : null;

  useEffect(() => {
    if (sectionId !== 'anonymous') {
      return;
    }

    let active = true;

    const likedPromise = user?.uid
      ? fetchViewerLikedPostIds('anonymousPosts', user.uid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    const savedPromise = user?.uid
      ? fetchViewerSavedPostIds('anonymousPosts', user.uid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    const ownedPromise = user?.uid
      ? fetchOwnedAnonymousEntries(user.uid).catch(() => ({
          postIds: new Set<string>(),
          commentIds: new Set<string>(),
        }))
      : Promise.resolve({
          postIds: new Set<string>(),
          commentIds: new Set<string>(),
        });

    Promise.all([
      fetchPublicAnonymousFeedPage({ pageSize: 12 }),
      likedPromise,
      savedPromise,
      ownedPromise,
    ])
      .then(([page, likedIds, savedIds, owned]) => {
        if (!active) return;
        setAnonymousPosts(page.items);
        setAnonCursor(page.nextCursor);
        setHasMoreAnon(page.hasMore);
        setLikedAnonIds(likedIds);
        setSavedAnonIds(savedIds);
        setOwnedAnonPostIds(owned.postIds);
        setOwnedAnonCommentIds(owned.commentIds);
        setAnonLoadState('ready');
      })
      .catch(() => {
        if (!active) return;
        setAnonLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [sectionId, user?.uid, retryToken]);

  useEffect(() => {
    if (
      sectionId !== 'anonymous' ||
      activeAnonTab !== 'mine' ||
      !user?.uid ||
      !myAnonTargetKey ||
      myAnonState.loadedKey === myAnonTargetKey
    ) {
      return;
    }
    let active = true;
    fetchMyAnonymousHistory(user.uid)
      .then((items) => {
        if (!active) return;
        setMyAnonState({ loadedKey: myAnonTargetKey, items, error: null });
      })
      .catch(() => {
        if (!active) return;
        setMyAnonState({
          loadedKey: myAnonTargetKey,
          items: [],
          error: 'Unable to load your anonymous posts right now.',
        });
      });

    return () => {
      active = false;
    };
  }, [
    sectionId,
    activeAnonTab,
    user?.uid,
    myAnonTargetKey,
    myAnonState.loadedKey,
  ]);

  const loadAnonymous = () => {
    setAnonLoadState('loading');
    setRetryToken((prev) => prev + 1);
  };

  const handleLoadMoreAnonymous = async () => {
    if (!anonCursor || loadingMoreAnon) return;
    setLoadingMoreAnon(true);
    try {
      const page = await fetchPublicAnonymousFeedPage({
        pageSize: 12,
        cursor: anonCursor,
      });
      setAnonymousPosts((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const extra = page.items.filter((item) => !seen.has(item.id));
        return [...prev, ...extra];
      });
      setAnonCursor(page.nextCursor);
      setHasMoreAnon(page.hasMore);
    } finally {
      setLoadingMoreAnon(false);
    }
  };

  const handleAnonymousPostClick = () => {
    if (!user) {
      setActionPrompt('guest');
      return;
    }
    if (isSuspended) {
      setActionPrompt('suspended');
      return;
    }
    setActionPrompt('none');
    setComposerModal({ open: true });
  };

  const actorRole: UserRole = (
    effectiveTier === 'guest' ? 'member' : effectiveTier
  ) as UserRole;

  const displayedAnonPosts =
    activeAnonTab === 'mine' && user ? myAnonPosts : anonymousPosts;

  return (
    <section
      aria-labelledby="active-section-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Inline Contextual Search scoped strictly to this section */}
      <ContextualSearchBar
        scope={sectionId}
        embedded
        onNavigate={onNavigate}
        onRequireAuth={onRequireAuth}
        returnRoute={sectionId}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <button
                type="button"
                onClick={() => onNavigate('for-you')}
                className="text-[#1E88E5] hover:underline"
              >
                Home
              </button>
              <span aria-hidden="true">/</span>
              <span>{activeSection.group}</span>
            </div>

            <h1
              id="active-section-heading"
              className="mt-2 flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-[#0B1A2E] sm:text-3xl"
            >
              <SectionIcon
                sectionId={activeSection.id}
                className="h-6 w-6 shrink-0 text-[#1E88E5]"
              />
              <span>{activeSection.title}</span>
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              {activeSection.summary}
            </p>
          </div>

          {sectionId === 'anonymous' && (
            <button
              type="button"
              onClick={handleAnonymousPostClick}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844]"
            >
              <MessageSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Post Anonymously
            </button>
          )}
        </div>

        {sectionId === 'anonymous' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs leading-relaxed text-slate-600">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                aria-hidden="true"
              />
              <span>
                Your identity, photo EXIF metadata, and filenames are stripped
                automatically before publishing. Every active registered LASUED
                Intel account can share text-only cards or 1–4 anonymous photos.
              </span>
            </div>

            {/* Inline Quick Compose Prompt Strip */}
            <button
              type="button"
              onClick={handleAnonymousPostClick}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-[#1E88E5]/50 hover:bg-slate-50/60"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B1A2E] text-white">
                  <EyeOff className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                </span>
                <span className="truncate text-sm text-slate-500">
                  Share an anonymous campus thought or photo...
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-2 text-xs font-semibold text-slate-500 sm:inline-flex">
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                  <Type className="h-3.5 w-3.5 text-[#0B1A2E]" aria-hidden="true" />
                  Text
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                  <ImageIcon className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Photos
                </span>
              </span>
            </button>

            {user && (
              <div
                role="tablist"
                aria-label="Anonymous feed views"
                className="inline-flex rounded-xl bg-slate-100 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeAnonTab === 'feed'}
                  onClick={() => setAnonViewTab('feed')}
                  className={`min-h-[38px] rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
                    activeAnonTab === 'feed'
                      ? 'bg-white text-[#0B1A2E] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1A2E]'
                  }`}
                >
                  Community Feed
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeAnonTab === 'mine'}
                  onClick={() => setAnonViewTab('mine')}
                  className={`min-h-[38px] rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
                    activeAnonTab === 'mine'
                      ? 'bg-white text-[#0B1A2E] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1A2E]'
                  }`}
                >
                  My Anonymous Posts
                </button>
              </div>
            )}
          </div>
        )}

        {actionPrompt === 'guest' && (
          <div className="mt-5">
            <GuestPromptCard
              title="Sign in to post anonymously"
              description="Guests can browse public anonymous posts freely. Sign in or create a free LASUED Intel account to publish anonymous posts or replies."
              returnRoute="anonymous"
              onRequireAuth={onRequireAuth}
              onDismiss={() => setActionPrompt('none')}
            />
          </div>
        )}

        {actionPrompt === 'suspended' && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Your account is suspended and cannot create anonymous posts or
              replies.
            </span>
          </div>
        )}

        <div className="mt-6">
          {sectionId === 'anonymous' ? (
            activeAnonTab === 'mine' && user ? (
              myAnonLoading ? (
                <LoadingState sectionTitle="My Anonymous Posts" />
              ) : myAnonError ? (
                <ErrorState
                  section={activeSection}
                  onRetry={() => {
                    setRetryToken((prev) => prev + 1);
                  }}
                />
              ) : displayedAnonPosts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
                  <p className="text-sm font-semibold text-[#0B1A2E]">
                    You haven&apos;t published any anonymous posts yet
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Your anonymous submissions appear privately here so only you
                    can review, edit, or delete them later.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {displayedAnonPosts.map((item) => (
                    <PostCard
                      key={item.id}
                      kind="anonymous"
                      post={item}
                      viewerUid={user?.uid ?? null}
                      viewerTier={effectiveTier}
                      viewerSuspended={isSuspended}
                      isLiked={likedAnonIds.has(item.id)}
                      isSaved={savedAnonIds.has(item.id)}
                      onSaveChanged={(postId, saved) =>
                        setSavedAnonIds((prev) => {
                          const next = new Set(prev);
                          if (saved) next.add(postId);
                          else next.delete(postId);
                          return next;
                        })
                      }
                      isOwnedAnonymous={
                        ownedAnonPostIds.has(item.id) || activeAnonTab === 'mine'
                      }
                      ownedAnonymousCommentIds={ownedAnonCommentIds}
                      onRequireAuth={onRequireAuth}
                      returnRoute="anonymous"
                      onEditPost={(targetPost) =>
                        setComposerModal({
                          open: true,
                          editPost: targetPost as AnonymousPost,
                        })
                      }
                      onPostUpdated={(updated) => {
                        const updatedAnon = updated as AnonymousPost;
                        setAnonymousPosts((prev) =>
                          prev.map((existing) =>
                            existing.id === updatedAnon.id ? updatedAnon : existing
                          )
                        );
                        setMyAnonState((prev) => ({
                          ...prev,
                          items: prev.items.map((existing) =>
                            existing.id === updatedAnon.id ? updatedAnon : existing
                          ),
                        }));
                      }}
                      onPostDeleted={(deletedId) => {
                        setAnonymousPosts((prev) =>
                          prev.filter((existing) => existing.id !== deletedId)
                        );
                        setMyAnonState((prev) => ({
                          ...prev,
                          items: prev.items.filter(
                            (existing) => existing.id !== deletedId
                          ),
                        }));
                        setOwnedAnonPostIds((prev) => {
                          const next = new Set(prev);
                          next.delete(deletedId);
                          return next;
                        });
                      }}
                      onAnonymousCommentTracked={(commentId, action) =>
                        setOwnedAnonCommentIds((prev) => {
                          const next = new Set(prev);
                          if (action === 'add') next.add(commentId);
                          else next.delete(commentId);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              )
            ) : anonLoadState === 'loading' ? (
              <LoadingState sectionTitle={activeSection.title} />
            ) : anonLoadState === 'error' ? (
              <ErrorState
                section={activeSection}
                onRetry={() => void loadAnonymous()}
              />
            ) : anonymousPosts.length === 0 ? (
              <EmptyState section={activeSection} />
            ) : (
              <div className="space-y-4">
                {anonymousPosts.map((item) => (
                  <PostCard
                    key={item.id}
                    kind="anonymous"
                    post={item}
                    viewerUid={user?.uid ?? null}
                    viewerTier={effectiveTier}
                    viewerSuspended={isSuspended}
                    isLiked={likedAnonIds.has(item.id)}
                    isSaved={savedAnonIds.has(item.id)}
                    onSaveChanged={(postId, saved) =>
                      setSavedAnonIds((prev) => {
                        const next = new Set(prev);
                        if (saved) next.add(postId);
                        else next.delete(postId);
                        return next;
                      })
                    }
                    isOwnedAnonymous={ownedAnonPostIds.has(item.id)}
                    ownedAnonymousCommentIds={ownedAnonCommentIds}
                    onRequireAuth={onRequireAuth}
                    returnRoute="anonymous"
                    onEditPost={(targetPost) =>
                      setComposerModal({
                        open: true,
                        editPost: targetPost as AnonymousPost,
                      })
                    }
                    onPostUpdated={(updated) => {
                      const updatedAnon = updated as AnonymousPost;
                      setAnonymousPosts((prev) =>
                        prev.map((existing) =>
                          existing.id === updatedAnon.id ? updatedAnon : existing
                        )
                      );
                      setMyAnonState((prev) => ({
                        ...prev,
                        items: prev.items.map((existing) =>
                          existing.id === updatedAnon.id ? updatedAnon : existing
                        ),
                      }));
                    }}
                    onPostDeleted={(deletedId) => {
                      setAnonymousPosts((prev) =>
                        prev.filter((existing) => existing.id !== deletedId)
                      );
                      setMyAnonState((prev) => ({
                        ...prev,
                        items: prev.items.filter(
                          (existing) => existing.id !== deletedId
                        ),
                      }));
                      setOwnedAnonPostIds((prev) => {
                        const next = new Set(prev);
                        next.delete(deletedId);
                        return next;
                      });
                    }}
                    onAnonymousCommentTracked={(commentId, action) =>
                      setOwnedAnonCommentIds((prev) => {
                        const next = new Set(prev);
                        if (action === 'add') {
                          next.add(commentId);
                        } else {
                          next.delete(commentId);
                        }
                        return next;
                      })
                    }
                  />
                ))}

                {hasMoreAnon && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      disabled={loadingMoreAnon}
                      onClick={() => void handleLoadMoreAnonymous()}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                    >
                      {loadingMoreAnon && (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                          aria-hidden="true"
                        />
                      )}
                      {loadingMoreAnon
                        ? 'Loading more...'
                        : 'Load more anonymous posts'}
                    </button>
                  </div>
                )}
              </div>
            )
          ) : sectionId === 'marketplace' ? (
            <MarketplaceSection
              onRequireAuth={onRequireAuth}
              onNavigateProfile={(uname) =>
                onNavigate('profile', { username: uname })
              }
            />
          ) : sectionId === 'opportunities' ? (
            <OpportunitiesSection
              selectedOpportunityId={selectedOpportunityId}
              onSelectOpportunity={(oppId) =>
                onNavigate('opportunities', { opportunityId: oppId })
              }
              onRequireAuth={onRequireAuth}
            />
          ) : sectionId === 'upcoming-events' ? (
            <EventsSection
              selectedEventId={selectedEventId}
              onSelectEvent={(evtId) =>
                onNavigate('upcoming-events', { eventId: evtId })
              }
              onNavigateProfile={(uname) =>
                onNavigate('profile', { username: uname })
              }
              onRequireAuth={onRequireAuth}
            />
          ) : sectionId === 'trusted-circle' ? (
            <TrustedCircleSection
              onNavigate={onNavigate}
              onRequireAuth={onRequireAuth}
            />
          ) : (
            <>
              {fallbackState === 'loading' && (
                <LoadingState sectionTitle={activeSection.title} />
              )}
              {fallbackState === 'empty' && (
                <EmptyState section={activeSection} />
              )}
              {fallbackState === 'error' && (
                <ErrorState
                  section={activeSection}
                  onRetry={() => onRetry(activeSection.id)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {composerModal.open && user && (
        <PostComposer
          mode="anonymous"
          actorUid={user.uid}
          actorRole={actorRole}
          initialPost={composerModal.editPost ?? null}
          onSuccess={(saved) => {
            const savedAnon = saved as AnonymousPost;
            if (composerModal.editPost) {
              setAnonymousPosts((prev) =>
                prev.map((item) => (item.id === savedAnon.id ? savedAnon : item))
              );
              setMyAnonState((prev) => ({
                ...prev,
                items: prev.items.map((item) =>
                  item.id === savedAnon.id ? savedAnon : item
                ),
              }));
            } else {
              setAnonymousPosts((prev) => [savedAnon, ...prev]);
              setMyAnonState((prev) =>
                prev.loadedKey === myAnonTargetKey
                  ? { ...prev, items: [savedAnon, ...prev.items] }
                  : prev
              );
              setOwnedAnonPostIds((prev) => {
                const next = new Set(prev);
                next.add(savedAnon.id);
                return next;
              });
            }
            setComposerModal({ open: false });
          }}
          onClose={() => setComposerModal({ open: false })}
        />
      )}
    </section>
  );
};

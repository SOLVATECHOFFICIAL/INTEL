import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { useActiveBackgroundRefresh } from '../hooks/useActiveBackgroundRefresh';
import { toggleEventReaction } from '../services/events';
import {
  fetchCommunityFeedPage,
  type CommunityFeedCursor,
  type CommunityPostWithAuthor,
} from '../services/firestoreFoundation';
import { prefetchMediaImages } from '../services/mediaStorage';
import {
  clearHomeFeedSessionCache,
  getHomeFeedSessionSnapshot,
  hydrateHomeFeedSnapshot,
  loadPersonalisationContextAndDiscovery,
  saveHomeFeedSessionSnapshot,
  type ForYouDiscoveryBundle,
} from '../services/personalisedFeed';
import {
  fetchSinglePublishedPostWithAuthor,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
  toggleSavedPost,
} from '../services/socialPosts';
import type {
  CampusEvent,
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
import {
  buildForYouFeedStream,
  loadDismissedRecommendationKeys,
  saveDismissedRecommendationKey,
  type ForYouRankingOptions,
} from '../utils/feedRanking';
import { computeOptimisticReactionToggle } from '../utils/optimisticInteractions';
import { mergeCommunityPostItems } from '../utils/cacheSync';
import { isDataSaverConnection } from '../utils/mediaCache';
import { getSectionById } from '../utils/sectionState';
import type { AccountSettingsSection } from '../types/platform';
import { ContextualSearchBar } from './ContextualSearchBar';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { PostCard } from './posts/PostCard';
import { PostComposer } from './posts/PostComposer';
import { EventCard } from './sections/events/EventCard';
import { OpportunityCard } from './sections/opportunities/OpportunityCard';
import { MemberDirectoryCard } from './sections/shared/DirectoryProfileCards';

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
      searchQuery?: string | null;
      postId?: string | null;
      commentId?: string | null;
      eventId?: string | null;
      opportunityId?: string | null;
      accountSection?: AccountSettingsSection;
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
  const {
    authReady,
    user,
    profile,
    roleRecord,
    effectiveTier,
    isSuspended,
    interestCategories,
    followingUsernames,
  } = useFirebase();

  const viewerKey = user?.uid ?? 'guest';
  const interestSignature = useMemo(
    () =>
      [
        profile?.department ?? '',
        profile?.faculty ?? '',
        profile?.level ?? '',
        ...interestCategories,
      ]
        .join('|')
        .toLowerCase(),
    [profile?.department, profile?.faculty, profile?.level, interestCategories]
  );

  const initialCache = useMemo(() => {
    const snap = getHomeFeedSessionSnapshot(viewerKey, activeFeedTab);
    if (!snap) return null;
    if (
      activeFeedTab === 'for-you' &&
      snap.interestSignature !== interestSignature
    ) {
      return null;
    }
    return snap;
  }, [viewerKey, activeFeedTab, interestSignature]);

  const [postItems, setPostItems] = useState<CommunityPostWithAuthor[]>(
    () => initialCache?.postItems ?? []
  );
  const [deepLinkedPost, setDeepLinkedPost] = useState<{
    targetId: string;
    item: CommunityPostWithAuthor | null;
  } | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(
    () => initialCache?.likedPostIds ?? new Set()
  );
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(
    () => initialCache?.savedPostIds ?? new Set()
  );
  const [followingCount, setFollowingCount] = useState<number>(
    () => initialCache?.followingCount ?? 0
  );
  const [followedUids, setFollowedUids] = useState<string[]>(
    () => initialCache?.followedUids ?? []
  );
  const [feedCursor, setFeedCursor] = useState<CommunityFeedCursor | null>(
    () => initialCache?.feedCursor ?? null
  );
  const [hasMorePosts, setHasMorePosts] = useState(
    () => initialCache?.hasMorePosts ?? false
  );
  const [rankingOptions, setRankingOptions] = useState<
    Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'> | undefined
  >(() => initialCache?.rankingOptions);
  const [discovery, setDiscovery] = useState<ForYouDiscoveryBundle | undefined>(
    () => initialCache?.discovery
  );
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() =>
    loadDismissedRecommendationKeys(user?.uid ?? null)
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    () => (initialCache ? 'ready' : 'loading')
  );
  const [retryToken, setRetryToken] = useState(0);
  const [savingOppId, setSavingOppId] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());
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

  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastHandledRetryRef = useRef(0);
  const latestProfileRef = useRef(profile);
  const latestInterestsRef = useRef(interestCategories);
  const latestFollowingUsernamesRef = useRef(followingUsernames);
  useEffect(() => {
    latestProfileRef.current = profile;
    latestInterestsRef.current = interestCategories;
    latestFollowingUsernamesRef.current = followingUsernames;
  }, [profile, interestCategories, followingUsernames]);

  const activeViewerUid = user?.uid ?? null;
  const activeTabRef = useRef(activeFeedTab);
  const viewerKeyRef = useRef(viewerKey);
  const activeViewerUidRef = useRef(activeViewerUid);
  const interestSigRef = useRef(interestSignature);
  const postItemsRef = useRef(postItems);
  const loadStateRef = useRef(loadState);

  useEffect(() => {
    activeTabRef.current = activeFeedTab;
    viewerKeyRef.current = viewerKey;
    activeViewerUidRef.current = activeViewerUid;
    interestSigRef.current = interestSignature;
    postItemsRef.current = postItems;
    loadStateRef.current = loadState;
  }, [
    activeFeedTab,
    viewerKey,
    activeViewerUid,
    interestSignature,
    postItems,
    loadState,
  ]);

  const prefetchLeadPostMedia = useCallback(
    (items: readonly CommunityPostWithAuthor[]) => {
      if (isDataSaverConnection()) return;
      const imageIds = items
        .slice(0, 5)
        .flatMap((entry) => [
          entry.author?.photoImageId,
          entry.post.mediaItems?.[0]?.imageId,
        ]);
      if (imageIds.some(Boolean)) {
        void prefetchMediaImages(imageIds);
      }
    },
    []
  );

  const syncHomeFeedFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      const targetTab = activeTabRef.current;
      const uid = activeViewerUidRef.current;
      if (targetTab === 'following' && !uid) return;
      if (
        mode === 'background' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }

      const likedPromise = uid
        ? fetchViewerLikedPostIds('posts', uid).catch(
            () => new Set<string>()
          )
        : Promise.resolve(new Set<string>());

      const savedPromise = uid
        ? fetchViewerSavedPostIds('posts', uid).catch(
            () => new Set<string>()
          )
        : Promise.resolve(new Set<string>());

      const [likedIds, savedIds] = await Promise.all([
        likedPromise,
        savedPromise,
      ]);

      let nextRankingOptions:
        | Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'>
        | undefined;
      let nextDiscovery: ForYouDiscoveryBundle | undefined;

      if (targetTab === 'for-you') {
        const personalisation = await loadPersonalisationContextAndDiscovery({
          viewerUid: uid,
          viewerProfile: latestProfileRef.current,
          interestCategories: latestInterestsRef.current,
          followedUids: [],
          followingUsernames: latestFollowingUsernamesRef.current,
          likedPostIds: likedIds,
          savedPostIds: savedIds,
          dismissedKeys: loadDismissedRecommendationKeys(uid),
        }).catch(() => null);

        if (personalisation) {
          nextRankingOptions = personalisation.rankingOptions;
          nextDiscovery = personalisation.discovery;
        }
      }

      const page = await fetchCommunityFeedPage({
        tab: targetTab,
        viewerUid: uid,
        pageSize: FEED_PAGE_SIZE,
        rankingOptions: nextRankingOptions,
      });

      if (isCancelled?.()) return;

      if (nextDiscovery && latestFollowingUsernamesRef.current.size > 0) {
        const currentFollowingSet = latestFollowingUsernamesRef.current;
        nextDiscovery = {
          ...nextDiscovery,
          recommendedPeople: nextDiscovery.recommendedPeople.filter(
            (item) =>
              !currentFollowingSet.has(item.member.username.toLowerCase())
          ),
        };
      }

      setFollowingCount(page.followingCount);
      setFollowedUids(page.followedUids);
      setPostItems((prev) =>
        mode === 'background' && prev.length > 0
          ? mergeCommunityPostItems({
              existing: prev,
              incoming: page.items,
              preferIncomingOrder: false,
              preserveTail: true,
            })
          : page.items
      );
      setFeedCursor((prevCursor) =>
        mode === 'background' &&
        postItemsRef.current.length > page.items.length &&
        prevCursor
          ? prevCursor
          : page.nextCursor
      );
      setHasMorePosts((prevHasMore) =>
        mode === 'background' && postItemsRef.current.length > page.items.length
          ? prevHasMore
          : page.hasMore
      );
      setLikedPostIds(likedIds);
      setSavedPostIds(savedIds);
      if (nextRankingOptions) {
        setRankingOptions(nextRankingOptions);
      }
      if (nextDiscovery) {
        setDiscovery(nextDiscovery);
      }
      setDismissedKeys(loadDismissedRecommendationKeys(uid));
      setLoadState('ready');
      prefetchLeadPostMedia(page.items);
    },
    [prefetchLeadPostMedia]
  );

  useEffect(() => {
    if (activeFeedTab === 'following' && !activeViewerUid) {
      return;
    }

    let active = true;
    let networkSettled = false;

    const cached = getHomeFeedSessionSnapshot(viewerKey, activeFeedTab);
    const ramMatches =
      Boolean(cached) &&
      retryToken === lastHandledRetryRef.current &&
      (activeFeedTab !== 'for-you' ||
        cached?.interestSignature === interestSignature);

    if (ramMatches && cached) {
      prefetchLeadPostMedia(cached.postItems);
      if (Date.now() - cached.cachedAt > 15_000) {
        void syncHomeFeedFromNetwork('background', () => !active).catch(
          () => undefined
        );
      }
      return () => {
        active = false;
      };
    }

    lastHandledRetryRef.current = retryToken;

    const run = async () => {
      // Cold-reload persistent IDB fast paint before network settles
      if (retryToken === 0) {
        const persisted = await hydrateHomeFeedSnapshot(
          viewerKey,
          activeFeedTab
        );
        if (
          active &&
          !networkSettled &&
          persisted &&
          persisted.postItems.length > 0 &&
          (activeFeedTab !== 'for-you' ||
            !persisted.interestSignature ||
            persisted.interestSignature === interestSignature)
        ) {
          setFollowingCount(persisted.followingCount);
          setFollowedUids(persisted.followedUids);
          setPostItems(persisted.postItems);
          setFeedCursor(persisted.feedCursor);
          setHasMorePosts(persisted.hasMorePosts);
          setLikedPostIds(persisted.likedPostIds);
          setSavedPostIds(persisted.savedPostIds);
          if (persisted.discovery) setDiscovery(persisted.discovery);
          setLoadState('ready');
          prefetchLeadPostMedia(persisted.postItems);

          // Revalidate silently in background
          await syncHomeFeedFromNetwork('background', () => !active).catch(
            () => undefined
          );
          return;
        }
      }

      await syncHomeFeedFromNetwork('initial', () => !active);
      networkSettled = true;
    };

    void run().catch(() => {
      if (!active) return;
      if (postItemsRef.current.length > 0) {
        setLoadState('ready');
      } else {
        setLoadState('error');
      }
    });

    return () => {
      active = false;
    };
  }, [
    activeFeedTab,
    activeViewerUid,
    viewerKey,
    retryToken,
    interestSignature,
    prefetchLeadPostMedia,
    syncHomeFeedFromNetwork,
  ]);

  useActiveBackgroundRefresh({
    enabled:
      loadState === 'ready' && !(activeFeedTab === 'following' && !activeViewerUid),
    onRefresh: () => syncHomeFeedFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  useEffect(() => {
    if (loadState !== 'ready') return;
    if (activeFeedTab === 'following' && !user) return;
    saveHomeFeedSessionSnapshot({
      viewerKey,
      tab: activeFeedTab,
      postItems,
      likedPostIds,
      savedPostIds,
      followingCount,
      followedUids,
      feedCursor,
      hasMorePosts,
      rankingOptions,
      discovery,
      interestSignature,
      cachedAt: Date.now(),
    });
  }, [
    loadState,
    viewerKey,
    activeFeedTab,
    user,
    postItems,
    likedPostIds,
    savedPostIds,
    followingCount,
    followedUids,
    feedCursor,
    hasMorePosts,
    rankingOptions,
    discovery,
    interestSignature,
  ]);

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

  const displayedPostItems = useMemo(
    () =>
      selectedPostId &&
      deepLinkedPost?.targetId === selectedPostId &&
      deepLinkedPost.item &&
      !postItems.some((item) => item.post.id === selectedPostId)
        ? [deepLinkedPost.item, ...postItems]
        : postItems,
    [selectedPostId, deepLinkedPost, postItems]
  );

  const forYouStream = useMemo(() => {
    if (activeFeedTab !== 'for-you') return [];
    return buildForYouFeedStream({
      posts: displayedPostItems,
      recommendedPeople: discovery?.recommendedPeople,
      recommendedEvents: discovery?.recommendedEvents,
      recommendedOpportunities: discovery?.recommendedOpportunities,
      recommendedAnonymous: discovery?.recommendedAnonymous,
      dismissedKeys,
    });
  }, [activeFeedTab, displayedPostItems, discovery, dismissedKeys]);

  const loadFeed = () => {
    clearHomeFeedSessionCache(activeFeedTab);
    setLoadState('loading');
    setFeedCursor(null);
    setHasMorePosts(false);
    setRetryToken((prev) => prev + 1);
  };

  const handleLoadMore = useCallback(async () => {
    if (!feedCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityFeedPage({
        tab: activeFeedTab,
        viewerUid: user?.uid ?? null,
        pageSize: FEED_PAGE_SIZE,
        cursor: feedCursor,
        followedUids,
        rankingOptions,
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
  }, [feedCursor, loadingMore, activeFeedTab, user, followedUids, rankingOptions]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !hasMorePosts ||
      !feedCursor ||
      loadingMore ||
      (activeFeedTab === 'following' && !user)
    ) {
      return;
    }
    const target = loadMoreSentinelRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void handleLoadMore();
        }
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    loadState,
    hasMorePosts,
    feedCursor,
    loadingMore,
    activeFeedTab,
    user,
    handleLoadMore,
  ]);

  const handleDismissRecommendation = (recKey: string) => {
    const next = saveDismissedRecommendationKey(user?.uid ?? null, recKey);
    setDismissedKeys(next);
  };

  const handleToggleRecommendedEventLike = async (event: CampusEvent) => {
    if (!user) {
      onRequireAuth('login', 'for-you');
      return;
    }
    if (isSuspended || !discovery) return;

    const currentLiked = discovery.likedEventIds.has(event.id);
    const optimistic = computeOptimisticReactionToggle({
      currentlyLiked: currentLiked,
      currentCount: event.likesCount ?? 0,
    });

    setDiscovery((prev) => {
      if (!prev) return prev;
      const nextLiked = new Set(prev.likedEventIds);
      if (optimistic.nextLiked) nextLiked.add(event.id);
      else nextLiked.delete(event.id);
      return {
        ...prev,
        likedEventIds: nextLiked,
        recommendedEvents: prev.recommendedEvents.map((rec) =>
          rec.event.id === event.id
            ? { ...rec, event: { ...rec.event, likesCount: optimistic.nextCount } }
            : rec
        ),
      };
    });

    try {
      await toggleEventReaction({ eventId: event.id, actorUid: user.uid });
    } catch {
      setDiscovery((prev) => {
        if (!prev) return prev;
        const nextLiked = new Set(prev.likedEventIds);
        if (currentLiked) nextLiked.add(event.id);
        else nextLiked.delete(event.id);
        return {
          ...prev,
          likedEventIds: nextLiked,
          recommendedEvents: prev.recommendedEvents.map((rec) =>
            rec.event.id === event.id
              ? { ...rec, event: { ...rec.event, likesCount: event.likesCount ?? 0 } }
              : rec
          ),
        };
      });
    }
  };

  const handleToggleRecommendedEventSave = async (event: CampusEvent) => {
    if (!user) {
      onRequireAuth('login', 'for-you');
      return;
    }
    if (isSuspended || !discovery) return;

    const currentlySaved = discovery.savedEventIds.has(event.id);
    setDiscovery((prev) => {
      if (!prev) return prev;
      const nextSaved = new Set(prev.savedEventIds);
      if (currentlySaved) nextSaved.delete(event.id);
      else nextSaved.add(event.id);
      return { ...prev, savedEventIds: nextSaved };
    });

    try {
      await toggleSavedPost({
        actorUid: user.uid,
        targetCollection: 'events',
        targetId: event.id,
        currentlySaved,
      });
    } catch {
      setDiscovery((prev) => {
        if (!prev) return prev;
        const nextSaved = new Set(prev.savedEventIds);
        if (currentlySaved) nextSaved.add(event.id);
        else nextSaved.delete(event.id);
        return { ...prev, savedEventIds: nextSaved };
      });
    }
  };

  const handleToggleRecommendedOpportunitySave = async (oppId: string) => {
    if (!user) {
      onRequireAuth('login', 'for-you');
      return;
    }
    if (isSuspended || !discovery || savingOppId === oppId) return;

    const currentlySaved = discovery.savedOpportunityIds.has(oppId);
    setSavingOppId(oppId);
    try {
      const res = await toggleSavedPost({
        actorUid: user.uid,
        targetCollection: 'opportunities',
        targetId: oppId,
        currentlySaved,
      });
      setDiscovery((prev) => {
        if (!prev) return prev;
        const nextSaved = new Set(prev.savedOpportunityIds);
        if (res.saved) nextSaved.add(oppId);
        else nextSaved.delete(oppId);
        return { ...prev, savedOpportunityIds: nextSaved };
      });
    } finally {
      setSavingOppId(null);
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

  const renderOrdinaryPostCard = ({ post, author }: CommunityPostWithAuthor) => {
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
        onNavigateProfile={(uname) => onNavigate('profile', { username: uname })}
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
  };

  const hasFeedContent =
    activeFeedTab === 'for-you'
      ? forYouStream.length > 0
      : displayedPostItems.length > 0;

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
          <div className="flex flex-wrap items-center gap-3">
            {activeFeedTab === 'for-you' && user && (
              <button
                type="button"
                onClick={() =>
                  onNavigate('account', { accountSection: 'privacy' })
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Tailor topics
                {interestCategories.length > 0
                  ? ` (${interestCategories.length})`
                  : ''}
              </button>
            )}
            {!authReady && (
              <span className="text-xs text-slate-500">Checking account...</span>
            )}
          </div>
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
                onClick={() => onNavigate('search', { searchScope: 'people' })}
                className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1565C0]"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Find Members to Follow
              </button>
            </div>
          ) : !hasFeedContent ? (
            <EmptyState section={activeSection} />
          ) : (
            <div className="space-y-4">
              {activeFeedTab === 'for-you'
                ? forYouStream.map((entry) => {
                    if (entry.kind === 'post') {
                      return renderOrdinaryPostCard(entry.item);
                    }

                    if (entry.kind === 'people_discovery') {
                      return (
                        <section
                          key={entry.id}
                          aria-label="Recommended campus members"
                          className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                            <div className="flex items-center gap-2">
                              <Sparkles
                                className="h-4 w-4 text-[#1E88E5]"
                                aria-hidden="true"
                              />
                              <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
                                Discover Classmates &amp; Campus Voices
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('search', { searchScope: 'people' })
                              }
                              className="text-xs font-semibold text-[#1E88E5] hover:underline"
                            >
                              Browse directory
                            </button>
                          </div>

                          <div className="space-y-2.5">
                            {entry.people.map(({ member, reason }) => (
                              <div key={member.username} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 px-1">
                                  <span className="text-[11px] font-medium text-slate-500">
                                    {reason}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDismissRecommendation(
                                        `person:${member.username.toLowerCase()}`
                                      )
                                    }
                                    aria-label={`Dismiss suggestion for ${member.fullName}`}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-700"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                    Hide
                                  </button>
                                </div>
                                <MemberDirectoryCard
                                  member={member}
                                  viewerUsername={profile?.username ?? null}
                                  onOpenProfile={(uname) =>
                                    onNavigate('profile', { username: uname })
                                  }
                                  onRequireAuth={() =>
                                    onRequireAuth('login', 'for-you')
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    }

                    if (entry.kind === 'recommended_event') {
                      const { event, reason } = entry.recommendation;
                      return (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 sm:p-4"
                        >
                          <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                              <Sparkles
                                className="h-3.5 w-3.5 text-[#1E88E5]"
                                aria-hidden="true"
                              />
                              Relevant Event ·{' '}
                              <span className="font-normal text-slate-600">
                                {reason}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleDismissRecommendation(
                                  `event:${event.id}`
                                )
                              }
                              aria-label={`Hide recommended event ${event.title}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                              Hide
                            </button>
                          </div>
                          <EventCard
                            event={event}
                            nowMs={nowMs}
                            isLiked={Boolean(discovery?.likedEventIds.has(event.id))}
                            isSaved={Boolean(discovery?.savedEventIds.has(event.id))}
                            onOpenDetails={(eventId) =>
                              onNavigate('upcoming-events', { eventId })
                            }
                            onToggleLike={(evt) =>
                              void handleToggleRecommendedEventLike(evt)
                            }
                            onToggleSave={(evt) =>
                              void handleToggleRecommendedEventSave(evt)
                            }
                          />
                        </div>
                      );
                    }

                    if (entry.kind === 'recommended_opportunity') {
                      const { opportunity, reason } = entry.recommendation;
                      return (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 sm:p-4"
                        >
                          <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                              <Sparkles
                                className="h-3.5 w-3.5 text-[#1E88E5]"
                                aria-hidden="true"
                              />
                              Recommended Opportunity ·{' '}
                              <span className="font-normal text-slate-600">
                                {reason}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleDismissRecommendation(
                                  `opportunity:${opportunity.id}`
                                )
                              }
                              aria-label={`Hide recommended opportunity ${opportunity.title}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                              Hide
                            </button>
                          </div>
                          <OpportunityCard
                            opportunity={opportunity}
                            nowMs={nowMs}
                            isSaved={Boolean(
                              discovery?.savedOpportunityIds.has(opportunity.id)
                            )}
                            saving={savingOppId === opportunity.id}
                            onToggleSave={(id) =>
                              void handleToggleRecommendedOpportunitySave(id)
                            }
                            onOpenDetails={(oppId) =>
                              onNavigate('opportunities', { opportunityId: oppId })
                            }
                          />
                        </div>
                      );
                    }

                    if (entry.kind === 'recommended_anonymous') {
                      const { post, reason } = entry.recommendation;
                      return (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 sm:p-4"
                        >
                          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                              <Sparkles
                                className="h-3.5 w-3.5 text-[#1E88E5]"
                                aria-hidden="true"
                              />
                              Recommended Anonymous Thread ·{' '}
                              <span className="font-normal text-slate-600">
                                {reason}
                              </span>
                            </span>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate('anonymous', { postId: post.id })
                                }
                                className="text-xs font-semibold text-[#1E88E5] hover:underline"
                              >
                                Open Anonymous
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleDismissRecommendation(`anon:${post.id}`)
                                }
                                aria-label="Hide recommended anonymous thread"
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                Hide
                              </button>
                            </div>
                          </div>
                          <PostCard
                            kind="anonymous"
                            post={post}
                            viewerUid={user?.uid ?? null}
                            viewerTier={effectiveTier}
                            viewerSuspended={isSuspended}
                            isLiked={Boolean(discovery?.likedAnonIds.has(post.id))}
                            isSaved={Boolean(discovery?.savedAnonIds.has(post.id))}
                            isOwnedAnonymous={Boolean(
                              discovery?.ownedAnonPostIds.has(post.id)
                            )}
                            ownedAnonymousCommentIds={
                              discovery?.ownedAnonCommentIds
                            }
                            allowAnonymousReport={false}
                            onSaveChanged={(postId, saved) =>
                              setDiscovery((prev) => {
                                if (!prev) return prev;
                                const next = new Set(prev.savedAnonIds);
                                if (saved) next.add(postId);
                                else next.delete(postId);
                                return { ...prev, savedAnonIds: next };
                              })
                            }
                            onPostUpdated={(updated) =>
                              setDiscovery((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  recommendedAnonymous:
                                    prev.recommendedAnonymous.map((rec) =>
                                      rec.post.id === updated.id
                                        ? {
                                            ...rec,
                                            post: updated as typeof rec.post,
                                          }
                                        : rec
                                    ),
                                };
                              })
                            }
                            onPostDeleted={(deletedId) =>
                              setDiscovery((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  recommendedAnonymous:
                                    prev.recommendedAnonymous.filter(
                                      (rec) => rec.post.id !== deletedId
                                    ),
                                };
                              })
                            }
                            onRequireAuth={onRequireAuth}
                            returnRoute="for-you"
                          />
                        </div>
                      );
                    }

                    return null;
                  })
                : displayedPostItems.map(renderOrdinaryPostCard)}

              {hasMorePosts ? (
                <div
                  ref={loadMoreSentinelRef}
                  className="flex justify-center pt-2"
                >
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
                    {loadingMore
                      ? 'Loading more updates...'
                      : 'Load more updates'}
                  </button>
                </div>
              ) : (
                <p className="pt-2 text-center text-xs text-slate-500">
                  {activeFeedTab === 'latest'
                    ? 'You have reached all published campus updates.'
                    : "You've caught up on current campus updates."}
                </p>
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

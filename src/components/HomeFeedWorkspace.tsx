import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Megaphone,
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
import { subscribeCacheMutations } from '../services/cacheInvalidation';
import { fetchOfficialUpdatesPage } from '../services/adminUpdates';
import { toggleEventReaction } from '../services/events';
import {
  fetchCommunityFeedPage,
  fetchPublicAnonymousFeedPage,
  type CommunityFeedCursor,
  type CommunityPostWithAuthor,
} from '../services/firestoreFoundation';
import { prefetchMediaImagesPriority } from '../services/mediaStorage';
import {
  clearHomeFeedSessionCache,
  getHomeFeedSessionSnapshot,
  hydrateHomeFeedSnapshot,
  loadPersonalisationContextAndDiscovery,
  saveHomeFeedSessionSnapshot,
  type ForYouDiscoveryBundle,
} from '../services/personalisedFeed';
import { requestEmailVerification } from '../services/auth';
import {
  fetchOwnedAnonymousEntries,
  fetchSinglePublishedPostWithAuthor,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
  toggleSavedPost,
} from '../services/socialPosts';
import type {
  AdminUpdate,
  AnonymousPost,
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
  hasDesignatedSupremeAdminEmailMatch,
  hasPostingRolePendingEmailVerification,
  isAccountSuspended,
  isDesignatedSupremeAdminUser,
  resolveEffectiveAccountTier,
  toPublicProfileProjection,
} from '../utils/authValidation';
import {
  buildCombinedHomeForYouStream,
  buildCombinedHomeLatestStream,
  loadDismissedRecommendationKeys,
  recordFeedBehaviorSignal,
  saveDismissedRecommendationKey,
  type CombinedHomeStreamEntry,
  type ForYouRankingOptions,
  type HomeUpdateWithAuthor,
} from '../utils/feedRanking';
import { computeOptimisticReactionToggle } from '../utils/optimisticInteractions';
import {
  mergeAnchoredFeedStream,
  mergeCommunityPostItems,
  reuseSetIfUnchanged,
} from '../utils/cacheSync';
import { isDataSaverConnection } from '../utils/mediaCache';
import { getSectionById } from '../utils/sectionState';
import type { AccountSettingsSection } from '../types/platform';
import { ContextualSearchBar } from './ContextualSearchBar';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { PostCard } from './posts/PostCard';
import { PostComposer } from './posts/PostComposer';
import { UpdateCard } from './updates/UpdateCard';
import { UpdateComposerModal } from './updates/UpdateComposerModal';
import { EventCard } from './sections/events/EventCard';
import { OpportunityCard } from './sections/opportunities/OpportunityCard';
import { MemberDirectoryCard } from './sections/shared/DirectoryProfileCards';

interface HomeFeedWorkspaceProps {
  activeFeedTab: FeedTabId;
  selectedPostId?: string | null;
  selectedCommentId?: string | null;
  canGoBack?: boolean;
  onBack?: () => void;
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
  canGoBack = false,
  onBack,
  onSelectFeedTab,
  onNavigate,
  onRequireAuth,
}) => {
  const {
    authReady,
    accountSyncReady,
    user,
    profile,
    roleRecord,
    effectiveTier,
    isSuspended,
    interestCategories,
    followingUsernames,
    refreshVerificationStatus,
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
  const [updateItems, setUpdateItems] = useState<HomeUpdateWithAuthor[]>(
    () => initialCache?.updateItems ?? []
  );
  const [anonymousItems, setAnonymousItems] = useState<AnonymousPost[]>(
    () => initialCache?.anonymousItems ?? []
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
  const [likedUpdateIds, setLikedUpdateIds] = useState<Set<string>>(
    () => initialCache?.likedUpdateIds ?? new Set()
  );
  const [savedUpdateIds, setSavedUpdateIds] = useState<Set<string>>(
    () => initialCache?.savedUpdateIds ?? new Set()
  );
  const [likedAnonIds, setLikedAnonIds] = useState<Set<string>>(
    () => initialCache?.likedAnonIds ?? new Set()
  );
  const [savedAnonIds, setSavedAnonIds] = useState<Set<string>>(
    () => initialCache?.savedAnonIds ?? new Set()
  );
  const [ownedAnonPostIds, setOwnedAnonPostIds] = useState<Set<string>>(
    () => initialCache?.ownedAnonPostIds ?? new Set()
  );
  const [ownedAnonCommentIds, setOwnedAnonCommentIds] = useState<Set<string>>(
    () => initialCache?.ownedAnonCommentIds ?? new Set()
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
      | 'email_verification_required'
      | 'anonymous_published'
      | 'ordinary_published'
      | 'suspended';
    message?: string;
    pendingAction?: 'write' | 'photo';
  } | null>(null);
  const [verifyingComposerAction, setVerifyingComposerAction] = useState(false);
  const [resendingVerificationEmail, setResendingVerificationEmail] =
    useState(false);
  const [composerModal, setComposerModal] = useState<{
    mode: 'ordinary' | 'anonymous';
    ordinaryType?: OrdinaryPostType;
    editPost?: CommunityPost;
  } | null>(null);
  const [officialUpdateModalOpen, setOfficialUpdateModalOpen] = useState(false);
  const [editingOfficialUpdate, setEditingOfficialUpdate] =
    useState<AdminUpdate | null>(null);

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
  const updateItemsRef = useRef(updateItems);
  const anonymousItemsRef = useRef(anonymousItems);
  const discoveryRef = useRef(discovery);
  const dismissedKeysRef = useRef(dismissedKeys);
  const loadStateRef = useRef(loadState);
  const rankingOptionsRef = useRef(rankingOptions);
  const lastDiscoverySyncAtRef = useRef<number>(
    initialCache?.rankingOptions ? initialCache.cachedAt : 0
  );

  const currentTabKey = `${viewerKey}:${activeFeedTab}`;
  const [anchoredOrderState, setAnchoredOrderState] = useState<{
    key: string;
    ids: string[];
  }>({ key: currentTabKey, ids: [] });
  const activeAnchorEntryIdRef = useRef<string | null>(null);
  const currentStreamIdsRef = useRef<string[]>([]);
  const pendingScrollAdjustRef = useRef<{
    anchorId: string;
    beforeTop: number;
  } | null>(null);
  const visibleEntryTimingRef = useRef<
    Map<
      string,
      {
        startedAt: number;
        meta: {
          targetId: string;
          authorKey?: string;
          category?: string;
          text?: string;
        };
      }
    >
  >(new Map());
  const streamEntryMetaRef = useRef<
    Map<
      string,
      {
        targetId: string;
        authorKey?: string;
        category?: string;
        text?: string;
      }
    >
  >(new Map());

  useEffect(() => {
    activeTabRef.current = activeFeedTab;
    viewerKeyRef.current = viewerKey;
    activeViewerUidRef.current = activeViewerUid;
    interestSigRef.current = interestSignature;
    postItemsRef.current = postItems;
    updateItemsRef.current = updateItems;
    anonymousItemsRef.current = anonymousItems;
    discoveryRef.current = discovery;
    dismissedKeysRef.current = dismissedKeys;
    loadStateRef.current = loadState;
    rankingOptionsRef.current = rankingOptions;
  }, [
    activeFeedTab,
    viewerKey,
    activeViewerUid,
    interestSignature,
    postItems,
    updateItems,
    anonymousItems,
    discovery,
    dismissedKeys,
    loadState,
    rankingOptions,
  ]);

  const prefetchLeadPostMedia = useCallback(
    (
      items: readonly CommunityPostWithAuthor[],
      recommendedPeople?: ForYouDiscoveryBundle['recommendedPeople'],
      updates: readonly HomeUpdateWithAuthor[] = [],
      anons: readonly AnonymousPost[] = []
    ) => {
      if (isDataSaverConnection()) return;
      const highPriority: Array<string | null | undefined> = [];
      const normalPriority: Array<string | null | undefined> = [];

      updates.slice(0, 4).forEach((entry, index) => {
        if (index < 2) {
          highPriority.push(
            entry.author?.photoImageId,
            entry.update.mediaItems?.[0]?.imageId
          );
        } else {
          normalPriority.push(
            entry.author?.photoImageId,
            entry.update.mediaItems?.[0]?.imageId
          );
        }
      });

      items.slice(0, 6).forEach((entry, index) => {
        if (index < 3) {
          highPriority.push(
            entry.author?.photoImageId,
            entry.post.mediaItems?.[0]?.imageId
          );
          if (entry.post.mediaItems?.[1]?.imageId) {
            normalPriority.push(entry.post.mediaItems[1].imageId);
          }
        } else {
          normalPriority.push(
            entry.author?.photoImageId,
            entry.post.mediaItems?.[0]?.imageId
          );
        }
      });

      anons.slice(0, 3).forEach((anon) => {
        normalPriority.push(anon.mediaItems?.[0]?.imageId);
      });

      if (recommendedPeople?.length) {
        recommendedPeople.slice(0, 5).forEach((rec) => {
          normalPriority.push(rec.member.photoImageId);
        });
      }

      if (highPriority.some(Boolean) || normalPriority.some(Boolean)) {
        void prefetchMediaImagesPriority({
          highPriority,
          normalPriority,
          predecode: false,
          maxTotal: 16,
        });
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

      const includeCombinedSources = targetTab !== 'following';

      const [
        likedIds,
        savedIds,
        likedUpdates,
        savedUpdates,
        likedAnons,
        savedAnons,
        ownedAnons,
      ] = await Promise.all([
        uid
          ? fetchViewerLikedPostIds('posts', uid).catch(() => new Set<string>())
          : Promise.resolve(new Set<string>()),
        uid
          ? fetchViewerSavedPostIds('posts', uid).catch(() => new Set<string>())
          : Promise.resolve(new Set<string>()),
        uid
          ? fetchViewerLikedPostIds('updates', uid).catch(
              () => new Set<string>()
            )
          : Promise.resolve(new Set<string>()),
        uid
          ? fetchViewerSavedPostIds('updates', uid).catch(
              () => new Set<string>()
            )
          : Promise.resolve(new Set<string>()),
        uid && includeCombinedSources
          ? fetchViewerLikedPostIds('anonymousPosts', uid).catch(
              () => new Set<string>()
            )
          : Promise.resolve(new Set<string>()),
        uid && includeCombinedSources
          ? fetchViewerSavedPostIds('anonymousPosts', uid).catch(
              () => new Set<string>()
            )
          : Promise.resolve(new Set<string>()),
        uid && includeCombinedSources
          ? fetchOwnedAnonymousEntries(uid).catch(() => ({
              postIds: new Set<string>(),
              commentIds: new Set<string>(),
            }))
          : Promise.resolve({
              postIds: new Set<string>(),
              commentIds: new Set<string>(),
            }),
      ]);

      let nextRankingOptions:
        | Omit<ForYouRankingOptions, 'followedUids' | 'authorMap'>
        | undefined;
      let nextDiscovery: ForYouDiscoveryBundle | undefined;

      if (targetTab === 'for-you') {
        const shouldReuseCachedDiscovery =
          mode === 'background' &&
          Boolean(rankingOptionsRef.current) &&
          Date.now() - lastDiscoverySyncAtRef.current < 45_000;

        if (shouldReuseCachedDiscovery) {
          nextRankingOptions = rankingOptionsRef.current;
        } else {
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
            rankingOptionsRef.current = personalisation.rankingOptions;
            lastDiscoverySyncAtRef.current = Date.now();
          }
        }
      }

      const [page, updatesPage, anonPage] = await Promise.all([
        fetchCommunityFeedPage({
          tab: targetTab,
          viewerUid: uid,
          pageSize: FEED_PAGE_SIZE,
          rankingOptions: nextRankingOptions,
        }),
        fetchOfficialUpdatesPage({ pageSize: 14 }).catch(() => null),
        includeCombinedSources
          ? fetchPublicAnonymousFeedPage({ pageSize: 12 }).catch(() => null)
          : Promise.resolve(null),
      ]);

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

      const mappedUpdates: HomeUpdateWithAuthor[] | null = updatesPage
        ? updatesPage.items.map((update) => ({
            update,
            author:
              update.authorMode === 'public_admin' && update.ownerUID
                ? updatesPage.authorMap.get(update.ownerUID) ?? null
                : null,
          }))
        : null;

      const tabKey = `${viewerKeyRef.current}:${targetTab}`;
      const nextDismissed = loadDismissedRecommendationKeys(uid);

      const nextPosts =
        mode === 'background' && postItemsRef.current.length > 0
          ? mergeCommunityPostItems({
              existing: postItemsRef.current,
              incoming: page.items,
              preferIncomingOrder: false,
              preserveTail: true,
            })
          : page.items;
      const nextUpdates = mappedUpdates ?? updateItemsRef.current;
      const nextAnons = includeCombinedSources
        ? anonPage?.items ?? anonymousItemsRef.current
        : [];
      const effectiveDiscovery = nextDiscovery ?? discoveryRef.current;
      const effectiveRanking = nextRankingOptions ?? rankingOptionsRef.current;

      if (mode === 'background' && currentStreamIdsRef.current.length > 0) {
        const isScrolledMidFeed =
          typeof window !== 'undefined' && window.scrollY > 140;
        const anchorId = isScrolledMidFeed
          ? activeAnchorEntryIdRef.current
          : null;
        if (anchorId && typeof document !== 'undefined') {
          const el = document.querySelector<HTMLElement>(
            `[data-feed-entry-id="${anchorId}"]`
          );
          if (el) {
            pendingScrollAdjustRef.current = {
              anchorId,
              beforeTop: el.getBoundingClientRect().top,
            };
          }
        }

        const followedSet = new Set(page.followedUids);
        const incomingStream: CombinedHomeStreamEntry[] =
          targetTab === 'for-you'
            ? buildCombinedHomeForYouStream({
                updates: nextUpdates,
                posts: nextPosts,
                anonymousPosts: [
                  ...nextAnons,
                  ...(effectiveDiscovery?.recommendedAnonymous ?? []).map(
                    (item) => item.post
                  ),
                ],
                rankingOptions: effectiveRanking
                  ? { ...effectiveRanking, followedUids: followedSet }
                  : undefined,
                recommendedPeople: effectiveDiscovery?.recommendedPeople,
                recommendedEvents: effectiveDiscovery?.recommendedEvents,
                recommendedOpportunities:
                  effectiveDiscovery?.recommendedOpportunities,
                dismissedKeys: nextDismissed,
              })
            : targetTab === 'latest'
              ? buildCombinedHomeLatestStream({
                  updates: nextUpdates,
                  posts: nextPosts,
                  anonymousPosts: nextAnons,
                })
              : buildCombinedHomeLatestStream({
                  updates: nextUpdates.filter(
                    (item) =>
                      item.update.authorMode === 'public_admin' &&
                      Boolean(
                        item.update.ownerUID &&
                          followedSet.has(item.update.ownerUID)
                      )
                  ),
                  posts: nextPosts,
                  anonymousPosts: [],
                });

        const baseIds = currentStreamIdsRef.current.map((id) => ({ id }));
        const mergedStream = mergeAnchoredFeedStream<{ id: string }>({
          existing: baseIds,
          incoming: incomingStream.map((entry) => ({ id: entry.id })),
          anchorId,
          isScrolledMidFeed,
          fallbackPrependUnseen: true,
        });
        setAnchoredOrderState({
          key: tabKey,
          ids: mergedStream.items.map((item) => item.id),
        });
      } else if (mode === 'initial') {
        setAnchoredOrderState({ key: tabKey, ids: [] });
      }

      setFollowingCount(page.followingCount);
      setFollowedUids(page.followedUids);
      setPostItems(nextPosts);
      if (mappedUpdates) {
        setUpdateItems(mappedUpdates);
      }
      if (includeCombinedSources) {
        if (anonPage) {
          setAnonymousItems(anonPage.items);
        }
      } else {
        setAnonymousItems([]);
      }
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
      setLikedPostIds((prev) => reuseSetIfUnchanged(prev, likedIds));
      setSavedPostIds((prev) => reuseSetIfUnchanged(prev, savedIds));
      setLikedUpdateIds((prev) => reuseSetIfUnchanged(prev, likedUpdates));
      setSavedUpdateIds((prev) => reuseSetIfUnchanged(prev, savedUpdates));
      if (includeCombinedSources) {
        setLikedAnonIds((prev) => reuseSetIfUnchanged(prev, likedAnons));
        setSavedAnonIds((prev) => reuseSetIfUnchanged(prev, savedAnons));
        setOwnedAnonPostIds((prev) =>
          reuseSetIfUnchanged(prev, ownedAnons.postIds)
        );
        setOwnedAnonCommentIds((prev) =>
          reuseSetIfUnchanged(prev, ownedAnons.commentIds)
        );
      }
      if (nextRankingOptions) {
        setRankingOptions(nextRankingOptions);
      }
      if (nextDiscovery) {
        setDiscovery(nextDiscovery);
      }
      setDismissedKeys(loadDismissedRecommendationKeys(uid));
      setLoadState('ready');
      prefetchLeadPostMedia(
        page.items,
        nextDiscovery?.recommendedPeople,
        mappedUpdates ?? [],
        anonPage?.items ?? []
      );
    },
    [prefetchLeadPostMedia]
  );

  useEffect(() => {
    const unsubscribe = subscribeCacheMutations((event) => {
      if (event.type === 'follow_toggled') {
        const lower = event.targetUsername.trim().toLowerCase();
        const delta = event.following ? 1 : -1;
        setFollowingCount((prev) => Math.max(0, prev + delta));
        setPostItems((prev) => {
          let changed = false;
          const next = prev.map((entry) => {
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
          return changed ? next : prev;
        });
        setUpdateItems((prev) => {
          let changed = false;
          const next = prev.map((entry) => {
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
          return changed ? next : prev;
        });
        setDiscovery((prev) => {
          if (!prev || prev.recommendedPeople.length === 0) return prev;
          let changed = false;
          const nextRec = prev.recommendedPeople.map((rec) => {
            if (rec.member.username.toLowerCase() !== lower) return rec;
            changed = true;
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
          return changed ? { ...prev, recommendedPeople: nextRec } : prev;
        });
      } else if (event.type === 'profile_updated') {
        const snap = getHomeFeedSessionSnapshot(viewerKey, activeFeedTab);
        if (snap) {
          setPostItems(snap.postItems);
          if (snap.updateItems) setUpdateItems(snap.updateItems);
          if (snap.discovery) setDiscovery(snap.discovery);
        }
      } else if (event.type === 'admin_update_created') {
        const createdId = `update_${event.update.id}`;
        setAnchoredOrderState((prev) =>
          prev.key === `${viewerKey}:${activeFeedTab}` && prev.ids.length > 0
            ? {
                key: prev.key,
                ids: [createdId, ...prev.ids.filter((id) => id !== createdId)],
              }
            : prev
        );
        setUpdateItems((prev) => [
          { update: event.update, author: event.author },
          ...prev.filter((item) => item.update.id !== event.update.id),
        ]);
      } else if (event.type === 'admin_update_updated') {
        setUpdateItems((prev) =>
          prev.map((item) =>
            item.update.id === event.update.id
              ? { ...item, update: event.update }
              : item
          )
        );
      } else if (event.type === 'admin_update_deleted') {
        setUpdateItems((prev) =>
          prev.filter((item) => item.update.id !== event.updateId)
        );
      } else if (event.type === 'admin_update_reaction') {
        setLikedUpdateIds((prev) => {
          const next = new Set(prev);
          if (event.liked) next.add(event.updateId);
          else next.delete(event.updateId);
          return next;
        });
        setUpdateItems((prev) =>
          prev.map((item) =>
            item.update.id === event.updateId
              ? {
                  ...item,
                  update: { ...item.update, likesCount: event.likesCount },
                }
              : item
          )
        );
      } else if (event.type === 'admin_update_saved') {
        setSavedUpdateIds((prev) => {
          const next = new Set(prev);
          if (event.saved) next.add(event.updateId);
          else next.delete(event.updateId);
          return next;
        });
      } else if (event.type === 'admin_update_comment_mutated') {
        setUpdateItems((prev) =>
          prev.map((item) =>
            item.update.id === event.updateId
              ? {
                  ...item,
                  update: {
                    ...item.update,
                    commentsCount: event.commentsCount,
                  },
                }
              : item
          )
        );
      } else if (event.type === 'anonymous_post_created') {
        if (activeFeedTab !== 'following') {
          const createdId = `anon_${event.post.id}`;
          setAnchoredOrderState((prev) =>
            prev.key === `${viewerKey}:${activeFeedTab}` && prev.ids.length > 0
              ? {
                  key: prev.key,
                  ids: [createdId, ...prev.ids.filter((id) => id !== createdId)],
                }
              : prev
          );
          setAnonymousItems((prev) => [
            event.post,
            ...prev.filter((item) => item.id !== event.post.id),
          ]);
        }
      } else if (event.type === 'anonymous_post_updated') {
        setAnonymousItems((prev) =>
          prev.map((item) => (item.id === event.post.id ? event.post : item))
        );
      } else if (event.type === 'anonymous_post_deleted') {
        setAnonymousItems((prev) =>
          prev.filter((item) => item.id !== event.postId)
        );
      } else if (event.type === 'anonymous_post_reaction') {
        setLikedAnonIds((prev) => {
          const next = new Set(prev);
          if (event.liked) next.add(event.postId);
          else next.delete(event.postId);
          return next;
        });
        setAnonymousItems((prev) =>
          prev.map((item) =>
            item.id === event.postId
              ? { ...item, likesCount: event.likesCount }
              : item
          )
        );
      } else if (event.type === 'anonymous_post_saved') {
        setSavedAnonIds((prev) => {
          const next = new Set(prev);
          if (event.saved) next.add(event.postId);
          else next.delete(event.postId);
          return next;
        });
      } else if (event.type === 'community_post_updated') {
        setPostItems((prev) =>
          prev.map((item) =>
            item.post.id === event.post.id
              ? { ...item, post: event.post }
              : item
          )
        );
      } else if (event.type === 'community_post_deleted') {
        setPostItems((prev) =>
          prev.filter((item) => item.post.id !== event.postId)
        );
      } else if (event.type === 'community_post_reaction') {
        setLikedPostIds((prev) => {
          const next = new Set(prev);
          if (event.liked) next.add(event.postId);
          else next.delete(event.postId);
          return next;
        });
        setPostItems((prev) =>
          prev.map((item) =>
            item.post.id === event.postId
              ? { ...item, post: { ...item.post, likesCount: event.likesCount } }
              : item
          )
        );
      } else if (event.type === 'community_post_saved') {
        setSavedPostIds((prev) => {
          const next = new Set(prev);
          if (event.saved) next.add(event.postId);
          else next.delete(event.postId);
          return next;
        });
      }
    });
    return unsubscribe;
  }, [viewerKey, activeFeedTab]);

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
      prefetchLeadPostMedia(
        cached.postItems,
        cached.discovery?.recommendedPeople,
        cached.updateItems ?? [],
        cached.anonymousItems ?? []
      );
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
          (persisted.postItems.length > 0 ||
            (persisted.updateItems?.length ?? 0) > 0 ||
            (persisted.anonymousItems?.length ?? 0) > 0) &&
          (activeFeedTab !== 'for-you' ||
            !persisted.interestSignature ||
            persisted.interestSignature === interestSignature)
        ) {
          setFollowingCount(persisted.followingCount);
          setFollowedUids(persisted.followedUids);
          setPostItems(persisted.postItems);
          setUpdateItems(persisted.updateItems ?? []);
          setAnonymousItems(persisted.anonymousItems ?? []);
          setFeedCursor(persisted.feedCursor);
          setHasMorePosts(persisted.hasMorePosts);
          setLikedPostIds(persisted.likedPostIds);
          setSavedPostIds(persisted.savedPostIds);
          setLikedUpdateIds(persisted.likedUpdateIds ?? new Set());
          setSavedUpdateIds(persisted.savedUpdateIds ?? new Set());
          setLikedAnonIds(persisted.likedAnonIds ?? new Set());
          setSavedAnonIds(persisted.savedAnonIds ?? new Set());
          setOwnedAnonPostIds(persisted.ownedAnonPostIds ?? new Set());
          setOwnedAnonCommentIds(persisted.ownedAnonCommentIds ?? new Set());
          if (persisted.discovery) setDiscovery(persisted.discovery);
          setLoadState('ready');
          prefetchLeadPostMedia(
            persisted.postItems,
            persisted.discovery?.recommendedPeople,
            persisted.updateItems ?? [],
            persisted.anonymousItems ?? []
          );

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
      updateItems,
      anonymousItems,
      likedPostIds,
      savedPostIds,
      likedUpdateIds,
      savedUpdateIds,
      likedAnonIds,
      savedAnonIds,
      ownedAnonPostIds,
      ownedAnonCommentIds,
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
    updateItems,
    anonymousItems,
    likedPostIds,
    savedPostIds,
    likedUpdateIds,
    savedUpdateIds,
    likedAnonIds,
    savedAnonIds,
    ownedAnonPostIds,
    ownedAnonCommentIds,
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

  const combinedForYouStream = useMemo(() => {
    if (activeFeedTab !== 'for-you') return [];
    const mergedAnonymous = [
      ...anonymousItems,
      ...(discovery?.recommendedAnonymous ?? []).map((item) => item.post),
    ];
    return buildCombinedHomeForYouStream({
      updates: updateItems,
      posts: displayedPostItems,
      anonymousPosts: mergedAnonymous,
      rankingOptions: rankingOptions
        ? { ...rankingOptions, followedUids: new Set(followedUids) }
        : undefined,
      recommendedPeople: discovery?.recommendedPeople,
      recommendedEvents: discovery?.recommendedEvents,
      recommendedOpportunities: discovery?.recommendedOpportunities,
      dismissedKeys,
    });
  }, [
    activeFeedTab,
    updateItems,
    displayedPostItems,
    anonymousItems,
    rankingOptions,
    followedUids,
    discovery,
    dismissedKeys,
  ]);

  const combinedLatestStream = useMemo(() => {
    if (activeFeedTab !== 'latest') return [];
    return buildCombinedHomeLatestStream({
      updates: updateItems,
      posts: displayedPostItems,
      anonymousPosts: anonymousItems,
    });
  }, [activeFeedTab, updateItems, displayedPostItems, anonymousItems]);

  const followingStream = useMemo(() => {
    if (activeFeedTab !== 'following') return [];
    const followedUidSet = new Set(followedUids);
    const followedUpdates = updateItems.filter(
      (item) =>
        item.update.authorMode === 'public_admin' &&
        Boolean(item.update.ownerUID && followedUidSet.has(item.update.ownerUID))
    );
    return buildCombinedHomeLatestStream({
      updates: followedUpdates,
      posts: displayedPostItems,
      anonymousPosts: [],
    });
  }, [activeFeedTab, updateItems, displayedPostItems, followedUids]);

  const computedActiveStream = useMemo<CombinedHomeStreamEntry[]>(() => {
    if (activeFeedTab === 'for-you') return combinedForYouStream;
    if (activeFeedTab === 'latest') return combinedLatestStream;
    return followingStream;
  }, [activeFeedTab, combinedForYouStream, combinedLatestStream, followingStream]);

  const displayedStream = useMemo<CombinedHomeStreamEntry[]>(() => {
    if (
      anchoredOrderState.key !== currentTabKey ||
      anchoredOrderState.ids.length === 0
    ) {
      return computedActiveStream;
    }
    const byId = new Map<string, CombinedHomeStreamEntry>();
    for (const entry of computedActiveStream) {
      byId.set(entry.id, entry);
    }
    const ordered: CombinedHomeStreamEntry[] = [];
    for (const id of anchoredOrderState.ids) {
      const match = byId.get(id);
      if (match) {
        ordered.push(match);
        byId.delete(id);
      }
    }
    for (const remaining of byId.values()) {
      ordered.push(remaining);
    }
    return ordered;
  }, [anchoredOrderState, currentTabKey, computedActiveStream]);

  useEffect(() => {
    currentStreamIdsRef.current = displayedStream.map((entry) => entry.id);
    const metaMap = new Map<
      string,
      { targetId: string; authorKey?: string; category?: string; text?: string }
    >();
    for (const entry of displayedStream) {
      if (entry.kind === 'post') {
        metaMap.set(entry.id, {
          targetId: entry.item.post.id,
          authorKey: entry.item.post.ownerUID,
          category: entry.item.post.category,
          text: entry.item.post.body,
        });
      } else if (entry.kind === 'update') {
        metaMap.set(entry.id, {
          targetId: entry.item.update.id,
          authorKey: entry.item.update.ownerUID,
          category: entry.item.update.category,
          text: `${entry.item.update.title ?? ''} ${entry.item.update.body}`,
        });
      } else if (entry.kind === 'anonymous') {
        metaMap.set(entry.id, {
          targetId: entry.post.id,
          category: entry.post.category,
          text: entry.post.body,
        });
      }
    }
    streamEntryMetaRef.current = metaMap;
  }, [displayedStream]);

  useLayoutEffect(() => {
    const adjust = pendingScrollAdjustRef.current;
    if (
      !adjust ||
      typeof document === 'undefined' ||
      typeof window === 'undefined'
    ) {
      return;
    }
    pendingScrollAdjustRef.current = null;
    const el = document.querySelector<HTMLElement>(
      `[data-feed-entry-id="${adjust.anchorId}"]`
    );
    if (!el) return;
    const delta = el.getBoundingClientRect().top - adjust.beforeTop;
    if (Math.abs(delta) > 1) {
      window.scrollBy(0, delta);
    }
  }, [displayedStream]);

  useEffect(() => {
    if (
      loadState !== 'ready' ||
      typeof IntersectionObserver === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-feed-entry-id]')
    );
    if (nodes.length === 0) return;

    const timingMap = visibleEntryTimingRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const now = Date.now();
        const targetY =
          typeof window !== 'undefined' ? window.innerHeight * 0.28 : 220;
        let bestId: string | null = null;
        let bestDist = Infinity;

        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.feedEntryId;
          if (!id) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            const dist = Math.abs(entry.boundingClientRect.top - targetY);
            if (dist < bestDist) {
              bestDist = dist;
              bestId = id;
            }
            if (!timingMap.has(id)) {
              const meta = streamEntryMetaRef.current.get(id);
              if (meta) {
                timingMap.set(id, { startedAt: now, meta });
              }
            }
          } else {
            const activeTiming = timingMap.get(id);
            if (activeTiming) {
              timingMap.delete(id);
              const dwellMs = now - activeTiming.startedAt;
              if (dwellMs >= 150) {
                recordFeedBehaviorSignal(activeViewerUidRef.current, {
                  ...activeTiming.meta,
                  dwellMs,
                  timestampMs: now,
                });
              }
            }
          }
        }

        if (bestId) {
          activeAnchorEntryIdRef.current = bestId;
        }
      },
      { threshold: [0.1, 0.35, 0.65] }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [loadState, displayedStream, activeFeedTab]);

  const loadFeed = () => {
    clearHomeFeedSessionCache(activeFeedTab);
    setAnchoredOrderState({ key: currentTabKey, ids: [] });
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
  const canPublishOfficialUpdate =
    authReady &&
    Boolean(user?.uid) &&
    !isSuspended &&
    effectiveTier === 'supreme_admin' &&
    isDesignatedSupremeAdminUser(user);
  const actorRole: UserRole = (
    effectiveTier === 'guest' ? 'member' : effectiveTier
  ) as UserRole;

  const handleComposerAction = async (
    action: 'write' | 'photo' | 'anonymous'
  ) => {
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
      if (
        !accountSyncReady ||
        (hasDesignatedSupremeAdminEmailMatch(user) && !user.emailVerified)
      ) {
        setVerifyingComposerAction(true);
        try {
          const snapshot = await refreshVerificationStatus();
          const freshUser = snapshot.user;
          const freshTier = resolveEffectiveAccountTier(
            freshUser,
            snapshot.roleRecord
          );
          const freshSuspended = isAccountSuspended(snapshot.profile);

          if (freshSuspended) {
            setComposerFeedback({
              kind: 'suspended',
              message:
                'Your account is currently suspended and cannot publish or interact with campus posts.',
            });
            return;
          }

          if (
            canPublishOrdinaryPostStrict({
              user: freshUser,
              tier: freshTier,
              profile: snapshot.profile,
              roleRecord: snapshot.roleRecord,
              suspended: freshSuspended,
            })
          ) {
            setComposerModal({
              mode: 'ordinary',
              ordinaryType: action === 'photo' ? 'photo' : 'text',
            });
            return;
          }

          if (
            hasPostingRolePendingEmailVerification({
              user: freshUser,
              profile: snapshot.profile,
              roleRecord: snapshot.roleRecord,
            })
          ) {
            setComposerFeedback({
              kind: 'email_verification_required',
              pendingAction: action,
              message:
                'Your account holds campus posting privileges, but Firebase requires a verified email address before publishing updates or photos.',
            });
            return;
          }
        } finally {
          setVerifyingComposerAction(false);
        }
      } else if (
        hasPostingRolePendingEmailVerification({
          user,
          profile,
          roleRecord,
        })
      ) {
        setComposerFeedback({
          kind: 'email_verification_required',
          pendingAction: action,
          message:
            'Your account holds campus posting privileges, but Firebase requires a verified email address before publishing updates or photos.',
        });
        return;
      }

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

  const handleRefreshComposerVerification = async () => {
    if (verifyingComposerAction) return;
    const targetAction = composerFeedback?.pendingAction ?? 'write';
    setVerifyingComposerAction(true);
    try {
      const snapshot = await refreshVerificationStatus();
      const freshTier = resolveEffectiveAccountTier(
        snapshot.user,
        snapshot.roleRecord
      );
      const freshSuspended = isAccountSuspended(snapshot.profile);
      if (
        canPublishOrdinaryPostStrict({
          user: snapshot.user,
          tier: freshTier,
          profile: snapshot.profile,
          roleRecord: snapshot.roleRecord,
          suspended: freshSuspended,
        })
      ) {
        setComposerFeedback(null);
        setComposerModal({
          mode: 'ordinary',
          ordinaryType: targetAction === 'photo' ? 'photo' : 'text',
        });
      } else {
        setComposerFeedback((prev) => ({
          kind: 'email_verification_required',
          pendingAction: prev?.pendingAction ?? targetAction,
          message:
            'Email verification has not synced yet. Open the verification link sent to your inbox, then tap Refresh again.',
        }));
      }
    } finally {
      setVerifyingComposerAction(false);
    }
  };

  const handleResendComposerVerification = async () => {
    if (resendingVerificationEmail || !user) return;
    setResendingVerificationEmail(true);
    try {
      await requestEmailVerification(user);
      setComposerFeedback((prev) => ({
        kind: 'email_verification_required',
        pendingAction: prev?.pendingAction ?? 'write',
        message:
          'Verification email sent! Check your inbox or spam folder, click the link, then tap "I\'ve Verified — Refresh".',
      }));
    } catch (error) {
      setComposerFeedback((prev) => ({
        kind: 'email_verification_required',
        pendingAction: prev?.pendingAction ?? 'write',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Could not send verification email right now. Please wait a moment and retry.',
      }));
    } finally {
      setResendingVerificationEmail(false);
    }
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

  const renderHomeUpdateCard = ({ update, author }: HomeUpdateWithAuthor) => {
    const resolvedAuthor =
      update.authorMode === 'public_admin' &&
      profile &&
      update.ownerUID === profile.uid
        ? toPublicProfileProjection(profile)
        : author;

    return (
      <UpdateCard
        key={`update_${update.id}`}
        update={update}
        author={resolvedAuthor}
        viewerUid={user?.uid ?? null}
        viewerTier={effectiveTier}
        viewerSuspended={isSuspended}
        isLiked={likedUpdateIds.has(update.id)}
        isSaved={savedUpdateIds.has(update.id)}
        onSaveChanged={(updateId, saved) =>
          setSavedUpdateIds((prev) => {
            const next = new Set(prev);
            if (saved) next.add(updateId);
            else next.delete(updateId);
            return next;
          })
        }
        onEditUpdate={(targetUpdate) => {
          setEditingOfficialUpdate(targetUpdate);
          setOfficialUpdateModalOpen(true);
        }}
        onUpdateMutated={(updated) =>
          setUpdateItems((prev) =>
            prev.map((item) =>
              item.update.id === updated.id ? { ...item, update: updated } : item
            )
          )
        }
        onUpdateDeleted={(deletedId) =>
          setUpdateItems((prev) =>
            prev.filter((item) => item.update.id !== deletedId)
          )
        }
        onNavigateProfile={(uname) => onNavigate('profile', { username: uname })}
        onRequireAuth={onRequireAuth}
        returnRoute={activeFeedTab}
      />
    );
  };

  const renderHomeAnonymousCard = (anon: AnonymousPost) => {
    const isLiked =
      likedAnonIds.has(anon.id) || Boolean(discovery?.likedAnonIds.has(anon.id));
    const isSaved =
      savedAnonIds.has(anon.id) || Boolean(discovery?.savedAnonIds.has(anon.id));
    const isOwned =
      ownedAnonPostIds.has(anon.id) ||
      Boolean(discovery?.ownedAnonPostIds.has(anon.id));

    return (
      <PostCard
        key={`anon_${anon.id}`}
        kind="anonymous"
        post={anon}
        viewerUid={user?.uid ?? null}
        viewerTier={effectiveTier}
        viewerSuspended={isSuspended}
        isLiked={isLiked}
        isSaved={isSaved}
        isOwnedAnonymous={isOwned}
        ownedAnonymousCommentIds={
          ownedAnonCommentIds.size > 0
            ? ownedAnonCommentIds
            : discovery?.ownedAnonCommentIds
        }
        onSaveChanged={(postId, saved) =>
          setSavedAnonIds((prev) => {
            const next = new Set(prev);
            if (saved) next.add(postId);
            else next.delete(postId);
            return next;
          })
        }
        onPostUpdated={(updated) =>
          setAnonymousItems((prev) =>
            prev.map((item) =>
              item.id === updated.id ? (updated as AnonymousPost) : item
            )
          )
        }
        onPostDeleted={(deletedId) =>
          setAnonymousItems((prev) =>
            prev.filter((item) => item.id !== deletedId)
          )
        }
        onRequireAuth={onRequireAuth}
        returnRoute={activeFeedTab}
      />
    );
  };

  const hasFeedContent = displayedStream.length > 0;

  return (
    <div className="min-w-0 max-w-full flex-1 space-y-5">
      {canGoBack && onBack && (
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#0B1A2E] sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        </div>
      )}

      {/* Contextual Home Search (Members & Public Ordinary Posts) */}
      <ContextualSearchBar
        scope="home"
        embedded
        onNavigate={onNavigate}
        onRequireAuth={onRequireAuth}
        returnRoute={activeFeedTab}
      />

      {/* Prominent Official Updates & Marketplace Shortcuts near the top of Homepage */}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50/60 to-blue-50/85 px-4 py-3.5 shadow-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lasued-brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs">
              <Megaphone className="h-5 w-5 text-sky-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#0B1A2E]">
                Official Updates
              </p>
              <p className="truncate text-xs text-slate-600">
                Verified announcements &amp; campus notices.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('updates')}
            className="lasued-accent-gradient inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1 rounded-lg px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
          >
            View Updates
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-teal-200/80 bg-gradient-to-br from-white via-teal-50/45 to-emerald-50/70 px-4 py-3.5 shadow-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lasued-emerald-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs">
              <ShoppingBag className="h-5 w-5 text-teal-100" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#0B1A2E]">
                Campus Marketplace
              </p>
              <p className="truncate text-xs text-slate-600">
                Textbooks, hostels, gadgets &amp; services.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('marketplace')}
            className="lasued-action-gradient inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1 rounded-lg px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
          >
            Marketplace
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
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
                    className="lasued-action-gradient absolute right-4 bottom-0 left-4 h-0.5 rounded-full"
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
            disabled={verifyingComposerAction}
            onClick={() => void handleComposerAction('write')}
            className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-sky-50/50 px-4 py-3 text-left text-sm text-slate-600 transition-colors hover:border-[#1E88E5]/40 hover:from-sky-50/70 hover:to-blue-50/60 disabled:opacity-70"
          >
            <span>What&apos;s happening on campus?</span>
            {verifyingComposerAction && (
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
            )}
          </button>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={verifyingComposerAction}
                onClick={() => void handleComposerAction('write')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-sky-50 hover:text-[#0B1A2E] disabled:opacity-60"
              >
                <PenSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Text Post
              </button>

              <button
                type="button"
                disabled={verifyingComposerAction}
                onClick={() => void handleComposerAction('photo')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-sky-50 hover:text-[#0B1A2E] disabled:opacity-60"
              >
                <ImagePlus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Photo Post
              </button>

              {canPublishOfficialUpdate && (
                <button
                  type="button"
                  data-testid="home-official-update-btn"
                  onClick={() => {
                    setComposerFeedback(null);
                    setEditingOfficialUpdate(null);
                    setOfficialUpdateModalOpen(true);
                  }}
                  className="lasued-emerald-gradient inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
                >
                  <Megaphone className="h-4 w-4 text-teal-100" aria-hidden="true" />
                  Official Update
                </button>
              )}
            </div>

            {/* Visibly separate Anonymous action */}
            <button
              type="button"
              onClick={() => void handleComposerAction('anonymous')}
              className="lasued-accent-gradient inline-flex min-h-[42px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
            >
              <MessageSquare className="h-4 w-4 text-sky-200" aria-hidden="true" />
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
                  : composerFeedback.kind === 'email_verification_required'
                  ? 'border-amber-200 bg-amber-50 text-amber-950'
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
                        : composerFeedback.kind === 'email_verification_required'
                        ? 'text-amber-700'
                        : 'text-[#1E88E5]'
                    }`}
                    aria-hidden="true"
                  />
                )}
                <span>{composerFeedback.message}</span>
              </div>
              {composerFeedback.kind === 'email_verification_required' && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={verifyingComposerAction}
                    onClick={() => void handleRefreshComposerVerification()}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-[#132844] disabled:opacity-60"
                  >
                    {verifyingComposerAction
                      ? 'Checking...'
                      : "I've Verified — Refresh"}
                  </button>
                  <button
                    type="button"
                    disabled={resendingVerificationEmail}
                    onClick={() => void handleResendComposerVerification()}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 whitespace-nowrap hover:bg-amber-100 disabled:opacity-60"
                  >
                    {resendingVerificationEmail
                      ? 'Sending...'
                      : 'Resend Verification Email'}
                  </button>
                </div>
              )}
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
        className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6"
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
          {selectedPostId &&
            loadState === 'ready' &&
            deepLinkedPost?.targetId === selectedPostId &&
            deepLinkedPost.item === null &&
            !postItems.some((item) => item.post.id === selectedPostId) && (
              <div
                role="status"
                className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950 sm:text-sm"
              >
                <span>
                  This post is unavailable or may have been deleted.
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate(activeFeedTab)}
                  className="font-semibold text-[#1E88E5] hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

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
          ) : activeFeedTab === 'following' && followingStream.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
              <Users
                className="mx-auto mb-2.5 h-6 w-6 text-[#1E88E5]"
                aria-hidden="true"
              />
              <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                {followingCount === 0
                  ? 'You are not following anyone yet'
                  : 'No updates from accounts you follow yet'}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                {followingCount === 0
                  ? 'Search for classmates, lecturers, and verified campus contributors to follow their public updates.'
                  : `You follow ${followingCount} ${
                      followingCount === 1 ? 'account' : 'accounts'
                    }. Public campus updates they publish appear here (anonymous posts never appear here).`}
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
              {displayedStream.map((entry) => {
                if (entry.kind === 'update') {
                  return (
                    <div key={entry.id} data-feed-entry-id={entry.id}>
                      {renderHomeUpdateCard(entry.item)}
                    </div>
                  );
                }
                if (entry.kind === 'post') {
                  return (
                    <div key={entry.id} data-feed-entry-id={entry.id}>
                      {renderOrdinaryPostCard(entry.item)}
                    </div>
                  );
                }
                if (entry.kind === 'anonymous') {
                  return (
                    <div key={entry.id} data-feed-entry-id={entry.id}>
                      {renderHomeAnonymousCard(entry.post)}
                    </div>
                  );
                }

                if (entry.kind === 'people_discovery') {
                  return (
                    <section
                      key={entry.id}
                      data-feed-entry-id={entry.id}
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
                      data-feed-entry-id={entry.id}
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
                      data-feed-entry-id={entry.id}
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

                return null;
              })}

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
              const savedAnon = saved as AnonymousPost;
              if (activeFeedTab !== 'following') {
                const createdId = `anon_${savedAnon.id}`;
                setAnchoredOrderState((prev) =>
                  prev.key === currentTabKey && prev.ids.length > 0
                    ? {
                        key: prev.key,
                        ids: [
                          createdId,
                          ...prev.ids.filter((id) => id !== createdId),
                        ],
                      }
                    : prev
                );
                setAnonymousItems((prev) => [
                  savedAnon,
                  ...prev.filter((item) => item.id !== savedAnon.id),
                ]);
                setOwnedAnonPostIds((prev) => new Set([...prev, savedAnon.id]));
              }
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
                const createdId = `post_${savedCommunity.id}`;
                setAnchoredOrderState((prev) =>
                  prev.key === currentTabKey && prev.ids.length > 0
                    ? {
                        key: prev.key,
                        ids: [
                          createdId,
                          ...prev.ids.filter((id) => id !== createdId),
                        ],
                      }
                    : prev
                );
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

      {officialUpdateModalOpen && canPublishOfficialUpdate && user?.uid && (
        <UpdateComposerModal
          actorUid={user.uid}
          actorRole="supreme_admin"
          actorName={profile?.fullName || user.displayName || undefined}
          actorPhotoUrl={profile?.photoUrl}
          actorPhotoImageId={profile?.photoImageId}
          initialUpdate={editingOfficialUpdate}
          onSuccess={(savedUpdate) => {
            const authorProjection =
              savedUpdate.authorMode === 'public_admin' && profile
                ? toPublicProfileProjection(profile)
                : null;
            if (!editingOfficialUpdate) {
              const createdId = `update_${savedUpdate.id}`;
              setAnchoredOrderState((prev) =>
                prev.key === currentTabKey && prev.ids.length > 0
                  ? {
                      key: prev.key,
                      ids: [
                        createdId,
                        ...prev.ids.filter((id) => id !== createdId),
                      ],
                    }
                  : prev
              );
            }
            setUpdateItems((prev) => [
              { update: savedUpdate, author: authorProjection },
              ...prev.filter((item) => item.update.id !== savedUpdate.id),
            ]);
            setOfficialUpdateModalOpen(false);
            setEditingOfficialUpdate(null);
            setComposerFeedback({
              kind: 'ordinary_published',
              message: editingOfficialUpdate
                ? 'Your official update has been updated.'
                : 'Your official update is now live across Home and Official Updates.',
            });
          }}
          onClose={() => {
            setOfficialUpdateModalOpen(false);
            setEditingOfficialUpdate(null);
          }}
        />
      )}
    </div>
  );
};

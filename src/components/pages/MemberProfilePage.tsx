import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Briefcase,
  Building2,
  Camera,
  Check,
  Edit3,
  Eye,
  GraduationCap,
  Heart,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Package,
  Shield,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  getAnonymousBackgroundTheme,
  getTextPostBackgroundTheme,
} from '../../config/anonymousBackgrounds';
import { buildProfileShareUrl } from '../../config/site';
import { useFirebase } from '../../context/firebaseContext';
import {
  fetchFollowDirectoryPage,
  fetchMemberProfileBundleByUsername,
  type CommunityPostWithAuthor,
  type MemberProfileBundle,
} from '../../services/firestoreFoundation';
import {
  prefetchMediaImagesPriority,
  removeProfileMediaImage,
  saveProfileMediaImage,
  type UploadProgressState,
} from '../../services/mediaStorage';
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  getProfileSessionSnapshot,
  hydrateProfileSnapshot,
  saveProfileSessionSnapshot,
} from '../../services/navigationStateCache';
import {
  deletePostCascading,
  fetchMyAnonymousHistory,
  fetchOwnedAnonymousEntries,
  fetchOwnerSavedContentBundle,
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
  type SavedContentBundle,
} from '../../services/socialPosts';
import { LinkifiedText } from '../shared/LinkifiedText';
import { SectionRibbon } from '../shared/SectionRibbon';
import { ShareActionMenu } from '../shared/ShareActionMenu';
import type {
  AnonymousPost,
  CommunityPost,
  PublicProfileProjection,
  UserRole,
} from '../../types/database';
import type {
  ActiveRoute,
  ProfileTab,
  SearchScopeId,
} from '../../types/platform';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
  toPublicProfileProjection,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import {
  mergeCommunityPostItems,
  mergeOrderedRecords,
  reuseSetIfUnchanged,
  subtractPostLikesSafe,
} from '../../utils/cacheSync';
import {
  ALL_IMAGE_FILE_ACCEPT,
  compressImageFile,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import { mediaMetaToGridItems } from '../../utils/mediaGrid';
import {
  isDataSaverConnection,
  selectProfilePreloadTargets,
} from '../../utils/mediaCache';
import {
  formatOpportunityDeadlineSummary,
  getOpportunityCategoryShortLabel,
  resolveOpportunityLifecycle,
} from '../../utils/opportunities';
import {
  formatEventLocalDate,
  getEventCategoryShortLabel,
  resolveEventLifecycle,
} from '../../utils/events';
import { formatCompactViewCount } from '../../utils/postViews';
import { ProfileBadgesRow } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia, FirestoreImage } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';
import { PostCard } from '../posts/PostCard';
import { PostComposer } from '../posts/PostComposer';
import { EditProfileModal } from '../profile/EditProfileModal';
import { ProfileMenuSheet } from '../profile/ProfileMenuSheet';

interface MemberProfilePageProps {
  username: string | null;
  initialTab?: ProfileTab | null;
  onTabChange?: (tab: ProfileTab) => void;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
      opportunityId?: string | null;
      eventId?: string | null;
      listingId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack: () => void;
}

type DetailModalTarget =
  | { kind: 'ordinary'; post: CommunityPost; author: PublicProfileProjection | null }
  | { kind: 'anonymous'; post: AnonymousPost };

function formatHistoryTimestamp(value: unknown): string {
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

export const MemberProfilePage: React.FC<MemberProfilePageProps> = ({
  username,
  initialTab,
  onTabChange,
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const {
    authReady,
    user,
    profile: viewerProfile,
    effectiveTier,
    isSuspended,
    refreshAccountState,
  } = useFirebase();

  const viewerKey = user?.uid ?? 'guest';
  const effectiveUsername =
    username?.trim().toLowerCase() || viewerProfile?.username || null;
  const initialSnapshot = effectiveUsername
    ? getProfileSessionSnapshot(viewerKey, effectiveUsername)
    : null;

  const [bundle, setBundle] = useState<MemberProfileBundle | null>(
    () => initialSnapshot?.bundle ?? null
  );
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'not_found' | 'needs_setup' | 'error'
  >(() =>
    initialSnapshot?.bundle
      ? 'ready'
      : effectiveUsername
      ? 'loading'
      : 'not_found'
  );
  const [retryToken, setRetryToken] = useState(0);
  const lastHandledRetryRef = useRef(0);
  const hydratedProfileKeyRef = useRef<string | null>(
    initialSnapshot && effectiveUsername
      ? `${viewerKey}:${effectiveUsername}`
      : null
  );

  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(
    () => initialSnapshot?.likedPostIds ?? new Set()
  );
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(
    () => initialSnapshot?.savedPostIds ?? new Set()
  );
  const [likedAnonIds, setLikedAnonIds] = useState<Set<string>>(
    () => initialSnapshot?.likedAnonIds ?? new Set()
  );
  const [savedAnonIds, setSavedAnonIds] = useState<Set<string>>(
    () => initialSnapshot?.savedAnonIds ?? new Set()
  );
  const [ownedAnonCommentIds, setOwnedAnonCommentIds] = useState<Set<string>>(
    () => initialSnapshot?.ownedAnonCommentIds ?? new Set()
  );

  const [activeTab, setActiveTab] = useState<ProfileTab>(() => {
    if (initialTab && initialTab !== 'followers' && initialTab !== 'following') {
      return initialTab;
    }
    return initialSnapshot?.activeTab ?? 'posts';
  });

  // Lazy owner-only data states
  const [savedBundle, setSavedBundle] = useState<SavedContentBundle | null>(() =>
    user?.uid && initialSnapshot?.bundle.isOwnProfile
      ? initialSnapshot.savedBundle
      : null
  );
  const [anonHistory, setAnonHistory] = useState<AnonymousPost[] | null>(() =>
    user?.uid && initialSnapshot?.bundle.isOwnProfile
      ? initialSnapshot.anonHistory
      : null
  );

  // Followers / Following sheet
  const [followModalKind, setFollowModalKind] = useState<
    'followers' | 'following' | null
  >(() =>
    initialTab === 'followers' || initialTab === 'following'
      ? initialTab
      : initialSnapshot?.followModalKind ?? null
  );
  const [followModalList, setFollowModalList] = useState<
    PublicProfileProjection[] | null
  >(() =>
    initialSnapshot && initialSnapshot.followModalKind
      ? initialSnapshot.followList
      : null
  );
  const [followModalCursor, setFollowModalCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(
      () => initialSnapshot?.followCursor ?? null
    );
  const [followModalHasMore, setFollowModalHasMore] = useState(
    () => initialSnapshot?.followHasMore ?? false
  );
  const [followModalLoadingMore, setFollowModalLoadingMore] = useState(false);
  const [followModalError, setFollowModalError] = useState<string | null>(null);

  // Modals & sheets
  const [detailTarget, setDetailTarget] = useState<DetailModalTarget | null>(
    () => initialSnapshot?.detailTarget ?? null
  );
  const [editingOrdinaryPost, setEditingOrdinaryPost] =
    useState<CommunityPost | null>(null);
  const [editingAnonPost, setEditingAnonPost] = useState<AnonymousPost | null>(
    null
  );
  const [confirmDeleteAnonId, setConfirmDeleteAnonId] = useState<string | null>(
    null
  );
  const [deletingAnonId, setDeletingAnonId] = useState<string | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);

  // Direct Cover & Avatar gallery pickers on header
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCover, setPendingCover] =
    useState<CompressedImageResult | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverProgress, setCoverProgress] =
    useState<UploadProgressState | null>(null);
  const [pendingAvatar, setPendingAvatar] =
    useState<CompressedImageResult | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarProgress, setAvatarProgress] =
    useState<UploadProgressState | null>(null);
  const [profileMediaLightbox, setProfileMediaLightbox] = useState<{
    imageId?: string | null;
    directSrc?: string | null;
    fallbackUrl?: string | null;
    title: string;
  } | null>(null);

  // Feedback & actions
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Persist profile session snapshot per viewer
  useEffect(() => {
    if (
      loadState !== 'ready' ||
      !bundle ||
      !effectiveUsername ||
      hydratedProfileKeyRef.current !== `${viewerKey}:${effectiveUsername}`
    ) {
      return;
    }
    const allowOwnerPrivate = Boolean(user?.uid && bundle.isOwnProfile);
    saveProfileSessionSnapshot({
      viewerKey,
      username: bundle.resolvedUsername || effectiveUsername,
      bundle,
      activeTab,
      likedPostIds,
      savedPostIds,
      likedAnonIds,
      savedAnonIds,
      ownedAnonCommentIds,
      savedBundle: allowOwnerPrivate ? savedBundle : null,
      anonHistory: allowOwnerPrivate ? anonHistory : null,
      detailTarget,
      followModalKind,
      followList: followModalList ?? [],
      followCursor: followModalCursor,
      followHasMore: followModalHasMore,
      cachedAt: Date.now(),
    });
  }, [
    viewerKey,
    user?.uid,
    effectiveUsername,
    loadState,
    bundle,
    activeTab,
    likedPostIds,
    savedPostIds,
    likedAnonIds,
    savedAnonIds,
    ownedAnonCommentIds,
    savedBundle,
    anonHistory,
    detailTarget,
    followModalKind,
    followModalList,
    followModalCursor,
    followModalHasMore,
  ]);

  const syncProfileFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      if (!effectiveUsername) return;
      const profileCacheKey = `${viewerKey}:${effectiveUsername}`;
      const viewerUid = user?.uid ?? null;

      try {
        const [
          result,
          likedIds,
          savedIds,
          likedAnons,
          savedAnons,
          ownedAnon,
        ] = await Promise.all([
          fetchMemberProfileBundleByUsername(effectiveUsername, viewerUid),
          viewerUid
            ? fetchViewerLikedPostIds('posts', viewerUid).catch(() => null)
            : Promise.resolve(new Set<string>()),
          viewerUid
            ? fetchViewerSavedPostIds('posts', viewerUid).catch(() => null)
            : Promise.resolve(new Set<string>()),
          viewerUid
            ? fetchViewerLikedPostIds('anonymousPosts', viewerUid).catch(() => null)
            : Promise.resolve(new Set<string>()),
          viewerUid
            ? fetchViewerSavedPostIds('anonymousPosts', viewerUid).catch(() => null)
            : Promise.resolve(new Set<string>()),
          viewerUid
            ? fetchOwnedAnonymousEntries(viewerUid).catch(() => null)
            : Promise.resolve({
                postIds: new Set<string>(),
                commentIds: new Set<string>(),
              }),
        ]);

        if (isCancelled?.()) return;
        if (!result) {
          if (mode === 'initial') {
            setBundle(null);
            setLoadState('not_found');
          }
          return;
        }

        const alreadyHydrated = hydratedProfileKeyRef.current === profileCacheKey;
        hydratedProfileKeyRef.current = profileCacheKey;
        setBundle((prev) => {
          if (
            !prev ||
            mode === 'initial' ||
            prev.profile.username !== result.profile.username
          ) {
            return result;
          }
          return {
            ...result,
            posts: mergeOrderedRecords({
              existing: prev.posts,
              incoming: result.posts,
              preferIncomingOrder: false,
              preserveTail: true,
            }),
            likedPosts: mergeCommunityPostItems({
              existing: prev.likedPosts,
              incoming: result.likedPosts,
              preferIncomingOrder: false,
              preserveTail: true,
            }),
          };
        });
        if (likedIds !== null) {
          setLikedPostIds((prev) => reuseSetIfUnchanged(prev, likedIds));
        } else if (mode === 'initial' || !alreadyHydrated) {
          setLikedPostIds(new Set());
        }
        if (savedIds !== null) {
          setSavedPostIds((prev) => reuseSetIfUnchanged(prev, savedIds));
        } else if (mode === 'initial' || !alreadyHydrated) {
          setSavedPostIds(new Set());
        }
        if (likedAnons !== null) {
          setLikedAnonIds((prev) => reuseSetIfUnchanged(prev, likedAnons));
        } else if (mode === 'initial' || !alreadyHydrated) {
          setLikedAnonIds(new Set());
        }
        if (savedAnons !== null) {
          setSavedAnonIds((prev) => reuseSetIfUnchanged(prev, savedAnons));
        } else if (mode === 'initial' || !alreadyHydrated) {
          setSavedAnonIds(new Set());
        }
        if (ownedAnon !== null) {
          setOwnedAnonCommentIds((prev) =>
            reuseSetIfUnchanged(prev, ownedAnon.commentIds)
          );
        } else if (mode === 'initial' || !alreadyHydrated) {
          setOwnedAnonCommentIds(new Set());
        }

        // Enforce strict owner-only boundary on private tabs
        if (!result.isOwnProfile) {
          setActiveTab((curr) =>
            curr === 'saved' || curr === 'anonymous' ? 'posts' : curr
          );
        }
        setLoadState('ready');

        const { highPriority, normalPriority } = selectProfilePreloadTargets({
          coverImageId: result.profile.coverImageId,
          photoImageId: result.profile.photoImageId,
          posts: result.posts,
          likedPosts: result.likedPosts,
          listings: result.listings,
          isDataSaver: isDataSaverConnection(),
          maxTotal: 14,
        });
        if (highPriority.length > 0 || normalPriority.length > 0) {
          void prefetchMediaImagesPriority({
            highPriority,
            normalPriority,
            predecode: true,
            maxTotal: 14,
          });
        }
      } catch {
        if (isCancelled?.()) return;
        if (mode === 'initial') {
          setBundle((curr) => {
            if (!curr) {
              setLoadState('error');
            }
            return curr;
          });
        }
      }
    },
    [effectiveUsername, user?.uid, viewerKey]
  );

  // Fetch main profile bundle + viewer interaction flags with IDB fast hydration
  useEffect(() => {
    if (!effectiveUsername) {
      return;
    }

    const retryRequested = retryToken !== lastHandledRetryRef.current;
    if (retryRequested) {
      lastHandledRetryRef.current = retryToken;
    }

    const profileCacheKey = `${viewerKey}:${effectiveUsername}`;
    const existingSnapshot = !retryRequested
      ? getProfileSessionSnapshot(viewerKey, effectiveUsername)
      : null;

    let active = true;

    if (existingSnapshot && authReady) {
      let timer: number | null = null;
      if (hydratedProfileKeyRef.current !== profileCacheKey) {
        hydratedProfileKeyRef.current = profileCacheKey;
        const allowOwnerPrivate = Boolean(
          user?.uid && existingSnapshot.bundle.isOwnProfile
        );
        timer = window.setTimeout(() => {
          if (!active) return;
          setBundle(existingSnapshot.bundle);
          setLikedPostIds(existingSnapshot.likedPostIds);
          setSavedPostIds(existingSnapshot.savedPostIds);
          setLikedAnonIds(existingSnapshot.likedAnonIds);
          setSavedAnonIds(existingSnapshot.savedAnonIds);
          setOwnedAnonCommentIds(existingSnapshot.ownedAnonCommentIds);
          setSavedBundle(allowOwnerPrivate ? existingSnapshot.savedBundle : null);
          setAnonHistory(allowOwnerPrivate ? existingSnapshot.anonHistory : null);
          setDetailTarget(existingSnapshot.detailTarget);
          setLoadState('ready');
        }, 0);
      }

      const { highPriority, normalPriority } = selectProfilePreloadTargets({
        coverImageId: existingSnapshot.bundle.profile.coverImageId,
        photoImageId: existingSnapshot.bundle.profile.photoImageId,
        posts: existingSnapshot.bundle.posts,
        likedPosts: existingSnapshot.bundle.likedPosts,
        listings: existingSnapshot.bundle.listings,
        isDataSaver: isDataSaverConnection(),
        maxTotal: 14,
      });
      if (highPriority.length > 0 || normalPriority.length > 0) {
        void prefetchMediaImagesPriority({
          highPriority,
          normalPriority,
          predecode: true,
          maxTotal: 14,
        });
      }

      if (Date.now() - existingSnapshot.cachedAt > 2_000) {
        void syncProfileFromNetwork('background', () => !active);
      }

      return () => {
        active = false;
        if (timer !== null) window.clearTimeout(timer);
      };
    }

    let networkSettled = false;

    if (!retryRequested) {
      void hydrateProfileSnapshot(viewerKey, effectiveUsername)
        .then((persisted) => {
          if (!active || networkSettled || !persisted?.bundle) return;
          const allowOwnerPrivate = Boolean(
            user?.uid && persisted.bundle.isOwnProfile
          );
          hydratedProfileKeyRef.current = profileCacheKey;
          setBundle(persisted.bundle);
          setLikedPostIds(persisted.likedPostIds);
          setSavedPostIds(persisted.savedPostIds);
          setLikedAnonIds(persisted.likedAnonIds);
          setSavedAnonIds(persisted.savedAnonIds);
          setOwnedAnonCommentIds(persisted.ownedAnonCommentIds);
          setSavedBundle(allowOwnerPrivate ? persisted.savedBundle : null);
          setAnonHistory(allowOwnerPrivate ? persisted.anonHistory : null);
          setLoadState('ready');

          const { highPriority, normalPriority } = selectProfilePreloadTargets({
            coverImageId: persisted.bundle.profile.coverImageId,
            photoImageId: persisted.bundle.profile.photoImageId,
            posts: persisted.bundle.posts,
            likedPosts: persisted.bundle.likedPosts,
            listings: persisted.bundle.listings,
            isDataSaver: isDataSaverConnection(),
            maxTotal: 14,
          });
          if (highPriority.length > 0 || normalPriority.length > 0) {
            void prefetchMediaImagesPriority({
              highPriority,
              normalPriority,
              predecode: true,
              maxTotal: 14,
            });
          }
        })
        .catch(() => undefined);
    }

    void syncProfileFromNetwork('initial', () => !active).finally(() => {
      networkSettled = true;
    });

    return () => {
      active = false;
    };
  }, [
    effectiveUsername,
    viewerKey,
    user?.uid,
    authReady,
    viewerProfile?.username,
    retryToken,
    syncProfileFromNetwork,
  ]);

  useActiveBackgroundRefresh({
    enabled:
      authReady &&
      loadState === 'ready' &&
      Boolean(effectiveUsername) &&
      Boolean(bundle),
    onRefresh: () => syncProfileFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  const processedDeletedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return subscribeCacheMutations((event) => {
      if (event.type === 'community_post_deleted') {
        const key = `post:${event.postId}`;
        const alreadyApplied = processedDeletedIdsRef.current.has(key);
        processedDeletedIdsRef.current.add(key);

        setBundle((prev) => {
          if (!prev) return prev;
          const removedOwnPost = prev.posts.find((p) => p.id === event.postId);
          const isTargetProfileAuthor =
            Boolean(removedOwnPost) ||
            Boolean(prev.isOwnProfile && event.ownerUID && user?.uid && event.ownerUID === user.uid);
          const likesToSubtract = alreadyApplied
            ? 0
            : Math.max(
                0,
                event.likesCount ?? removedOwnPost?.likesCount ?? 0
              );
          const nextPosts = prev.posts.filter((p) => p.id !== event.postId);
          const nextLiked = prev.likedPosts.filter(
            (entry) => entry.post.id !== event.postId
          );
          const nextTotalLikes = isTargetProfileAuthor
            ? subtractPostLikesSafe(prev.totalLikesReceived, likesToSubtract)
            : prev.totalLikesReceived;

          return {
            ...prev,
            posts: nextPosts,
            likedPosts: nextLiked,
            totalLikesReceived: nextTotalLikes,
          };
        });
        setSavedBundle((prev) =>
          prev
            ? {
                ...prev,
                posts: prev.posts.filter((e) => e.post.id !== event.postId),
              }
            : prev
        );
      } else if (event.type === 'anonymous_post_deleted') {
        const key = `anon:${event.postId}`;
        const alreadyApplied = processedDeletedIdsRef.current.has(key);
        processedDeletedIdsRef.current.add(key);

        let removedHistoryLikes = 0;
        setAnonHistory((prev) => {
          if (!prev) return prev;
          const removed = prev.find((item) => item.id === event.postId);
          if (removed) {
            removedHistoryLikes = Math.max(0, removed.likesCount ?? 0);
          }
          return prev.filter((item) => item.id !== event.postId);
        });
        setSavedBundle((prev) =>
          prev
            ? {
                ...prev,
                anonymousPosts: prev.anonymousPosts.filter(
                  (p) => p.id !== event.postId
                ),
              }
            : prev
        );
        setBundle((prev) => {
          if (!prev) return prev;
          const isTargetProfileAuthor = prev.isOwnProfile;
          if (!isTargetProfileAuthor || alreadyApplied) return prev;
          const likesToSubtract = Math.max(
            0,
            event.likesCount ?? removedHistoryLikes
          );
          if (likesToSubtract <= 0) return prev;
          const nextAnonLikes = subtractPostLikesSafe(
            prev.profile.anonymousLikesReceivedCount ?? 0,
            likesToSubtract
          );
          return {
            ...prev,
            profile: {
              ...prev.profile,
              anonymousLikesReceivedCount: nextAnonLikes,
            },
            totalLikesReceived: subtractPostLikesSafe(
              prev.totalLikesReceived,
              likesToSubtract
            ),
          };
        });
      }
    });
  }, [user?.uid]);

  const resolvedLoadState: typeof loadState = !effectiveUsername
    ? !authReady
      ? 'loading'
      : user && !viewerProfile
      ? 'needs_setup'
      : 'not_found'
    : loadState;

  const savedLoading =
    activeTab === 'saved' &&
    Boolean(bundle?.isOwnProfile) &&
    Boolean(user?.uid) &&
    savedBundle === null;

  const anonLoading =
    activeTab === 'anonymous' &&
    Boolean(bundle?.isOwnProfile) &&
    Boolean(user?.uid) &&
    anonHistory === null;

  const followModalLoading =
    followModalKind !== null && bundle !== null && followModalList === null;

  // Keep own profile header synced immediately whenever viewerProfile updates via modal/menu
  const displayedProfile: PublicProfileProjection | null = bundle
    ? bundle.isOwnProfile && viewerProfile
      ? toPublicProfileProjection(viewerProfile)
      : bundle.profile
    : null;

  // Lazy load Saved tab ONLY for authenticated profile owner
  useEffect(() => {
    if (
      !bundle?.isOwnProfile ||
      !user?.uid ||
      activeTab !== 'saved' ||
      savedBundle !== null
    ) {
      return;
    }
    let active = true;
    fetchOwnerSavedContentBundle(user.uid)
      .then((res) => {
        if (!active) return;
        setSavedBundle(res);
      })
      .catch((err) => {
        if (!active) return;
        setSavedBundle({
          posts: [],
          anonymousPosts: [],
          listings: [],
          opportunities: [],
          events: [],
        });
        setActionError(
          formatFirestoreOrAppError(err, 'Unable to load saved content.')
        );
      });
    return () => {
      active = false;
    };
  }, [bundle?.isOwnProfile, user?.uid, activeTab, savedBundle]);

  // Lazy load My Anonymous Posts tab ONLY for authenticated profile owner
  useEffect(() => {
    if (
      !bundle?.isOwnProfile ||
      !user?.uid ||
      activeTab !== 'anonymous' ||
      anonHistory !== null
    ) {
      return;
    }
    let active = true;
    fetchMyAnonymousHistory(user.uid)
      .then((posts) => {
        if (!active) return;
        setAnonHistory(posts);
      })
      .catch((err) => {
        if (!active) return;
        setAnonHistory([]);
        setActionError(
          formatFirestoreOrAppError(
            err,
            'Unable to load your anonymous post history.'
          )
        );
      });
    return () => {
      active = false;
    };
  }, [bundle?.isOwnProfile, user?.uid, activeTab, anonHistory]);

  const followModalTargetUsername = bundle?.resolvedUsername ?? null;

  const lastInitialTabRef = useRef(initialTab);
  useEffect(() => {
    if (lastInitialTabRef.current === initialTab) return;
    lastInitialTabRef.current = initialTab;
    const timer = window.setTimeout(() => {
      if (initialTab === 'followers' || initialTab === 'following') {
        setFollowModalList(null);
        setFollowModalCursor(null);
        setFollowModalHasMore(false);
        setFollowModalError(null);
        setFollowModalKind(initialTab);
      } else if (initialTab) {
        if (bundle && !bundle.isOwnProfile && (initialTab === 'saved' || initialTab === 'anonymous')) {
          setActiveTab('posts');
        } else {
          setActiveTab(initialTab);
        }
        setFollowModalKind(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialTab, bundle]);

  // Load Followers / Following modal list when opened
  useEffect(() => {
    if (!followModalKind || !followModalTargetUsername || followModalList !== null) {
      return;
    }
    let active = true;
    fetchFollowDirectoryPage({
      username: followModalTargetUsername,
      kind: followModalKind,
      pageSize: 20,
    })
      .then((page) => {
        if (!active) return;
        setFollowModalList(page.items);
        setFollowModalCursor(page.nextCursor);
        setFollowModalHasMore(page.hasMore);
        setFollowModalError(null);
      })
      .catch((err) => {
        if (!active) return;
        setFollowModalList([]);
        setFollowModalCursor(null);
        setFollowModalHasMore(false);
        setFollowModalError(
          formatFirestoreOrAppError(err, 'Unable to load this member list.')
        );
      });

    return () => {
      active = false;
    };
  }, [followModalKind, followModalTargetUsername, followModalList]);

  const openFollowModal = (kind: 'followers' | 'following') => {
    setFollowModalList(null);
    setFollowModalCursor(null);
    setFollowModalHasMore(false);
    setFollowModalError(null);
    setFollowModalKind(kind);
  };

  const closeFollowModal = () => {
    setFollowModalKind(null);
    setFollowModalList(null);
    setFollowModalCursor(null);
    setFollowModalHasMore(false);
    setFollowModalLoadingMore(false);
    setFollowModalError(null);
  };

  const handleLoadMoreFollowModal = async () => {
    if (
      !followModalKind ||
      !bundle ||
      !followModalHasMore ||
      followModalLoadingMore ||
      !followModalCursor
    ) {
      return;
    }
    setFollowModalLoadingMore(true);
    setFollowModalError(null);
    try {
      const page = await fetchFollowDirectoryPage({
        username: bundle.resolvedUsername,
        kind: followModalKind,
        pageSize: 20,
        cursor: followModalCursor,
      });
      setFollowModalList((prev) => {
        const existing = prev ?? [];
        const seen = new Set(existing.map((m) => m.username));
        return [
          ...existing,
          ...page.items.filter((m) => !seen.has(m.username)),
        ];
      });
      setFollowModalCursor(page.nextCursor);
      setFollowModalHasMore(page.hasMore);
    } catch (err) {
      setFollowModalError(
        formatFirestoreOrAppError(err, 'Unable to load more members right now.')
      );
    } finally {
      setFollowModalLoadingMore(false);
    }
  };

  const handleSelectTab = (tab: ProfileTab) => {
    if (!bundle) return;
    if (!bundle.isOwnProfile && (tab === 'saved' || tab === 'anonymous')) {
      return;
    }
    if (tab === 'followers' || tab === 'following') {
      openFollowModal(tab);
      return;
    }
    setActiveTab(tab);
    setActionError(null);
    onTabChange?.(tab);
  };

  // Direct Header Cover Picker Handlers
  const handleSelectCoverFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || coverBusy || isSuspended || !user) return;
    setCoverBusy(true);
    setActionError(null);
    setCoverProgress({ percent: 20, label: 'Compressing cover...' });
    try {
      const compressed = await compressImageFile(file, 'cover');
      setPendingCover(compressed);
      setCoverProgress(null);
    } catch (error) {
      setCoverProgress(null);
      setActionError(
        formatFirestoreOrAppError(error, 'Could not process cover photograph.')
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const handleSaveCoverDirect = async () => {
    if (!pendingCover || !user || coverBusy || isSuspended) return;
    setCoverBusy(true);
    setActionError(null);
    try {
      await saveProfileMediaImage({
        uid: user.uid,
        username: viewerProfile?.username,
        slot: 'cover',
        compressed: pendingCover,
        previousImageId: viewerProfile?.coverImageId,
        onProgress: setCoverProgress,
      });
      await refreshAccountState();
      setPendingCover(null);
      setCoverProgress(null);
      setActionMessage('Cover photo updated.');
      window.setTimeout(() => setActionMessage(null), 3000);
    } catch (error) {
      setCoverProgress(null);
      setActionError(
        formatFirestoreOrAppError(error, 'Could not save cover photo.')
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const handleRemoveCoverDirect = async () => {
    if (!user || coverBusy || isSuspended) return;
    if (pendingCover) {
      setPendingCover(null);
      return;
    }
    setCoverBusy(true);
    setActionError(null);
    try {
      await removeProfileMediaImage({
        uid: user.uid,
        username: viewerProfile?.username,
        slot: 'cover',
        currentImageId: viewerProfile?.coverImageId,
      });
      await refreshAccountState();
      setActionMessage('Cover photo removed.');
      window.setTimeout(() => setActionMessage(null), 3000);
    } catch (error) {
      setActionError(
        formatFirestoreOrAppError(error, 'Could not remove cover photo.')
      );
    } finally {
      setCoverBusy(false);
    }
  };

  // Direct Header Avatar Picker Handlers
  const handleSelectAvatarFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || avatarBusy || isSuspended || !user) return;
    setAvatarBusy(true);
    setActionError(null);
    setAvatarProgress({ percent: 20, label: 'Compressing profile photo...' });
    try {
      const compressed = await compressImageFile(file, 'avatar');
      setPendingAvatar(compressed);
      setAvatarProgress(null);
    } catch (error) {
      setAvatarProgress(null);
      setActionError(
        formatFirestoreOrAppError(error, 'Could not process profile picture.')
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleSaveAvatarDirect = async () => {
    if (!pendingAvatar || !user || avatarBusy || isSuspended) return;
    setAvatarBusy(true);
    setActionError(null);
    try {
      await saveProfileMediaImage({
        uid: user.uid,
        username: viewerProfile?.username,
        slot: 'avatar',
        compressed: pendingAvatar,
        previousImageId: viewerProfile?.photoImageId,
        onProgress: setAvatarProgress,
      });
      await refreshAccountState();
      setPendingAvatar(null);
      setAvatarProgress(null);
      setActionMessage('Profile picture updated.');
      window.setTimeout(() => setActionMessage(null), 3000);
    } catch (error) {
      setAvatarProgress(null);
      setActionError(
        formatFirestoreOrAppError(error, 'Could not save profile picture.')
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleDeleteOwnAnonPost = async (target: AnonymousPost) => {
    if (!user || deletingAnonId) return;
    setDeletingAnonId(target.id);
    setActionError(null);
    try {
      await deletePostCascading({
        kind: 'anonymousPosts',
        post: target,
        actorUid: user.uid,
      });
      setAnonHistory((prev) =>
        prev ? prev.filter((item) => item.id !== target.id) : prev
      );
      setConfirmDeleteAnonId(null);
      setActionMessage('Anonymous post permanently deleted.');
      window.setTimeout(() => setActionMessage(null), 3000);
    } catch (error) {
      setActionError(
        formatFirestoreOrAppError(
          error,
          'Unable to delete anonymous post right now.'
        )
      );
    } finally {
      setDeletingAnonId(null);
    }
  };

  if (resolvedLoadState === 'loading') {
    return (
      <section className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="h-56 w-full animate-pulse bg-[#0B1A2E]/20 sm:h-72 dark:bg-slate-800" />
        <div className="px-5 pb-6">
          <div className="-mt-12 h-24 w-24 animate-pulse rounded-full border-4 border-white bg-slate-200 sm:-mt-16 sm:h-32 sm:w-32 dark:border-slate-900 dark:bg-slate-700" />
          <div className="mt-4 h-7 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-2 h-4 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="aspect-square animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            <div className="aspect-square animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            <div className="aspect-square animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      </section>
    );
  }

  if (resolvedLoadState === 'needs_setup') {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div className="mt-5 max-w-lg">
          <h1 className="font-display text-2xl font-bold text-[#0B1A2E] dark:text-slate-100">
            Finish setting up your profile
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Add your name, @username, department, level, and WhatsApp in Account
            Settings to unlock your profile page.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('account')}
            className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-[#1E88E5] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1565C0]"
          >
            Set Up Profile
          </button>
        </div>
      </section>
    );
  }

  if (resolvedLoadState === 'error') {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-red-200 bg-white p-6 dark:border-red-900/50 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <h1 className="mt-4 font-display text-xl font-bold text-[#0B1A2E] dark:text-slate-100">
          Unable to load profile
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          We couldn&apos;t load this profile right now. Please try again.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadState('loading');
            setRetryToken((prev) => prev + 1);
          }}
          className="mt-4 inline-flex min-h-[42px] items-center rounded-lg bg-[#1E88E5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565C0]"
        >
          Try Again
        </button>
      </section>
    );
  }

  if (resolvedLoadState === 'not_found' || !bundle || !displayedProfile) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div className="mt-6 max-w-md">
          <h1 className="font-display text-xl font-bold text-[#0B1A2E] dark:text-slate-100">
            Profile not found
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            No active profile matches{' '}
            {effectiveUsername ? `@${effectiveUsername}` : 'this link'}.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('for-you')}
              className="inline-flex min-h-[42px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1565C0]"
            >
              Return Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('search', { searchScope: 'home' })}
              className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Search Members
            </button>
          </div>
        </div>
      </section>
    );
  }

  const profile = displayedProfile;
  const whatsappUrl =
    profile.showWhatsappPublicly && profile.publicWhatsapp
      ? buildWhatsAppChatUrl(profile.publicWhatsapp)
      : null;
  const hasCover = Boolean(
    pendingCover || profile.coverImageId || profile.coverUrl
  );
  const hasAvatar = Boolean(
    pendingAvatar || profile.photoImageId || profile.photoUrl
  );

  // Build visible tab list: public gets Posts + Liked (+ Listings if any), owner also gets Saved + My Anonymous
  const tabs: { id: ProfileTab; label: string; count?: number; privateTab?: boolean }[] =
    [
      { id: 'posts', label: 'Posts', count: bundle.posts.length },
      ...(bundle.isOwnProfile
        ? [{ id: 'saved' as ProfileTab, label: 'Saved', privateTab: true }]
        : []),
      { id: 'liked', label: 'Liked', count: bundle.likedPosts.length },
      ...(bundle.isOwnProfile
        ? [
            {
              id: 'anonymous' as ProfileTab,
              label: 'My Anonymous',
              privateTab: true,
            },
          ]
        : []),
      ...(bundle.listings.length > 0
        ? [
            {
              id: 'listings' as ProfileTab,
              label: 'Listings',
              count: bundle.listings.length,
            },
          ]
        : []),
    ];

  const handleOrdinaryPostUpdated = (updated: CommunityPost | AnonymousPost) => {
    const communityUpdated = updated as CommunityPost;
    setBundle((prev) => {
      if (!prev) return prev;
      const prevOrdinaryLikes = prev.posts.reduce(
        (acc, p) => acc + (p.status === 'published' ? Math.max(0, p.likesCount) : 0),
        0
      );
      const anonLikesBaseline = Math.max(
        0,
        prev.totalLikesReceived - prevOrdinaryLikes
      );
      const nextPosts = prev.posts.map((item) =>
        item.id === communityUpdated.id ? communityUpdated : item
      );
      const nextLikedPosts = prev.likedPosts.map((entry) =>
        entry.post.id === communityUpdated.id
          ? { ...entry, post: communityUpdated }
          : entry
      );
      const nextOrdinaryLikes = nextPosts.reduce(
        (acc, p) => acc + (p.status === 'published' ? Math.max(0, p.likesCount) : 0),
        0
      );
      return {
        ...prev,
        posts: nextPosts,
        likedPosts: nextLikedPosts,
        totalLikesReceived: nextOrdinaryLikes + anonLikesBaseline,
      };
    });
    setDetailTarget((prev) =>
      prev && prev.kind === 'ordinary' && prev.post.id === communityUpdated.id
        ? { ...prev, post: communityUpdated }
        : prev
    );
  };

  const handleOrdinaryPostDeleted = (deletedId: string) => {
    setBundle((prev) => {
      if (!prev) return prev;
      const prevOrdinaryLikes = prev.posts.reduce(
        (acc, p) => acc + (p.status === 'published' ? Math.max(0, p.likesCount) : 0),
        0
      );
      const anonLikesBaseline = Math.max(
        0,
        prev.totalLikesReceived - prevOrdinaryLikes
      );
      const nextPosts = prev.posts.filter((item) => item.id !== deletedId);
      const nextOrdinaryLikes = nextPosts.reduce(
        (acc, p) => acc + (p.status === 'published' ? Math.max(0, p.likesCount) : 0),
        0
      );
      return {
        ...prev,
        posts: nextPosts,
        likedPosts: prev.likedPosts.filter((e) => e.post.id !== deletedId),
        totalLikesReceived: nextOrdinaryLikes + anonLikesBaseline,
      };
    });
    setSavedBundle((prev) =>
      prev
        ? {
            ...prev,
            posts: prev.posts.filter((e) => e.post.id !== deletedId),
          }
        : prev
    );
    setDetailTarget(null);
  };

  const renderPostVisualGrid = (
    items: CommunityPostWithAuthor[],
    emptyTitle: string,
    emptySubtitle: string
  ) => {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
            {emptyTitle}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-600 dark:text-slate-400">
            {emptySubtitle}
          </p>
        </div>
      );
    }

    return (
      <div
        className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2"
        data-testid="profile-visual-grid"
      >
        {items.map(({ post, author: tileAuthor }) => {
          const media = post.mediaItems ?? [];
          const firstPhoto = media[0];
          const hasPhoto = Boolean(firstPhoto);

          return (
            <button
              key={post.id}
              type="button"
              onClick={() =>
                setDetailTarget({
                  kind: 'ordinary',
                  post,
                  author: tileAuthor,
                })
              }
              aria-label={`Open post: ${post.title || post.body.slice(0, 48) || post.category}`}
              className="group relative aspect-square w-[46%] shrink-0 snap-start overflow-hidden rounded-xl bg-[#0B1A2E] text-left focus-visible:outline-2 focus-visible:outline-[#1E88E5] sm:w-[31%] lg:w-[calc(25%-8px)]"
            >
              {hasPhoto ? (
                <FirestoreImage
                  imageId={firstPhoto.imageId}
                  alt={post.title || post.body.slice(0, 60) || 'Post media'}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  placeholderClassName="bg-[#0B1A2E]"
                />
              ) : (
                (() => {
                  const textTheme =
                    post.backgroundStyle || post.postType === 'text'
                      ? getTextPostBackgroundTheme(post.backgroundStyle)
                      : null;
                  return (
                    <div
                      className={`flex h-full w-full flex-col justify-between p-2.5 sm:p-3.5 ${
                        textTheme
                          ? ''
                          : 'bg-gradient-to-br from-[#0B1A2E] via-[#132944] to-[#1E88E5]/80'
                      }`}
                      style={
                        textTheme
                          ? { background: textTheme.backgroundCss }
                          : undefined
                      }
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide sm:text-[11px] ${
                          textTheme && !textTheme.isDark
                            ? 'text-[#0B1A2E]/75'
                            : 'text-[#90CAF9]'
                        }`}
                      >
                        {post.category}
                      </span>
                      <p
                        className={`line-clamp-4 text-[11px] font-semibold leading-snug sm:text-xs ${
                          textTheme ? textTheme.textColorClass : 'text-white'
                        }`}
                      >
                        {post.title || post.body}
                      </p>
                      <span aria-hidden="true" />
                    </div>
                  );
                })()
              )}

              {/* Subtle bottom gradient for metric legibility */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0B1A2E]/85 via-[#0B1A2E]/40 to-transparent"
              />

              {/* Multi-image indicator */}
              {media.length > 1 && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-[#0B1A2E]/80 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                  <Layers className="h-3 w-3" aria-hidden="true" />
                  {media.length}
                </span>
              )}

              {/* Likes, Comments & Views overlay metrics */}
              <div className="absolute right-2 bottom-1.5 left-2 flex items-center gap-2 text-[11px] font-semibold text-white">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Heart className="h-3 w-3 fill-white/90" aria-hidden="true" />
                  {post.likesCount}
                </span>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MessageCircle className="h-3 w-3" aria-hidden="true" />
                  {post.commentsCount}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 tabular-nums opacity-90">
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  {formatCompactViewCount(post.viewsCount)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <section
      aria-labelledby="member-profile-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-white hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>

        {bundle.redirectedFrom && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Previously @{bundle.redirectedFrom}
          </p>
        )}
      </div>

      {/* Main Profile Header Card (TikTok-inspired Layout with Large Cover + Overlapping Circular Avatar) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* 1. LARGE COVER PHOTO (~75% of profile header visual area) */}
        <div
          className="relative h-56 w-full overflow-hidden bg-[#0B1A2E] sm:h-72"
          data-testid="profile-cover-area"
        >
          {hasCover ? (
            <button
              type="button"
              onClick={() =>
                setProfileMediaLightbox({
                  imageId: pendingCover ? null : profile.coverImageId,
                  directSrc: pendingCover?.dataUrl ?? null,
                  fallbackUrl: pendingCover ? null : profile.coverUrl,
                  title: `${profile.fullName}'s cover banner`,
                })
              }
              aria-label={`View ${profile.fullName}'s cover banner full screen`}
              className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-[#1E88E5]"
            >
              <FirestoreImage
                directSrc={pendingCover?.dataUrl}
                imageId={pendingCover ? null : profile.coverImageId}
                fallbackUrl={pendingCover ? null : profile.coverUrl}
                alt={`${profile.fullName}'s cover banner`}
                eager
                className="h-full w-full object-cover object-center"
                placeholderClassName="bg-[#0B1A2E]"
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0B1A2E] via-[#132944] to-[#1E88E5]/60">
              <div className="text-center opacity-70">
                <p className="font-display text-xs font-semibold tracking-wider text-white/80 uppercase">
                  LASUED Intel
                </p>
              </div>
            </div>
          )}

          {/* Subtle gradient at bottom for crisp overlap */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0B1A2E]/65 to-transparent"
          />

          {/* Owner-Only Cover Controls */}
          {bundle.isOwnProfile && !isSuspended && (
            <>
              <input
                ref={coverInputRef}
                type="file"
                accept={ALL_IMAGE_FILE_ACCEPT}
                onChange={handleSelectCoverFile}
                className="hidden"
                data-testid="profile-header-cover-input"
              />

              <div className="absolute top-3 right-3 flex flex-wrap items-center gap-2">
                {pendingCover ? (
                  <>
                    <button
                      type="button"
                      disabled={coverBusy}
                      onClick={() => void handleSaveCoverDirect()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-[#1565C0] disabled:opacity-60"
                    >
                      {coverBusy ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Save Cover
                    </button>
                    <button
                      type="button"
                      disabled={coverBusy}
                      onClick={() => setPendingCover(null)}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] shadow-md hover:bg-white"
                    >
                      Discard
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={coverBusy}
                      onClick={() => coverInputRef.current?.click()}
                      aria-label="Edit cover photo"
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E]/80 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-xs hover:bg-[#0B1A2E]"
                    >
                      {coverBusy ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{hasCover ? 'Change Cover' : 'Add Cover'}</span>
                    </button>

                    {hasCover && (
                      <button
                        type="button"
                        disabled={coverBusy}
                        onClick={() => void handleRemoveCoverDirect()}
                        aria-label="Remove cover photo"
                        className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg bg-[#0B1A2E]/80 text-white ring-1 ring-white/25 backdrop-blur-xs hover:bg-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </>
                )}
              </div>

              {coverProgress && (
                <div className="absolute right-4 bottom-3 left-4 rounded-lg bg-[#0B1A2E]/90 px-3 py-2 text-xs text-white">
                  {coverProgress.label} ({coverProgress.percent}%)
                </div>
              )}
            </>
          )}
        </div>

        {/* 2. OVERLAPPING CIRCULAR PROFILE PICTURE & INFO */}
        <div className="px-4 pb-6 sm:px-6">
          <div className="-mt-12 flex flex-col justify-between gap-4 sm:-mt-16 sm:flex-row sm:items-end">
            {/* Large Circular Avatar with Independent Owner Camera Control */}
            <div className="relative inline-block w-fit">
              <div
                className="relative h-24 w-24 overflow-hidden rounded-full bg-[#0B1A2E] ring-4 ring-white shadow-md sm:h-32 sm:w-32 dark:ring-slate-900"
                data-testid="profile-avatar-circle"
              >
                {hasAvatar ? (
                  <button
                    type="button"
                    onClick={() =>
                      setProfileMediaLightbox({
                        imageId: pendingAvatar ? null : profile.photoImageId,
                        directSrc: pendingAvatar?.dataUrl ?? null,
                        fallbackUrl: pendingAvatar ? null : profile.photoUrl,
                        title: `${profile.fullName}'s profile picture`,
                      })
                    }
                    aria-label={`View ${profile.fullName}'s profile picture full screen`}
                    className="block h-full w-full cursor-zoom-in rounded-full"
                  >
                    {pendingAvatar ? (
                      <img
                        src={pendingAvatar.dataUrl}
                        alt={`${profile.fullName} preview`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <AvatarMedia
                        fullName={profile.fullName}
                        photoImageId={profile.photoImageId}
                        photoUrl={profile.photoUrl}
                        sizeClass="h-full w-full"
                        roundedClass="rounded-full"
                        textClass="text-2xl sm:text-3xl"
                        eager
                      />
                    )}
                  </button>
                ) : (
                  <AvatarMedia
                    fullName={profile.fullName}
                    photoImageId={profile.photoImageId}
                    photoUrl={profile.photoUrl}
                    sizeClass="h-full w-full"
                    roundedClass="rounded-full"
                    textClass="text-2xl sm:text-3xl"
                    eager
                  />
                )}
              </div>

              {bundle.isOwnProfile && !isSuspended && (
                <>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept={ALL_IMAGE_FILE_ACCEPT}
                    onChange={handleSelectAvatarFile}
                    className="hidden"
                    data-testid="profile-header-avatar-input"
                  />
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}
                    aria-label="Change profile picture"
                    className="absolute right-0 bottom-0 flex h-9 w-9 items-center justify-center rounded-full bg-[#1E88E5] text-white ring-2 ring-white shadow-sm hover:bg-[#1565C0] disabled:opacity-60 dark:ring-slate-900"
                  >
                    {avatarBusy ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Camera className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-2">
              {bundle.isOwnProfile ? (
                <>
                  <button
                    type="button"
                    disabled={isSuspended}
                    onClick={() => setEditProfileOpen(true)}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60 sm:text-sm dark:bg-[#1E88E5] dark:hover:bg-[#1565C0]"
                  >
                    <Edit3 className="h-4 w-4 text-[#1E88E5] dark:text-white" aria-hidden="true" />
                    Edit Profile
                  </button>

                  <ShareActionMenu
                    shareUrl={buildProfileShareUrl(bundle.resolvedUsername)}
                    title={`${displayedProfile.fullName} (@${displayedProfile.username}) — LASUED Intel`}
                    text={
                      displayedProfile.bio?.trim() ||
                      `View @${displayedProfile.username} on LASUED Intel`
                    }
                    variant="button"
                    label="Share Profile"
                    align="left"
                    buttonClassName="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  />

                  <button
                    type="button"
                    onClick={() => setMenuSheetOpen(true)}
                    aria-label="Open profile menu and settings"
                    className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <TikTokFollowButton
                    targetUsername={bundle.resolvedUsername}
                    compact={false}
                    disabled={bundle.isSuspended}
                    onRequireAuth={() => setShowGuestPrompt(true)}
                    onFollowChange={(nextFollowing) => {
                      setBundle((prev) =>
                        prev
                          ? {
                              ...prev,
                              isFollowing: nextFollowing,
                              profile: {
                                ...prev.profile,
                                followersCount: Math.max(
                                  0,
                                  prev.profile.followersCount +
                                    (nextFollowing ? 1 : -1)
                                ),
                              },
                            }
                          : prev
                      );
                    }}
                  />

                  {whatsappUrl && (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] sm:text-sm dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    >
                      <MessageCircle
                        className="h-4 w-4 text-[#1E88E5] dark:text-white"
                        aria-hidden="true"
                      />
                      WhatsApp
                    </a>
                  )}

                  <ShareActionMenu
                    shareUrl={buildProfileShareUrl(bundle.resolvedUsername)}
                    title={`${displayedProfile.fullName} (@${displayedProfile.username}) — LASUED Intel`}
                    text={
                      displayedProfile.bio?.trim() ||
                      `View @${displayedProfile.username} on LASUED Intel`
                    }
                    variant="button"
                    label="Share"
                    align="left"
                    ariaLabel="Share profile"
                    buttonClassName="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  />
                </>
              )}
            </div>
          </div>

          {/* Pending Direct Avatar Save/Discard Bar */}
          {pendingAvatar && bundle.isOwnProfile && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/5 px-3.5 py-2.5 text-xs dark:border-[#1E88E5]/40 dark:bg-[#1E88E5]/10">
              <span className="font-medium text-[#0B1A2E] dark:text-slate-100">
                New profile picture preview ready.
              </span>
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => void handleSaveAvatarDirect()}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#1E88E5] px-3 py-1 font-semibold text-white hover:bg-[#1565C0]"
              >
                {avatarBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Save Photo
              </button>
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => setPendingAvatar(null)}
                className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                Discard
              </button>
            </div>
          )}

          {avatarProgress && (
            <div className="mt-3 max-w-sm space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center justify-between text-xs font-medium text-[#0B1A2E] dark:text-slate-100">
                <span>{avatarProgress.label}</span>
                <span className="tabular-nums">{avatarProgress.percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full bg-[#1E88E5] transition-all duration-200"
                  style={{ width: `${avatarProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Full Name, Badge, Username */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                id="member-profile-heading"
                className="font-display text-2xl font-bold text-[#0B1A2E] dark:text-slate-100"
              >
                {profile.fullName}
              </h1>
              {(profile.badge !== 'none' || profile.isVerified) && (
                <ProfileBadgesRow profile={profile} size="md" />
              )}
              {bundle.isSuspended && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Suspended
                </span>
              )}
            </div>

            <p className="mt-0.5 text-sm font-medium text-slate-600 dark:text-slate-400">
              @{profile.username}
            </p>

            {/* TikTok-Inspired Stats Row: Following · Followers · Likes */}
            <div className="mt-4 flex flex-wrap items-center gap-6 border-y border-slate-100 py-3 text-sm dark:border-slate-800">
              <button
                type="button"
                onClick={() => openFollowModal('following')}
                className="inline-flex items-baseline gap-1.5 text-left hover:text-[#1E88E5] dark:hover:text-[#64B5F6]"
              >
                <span className="font-display text-base font-bold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                  {profile.followingCount}
                </span>
                <span className="text-xs font-medium text-slate-600 sm:text-sm dark:text-slate-400">
                  Following
                </span>
              </button>

              <button
                type="button"
                onClick={() => openFollowModal('followers')}
                className="inline-flex items-baseline gap-1.5 text-left hover:text-[#1E88E5] dark:hover:text-[#64B5F6]"
              >
                <span className="font-display text-base font-bold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                  {profile.followersCount}
                </span>
                <span className="text-xs font-medium text-slate-600 sm:text-sm dark:text-slate-400">
                  Followers
                </span>
              </button>

              <div className="inline-flex items-baseline gap-1.5">
                <span className="font-display text-base font-bold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                  {bundle.totalLikesReceived}
                </span>
                <span className="text-xs font-medium text-slate-600 sm:text-sm dark:text-slate-400">
                  Likes
                </span>
              </div>
            </div>

            {/* Bio */}
            {profile.bio?.trim() && (
              <LinkifiedText
                text={profile.bio}
                className="mt-3.5 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
              />
            )}

            {/* Academic & Category Details (Zero Private Email / Zero UID) */}
            <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-600 sm:text-sm dark:text-slate-400">
              {profile.accountCategory?.trim() && (
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile.accountCategory}
                </span>
              )}
              {profile.level?.trim() && (
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile.level}
                </span>
              )}
              {profile.department?.trim() && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile.department}
                </span>
              )}
              {profile.faculty?.trim() && (
                <span className="text-slate-600 dark:text-slate-400">
                  Faculty: {profile.faculty}
                </span>
              )}
            </div>
          </div>

          {actionMessage && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              {actionMessage}
            </div>
          )}

          {actionError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800 sm:text-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              {actionError}
            </div>
          )}

          {showGuestPrompt && (
            <div className="mt-4">
              <GuestPromptCard
                title={`Sign in to follow @${profile.username}`}
                description="Sign in to follow members and build your Following feed."
                returnRoute="for-you"
                onRequireAuth={onRequireAuth}
                onDismiss={() => setShowGuestPrompt(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* 3. SEPARATED CONTENT RIBBON & TIKTOK-STYLE 3-COLUMN GRID */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-3 py-3 sm:px-5 dark:border-slate-800">
          <SectionRibbon
            variant="primary"
            ariaLabel="Member profile content tabs"
            activeId={activeTab}
            onChange={handleSelectTab}
            items={tabs.map((tab) => ({
              id: tab.id,
              label: tab.label,
              count: tab.count,
              icon: tab.privateTab ? (
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              ) : undefined,
            }))}
          />
        </div>

        <div className="p-3 sm:p-5">
          {/* TAB 1: PUBLIC ORDINARY POSTS (3-Column Grid) */}
          {activeTab === 'posts' && (
            <div>
              {!bundle.canPublishOrdinaryPosts && bundle.posts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Public feed posts are open to Verified members, Moderators, and
                  Admins. Anonymous posts are kept private and never appear here.
                </div>
              ) : (
                renderPostVisualGrid(
                  bundle.posts.map((post) => ({ post, author: profile })),
                  `No public posts from @${profile.username} yet`,
                  'Published posts and photos will appear here.'
                )
              )}
            </div>
          )}

          {/* TAB 2: SAVED CONTENT (Strictly Private to Owner) */}
          {activeTab === 'saved' && bundle.isOwnProfile && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Lock
                  className="h-4 w-4 shrink-0 text-[#1E88E5]"
                  aria-hidden="true"
                />
                <span>
                  Only you can see your Saved items. Visitors never see this tab.
                </span>
              </div>

              {savedLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Loading your saved items...
                </div>
              ) : !savedBundle ||
                (savedBundle.posts.length === 0 &&
                  savedBundle.anonymousPosts.length === 0 &&
                  savedBundle.listings.length === 0 &&
                  savedBundle.opportunities.length === 0 &&
                  savedBundle.events.length === 0) ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-800/50">
                  <Bookmark
                    className="mx-auto mb-2 h-6 w-6 text-slate-400"
                    aria-hidden="true"
                  />
                  <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    No saved items yet
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-slate-600 dark:text-slate-400">
                    Tap Save on any post, listing, or event to keep it here.
                  </p>
                </div>
              ) : (
                <>
                  {savedBundle.posts.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Saved Updates ({savedBundle.posts.length})
                      </h2>
                      {renderPostVisualGrid(
                        savedBundle.posts,
                        '',
                        ''
                      )}
                    </div>
                  )}

                  {savedBundle.anonymousPosts.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Saved Anonymous Posts ({savedBundle.anonymousPosts.length})
                      </h2>
                      <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2">
                        {savedBundle.anonymousPosts.map((anonPost) => {
                          const firstPhoto = anonPost.mediaItems?.[0];
                          const theme = getAnonymousBackgroundTheme(
                            anonPost.backgroundStyle
                          );
                          return (
                            <button
                              key={anonPost.id}
                              type="button"
                              onClick={() =>
                                setDetailTarget({
                                  kind: 'anonymous',
                                  post: anonPost,
                                })
                              }
                              className="group relative aspect-square w-[46%] shrink-0 snap-start overflow-hidden rounded-xl bg-[#0B1A2E] text-left sm:w-[31%] lg:w-[calc(25%-8px)]"
                            >
                              {firstPhoto ? (
                                <FirestoreImage
                                  imageId={firstPhoto.imageId}
                                  alt="Saved anonymous post"
                                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                              ) : (
                                <div
                                  className="flex h-full w-full flex-col justify-between p-2.5 sm:p-3.5"
                                  style={{ background: theme.backgroundCss }}
                                >
                                  <span
                                    className={`text-[10px] font-semibold uppercase ${theme.textColorClass} opacity-80`}
                                  >
                                    Anonymous
                                  </span>
                                  <p
                                    className={`line-clamp-4 text-[11px] font-semibold sm:text-xs ${theme.textColorClass}`}
                                  >
                                    {anonPost.body}
                                  </p>
                                  <span aria-hidden="true" />
                                </div>
                              )}
                              <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0B1A2E]/85 to-transparent"
                              />
                              <div className="absolute right-2 bottom-1.5 left-2 flex items-center gap-2 text-[11px] font-semibold text-white">
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Heart
                                    className="h-3 w-3 fill-white/90"
                                    aria-hidden="true"
                                  />
                                  {anonPost.likesCount}
                                </span>
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <MessageCircle
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  {anonPost.commentsCount}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {savedBundle.listings.length > 0 && (
                    <div className="space-y-2.5">
                      <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Saved Marketplace Listings ({savedBundle.listings.length})
                      </h2>
                      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                        {savedBundle.listings.map((item) => (
                          <div
                            key={item.id}
                            className="flex w-[78%] shrink-0 snap-start flex-col justify-between gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 sm:w-[46%] lg:w-[32%] dark:border-slate-700 dark:bg-slate-800"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                                {item.title}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {item.category} · ₦{item.price.toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('marketplace', { listingId: item.id })
                              }
                              className="self-start text-xs font-semibold text-[#1E88E5] hover:underline dark:text-[#64B5F6]"
                            >
                              View Listing
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {savedBundle.opportunities.length > 0 && (
                    <div className="space-y-2.5">
                      <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Saved Opportunities ({savedBundle.opportunities.length})
                      </h2>
                      {savedBundle.opportunities.map((opp) => {
                        const lifecycle = resolveOpportunityLifecycle(opp);
                        return (
                          <div
                            key={opp.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                                {opp.title}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {getOpportunityCategoryShortLabel(opp.category)} ·{' '}
                                {opp.organisation} · {lifecycle.label} (
                                {formatOpportunityDeadlineSummary(lifecycle)})
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('opportunities', {
                                  opportunityId: opp.id,
                                })
                              }
                              className="shrink-0 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-[#64B5F6]"
                            >
                              View Details
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {savedBundle.events.length > 0 && (
                    <div className="space-y-2.5">
                      <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Saved Events ({savedBundle.events.length})
                      </h2>
                      {savedBundle.events.map((evt) => {
                        const lifecycle = resolveEventLifecycle(evt);
                        return (
                          <div
                            key={evt.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                                {evt.title}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {getEventCategoryShortLabel(evt.category)} ·{' '}
                                {evt.venue} · {lifecycle.label} (
                                {formatEventLocalDate(evt.eventDate)})
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('upcoming-events', {
                                  eventId: evt.id,
                                })
                              }
                              className="shrink-0 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-[#64B5F6]"
                            >
                              View Details
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 3: LIKED ORDINARY POSTS (Public Ordinary Content Only, Zero Anonymous Exposure) */}
          {activeTab === 'liked' &&
            renderPostVisualGrid(
              bundle.likedPosts,
              `No liked posts yet`,
              `Public posts liked by @${profile.username} will appear here.`
            )}

          {/* TAB 4: MY ANONYMOUS POSTS (Strictly Private Owner History & Management) */}
          {activeTab === 'anonymous' && bundle.isOwnProfile && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-[#1E88E5]/25 bg-[#0B1A2E] p-3.5 text-xs leading-relaxed text-white">
                <Shield
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                  aria-hidden="true"
                />
                <span>
                  <strong>Private to you:</strong> Manage, edit, or delete your
                  anonymous posts here. Your public profile never shows these.
                </span>
              </div>

              {anonLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Loading your anonymous posts...
                </div>
              ) : !anonHistory || anonHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-800/50">
                  <Shield
                    className="mx-auto mb-2 h-6 w-6 text-slate-400"
                    aria-hidden="true"
                  />
                  <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    No anonymous posts yet
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-slate-600 dark:text-slate-400">
                    Anonymous posts you share will appear here so you can edit or
                    delete them anytime.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('anonymous')}
                    className="mt-4 inline-flex min-h-[40px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1565C0]"
                  >
                    Go to Anonymous Feed
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {anonHistory.map((anonPost) => {
                    const gridItems = mediaMetaToGridItems(anonPost.mediaItems);
                    const isStyledText =
                      gridItems.length === 0 &&
                      Boolean(anonPost.backgroundStyle) &&
                      anonPost.backgroundStyle !== 'plain';
                    const theme = isStyledText
                      ? getAnonymousBackgroundTheme(anonPost.backgroundStyle)
                      : null;

                    return (
                      <article
                        key={anonPost.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-800/60"
                        data-testid={`private-anon-card-${anonPost.id}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">
                              {anonPost.category}
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span>
                              {formatHistoryTimestamp(anonPost.createdAt)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setDetailTarget({
                                  kind: 'anonymous',
                                  post: anonPost,
                                })
                              }
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700"
                            >
                              <MessageCircle
                                className="h-3.5 w-3.5 text-[#1E88E5]"
                                aria-hidden="true"
                              />
                              View Thread
                            </button>
                            <button
                              type="button"
                              disabled={isSuspended}
                              onClick={() => setEditingAnonPost(anonPost)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={
                                isSuspended || deletingAnonId === anonPost.id
                              }
                              onClick={() =>
                                setConfirmDeleteAnonId((prev) =>
                                  prev === anonPost.id ? null : anonPost.id
                                )
                              }
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </div>

                        {confirmDeleteAnonId === anonPost.id && (
                          <div className="mt-3 flex flex-col justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 sm:flex-row sm:items-center dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                            <span>
                              Permanently delete this anonymous post, its
                              replies, likes, and images?
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={deletingAnonId === anonPost.id}
                                onClick={() =>
                                  void handleDeleteOwnAnonPost(anonPost)
                                }
                                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1 font-semibold text-white hover:bg-red-800"
                              >
                                {deletingAnonId === anonPost.id && (
                                  <Loader2
                                    className="h-3 w-3 animate-spin"
                                    aria-hidden="true"
                                  />
                                )}
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteAnonId(null)}
                                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {isStyledText && theme ? (
                          <div
                            className="mt-3 flex min-h-[128px] items-center justify-center rounded-xl p-5 text-center"
                            style={{ background: theme.backgroundCss }}
                          >
                            <LinkifiedText
                              text={anonPost.body}
                              tone={theme.isDark ? 'on-dark' : 'on-light-card'}
                              className={`whitespace-pre-wrap text-sm font-semibold sm:text-base ${theme.textColorClass}`}
                            />
                          </div>
                        ) : (
                          <>
                            {anonPost.body.trim().length > 0 && (
                              <LinkifiedText
                                text={anonPost.body}
                                className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200"
                              />
                            )}
                            {gridItems.length > 0 && (
                              <div className="mt-3">
                                <SquareImageGrid
                                  items={gridItems}
                                  postLabel="Your anonymous post"
                                  showPerPhotoCaptions={false}
                                  onImageClick={() =>
                                    setDetailTarget({
                                      kind: 'anonymous',
                                      post: anonPost,
                                    })
                                  }
                                />
                              </div>
                            )}
                          </>
                        )}

                        <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-2.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Heart
                              className="h-3.5 w-3.5 text-[#1E88E5]"
                              aria-hidden="true"
                            />
                            {anonPost.likesCount} likes
                          </span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <MessageCircle
                              className="h-3.5 w-3.5 text-[#1E88E5]"
                              aria-hidden="true"
                            />
                            {anonPost.commentsCount} replies
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: MARKETPLACE LISTINGS */}
          {activeTab === 'listings' && (
            <div className="space-y-3">
              {bundle.listings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                  <Package
                    className="mx-auto mb-2 h-5 w-5 text-slate-400"
                    aria-hidden="true"
                  />
                  No active marketplace listings for @{profile.username}.
                </div>
              ) : (
                <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                  {bundle.listings.map((item) => (
                    <article
                      key={item.id}
                      className="flex w-[78%] shrink-0 snap-start flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:w-[46%] lg:w-[32%] dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {item.listingKind} · {item.category}
                        </p>
                        <h2 className="mt-0.5 line-clamp-1 font-display text-base font-bold text-[#0B1A2E] dark:text-slate-100">
                          {item.title}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                          {item.description}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-700">
                        <p className="font-display text-base font-bold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                          ₦{item.price.toLocaleString()}
                        </p>
                        {buildWhatsAppChatUrl(item.whatsappNumber) && (
                          <a
                            href={buildWhatsAppChatUrl(item.whatsappNumber)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-emerald-700 dark:hover:bg-emerald-600"
                          >
                            <MessageCircle
                              className="h-3.5 w-3.5 text-[#1E88E5] dark:text-white"
                              aria-hidden="true"
                            />
                            Contact
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FOLLOWERS / FOLLOWING INTERACTIVE MODAL */}
      {followModalKind && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/60 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="follow-modal-title"
          onClick={closeFollowModal}
        >
          <div
            className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl dark:border dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <SectionRibbon
                variant="sublist"
                ariaLabel="Followers or following list"
                activeId={followModalKind}
                onChange={(next) => openFollowModal(next)}
                items={[
                  {
                    id: 'followers',
                    label: 'Followers',
                    count: profile.followersCount,
                  },
                  {
                    id: 'following',
                    label: 'Following',
                    count: profile.followingCount,
                  },
                ]}
              />
              <h2 id="follow-modal-title" className="sr-only">
                {followModalKind === 'followers'
                  ? `Followers (${profile.followersCount})`
                  : `Following (${profile.followingCount})`}
              </h2>
              <button
                type="button"
                onClick={closeFollowModal}
                aria-label="Close list"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {followModalError && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              >
                {followModalError}
              </div>
            )}

            <div className="mt-4">
              {followModalLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Loading {followModalKind}...
                </div>
              ) : !followModalList || followModalList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                  <Users
                    className="mx-auto mb-2 h-5 w-5 text-slate-400"
                    aria-hidden="true"
                  />
                  {followModalKind === 'followers'
                    ? `@${profile.username} does not have any followers yet.`
                    : `@${profile.username} is not following anyone yet.`}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {followModalList.map((member) => (
                    <div
                      key={member.username}
                      className="flex min-h-[60px] w-full items-center justify-between gap-2.5 rounded-xl border border-slate-200 p-2.5 transition-colors hover:border-[#1E88E5]/60 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:border-[#64B5F6]/50 dark:hover:bg-slate-800"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          closeFollowModal();
                          onNavigate('profile', { username: member.username });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <AvatarMedia
                          fullName={member.fullName}
                          photoImageId={member.photoImageId}
                          photoUrl={member.photoUrl}
                          sizeClass="h-11 w-11"
                          roundedClass="rounded-full"
                          textClass="text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                              {member.fullName}
                            </p>
                            <ProfileBadgesRow profile={member} size="xs" />
                          </div>
                          <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                            @{member.username}
                            {member.department ? ` · ${member.department}` : ''}
                          </p>
                        </div>
                      </button>

                      <TikTokFollowButton
                        targetUsername={member.username}
                        compact
                        onRequireAuth={() => {
                          closeFollowModal();
                          setShowGuestPrompt(true);
                        }}
                      />
                    </div>
                  ))}

                  {followModalHasMore && (
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={followModalLoadingMore}
                        onClick={() => void handleLoadMoreFollowModal()}
                        className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        {followModalLoadingMore && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                            aria-hidden="true"
                          />
                        )}
                        Load more
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* POST DETAIL MODAL (Opens when tapping any visual grid tile or View Thread) */}
      {detailTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/70 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Post details"
          onClick={() => setDetailTarget(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-slate-50 p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:border dark:border-slate-800 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                {detailTarget.kind === 'anonymous'
                  ? 'Anonymous Post Thread'
                  : 'Campus Post'}
              </span>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                aria-label="Close post details"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-white text-slate-600 shadow-xs hover:text-[#0B1A2E] dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {detailTarget.kind === 'ordinary' ? (
              <PostCard
                key={detailTarget.post.id}
                kind="ordinary"
                post={detailTarget.post}
                author={detailTarget.author}
                viewerUid={user?.uid ?? null}
                viewerTier={effectiveTier}
                viewerSuspended={isSuspended}
                isLiked={likedPostIds.has(detailTarget.post.id)}
                isSaved={savedPostIds.has(detailTarget.post.id)}
                defaultCommentsOpen
                onNavigateProfile={(uname) => {
                  onNavigate('profile', { username: uname });
                }}
                onRequireAuth={(authRoute, returnTo) => {
                  onRequireAuth(authRoute, returnTo);
                }}
                returnRoute="profile"
                onEditPost={(targetPost) => {
                  setDetailTarget(null);
                  setEditingOrdinaryPost(targetPost as CommunityPost);
                }}
                onPostUpdated={handleOrdinaryPostUpdated}
                onPostDeleted={handleOrdinaryPostDeleted}
                onSaveChanged={(postId, saved) => {
                  setSavedPostIds((prev) => {
                    const next = new Set(prev);
                    if (saved) next.add(postId);
                    else next.delete(postId);
                    return next;
                  });
                  if (!saved) {
                    setSavedBundle((prev) =>
                      prev
                        ? {
                            ...prev,
                            posts: prev.posts.filter((e) => e.post.id !== postId),
                          }
                        : prev
                    );
                  } else {
                    setSavedBundle(null);
                  }
                }}
              />
            ) : (
              <PostCard
                key={detailTarget.post.id}
                kind="anonymous"
                post={detailTarget.post}
                viewerUid={user?.uid ?? null}
                viewerTier={effectiveTier}
                viewerSuspended={isSuspended}
                isLiked={likedAnonIds.has(detailTarget.post.id)}
                isSaved={savedAnonIds.has(detailTarget.post.id)}
                defaultCommentsOpen
                isOwnedAnonymous={bundle.isOwnProfile}
                ownedAnonymousCommentIds={ownedAnonCommentIds}
                onRequireAuth={(authRoute, returnTo) => {
                  onRequireAuth(authRoute, returnTo);
                }}
                returnRoute="profile"
                onEditPost={(targetPost) => {
                  setDetailTarget(null);
                  setEditingAnonPost(targetPost as AnonymousPost);
                }}
                onPostUpdated={(updated) => {
                  const anonUpdated = updated as AnonymousPost;
                  setAnonHistory((prev) =>
                    prev
                      ? prev.map((item) =>
                          item.id === anonUpdated.id ? anonUpdated : item
                        )
                      : prev
                  );
                  setDetailTarget((prev) =>
                    prev &&
                    prev.kind === 'anonymous' &&
                    prev.post.id === anonUpdated.id
                      ? { ...prev, post: anonUpdated }
                      : prev
                  );
                }}
                onPostDeleted={(deletedId) => {
                  setAnonHistory((prev) =>
                    prev ? prev.filter((item) => item.id !== deletedId) : prev
                  );
                  setSavedBundle((prev) =>
                    prev
                      ? {
                          ...prev,
                          anonymousPosts: prev.anonymousPosts.filter(
                            (p) => p.id !== deletedId
                          ),
                        }
                      : prev
                  );
                  setDetailTarget(null);
                }}
                onSaveChanged={(postId, saved) => {
                  setSavedAnonIds((prev) => {
                    const next = new Set(prev);
                    if (saved) next.add(postId);
                    else next.delete(postId);
                    return next;
                  });
                  if (!saved) {
                    setSavedBundle((prev) =>
                      prev
                        ? {
                            ...prev,
                            anonymousPosts: prev.anonymousPosts.filter(
                              (p) => p.id !== postId
                            ),
                          }
                        : prev
                    );
                  } else {
                    setSavedBundle(null);
                  }
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
            )}
          </div>
        </div>
      )}

      {/* EDIT PROFILE MODAL */}
      {editProfileOpen && user && bundle.isOwnProfile && (
        <EditProfileModal
          uid={user.uid}
          authEmail={user.email ?? ''}
          profile={viewerProfile}
          isSuspended={isSuspended}
          onRefreshAccount={refreshAccountState}
          onSaved={(updatedUsername) => {
            setEditProfileOpen(false);
            setActionMessage('Your profile changes have been saved.');
            window.setTimeout(() => setActionMessage(null), 3200);
            if (updatedUsername !== bundle.resolvedUsername) {
              onNavigate('profile', {
                username: updatedUsername,
                profileTab: activeTab,
              });
            }
          }}
          onClose={() => setEditProfileOpen(false)}
        />
      )}

      {/* PROFILE MENU / SETTINGS SHEET */}
      {menuSheetOpen && user && bundle.isOwnProfile && (
        <ProfileMenuSheet
          uid={user.uid}
          username={profile.username}
          showWhatsappPublicly={profile.showWhatsappPublicly}
          isSuspended={isSuspended}
          onEditProfile={() => setEditProfileOpen(true)}
          onOpenAccountSettings={() => onNavigate('account')}
          onSelectSavedTab={() => handleSelectTab('saved')}
          onSelectAnonymousTab={() => handleSelectTab('anonymous')}
          onPrivacyUpdated={async () => {
            await refreshAccountState();
          }}
          onSignedOut={() => onNavigate('for-you')}
          onClose={() => setMenuSheetOpen(false)}
        />
      )}

      {/* ORDINARY POST COMPOSER (Edit) */}
      {editingOrdinaryPost && user && (
        <PostComposer
          mode="ordinary"
          actorUid={user.uid}
          actorRole={
            (effectiveTier === 'guest' ? 'member' : effectiveTier) as UserRole
          }
          actorName={viewerProfile?.fullName || user.displayName || undefined}
          actorUsername={viewerProfile?.username}
          initialPost={editingOrdinaryPost}
          onSuccess={(updated) => {
            handleOrdinaryPostUpdated(updated);
            setEditingOrdinaryPost(null);
          }}
          onClose={() => setEditingOrdinaryPost(null)}
        />
      )}

      {/* ANONYMOUS POST COMPOSER (Edit from My Anonymous Posts) */}
      {editingAnonPost && user && (
        <PostComposer
          mode="anonymous"
          actorUid={user.uid}
          actorRole={
            (effectiveTier === 'guest' ? 'member' : effectiveTier) as UserRole
          }
          initialPost={editingAnonPost}
          onSuccess={(updated) => {
            const anonUpdated = updated as AnonymousPost;
            setAnonHistory((prev) =>
              prev
                ? prev.map((item) =>
                    item.id === anonUpdated.id ? anonUpdated : item
                  )
                : prev
            );
            setEditingAnonPost(null);
          }}
          onClose={() => setEditingAnonPost(null)}
        />
      )}

      {profileMediaLightbox && (
        <FullScreenImageLightbox
          items={[
            {
              imageId: profileMediaLightbox.imageId || 'profile-media-view',
              directSrc: profileMediaLightbox.directSrc || undefined,
              fallbackUrl: profileMediaLightbox.fallbackUrl || undefined,
            },
          ]}
          initialIndex={0}
          postTitle={profileMediaLightbox.title}
          onClose={() => setProfileMediaLightbox(null)}
        />
      )}
    </section>
  );
};

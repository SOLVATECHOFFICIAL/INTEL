import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Flame,
  ImagePlus,
  Loader2,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { buildMarketplaceListingShareUrl } from '../../config/site';
import { useFirebase } from '../../context/firebaseContext';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import {
  createMarketplaceListingItem,
  createMarketplaceUpdateRecord,
  deleteMarketplaceListing,
  deleteMarketplaceUpdateRecord,
  fetchAllMarketplaceUpdates,
  fetchMarketplaceListingById,
  fetchMarketplaceSellersMap,
  fetchMyMarketplaceListings,
  fetchPendingMarketplaceApprovals,
  fetchPublicMarketplaceListings,
  fetchPublishedMarketplaceUpdates,
  renewMarketplaceListing,
  reviewPendingMarketplaceListing,
  updateMarketplaceUpdateRecord,
  updateOwnMarketplaceListingQuantity,
} from '../../services/governance';
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  getMarketplaceSessionSnapshot,
  hydrateMarketplaceSnapshot,
  saveMarketplaceSessionSnapshot,
} from '../../services/navigationStateCache';
import {
  prefetchMediaImages,
  type UploadProgressState,
} from '../../services/mediaStorage';
import {
  clearPersistentDraft,
  loadPersistentDraft,
  savePersistentDraft,
} from '../../services/persistentCache';
import {
  BLUEPRINT_LIMITS,
  canRolePublishCommunityFeed,
  type MarketplaceListing,
  type MarketplaceListingKind,
  type MarketplaceUpdate,
  type MarketplaceUpdateCategory,
  type PublicProfileProjection,
  type UserRole,
} from '../../types/database';
import type { ActiveRoute, MarketplaceTab } from '../../types/platform';
import { canActorModerateMarketplaceListing } from '../../utils/adminPermissions';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import {
  compressImageFile,
  formatByteSize,
  validatePostImageCountAfterAdd,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import {
  isDataSaverConnection,
  partitionDuplicateSelectedFiles,
  reorderArrayItem,
} from '../../utils/mediaCache';
import { mergeOrderedRecords } from '../../utils/cacheSync';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { ProfileBadgesRow } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia, FirestoreImage } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';
import { MarketplaceListingComments } from './MarketplaceListingComments';
import { MarketplaceListingCard } from './marketplace/MarketplaceListingCard';

interface MarketplaceSectionProps {
  selectedListingId?: string | null;
  selectedCommentId?: string | null;
  initialTab?: MarketplaceTab;
  onTabChange?: (tab: MarketplaceTab) => void;
  onSelectListing?: (listingId: string | null) => void;
  onRequireAuth: (
    authRoute: 'login' | 'register',
    returnTo: ActiveRoute
  ) => void;
  onNavigateProfile?: (username: string) => void;
}

const MARKETPLACE_CATEGORIES = [
  'Electronics',
  'Phones and Accessories',
  'Fashion',
  'Books and Educational Materials',
  'Hostel and Accommodation',
  'Food and Groceries',
  'Beauty and Personal Care',
  'Home and Living',
  'Services',
  'Other',
] as const;

interface GalleryMediaSource {
  key: string;
  imageId?: string;
  fallbackUrl?: string;
}

function getListingGallerySources(
  listing: MarketplaceListing
): GalleryMediaSource[] {
  const fromMeta: GalleryMediaSource[] = (listing.mediaItems ?? []).map(
    (meta, idx) => ({
      key: meta.imageId || `meta-${idx}`,
      imageId: meta.imageId,
      fallbackUrl: listing.mediaUrls?.[idx],
    })
  );
  if (fromMeta.length > 0) {
    return fromMeta;
  }
  return (listing.mediaUrls ?? []).map((url, idx) => ({
    key: `url-${idx}`,
    fallbackUrl: url,
  }));
}

export const MarketplaceSection: React.FC<MarketplaceSectionProps> = ({
  selectedListingId = null,
  selectedCommentId = null,
  initialTab,
  onTabChange,
  onSelectListing,
  onRequireAuth,
  onNavigateProfile,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();
  const viewerUid = user?.uid ?? null;
  const viewerKey = viewerUid ?? 'guest';
  const initialCache = getMarketplaceSessionSnapshot(viewerKey);

  const canModerateApprovals =
    !isSuspended &&
    (effectiveTier === 'moderator' ||
      effectiveTier === 'supreme_admin' ||
      effectiveTier === 'owner');
  const isSupremeAdminOrOwner =
    !isSuspended &&
    (effectiveTier === 'supreme_admin' || effectiveTier === 'owner');
  const actorRole: UserRole = (
    effectiveTier === 'guest' ? 'member' : effectiveTier
  ) as UserRole;
  const isAutoPublished = canRolePublishCommunityFeed(actorRole);

  const [activeTab, setActiveTab] = useState<MarketplaceTab>(() => {
    if (initialTab && initialTab !== 'browse') return initialTab;
    return initialCache?.activeTab ?? initialTab ?? 'browse';
  });
  const [kindFilter] = useState<'all' | MarketplaceListingKind>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    () => initialCache?.selectedCategory ?? 'All Categories'
  );
  const [searchQuery, setSearchQuery] = useState<string>(
    () => initialCache?.searchQuery ?? ''
  );

  const [publicListings, setPublicListings] = useState<MarketplaceListing[]>(
    () => initialCache?.publicListings ?? []
  );
  const [sellerMap, setSellerMap] = useState<
    Map<string, PublicProfileProjection>
  >(() => initialCache?.sellerMap ?? new Map());
  const [myListings, setMyListings] = useState<MarketplaceListing[]>(
    () => initialCache?.myListings ?? []
  );
  const [pendingListings, setPendingListings] = useState<MarketplaceListing[]>(
    () => initialCache?.pendingListings ?? []
  );
  const [loading, setLoading] = useState(() => !initialCache);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(
    () => Boolean(initialCache?.showCreateForm)
  );
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);
  const [localSelectedListingId, setLocalSelectedListingId] = useState<
    string | null
  >(selectedListingId);
  const [directLookupListing, setDirectLookupListing] = useState<{
    targetId: string;
    listing: MarketplaceListing | null;
  } | null>(() => initialCache?.directLookupListing ?? null);
  const [galleryIndexByListingId, setGalleryIndexByListingId] = useState<
    Record<string, number>
  >(() => initialCache?.activeGalleryIndexByListingId ?? {});
  const [listingLinkCopied, setListingLinkCopied] = useState(false);
  const [confirmDeleteListingId, setConfirmDeleteListingId] = useState<
    string | null
  >(null);
  const savedScrollYRef = useRef<number | null>(null);

  // Create form state
  const [listingKind, setListingKind] =
    useState<MarketplaceListingKind>('product');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(MARKETPLACE_CATEGORIES[0]);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [whatsappNumber, setWhatsappNumber] = useState(
    profile?.publicWhatsapp || ''
  );
  const [description, setDescription] = useState('');
  const replacePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const replacingClientIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);

  const [formAttachments, setFormAttachments] = useState<
    Array<{
      clientId: string;
      previewUrl: string;
      compressed: CompressedImageResult;
    }>
  >([]);
  const [compressingPhotos, setCompressingPhotos] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<UploadProgressState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);
  const [formLightboxIndex, setFormLightboxIndex] = useState<number | null>(
    null
  );
  const [detailLightboxIndex, setDetailLightboxIndex] = useState<number | null>(
    () =>
      selectedListingId &&
      initialCache?.detailLightbox?.listingId === selectedListingId
        ? initialCache.detailLightbox.index
        : null
  );

  const [updatesList, setUpdatesList] = useState<MarketplaceUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState<boolean>(true);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [editingUpdate, setEditingUpdate] =
    useState<MarketplaceUpdate | null>(null);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateCategory, setUpdateCategory] =
    useState<MarketplaceUpdateCategory>('safety');
  const [updatePublished, setUpdatePublished] = useState(true);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [confirmDeleteUpdateId, setConfirmDeleteUpdateId] = useState<
    string | null
  >(null);
  const [deletingUpdateId, setDeletingUpdateId] = useState<string | null>(null);

  const loadMarketplaceUpdates = useCallback(async () => {
    try {
      const items = isSupremeAdminOrOwner
        ? await fetchAllMarketplaceUpdates()
        : await fetchPublishedMarketplaceUpdates();
      setUpdatesList(items);
    } catch {
      // Preserve last known updates silently if offline
    } finally {
      setUpdatesLoading(false);
    }
  }, [isSupremeAdminOrOwner]);

  useEffect(() => {
    void loadMarketplaceUpdates();
    return subscribeCacheMutations((event) => {
      if (event.type === 'marketplace_updates_mutated') {
        void loadMarketplaceUpdates();
      }
    });
  }, [loadMarketplaceUpdates]);

  const lastInitialTabRef = useRef(initialTab);
  useEffect(() => {
    if (lastInitialTabRef.current === initialTab) return;
    lastInitialTabRef.current = initialTab;
    if (!initialTab) return;
    const timer = window.setTimeout(() => {
      setActiveTab(initialTab);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialTab]);

  const handleSelectTab = (nextTab: MarketplaceTab) => {
    setActiveTab(nextTab);
    onTabChange?.(nextTab);
  };

  const syncMarketplaceFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      try {
        const [pubItems, myItems, pendingItems] = await Promise.all([
          fetchPublicMarketplaceListings(),
          viewerUid
            ? fetchMyMarketplaceListings(viewerUid).catch(() => [])
            : Promise.resolve([]),
          canModerateApprovals
            ? fetchPendingMarketplaceApprovals().catch(() => [])
            : Promise.resolve([]),
        ]);

        if (isCancelled?.()) return;

        setPublicListings((prev) =>
          mode === 'initial' || prev.length === 0
            ? pubItems
            : mergeOrderedRecords({
                existing: prev,
                incoming: pubItems,
                preferIncomingOrder: true,
                preserveTail: false,
              })
        );
        setMyListings((prev) =>
          mode === 'initial' || prev.length === 0
            ? myItems
            : mergeOrderedRecords({
                existing: prev,
                incoming: myItems,
                preferIncomingOrder: true,
                preserveTail: false,
              })
        );
        setPendingListings((prev) =>
          mode === 'initial' || prev.length === 0
            ? pendingItems
            : mergeOrderedRecords({
                existing: prev,
                incoming: pendingItems,
                preferIncomingOrder: true,
                preserveTail: false,
              })
        );
        setErrorMessage(null);

        if (!isDataSaverConnection()) {
          const coverIds = pubItems
            .slice(0, 12)
            .map((item) => item.mediaItems?.[0]?.imageId)
            .filter((id): id is string => Boolean(id));
          if (coverIds.length > 0) {
            prefetchMediaImages(coverIds);
          }
        }

        const sellers = await fetchMarketplaceSellersMap([
          ...pubItems,
          ...pendingItems,
        ]).catch(() => new Map<string, PublicProfileProjection>());
        if (isCancelled?.()) return;
        setSellerMap((prev) => {
          if (mode === 'initial' || prev.size === 0) return sellers;
          const next = new Map(prev);
          sellers.forEach((proj, uid) => next.set(uid, proj));
          return next;
        });
      } catch (error) {
        if (isCancelled?.()) return;
        if (mode === 'initial') {
          setPublicListings((curr) => {
            if (curr.length === 0) {
              setErrorMessage(
                formatFirestoreOrAppError(
                  error,
                  'Unable to load Campus Marketplace listings right now.'
                )
              );
            }
            return curr;
          });
        }
      } finally {
        if (!isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    [viewerUid, canModerateApprovals]
  );

  useEffect(() => {
    let active = true;
    const cached = getMarketplaceSessionSnapshot(viewerKey);
    if (cached) {
      if (!isDataSaverConnection()) {
        const coverIds = cached.publicListings
          .slice(0, 12)
          .map((item) => item.mediaItems?.[0]?.imageId)
          .filter((id): id is string => Boolean(id));
        if (coverIds.length > 0) {
          prefetchMediaImages(coverIds);
        }
      }
      if (
        Date.now() - cached.cachedAt > 15_000 ||
        (canModerateApprovals && cached.pendingListings.length === 0)
      ) {
        void syncMarketplaceFromNetwork('background', () => !active);
      }
      return () => {
        active = false;
      };
    }

    let networkSettled = false;

    void hydrateMarketplaceSnapshot(viewerKey)
      .then((persisted) => {
        if (!active || networkSettled || !persisted) return;
        setPublicListings(persisted.publicListings);
        setSellerMap(persisted.sellerMap);
        setMyListings(persisted.myListings);
        setPendingListings(persisted.pendingListings);
        if (!initialTab || initialTab === 'browse') {
          setActiveTab(persisted.activeTab);
        }
        setSelectedCategory(persisted.selectedCategory || 'All Categories');
        setSearchQuery(persisted.searchQuery);
        setGalleryIndexByListingId(persisted.activeGalleryIndexByListingId);
        if (persisted.showCreateForm) {
          setShowCreateForm(true);
        }
        setLoading(false);

        if (!isDataSaverConnection()) {
          const coverIds = persisted.publicListings
            .slice(0, 12)
            .map((item) => item.mediaItems?.[0]?.imageId)
            .filter((id): id is string => Boolean(id));
          if (coverIds.length > 0) {
            prefetchMediaImages(coverIds);
          }
        }
      })
      .catch(() => undefined);

    void syncMarketplaceFromNetwork('initial', () => !active).finally(() => {
      networkSettled = true;
    });

    return () => {
      active = false;
    };
  }, [viewerKey, canModerateApprovals, initialTab, syncMarketplaceFromNetwork]);

  useActiveBackgroundRefresh({
    enabled: !loading,
    onRefresh: () => syncMarketplaceFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  // Persistent draft load & autosave for marketplace listing composer
  useEffect(() => {
    if (!viewerUid) return;
    let active = true;
    void loadPersistentDraft<{
      listingKind: MarketplaceListingKind;
      title: string;
      category: string;
      price: string;
      quantity: string;
      whatsappNumber: string;
      description: string;
    }>(viewerKey, 'mkt_create_listing')
      .then((draft) => {
        if (!active || !draft) return;
        const hasContent = Boolean(
          draft.title?.trim() || draft.description?.trim() || draft.price?.trim()
        );
        if (!hasContent) return;
        setTitle((curr) => {
          if (curr.trim()) return curr;
          setListingKind(draft.listingKind || 'product');
          setCategory(draft.category || MARKETPLACE_CATEGORIES[0]);
          setPrice(draft.price || '');
          setQuantity(draft.quantity || '1');
          if (draft.whatsappNumber) setWhatsappNumber(draft.whatsappNumber);
          setDescription(draft.description || '');
          setDraftRestored(true);
          return draft.title || '';
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewerUid, viewerKey]);

  useEffect(() => {
    if (!viewerUid) return;
    const hasContent = Boolean(
      title.trim() || description.trim() || price.trim()
    );
    if (!hasContent) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(viewerKey, 'mkt_create_listing', {
        listingKind,
        title,
        category,
        price,
        quantity,
        whatsappNumber,
        description,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    viewerUid,
    viewerKey,
    listingKind,
    title,
    category,
    price,
    quantity,
    whatsappNumber,
    description,
  ]);

  const effectiveSelectedListingId = onSelectListing
    ? selectedListingId
    : localSelectedListingId;

  useEffect(() => {
    if (loading) return;
    saveMarketplaceSessionSnapshot({
      viewerKey,
      activeTab,
      selectedCategory,
      searchQuery,
      publicListings,
      sellerMap,
      myListings,
      pendingListings,
      activeGalleryIndexByListingId: galleryIndexByListingId,
      detailLightbox:
        detailLightboxIndex !== null && effectiveSelectedListingId
          ? {
              listingId: effectiveSelectedListingId,
              index: detailLightboxIndex,
            }
          : null,
      showCreateForm,
      directLookupListing,
      cachedAt: Date.now(),
    });
  }, [
    loading,
    viewerKey,
    activeTab,
    selectedCategory,
    searchQuery,
    publicListings,
    sellerMap,
    myListings,
    pendingListings,
    galleryIndexByListingId,
    detailLightboxIndex,
    showCreateForm,
    effectiveSelectedListingId,
    directLookupListing,
  ]);

  const selectedProductFromLists = effectiveSelectedListingId
    ? [...publicListings, ...myListings, ...pendingListings].find(
        (item) => item.id === effectiveSelectedListingId
      ) ?? null
    : null;

  const selectedProduct: MarketplaceListing | null =
    selectedProductFromLists ??
    (effectiveSelectedListingId &&
    directLookupListing?.targetId === effectiveSelectedListingId
      ? directLookupListing.listing
      : null);

  const directLookupLoading = Boolean(
    effectiveSelectedListingId &&
      !loading &&
      !selectedProductFromLists &&
      directLookupListing?.targetId !== effectiveSelectedListingId
  );

  useEffect(() => {
    if (
      !effectiveSelectedListingId ||
      loading ||
      selectedProductFromLists ||
      directLookupListing?.targetId === effectiveSelectedListingId
    ) {
      return;
    }
    let active = true;
    fetchMarketplaceListingById(effectiveSelectedListingId)
      .then(async (found) => {
        if (!active) return;
        setDirectLookupListing({
          targetId: effectiveSelectedListingId,
          listing: found,
        });
        if (found) {
          const extraSellers = await fetchMarketplaceSellersMap([found]).catch(
            () => new Map<string, PublicProfileProjection>()
          );
          if (active && extraSellers.size > 0) {
            setSellerMap((prev) => {
              const next = new Map(prev);
              extraSellers.forEach((v, k) => next.set(k, v));
              return next;
            });
          }
        }
      })
      .catch(() => {
        if (active) {
          setDirectLookupListing({
            targetId: effectiveSelectedListingId,
            listing: null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    effectiveSelectedListingId,
    loading,
    selectedProductFromLists,
    directLookupListing?.targetId,
  ]);

  const activeGalleryIndex = effectiveSelectedListingId
    ? galleryIndexByListingId[effectiveSelectedListingId] ?? 0
    : 0;

  const setActiveGalleryIndex = (idx: number) => {
    if (!effectiveSelectedListingId) return;
    setGalleryIndexByListingId((prev) => ({
      ...prev,
      [effectiveSelectedListingId]: idx,
    }));
  };

  const openListingModal = (listingId: string | null) => {
    setDetailLightboxIndex(null);
    setListingLinkCopied(false);
    if (listingId !== null && typeof window !== 'undefined') {
      savedScrollYRef.current = window.scrollY;
    }
    if (onSelectListing) {
      onSelectListing(listingId);
    } else {
      setLocalSelectedListingId(listingId);
    }
    if (
      listingId === null &&
      savedScrollYRef.current !== null &&
      typeof window !== 'undefined'
    ) {
      const targetY = savedScrollYRef.current;
      savedScrollYRef.current = null;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: targetY });
      });
    }
  };

  const handleShareListing = async (listing: MarketplaceListing) => {
    const url = buildMarketplaceListingShareUrl(listing.id);

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: listing.title,
          text: `${listing.title} — ₦${listing.price.toLocaleString()} on LASUED Intel Marketplace`,
          url,
        });
        return;
      } catch {
        // Fallback to clipboard copy below
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setListingLinkCopied(true);
        window.setTimeout(() => setListingLinkCopied(false), 2500);
      } catch {
        // Ignore clipboard denial
      }
    }
  };

  const handleListingCommentsCountChange = (
    listingId: string,
    nextCount: number
  ) => {
    setPublicListings((prev) =>
      prev.map((item) =>
        item.id === listingId ? { ...item, commentsCount: nextCount } : item
      )
    );
    setMyListings((prev) =>
      prev.map((item) =>
        item.id === listingId ? { ...item, commentsCount: nextCount } : item
      )
    );
    setPendingListings((prev) =>
      prev.map((item) =>
        item.id === listingId ? { ...item, commentsCount: nextCount } : item
      )
    );
    setDirectLookupListing((prev) =>
      prev && prev.listing && prev.listing.id === listingId
        ? { ...prev, listing: { ...prev.listing, commentsCount: nextCount } }
        : prev
    );
  };

  const handleOpenComposer = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!user) {
      setShowGuestPrompt(true);
      return;
    }
    if (isSuspended) {
      setErrorMessage('Suspended accounts cannot create marketplace listings.');
      return;
    }
    setShowGuestPrompt(false);
    if (!showCreateForm && profile?.publicWhatsapp && !whatsappNumber) {
      setWhatsappNumber(profile.publicWhatsapp);
    }
    setShowCreateForm((prev) => !prev);
    setIsPreviewMode(false);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    e.target.value = '';
    if (!fileList || fileList.length === 0 || submitting) return;

    const files = Array.from(fileList);
    const existingFingerprints = new Set<string>(
      formAttachments
        .map((att) => att.compressed.fingerprint)
        .filter((fp): fp is string => Boolean(fp))
    );
    const { unique: uniqueFiles, duplicateCount } =
      partitionDuplicateSelectedFiles(files, existingFingerprints);

    if (uniqueFiles.length === 0) {
      if (duplicateCount > 0) {
        setErrorMessage('Those photographs are already added to this listing.');
      }
      return;
    }

    const countError = validatePostImageCountAfterAdd(
      formAttachments.length,
      uniqueFiles.length
    );
    if (countError) {
      setErrorMessage(countError);
      return;
    }

    setCompressingPhotos(true);
    setErrorMessage(null);
    try {
      const newItems: Array<{
        clientId: string;
        previewUrl: string;
        compressed: CompressedImageResult;
      }> = [];
      for (const file of uniqueFiles) {
        if (formAttachments.length + newItems.length >= 4) break;
        const compressed = await compressImageFile(file, 'marketplace');
        newItems.push({
          clientId: `photo-${Date.now()}-${Math.random()}`,
          previewUrl: compressed.dataUrl,
          compressed,
        });
      }
      setFormAttachments((prev) => [...prev, ...newItems]);
      if (duplicateCount > 0) {
        setErrorMessage(
          `Skipped ${duplicateCount} duplicate photo${duplicateCount === 1 ? '' : 's'} already attached.`
        );
      }
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(err, 'Could not compress photograph.')
      );
    } finally {
      setCompressingPhotos(false);
    }
  };

  const handleRemovePhoto = (clientId: string) => {
    if (submitting) return;
    setFormAttachments((prev) => prev.filter((i) => i.clientId !== clientId));
  };

  const handleMovePhoto = (fromIndex: number, toIndex: number) => {
    if (submitting) return;
    setFormAttachments((prev) => reorderArrayItem(prev, fromIndex, toIndex));
  };

  const handleTriggerReplacePhoto = (clientId: string) => {
    if (submitting || compressingPhotos) return;
    replacingClientIdRef.current = clientId;
    replacePhotoInputRef.current?.click();
  };

  const handleReplacePhoto = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = replacingClientIdRef.current;
    replacingClientIdRef.current = null;
    if (!file || !targetId || submitting) return;

    const otherFingerprints = new Set<string>(
      formAttachments
        .filter((att) => att.clientId !== targetId)
        .map((att) => att.compressed.fingerprint)
        .filter((fp): fp is string => Boolean(fp))
    );
    const { duplicateCount } = partitionDuplicateSelectedFiles(
      [file],
      otherFingerprints
    );
    if (duplicateCount > 0) {
      setErrorMessage('That photograph is already added in another slot.');
      return;
    }

    setCompressingPhotos(true);
    setErrorMessage(null);
    try {
      const compressed = await compressImageFile(file, 'marketplace');
      setFormAttachments((prev) =>
        prev.map((att) =>
          att.clientId === targetId
            ? {
                clientId: `photo-${Date.now()}-${Math.random()}`,
                previewUrl: compressed.dataUrl,
                compressed,
              }
            : att
        )
      );
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(
          err,
          'Could not process replacement photograph.'
        )
      );
    } finally {
      setCompressingPhotos(false);
    }
  };

  const handleDiscardListingDraft = () => {
    setListingKind('product');
    setTitle('');
    setCategory(MARKETPLACE_CATEGORIES[0]);
    setPrice('');
    setQuantity('1');
    setWhatsappNumber(profile?.publicWhatsapp || '');
    setDescription('');
    setFormAttachments([]);
    setDraftRestored(false);
    setErrorMessage(null);
    void clearPersistentDraft(viewerKey, 'mkt_create_listing');
  };

  const handleCreateListing = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!user || isSuspended || submitting || compressingPhotos || submitLockRef.current) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMessage(
        'You are offline. Your marketplace listing draft is saved safely — reconnect to publish.'
      );
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    setUploadProgress(null);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const created = await createMarketplaceListingItem({
        ownerUID: user.uid,
        actorRole,
        listingKind,
        title,
        description,
        category,
        price: Number(price || 0),
        quantity: Number.parseInt(quantity || '1', 10),
        whatsappNumber,
        attachments: formAttachments.map((att) => ({
          compressed: att.compressed,
        })),
        onProgress: setUploadProgress,
      });

      setMyListings((prev) => [created, ...prev]);
      if (created.approvalStatus === 'approved') {
        setPublicListings((prev) => [created, ...prev]);
        setStatusMessage(
          'Your marketplace listing is live immediately and active for 7 days.'
        );
      } else {
        setPendingListings((prev) => [created, ...prev]);
        setStatusMessage(
          'Your listing was submitted and queued for Moderator or Admin approval.'
        );
      }

      setTitle('');
      setPrice('');
      setQuantity('1');
      setDescription('');
      setFormAttachments([]);
      setDraftRestored(false);
      setShowCreateForm(false);
      setIsPreviewMode(false);
      void clearPersistentDraft(viewerKey, 'mkt_create_listing');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not submit your marketplace listing.'
        )
      );
    } finally {
      submitLockRef.current = false;
      setUploadProgress(null);
      setSubmitting(false);
    }
  };

  const handleReviewPending = async (
    listingId: string,
    decision: 'approved' | 'rejected'
  ) => {
    if (!user || !canModerateApprovals || busyListingId) return;
    setBusyListingId(listingId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const updated = await reviewPendingMarketplaceListing({
        listingId,
        actorUid: user.uid,
        actorRole,
        decision,
      });
      setPendingListings((prev) => prev.filter((item) => item.id !== listingId));
      if (decision === 'approved') {
        setPublicListings((prev) => [updated, ...prev]);
      }
      setMyListings((prev) =>
        prev.map((item) => (item.id === listingId ? updated : item))
      );
      setStatusMessage(
        decision === 'approved'
          ? 'Listing approved and published for 7 days.'
          : 'Listing rejected cleanly.'
      );
    } catch (error) {
      const formatted = formatFirestoreOrAppError(
        error,
        'Could not complete marketplace listing review.'
      );
      if (actorRole === 'moderator' && /Permission denied/i.test(formatted)) {
        setErrorMessage(
          'Moderators can only approve or reject marketplace listings submitted by ordinary members.'
        );
      } else {
        setErrorMessage(formatted);
      }
    } finally {
      setBusyListingId(null);
    }
  };

  const handleUpdateQuantity = async (
    listing: MarketplaceListing,
    nextQuantity: number
  ) => {
    if (busyListingId) return;
    setBusyListingId(listing.id);
    setErrorMessage(null);
    try {
      const updated = await updateOwnMarketplaceListingQuantity({
        listing,
        nextQuantity,
      });
      setMyListings((prev) =>
        prev.map((item) => (item.id === listing.id ? updated : item))
      );
      setPublicListings((prev) =>
        updated.status === 'sold'
          ? prev.filter((item) => item.id !== listing.id)
          : prev.map((item) => (item.id === listing.id ? updated : item))
      );
      setStatusMessage(
        updated.status === 'sold'
          ? 'Listing marked as sold.'
          : `Updated stock quantity to ${updated.quantity}.`
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not update listing quantity.')
      );
    } finally {
      setBusyListingId(null);
    }
  };

  const handleRenewListing = async (listing: MarketplaceListing) => {
    if (busyListingId) return;
    setBusyListingId(listing.id);
    setErrorMessage(null);
    try {
      const renewed = await renewMarketplaceListing(listing);
      setMyListings((prev) =>
        prev.map((item) => (item.id === listing.id ? renewed : item))
      );
      setPublicListings((prev) => [
        renewed,
        ...prev.filter((i) => i.id !== listing.id),
      ]);
      setStatusMessage('Listing successfully renewed for another 7 days!');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not renew marketplace listing.'
        )
      );
    } finally {
      setBusyListingId(null);
    }
  };

  const handleDeleteListing = async (listingId: string) => {
    if (busyListingId) return;
    setBusyListingId(listingId);
    setErrorMessage(null);
    try {
      const targetListing =
        myListings.find((i) => i.id === listingId) ??
        publicListings.find((i) => i.id === listingId) ??
        pendingListings.find((i) => i.id === listingId);
      const knownMediaIds = (targetListing?.mediaItems ?? []).map(
        (m) => m.imageId
      );
      await deleteMarketplaceListing(listingId, knownMediaIds);
      setMyListings((prev) => prev.filter((i) => i.id !== listingId));
      setPublicListings((prev) => prev.filter((i) => i.id !== listingId));
      setPendingListings((prev) => prev.filter((i) => i.id !== listingId));
      setConfirmDeleteListingId(null);
      setStatusMessage('Listing deleted successfully.');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not delete marketplace listing.'
        )
      );
    } finally {
      setBusyListingId(null);
    }
  };

  const resetUpdateForm = () => {
    setEditingUpdate(null);
    setUpdateTitle('');
    setUpdateBody('');
    setUpdateCategory('safety');
    setUpdatePublished(true);
    setShowUpdateForm(false);
  };

  const handleSaveMarketplaceUpdate = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!user || !isSupremeAdminOrOwner || savingUpdate) return;
    setSavingUpdate(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (editingUpdate) {
        const updated = await updateMarketplaceUpdateRecord({
          existing: editingUpdate,
          title: updateTitle,
          body: updateBody,
          category: updateCategory,
          published: updatePublished,
          actorRole,
        });
        setUpdatesList((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );
        setStatusMessage(`Updated marketplace notice "${updated.title}".`);
      } else {
        const created = await createMarketplaceUpdateRecord({
          title: updateTitle,
          body: updateBody,
          category: updateCategory,
          published: updatePublished,
          actorUid: user.uid,
          actorRole,
        });
        setUpdatesList((prev) => [created, ...prev]);
        setStatusMessage(`Published marketplace update "${created.title}".`);
      }
      resetUpdateForm();
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not save marketplace update.')
      );
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleDeleteMarketplaceUpdate = async (updateId: string) => {
    if (!user || !isSupremeAdminOrOwner || deletingUpdateId) return;
    setDeletingUpdateId(updateId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await deleteMarketplaceUpdateRecord({
        updateId,
        actorRole,
      });
      setUpdatesList((prev) => prev.filter((item) => item.id !== updateId));
      setConfirmDeleteUpdateId(null);
      setStatusMessage('Marketplace notice removed.');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not delete marketplace notice.')
      );
    } finally {
      setDeletingUpdateId(null);
    }
  };

  const filteredPublic = publicListings.filter((item) => {
    if (kindFilter !== 'all' && item.listingKind !== kindFilter) return false;
    if (
      selectedCategory !== 'All Categories' &&
      item.category !== selectedCategory
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText =
        `${item.title} ${item.description} ${item.category}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const selectedSeller = selectedProduct
    ? sellerMap.get(selectedProduct.ownerUID) ?? null
    : null;
  const selectedGallery = selectedProduct
    ? getListingGallerySources(selectedProduct)
    : [];
  const activeGalleryMedia =
    selectedGallery[activeGalleryIndex] ?? selectedGallery[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-[#0B1A2E]">
              Campus Marketplace &amp; Student Services
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Connect directly with fellow LASUED students via WhatsApp. No in-app
            checkout or fees.{' '}
            {isAutoPublished
              ? 'Your Verified+ account auto-publishes listings instantly.'
              : 'Ordinary member listings require Moderator review.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenComposer}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1E88E5] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1565C0]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {showCreateForm ? 'Close Listing Form' : 'Post Marketplace Listing'}
        </button>
      </div>

      {showGuestPrompt && (
        <GuestPromptCard
          title="Sign in to join Campus Marketplace"
          description="Guests can browse listings and open WhatsApp seller links. Sign in to post listings or follow sellers."
          returnRoute="marketplace"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setShowGuestPrompt(false)}
        />
      )}

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Seller Listing Form */}
      {showCreateForm && user && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <h3 className="font-display text-base font-bold text-[#0B1A2E]">
              {isPreviewMode
                ? 'Review Listing Preview'
                : 'Create Marketplace Listing'}
            </h3>
            <span className="rounded-md bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
              {isAutoPublished
                ? 'Instant Publish (Verified+)'
                : 'Moderator Approval Required'}
            </span>
          </div>

          {draftRestored && !isPreviewMode && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1E88E5]/25 bg-[#1E88E5]/5 px-3.5 py-2 text-xs text-[#0B1A2E]">
              <span>Saved listing draft restored from this device.</span>
              <button
                type="button"
                onClick={handleDiscardListingDraft}
                className="font-semibold text-[#1E88E5] hover:underline"
              >
                Discard draft
              </button>
            </div>
          )}

          {!isPreviewMode ? (
            <form onSubmit={handleCreateListing} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="mkt-kind"
                    className="block text-xs font-semibold text-[#0B1A2E]"
                  >
                    Listing Type
                  </label>
                  <select
                    id="mkt-kind"
                    value={listingKind}
                    onChange={(e) =>
                      setListingKind(e.target.value as MarketplaceListingKind)
                    }
                    className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                  >
                    <option value="product">Product / Goods</option>
                    <option value="service">
                      Service (Tutoring, Graphic Design, etc.)
                    </option>
                    <option value="accommodation">
                      Hostel &amp; Accommodation
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mkt-category"
                    className="block text-xs font-semibold text-[#0B1A2E]"
                  >
                    Category
                  </label>
                  <select
                    id="mkt-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                  >
                    {MARKETPLACE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="mkt-title"
                  className="block text-xs font-semibold text-[#0B1A2E]"
                >
                  {listingKind === 'accommodation'
                    ? 'Accommodation Title & Location'
                    : listingKind === 'service'
                    ? 'Service Title'
                    : 'Product Title'}
                </label>
                <input
                  id="mkt-title"
                  type="text"
                  required
                  minLength={BLUEPRINT_LIMITS.marketplaceTitleMin}
                  maxLength={BLUEPRINT_LIMITS.marketplaceTitleMax}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    listingKind === 'accommodation'
                      ? 'e.g. 1 Room Self Contain at Camp Gate, Ijanikin'
                      : listingKind === 'service'
                      ? 'e.g. Professional Graphic Design & Assignment Typing'
                      : 'e.g. CASIO Scientific Calculator & CSC 201 Textbook'
                  }
                  className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="mkt-price"
                    className="block text-xs font-semibold text-[#0B1A2E]"
                  >
                    Price (₦)
                  </label>
                  <input
                    id="mkt-price"
                    type="number"
                    required
                    min={0}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="4500"
                    className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mkt-qty"
                    className="block text-xs font-semibold text-[#0B1A2E]"
                  >
                    Quantity / Availability
                  </label>
                  <input
                    id="mkt-qty"
                    type="number"
                    required
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mkt-whatsapp"
                    className="block text-xs font-semibold text-[#0B1A2E]"
                  >
                    WhatsApp Contact Number
                  </label>
                  <input
                    id="mkt-whatsapp"
                    type="tel"
                    required
                    minLength={BLUEPRINT_LIMITS.marketplaceWhatsappMin}
                    maxLength={BLUEPRINT_LIMITS.marketplaceWhatsappMax}
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+2348012345678"
                    className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="mkt-desc"
                  className="block text-xs font-semibold text-[#0B1A2E]"
                >
                  Full Description &amp; Campus Meetup Point
                </label>
                <textarea
                  id="mkt-desc"
                  rows={4}
                  required
                  minLength={BLUEPRINT_LIMITS.marketplaceDescMin}
                  maxLength={BLUEPRINT_LIMITS.marketplaceDescMax}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe condition, features, pricing details, and convenient campus meetup point (e.g. Main Gate, Epe Campus)..."
                  className="mt-1 block w-full rounded-xl border border-slate-300 p-3.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                />
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-[#0B1A2E]">
                      Product Photographs ({formAttachments.length}/4 max)
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Photo #1 is shown as the main cover. Dragless arrows let you reorder, replace, or remove photos.
                    </p>
                  </div>
                  <label className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0]">
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {compressingPhotos ? 'Compressing...' : 'Add Photos'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={
                        compressingPhotos ||
                        submitting ||
                        formAttachments.length >= 4
                      }
                      onChange={handlePhotoSelect}
                      className="sr-only"
                    />
                  </label>
                  <input
                    ref={replacePhotoInputRef}
                    type="file"
                    accept="image/*"
                    disabled={compressingPhotos || submitting}
                    onChange={handleReplacePhoto}
                    className="sr-only"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {formAttachments.map((att, idx) => (
                    <div
                      key={att.clientId}
                      className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-xs"
                    >
                      <div className="relative aspect-square overflow-hidden rounded-lg bg-[#0B1A2E]">
                        <button
                          type="button"
                          onClick={() => setFormLightboxIndex(idx)}
                          aria-label={`Inspect listing photo ${idx + 1} full screen`}
                          className="block h-full w-full cursor-zoom-in"
                        >
                          <img
                            src={att.previewUrl}
                            alt={`Listing photograph preview ${idx + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </button>
                        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-[#0B1A2E]/85 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                          {idx === 0 ? '#1 Cover' : `#${idx + 1}`}
                        </span>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleRemovePhoto(att.clientId)}
                          className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-600"
                          aria-label={`Remove photo ${idx + 1}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          disabled={compressingPhotos || submitting}
                          onClick={() => handleTriggerReplacePhoto(att.clientId)}
                          aria-label={`Replace listing photo ${idx + 1}`}
                          className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-50"
                        >
                          <RefreshCw
                            className="h-3 w-3 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                          Replace
                        </button>

                        {formAttachments.length > 1 ? (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={submitting || idx === 0}
                              onClick={() => handleMovePhoto(idx, idx - 1)}
                              aria-label={`Move photo ${idx + 1} left`}
                              className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                            >
                              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={
                                submitting || idx === formAttachments.length - 1
                              }
                              onClick={() => handleMovePhoto(idx, idx + 1)}
                              aria-label={`Move photo ${idx + 1} right`}
                              className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                            >
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <span className="truncate text-[11px] font-semibold text-slate-500 tabular-nums">
                            {formatByteSize(att.compressed.byteSize)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {formAttachments.length === 0 && (
                    <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                      No photographs added yet. Up to 4 clear photos help buyers
                      trust your listing.
                    </div>
                  )}
                </div>

                {uploadProgress && (
                  <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between text-xs font-medium text-[#0B1A2E]">
                      <span>{uploadProgress.label}</span>
                      <span className="tabular-nums">{uploadProgress.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-[#1E88E5] transition-all duration-200"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={submitting || compressingPhotos}
                  onClick={() => setIsPreviewMode(true)}
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
                >
                  Preview Listing
                </button>
                <button
                  type="submit"
                  disabled={submitting || compressingPhotos}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-6 py-2 text-xs font-bold text-white hover:bg-[#132844] disabled:opacity-60"
                >
                  {submitting && (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Publish Listing Now
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between text-xs font-semibold text-[#1E88E5] uppercase">
                  <span>
                    {listingKind} · {category}
                  </span>
                  <span>₦{Number(price || 0).toLocaleString()}</span>
                </div>
                <h4 className="mt-2 font-display text-lg font-bold text-[#0B1A2E]">
                  {title || 'Untitled Listing'}
                </h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {description || 'No description provided.'}
                </p>
                {formAttachments.length > 0 && (
                  <div className="mt-4 max-w-md">
                    <SquareImageGrid
                      items={formAttachments.map((att) => ({
                        imageId: att.clientId,
                        directSrc: att.previewUrl,
                      }))}
                      postLabel={title || 'Marketplace listing preview'}
                      showPerPhotoCaptions={false}
                      onImageClick={(idx) => setFormLightboxIndex(idx)}
                    />
                  </div>
                )}
              </div>

              {uploadProgress && (
                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs font-medium text-[#0B1A2E]">
                    <span>{uploadProgress.label}</span>
                    <span className="tabular-nums">{uploadProgress.percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-[#1E88E5] transition-all duration-200"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setIsPreviewMode(false)}
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] disabled:opacity-50"
                >
                  Edit Details
                </button>
                <button
                  type="button"
                  onClick={(e) =>
                    handleCreateListing(
                      e as unknown as React.FormEvent<HTMLFormElement>
                    )
                  }
                  disabled={submitting || compressingPhotos}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-6 py-2 text-xs font-bold text-white hover:bg-[#132844] disabled:opacity-60"
                >
                  {submitting && (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Confirm &amp; Publish
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleSelectTab('browse')}
            className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-bold transition-colors ${
              activeTab === 'browse'
                ? 'bg-[#0B1A2E] text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Browse Listings ({publicListings.length})
          </button>

          {user && (
            <button
              type="button"
              onClick={() => handleSelectTab('my_listings')}
              className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-bold transition-colors ${
                activeTab === 'my_listings'
                  ? 'bg-[#0B1A2E] text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              My Listings ({myListings.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSelectTab('updates')}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold transition-colors ${
              activeTab === 'updates'
                ? 'bg-[#0B1A2E] text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Flame className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            Marketplace Updates ({updatesList.length})
          </button>

          {canModerateApprovals && (
            <button
              type="button"
              onClick={() => handleSelectTab('pending_approvals')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold transition-colors ${
                activeTab === 'pending_approvals'
                  ? 'bg-[#1E88E5] text-white'
                  : 'border border-[#1E88E5]/40 bg-[#1E88E5]/10 text-[#0B1A2E] hover:bg-[#1E88E5]/20'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Pending Approvals ({pendingListings.length})
            </button>
          )}
        </div>

        {activeTab === 'browse' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or services..."
                className="min-h-[36px] w-44 rounded-xl border border-slate-200 bg-white pr-3 pl-9 text-xs text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] sm:w-56"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="min-h-[36px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-[#0B1A2E]"
            >
              <option value="All Categories">All Categories</option>
              {MARKETPLACE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* GRACEFUL MISSING LISTING FALLBACK */}
      {!loading && effectiveSelectedListingId && !selectedProduct && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
          {directLookupLoading ? (
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-[#1E88E5]" aria-hidden="true" />
              <span>Opening Marketplace listing...</span>
            </div>
          ) : (
            <>
              <ShoppingBag
                className="mx-auto mb-2 h-6 w-6 text-slate-400"
                aria-hidden="true"
              />
              <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                Listing not available
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
                This Marketplace listing may have expired, been removed, or is not publicly available.
              </p>
              <button
                type="button"
                onClick={() => openListingModal(null)}
                className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
              >
                Browse Marketplace
              </button>
            </>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2.5 h-5 w-5 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading Campus Marketplace...
        </div>
      ) : activeTab === 'browse' ? (
        filteredPublic.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-12 text-center">
            <ShoppingBag
              className="mx-auto mb-3 h-8 w-8 text-slate-400"
              aria-hidden="true"
            />
            <h3 className="font-display text-base font-bold text-[#0B1A2E]">
              No matching listings found
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Try adjusting your search terms or category filters, or be the
              first to post an offer.
            </p>
          </div>
        ) : (
          /* THREE-COLUMN GRID on suitable widths, graceful reflow on narrow mobile */
          <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 md:grid-cols-3">
            {filteredPublic.map((item) => (
              <MarketplaceListingCard
                key={item.id}
                listing={item}
                seller={sellerMap.get(item.ownerUID) ?? null}
                onOpenListing={openListingModal}
                onNavigateProfile={onNavigateProfile}
                onRequireAuth={() => setShowGuestPrompt(true)}
              />
            ))}
          </div>
        )
      ) : activeTab === 'my_listings' ? (
        myListings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-12 text-center text-sm text-slate-600">
            <Package
              className="mx-auto mb-3 h-8 w-8 text-slate-400"
              aria-hidden="true"
            />
            <p className="font-bold text-[#0B1A2E]">
              You have not posted any listings yet.
            </p>
            <p className="mt-1 text-xs">
              Create your first product, service, or accommodation listing
              above.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {myListings.map((item) => {
              const isExpired = item.status === 'expired';
              const confirmingDelete = confirmDeleteListingId === item.id;
              return (
                <div
                  key={item.id}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-[#1E88E5] uppercase">
                          {item.listingKind} · {item.category}
                        </span>
                        <span
                          className={`rounded-lg px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                            item.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.status === 'pending_approval'
                              ? 'bg-amber-100 text-amber-900'
                              : item.status === 'sold'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                      </div>
                      <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                        {item.title} — ₦{item.price.toLocaleString()}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Remaining stock: {item.quantity} · Posted{' '}
                        {new Date(Number(item.createdAt)).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {item.approvalStatus === 'approved' &&
                        item.status !== 'sold' && (
                          <button
                            type="button"
                            disabled={busyListingId === item.id}
                            onClick={() => void handleUpdateQuantity(item, 0)}
                            className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-[#0B1A2E] hover:bg-slate-50"
                          >
                            Mark as Sold
                          </button>
                        )}

                      {isExpired && (
                        <button
                          type="button"
                          disabled={busyListingId === item.id}
                          onClick={() => void handleRenewListing(item)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          <RefreshCw
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Renew for 7 Days
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyListingId === item.id}
                        onClick={() =>
                          setConfirmDeleteListingId((prev) =>
                            prev === item.id ? null : item.id
                          )
                        }
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>

                  {confirmingDelete && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                      <span>Permanently delete this listing?</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyListingId === item.id}
                          onClick={() => void handleDeleteListing(item.id)}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-red-700 px-3 py-1 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                        >
                          {busyListingId === item.id && (
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              aria-hidden="true"
                            />
                          )}
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteListingId(null)}
                          className="min-h-[34px] rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-[#0B1A2E]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : activeTab === 'updates' ? (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                Marketplace Announcements &amp; Safety Advisories
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Official updates regarding campus trading guidelines, security
                alerts, and accommodation notices.
              </p>
            </div>
            {isSupremeAdminOrOwner && (
              <button
                type="button"
                onClick={() => {
                  if (showUpdateForm) resetUpdateForm();
                  else setShowUpdateForm(true);
                }}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
              >
                <Plus className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                {showUpdateForm ? 'Close Form' : 'Publish Update'}
              </button>
            )}
          </div>

          {showUpdateForm && isSupremeAdminOrOwner && (
            <form
              onSubmit={handleSaveMarketplaceUpdate}
              className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-bold text-[#0B1A2E]">
                  {editingUpdate
                    ? `Edit Notice: ${editingUpdate.title}`
                    : 'New Marketplace Update / Safety Advisory'}
                </h4>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={BLUEPRINT_LIMITS.postTitleMax}
                  value={updateTitle}
                  onChange={(e) => setUpdateTitle(e.target.value)}
                  placeholder="Notice headline..."
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] sm:col-span-2"
                />
                <select
                  value={updateCategory}
                  onChange={(e) =>
                    setUpdateCategory(e.target.value as MarketplaceUpdateCategory)
                  }
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E]"
                >
                  <option value="safety">Safety Advisory</option>
                  <option value="policy">Trading Policy</option>
                  <option value="notice">Campus Notice</option>
                  <option value="general">General Update</option>
                </select>
              </div>

              <textarea
                rows={3}
                required
                maxLength={BLUEPRINT_LIMITS.postBodyMax}
                value={updateBody}
                onChange={(e) => setUpdateBody(e.target.value)}
                placeholder="Write the official notice details..."
                className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E]"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[#0B1A2E]">
                  <input
                    type="checkbox"
                    checked={updatePublished}
                    onChange={(e) => setUpdatePublished(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-[#1E88E5]"
                  />
                  Publish immediately to all users
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingUpdate}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#1E88E5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
                  >
                    {savingUpdate && (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {editingUpdate ? 'Save Changes' : 'Publish Update'}
                  </button>
                  <button
                    type="button"
                    onClick={resetUpdateForm}
                    className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          {updatesLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-600">
              <Loader2
                className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                aria-hidden="true"
              />
              Loading official updates...
            </div>
          ) : updatesList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-600">
              No marketplace updates or safety advisories published yet.
            </div>
          ) : (
            <div className="space-y-3">
              {updatesList.map((up) => {
                const tsMs = extractTimestampMs(up.createdAt);
                const formattedDate = tsMs
                  ? new Date(tsMs).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'Official notice';
                const confirmingDelete = confirmDeleteUpdateId === up.id;

                return (
                  <article
                    key={up.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[#1E88E5]/10 px-2 py-0.5 font-semibold text-[#1E88E5] uppercase">
                          {up.category}
                        </span>
                        {!up.published && (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                            Draft
                          </span>
                        )}
                        <span>{formattedDate}</span>
                      </div>
                      {isSupremeAdminOrOwner && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUpdate(up);
                              setUpdateTitle(up.title);
                              setUpdateBody(up.body);
                              setUpdateCategory(up.category);
                              setUpdatePublished(up.published);
                              setShowUpdateForm(true);
                            }}
                            aria-label={`Edit ${up.title}`}
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteUpdateId((curr) =>
                                curr === up.id ? null : up.id
                              )
                            }
                            aria-label={`Delete ${up.title}`}
                            className="rounded-lg p-1.5 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                    <h4 className="mt-2 font-display text-base font-bold text-[#0B1A2E]">
                      {up.title}
                    </h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {up.body}
                    </p>
                    {confirmingDelete && isSupremeAdminOrOwner && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                        <span>Delete this marketplace notice?</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingUpdateId === up.id}
                            onClick={() =>
                              void handleDeleteMarketplaceUpdate(up.id)
                            }
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-red-700 px-3 py-1 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                          >
                            {deletingUpdateId === up.id && (
                              <Loader2
                                className="h-3 w-3 animate-spin"
                                aria-hidden="true"
                              />
                            )}
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUpdateId(null)}
                            className="min-h-[32px] rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-[#0B1A2E]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : pendingListings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-12 text-center text-sm text-slate-600">
          <Clock
            className="mx-auto mb-3 h-8 w-8 text-slate-400"
            aria-hidden="true"
          />
          No pending listings awaiting review.
        </div>
      ) : (
        <div className="space-y-4">
          {pendingListings.map((item) => {
            const sellerBadge = sellerMap.get(item.ownerUID)?.badge;
            const canReviewItem = canActorModerateMarketplaceListing(
              actorRole,
              sellerBadge,
              item.approvalStatus
            );
            return (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-bold text-[#1E88E5] uppercase">
                    {item.listingKind} · {item.category}
                  </p>
                  <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                    {item.title} — ₦{item.price.toLocaleString()}
                  </h3>
                  <p className="text-xs text-slate-600">{item.description}</p>
                </div>

                {canReviewItem ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busyListingId === item.id}
                      onClick={() => void handleReviewPending(item.id, 'approved')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyListingId === item.id}
                      onClick={() => void handleReviewPending(item.id, 'rejected')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100"
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    Admin review only
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* PRODUCT DETAILS VIEW MODAL */}
      {selectedProduct && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/70 p-4 backdrop-blur-xs"
        >
          <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => openListingModal(null)}
                  aria-label="Back from product details"
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back
                </button>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-[#1E88E5] uppercase">
                    {selectedProduct.listingKind} · {selectedProduct.category}
                  </span>
                  <h3 className="truncate font-display text-lg font-bold text-[#0B1A2E]">
                    {selectedProduct.title}
                  </h3>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleShareListing(selectedProduct)}
                  aria-label="Share listing link"
                  title="Share or copy link"
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E]"
                >
                  {listingLinkCopied ? (
                    <>
                      <Check
                        className="h-3.5 w-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openListingModal(null)}
                  aria-label="Close product details"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {/* Image Gallery */}
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-slate-900">
                {activeGalleryMedia ? (
                  <button
                    type="button"
                    onClick={() => setDetailLightboxIndex(activeGalleryIndex)}
                    aria-label={`View ${selectedProduct.title} image full screen`}
                    className="group relative block h-full w-full cursor-zoom-in"
                  >
                    <FirestoreImage
                      imageId={activeGalleryMedia.imageId}
                      fallbackUrl={activeGalleryMedia.fallbackUrl}
                      alt={selectedProduct.title}
                      eager
                      className="h-full w-full object-contain"
                      placeholderClassName="bg-slate-900"
                    />
                    <span className="pointer-events-none absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-lg bg-[#0B1A2E]/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-xs">
                      <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                      Full screen
                    </span>
                  </button>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-slate-400">
                    <ShoppingBag
                      className="h-10 w-10 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    <span className="mt-2 text-xs">
                      No photographs attached
                    </span>
                  </div>
                )}
              </div>

              {selectedGallery.length > 1 && (
                <div className="flex gap-2">
                  {selectedGallery.map((media, idx) => (
                    <button
                      key={media.key}
                      type="button"
                      onClick={() => setActiveGalleryIndex(idx)}
                      className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${
                        activeGalleryIndex === idx
                          ? 'border-[#1E88E5]'
                          : 'border-transparent'
                      }`}
                    >
                      <FirestoreImage
                        imageId={media.imageId}
                        fallbackUrl={media.fallbackUrl}
                        alt={`Thumbnail ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Seller Identity + Follow Control */}
              {selectedSeller && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateProfile?.(selectedSeller.username);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <AvatarMedia
                      fullName={selectedSeller.fullName}
                      photoImageId={selectedSeller.photoImageId}
                      photoUrl={selectedSeller.photoUrl}
                      sizeClass="h-10 w-10"
                      roundedClass="rounded-full"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-display text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]">
                          {selectedSeller.fullName}
                        </span>
                        <ProfileBadgesRow profile={selectedSeller} size="xs" />
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        @{selectedSeller.username}
                        {selectedSeller.department
                          ? ` · ${selectedSeller.department}`
                          : ''}
                      </p>
                    </div>
                  </button>

                  <TikTokFollowButton
                    targetUsername={selectedSeller.username}
                    compact
                    onRequireAuth={() => {
                      onRequireAuth('login', 'marketplace');
                    }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs text-slate-500">Price</span>
                  <p className="font-display text-2xl font-bold text-[#0B1A2E] tabular-nums">
                    ₦{selectedProduct.price.toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">Availability</span>
                  <p className="text-sm font-bold text-emerald-700 capitalize">
                    {selectedProduct.status} (Qty: {selectedProduct.quantity})
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase">
                  Description
                </h4>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {selectedProduct.description}
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p>
                  Meetup &amp; Transaction: Direct between buyer and seller at
                  safe campus locations.
                </p>
                <p>
                  Posted on{' '}
                  {new Date(
                    Number(selectedProduct.createdAt)
                  ).toLocaleDateString()}
                </p>
              </div>

              <MarketplaceListingComments
                key={selectedProduct.id}
                listingId={selectedProduct.id}
                listingStatus={selectedProduct.status}
                commentsCount={Number(selectedProduct.commentsCount ?? 0)}
                highlightCommentId={selectedCommentId}
                onCommentsCountChange={(nextCount) =>
                  handleListingCommentsCountChange(
                    selectedProduct.id,
                    nextCount
                  )
                }
                onNavigateProfile={(uname) => {
                  onNavigateProfile?.(uname);
                }}
                onRequireGuestAuth={() => {
                  onRequireAuth('login', 'marketplace');
                }}
              />
            </div>

            <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-6 py-4">
              {buildWhatsAppChatUrl(selectedProduct.whatsappNumber) && (
                <a
                  href={buildWhatsAppChatUrl(selectedProduct.whatsappNumber)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0B1A2E] px-6 py-2.5 text-xs font-bold text-white hover:bg-[#132844]"
                >
                  <MessageCircle
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Contact Seller on WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {formLightboxIndex !== null && formAttachments.length > 0 && (
        <FullScreenImageLightbox
          items={formAttachments.map((att) => ({
            imageId: att.clientId,
            directSrc: att.previewUrl,
          }))}
          initialIndex={formLightboxIndex}
          postTitle={title.trim() || 'Marketplace Listing Preview'}
          postCaption={description.trim() || undefined}
          onClose={() => setFormLightboxIndex(null)}
        />
      )}

      {detailLightboxIndex !== null && selectedProduct && selectedGallery.length > 0 && (
        <FullScreenImageLightbox
          items={selectedGallery.map(
            (media): GridPhotoItem => ({
              imageId: media.imageId || media.key,
              fallbackUrl: media.fallbackUrl,
            })
          )}
          initialIndex={detailLightboxIndex}
          postTitle={selectedProduct.title}
          postCaption={`₦${selectedProduct.price.toLocaleString()} · ${selectedProduct.category}`}
          onIndexChange={(idx) => setDetailLightboxIndex(idx)}
          onClose={() => setDetailLightboxIndex(null)}
        />
      )}
    </div>
  );
};

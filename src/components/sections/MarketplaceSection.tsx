import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
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
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  createMarketplaceListingItem,
  deleteMarketplaceListing,
  fetchMarketplaceListingById,
  fetchMarketplaceSellersMap,
  fetchMyMarketplaceListings,
  fetchPendingMarketplaceApprovals,
  fetchPublicMarketplaceListings,
  renewMarketplaceListing,
  reviewPendingMarketplaceListing,
  updateOwnMarketplaceListingQuantity,
} from '../../services/governance';
import {
  BLUEPRINT_LIMITS,
  canRolePublishCommunityFeed,
  type MarketplaceListing,
  type MarketplaceListingKind,
  type PublicProfileProjection,
  type UserRole,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import {
  compressImageFile,
  validatePostImageCountAfterAdd,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import { RoleBadge } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia, FirestoreImage } from '../media/FirestoreImage';
import { MarketplaceListingComments } from './MarketplaceListingComments';

interface MarketplaceSectionProps {
  selectedListingId?: string | null;
  selectedCommentId?: string | null;
  onSelectListing?: (listingId: string | null) => void;
  onRequireAuth: (
    authRoute: 'login' | 'register',
    returnTo: ActiveRoute
  ) => void;
  onNavigateProfile?: (username: string) => void;
}

type MarketplaceTab =
  | 'browse'
  | 'my_listings'
  | 'updates'
  | 'pending_approvals';

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
  onSelectListing,
  onRequireAuth,
  onNavigateProfile,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();

  const canModerateApprovals =
    !isSuspended &&
    (effectiveTier === 'moderator' ||
      effectiveTier === 'supreme_admin' ||
      effectiveTier === 'owner');
  const actorRole: UserRole = (
    effectiveTier === 'guest' ? 'member' : effectiveTier
  ) as UserRole;
  const isAutoPublished = canRolePublishCommunityFeed(actorRole);

  const [activeTab, setActiveTab] = useState<MarketplaceTab>('browse');
  const [kindFilter] = useState<'all' | MarketplaceListingKind>('all');
  const [selectedCategory, setSelectedCategory] =
    useState<string>('All Categories');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [publicListings, setPublicListings] = useState<MarketplaceListing[]>(
    []
  );
  const [sellerMap, setSellerMap] = useState<
    Map<string, PublicProfileProjection>
  >(new Map());
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [pendingListings, setPendingListings] = useState<MarketplaceListing[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);
  const [localSelectedListingId, setLocalSelectedListingId] = useState<
    string | null
  >(selectedListingId);
  const [directLookupListing, setDirectLookupListing] = useState<{
    targetId: string;
    listing: MarketplaceListing | null;
  } | null>(null);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const [listingLinkCopied, setListingLinkCopied] = useState(false);
  const [confirmDeleteListingId, setConfirmDeleteListingId] = useState<
    string | null
  >(null);
  const [reportedListingIds, setReportedListingIds] = useState<Set<string>>(
    new Set()
  );

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
  const [formAttachments, setFormAttachments] = useState<
    Array<{
      clientId: string;
      previewUrl: string;
      compressed: CompressedImageResult;
    }>
  >([]);
  const [compressingPhotos, setCompressingPhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);

  const [updatesList] = useState<
    Array<{
      id: string;
      title: string;
      body: string;
      date: string;
      author: string;
    }>
  >([
    {
      id: 'up-1',
      title: 'Verified Campus Delivery Safety Notice',
      body: 'Always meet buyers and sellers in well-lit public locations on campus such as the Main Quad, Epe Campus Gate, or Departmental Foyers. Never make advance bank transfers before inspecting goods.',
      date: '2 days ago',
      author: 'LASUED Intel Security & Welfare',
    },
    {
      id: 'up-2',
      title: 'Hostel Booking Scam Alert',
      body: 'Beware of unofficial agents demanding deposit fees via WhatsApp without physical hostel inspection. Verify accommodation listings with the Student Union or Faculty Presidents.',
      date: '5 days ago',
      author: 'LASUED Intel Moderation Team',
    },
  ]);

  useEffect(() => {
    let active = true;
    const viewerUid = user?.uid ?? null;

    const publicPromise = fetchPublicMarketplaceListings();
    const minePromise = viewerUid
      ? fetchMyMarketplaceListings(viewerUid).catch(() => [])
      : Promise.resolve([]);
    const pendingPromise = canModerateApprovals
      ? fetchPendingMarketplaceApprovals().catch(() => [])
      : Promise.resolve([]);

    Promise.all([publicPromise, minePromise, pendingPromise])
      .then(async ([pubItems, myItems, pendingItems]) => {
        if (!active) return;
        setPublicListings(pubItems);
        setMyListings(myItems);
        setPendingListings(pendingItems);
        setErrorMessage(null);
        const sellers = await fetchMarketplaceSellersMap(pubItems).catch(
          () => new Map<string, PublicProfileProjection>()
        );
        if (active) {
          setSellerMap(sellers);
        }
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load Campus Marketplace listings right now.'
          )
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, canModerateApprovals]);

  const effectiveSelectedListingId = onSelectListing
    ? selectedListingId
    : localSelectedListingId;

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

  const openListingModal = (listingId: string | null) => {
    setActiveGalleryIndex(0);
    setListingLinkCopied(false);
    if (onSelectListing) {
      onSelectListing(listingId);
    } else {
      setLocalSelectedListingId(listingId);
    }
  };

  const handleShareListing = async (listing: MarketplaceListing) => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?view=marketplace&listingId=${listing.id}`
        : `/?view=marketplace&listingId=${listing.id}`;

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
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;

    const countError = validatePostImageCountAfterAdd(
      formAttachments.length,
      files.length
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
      for (const file of Array.from(files)) {
        if (formAttachments.length + newItems.length >= 4) break;
        const compressed = await compressImageFile(file, 'post');
        newItems.push({
          clientId: `photo-${Date.now()}-${Math.random()}`,
          previewUrl: compressed.dataUrl,
          compressed,
        });
      }
      setFormAttachments((prev) => [...prev, ...newItems]);
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(err, 'Could not compress photograph.')
      );
    } finally {
      setCompressingPhotos(false);
    }
  };

  const handleRemovePhoto = (clientId: string) => {
    setFormAttachments((prev) => prev.filter((i) => i.clientId !== clientId));
  };

  const handleCreateListing = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!user || isSuspended || submitting) return;
    setSubmitting(true);
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
      setShowCreateForm(false);
      setIsPreviewMode(false);
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not submit your marketplace listing.'
        )
      );
    } finally {
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
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not complete marketplace listing review.'
        )
      );
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
      await deleteMarketplaceListing(listingId);
      setMyListings((prev) => prev.filter((i) => i.id !== listingId));
      setPublicListings((prev) => prev.filter((i) => i.id !== listingId));
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

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0B1A2E]">
                    Product Photographs (Up to 4 Max)
                  </span>
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
                        compressingPhotos || formAttachments.length >= 4
                      }
                      onChange={handlePhotoSelect}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {formAttachments.map((att, idx) => (
                    <div
                      key={att.clientId}
                      className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
                    >
                      <img
                        src={att.previewUrl}
                        alt={`Preview ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(att.clientId)}
                        className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-600"
                        aria-label="Remove photo"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {formAttachments.length === 0 && (
                    <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                      No photographs added yet. Up to 4 clear photos help buyers
                      trust your listing.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewMode(true)}
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
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
                <div className="mt-4 flex flex-wrap gap-2">
                  {formAttachments.map((att, i) => (
                    <img
                      key={i}
                      src={att.previewUrl}
                      alt="Preview"
                      className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewMode(false)}
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E]"
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
                  disabled={submitting}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-6 py-2 text-xs font-bold text-white hover:bg-[#132844]"
                >
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
            onClick={() => setActiveTab('browse')}
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
              onClick={() => setActiveTab('my_listings')}
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
            onClick={() => setActiveTab('updates')}
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
              onClick={() => setActiveTab('pending_approvals')}
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
            {filteredPublic.map((item) => {
              const waUrl = buildWhatsAppChatUrl(item.whatsappNumber);
              const seller = sellerMap.get(item.ownerUID) ?? null;
              const gallery = getListingGallerySources(item);
              const leadPhoto = gallery[0] ?? null;

              return (
                <article
                  key={item.id}
                  className="group flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1E88E5]/50 hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => openListingModal(item.id)}
                    className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left"
                  >
                    {leadPhoto ? (
                      <FirestoreImage
                        imageId={leadPhoto.imageId}
                        fallbackUrl={leadPhoto.fallbackUrl}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        placeholderClassName="bg-[#0B1A2E]"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0B1A2E] text-slate-300">
                        <ShoppingBag
                          className="h-8 w-8 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        <span className="mt-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                          {item.listingKind}
                        </span>
                      </div>
                    )}
                    <span className="absolute top-2.5 left-2.5 rounded-lg bg-[#0B1A2E]/80 px-2.5 py-1 text-[10px] font-bold text-white uppercase backdrop-blur-xs">
                      {item.listingKind}
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate font-semibold text-[#1E88E5]">
                          {item.category}
                        </span>
                        <span className="shrink-0">
                          {item.status === 'sold'
                            ? 'Sold'
                            : `Qty: ${item.quantity}`}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => openListingModal(item.id)}
                        className="mt-1.5 text-left"
                      >
                        <h3 className="line-clamp-2 font-display text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]">
                          {item.title}
                        </h3>
                      </button>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                        {item.description}
                      </p>

                      {seller && (
                        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateProfile?.(seller.username)
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <AvatarMedia
                              fullName={seller.fullName}
                              photoImageId={seller.photoImageId}
                              photoUrl={seller.photoUrl}
                              sizeClass="h-6 w-6"
                              roundedClass="rounded-full"
                              textClass="text-[10px]"
                            />
                            <span className="truncate text-[11px] font-semibold text-[#0B1A2E] hover:text-[#1E88E5]">
                              {seller.fullName}
                            </span>
                            <RoleBadge badge={seller.badge} size="xs" />
                          </button>

                          <TikTokFollowButton
                            targetUsername={seller.username}
                            compact
                            onRequireAuth={() => setShowGuestPrompt(true)}
                          />
                        </div>
                      )}
                    </div>

                    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <span className="font-display text-base font-bold text-[#0B1A2E] tabular-nums">
                        ₦{item.price.toLocaleString()}
                      </span>
                      {waUrl && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#132844]"
                        >
                          <MessageCircle
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
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
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-base font-bold text-[#0B1A2E]">
              Marketplace Announcements &amp; Safety Advisories
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Official updates regarding campus trading guidelines, security
              alerts, and accommodation notices.
            </p>
          </div>

          <div className="space-y-3">
            {updatesList.map((up) => (
              <article
                key={up.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-[#1E88E5]">
                    {up.author}
                  </span>
                  <span>{up.date}</span>
                </div>
                <h4 className="mt-2 font-display text-base font-bold text-[#0B1A2E]">
                  {up.title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  {up.body}
                </p>
              </article>
            ))}
          </div>
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
          {pendingListings.map((item) => (
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
            </div>
          ))}
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
              <div className="min-w-0">
                <span className="text-xs font-bold text-[#1E88E5] uppercase">
                  {selectedProduct.listingKind} · {selectedProduct.category}
                </span>
                <h3 className="truncate font-display text-lg font-bold text-[#0B1A2E]">
                  {selectedProduct.title}
                </h3>
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
                  <FirestoreImage
                    imageId={activeGalleryMedia.imageId}
                    fallbackUrl={activeGalleryMedia.fallbackUrl}
                    alt={selectedProduct.title}
                    className="h-full w-full object-contain"
                    placeholderClassName="bg-slate-900"
                  />
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
                      openListingModal(null);
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
                        <RoleBadge badge={selectedSeller.badge} size="xs" />
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
                      openListingModal(null);
                      setShowGuestPrompt(true);
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

              {reportedListingIds.has(selectedProduct.id) && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Thank you. This listing has been flagged for moderator
                    review.
                  </span>
                </div>
              )}

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
                  openListingModal(null);
                  onNavigateProfile?.(uname);
                }}
                onRequireGuestAuth={() => {
                  openListingModal(null);
                  setShowGuestPrompt(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                disabled={reportedListingIds.has(selectedProduct.id)}
                onClick={() => {
                  const id = selectedProduct.id;
                  setReportedListingIds((prev) => {
                    const next = new Set(prev);
                    next.add(id);
                    return next;
                  });
                }}
                className={`text-xs font-semibold ${
                  reportedListingIds.has(selectedProduct.id)
                    ? 'text-emerald-700'
                    : 'text-red-600 hover:underline'
                }`}
              >
                {reportedListingIds.has(selectedProduct.id)
                  ? 'Reported to Moderators'
                  : 'Report Listing'}
              </button>

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
    </div>
  );
};

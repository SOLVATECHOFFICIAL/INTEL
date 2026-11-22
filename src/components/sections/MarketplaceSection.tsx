import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Package,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  createMarketplaceListingItem,
  fetchMyMarketplaceListings,
  fetchPendingMarketplaceApprovals,
  fetchPublicMarketplaceListings,
  reviewPendingMarketplaceListing,
  updateOwnMarketplaceListingQuantity,
} from '../../services/governance';
import {
  BLUEPRINT_LIMITS,
  canRolePublishCommunityFeed,
  type MarketplaceListing,
  type MarketplaceListingKind,
  type UserRole,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface MarketplaceSectionProps {
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

type MarketplaceTab = 'browse' | 'my_listings' | 'pending_approvals';

export const MarketplaceSection: React.FC<MarketplaceSectionProps> = ({
  onRequireAuth,
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
  const [kindFilter, setKindFilter] = useState<'all' | MarketplaceListingKind>(
    'all'
  );

  const [publicListings, setPublicListings] = useState<MarketplaceListing[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [pendingListings, setPendingListings] = useState<MarketplaceListing[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Create form state
  const [listingKind, setListingKind] =
    useState<MarketplaceListingKind>('product');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Textbooks & Study');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [whatsappNumber, setWhatsappNumber] = useState(
    profile?.publicWhatsapp || ''
  );
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);

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
      .then(([pubItems, myItems, pendingItems]) => {
        if (!active) return;
        setPublicListings(pubItems);
        setMyListings(myItems);
        setPendingListings(pendingItems);
        setErrorMessage(null);
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
      setShowCreateForm(false);
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

  const filteredPublic =
    kindFilter === 'all'
      ? publicListings
      : publicListings.filter((item) => item.listingKind === kindFilter);

  return (
    <div className="space-y-5">
      {/* Toolbar & Notice */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
        <div className="space-y-0.5">
          <p className="font-display text-sm font-bold text-[#0B1A2E]">
            Direct Student-to-Student Trade via WhatsApp
          </p>
          <p className="text-xs text-slate-600">
            No in-app checkout or bank transfers.{' '}
            {isAutoPublished
              ? 'Your Verified+ account auto-publishes listings.'
              : 'Ordinary member listings require Moderator or Admin approval.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenComposer}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-[#1565C0]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {showCreateForm ? 'Close Form' : 'Post a Listing'}
        </button>
      </div>

      {showGuestPrompt && (
        <GuestPromptCard
          title="Sign in to post a marketplace listing"
          description="Guests can browse listings and open WhatsApp seller links. Sign in to post textbooks, accommodation, or services."
          returnRoute="marketplace"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setShowGuestPrompt(false)}
        />
      )}

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Create Listing Form */}
      {showCreateForm && user && (
        <form
          onSubmit={handleCreateListing}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Create Marketplace Listing
            </h2>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
              {isAutoPublished
                ? 'Instant Publish (Verified+)'
                : 'Moderator Approval Required'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E]"
              >
                <option value="product">Product</option>
                <option value="service">Service</option>
                <option value="accommodation">Accommodation</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="mkt-category"
                className="block text-xs font-semibold text-[#0B1A2E]"
              >
                Category
              </label>
              <input
                id="mkt-category"
                type="text"
                required
                minLength={2}
                maxLength={BLUEPRINT_LIMITS.categoryMax}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="mkt-title"
              className="block text-xs font-semibold text-[#0B1A2E]"
            >
              Title
            </label>
            <input
              id="mkt-title"
              type="text"
              required
              minLength={BLUEPRINT_LIMITS.marketplaceTitleMin}
              maxLength={BLUEPRINT_LIMITS.marketplaceTitleMax}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. CSC 201 Past Questions & Textbook"
              className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                placeholder="3500"
                className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E]"
              />
            </div>

            <div>
              <label
                htmlFor="mkt-qty"
                className="block text-xs font-semibold text-[#0B1A2E]"
              >
                Quantity Available
              </label>
              <input
                id="mkt-qty"
                type="number"
                required
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E]"
              />
            </div>

            <div>
              <label
                htmlFor="mkt-whatsapp"
                className="block text-xs font-semibold text-[#0B1A2E]"
              >
                WhatsApp Number
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
                className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="mkt-desc"
              className="block text-xs font-semibold text-[#0B1A2E]"
            >
              Description &amp; Campus Meetup Location
            </label>
            <textarea
              id="mkt-desc"
              rows={3}
              required
              minLength={BLUEPRINT_LIMITS.marketplaceDescMin}
              maxLength={BLUEPRINT_LIMITS.marketplaceDescMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Condition, pickup point on Epe/Ijanikin campus, and key details..."
              className="mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm text-[#0B1A2E]"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Submit Listing
            </button>
          </div>
        </form>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('browse')}
            className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold ${
              activeTab === 'browse'
                ? 'bg-[#0B1A2E] text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Browse Listings ({publicListings.length})
          </button>

          {user && (
            <button
              type="button"
              onClick={() => setActiveTab('my_listings')}
              className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold ${
                activeTab === 'my_listings'
                  ? 'bg-[#0B1A2E] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              My Listings ({myListings.length})
            </button>
          )}

          {canModerateApprovals && (
            <button
              type="button"
              onClick={() => setActiveTab('pending_approvals')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${
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
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'product', 'service', 'accommodation'] as const).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                    kindFilter === kind
                      ? 'bg-[#1E88E5] text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {kind === 'all' ? 'All Types' : kind}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading Campus Marketplace...
        </div>
      ) : activeTab === 'browse' ? (
        filteredPublic.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
            <ShoppingBag
              className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            <p className="font-display text-base font-bold text-[#0B1A2E]">
              No active marketplace listings yet
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Be the first to post a textbook, campus gadget, or accommodation
              offer.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {filteredPublic.map((item) => {
              const waUrl = buildWhatsAppChatUrl(item.whatsappNumber);
              return (
                <article
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-[#1E88E5] uppercase">
                        {item.listingKind}
                      </span>
                      <span>
                        {item.category} · Qty {item.quantity}
                      </span>
                    </div>
                    <h3 className="mt-1 font-display text-base font-bold text-[#0B1A2E]">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="font-display text-lg font-bold text-[#0B1A2E] tabular-nums">
                      ₦{item.price.toLocaleString()}
                    </span>
                    {waUrl && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132844]"
                      >
                        <MessageCircle
                          className="h-3.5 w-3.5 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        Contact on WhatsApp
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : activeTab === 'my_listings' ? (
        myListings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-600">
            <Package
              className="mx-auto mb-2 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            You have not posted any marketplace listings yet.
          </div>
        ) : (
          <div className="space-y-3">
            {myListings.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-[#1E88E5] uppercase">
                      {item.listingKind}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
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
                  <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                    {item.title} — ₦{item.price.toLocaleString()}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Remaining quantity: {item.quantity}
                  </p>
                </div>

                {item.approvalStatus === 'approved' && item.status !== 'rejected' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyListingId === item.id || item.quantity === 0}
                      onClick={() => void handleUpdateQuantity(item, 0)}
                      className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
                    >
                      Mark Sold
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : pendingListings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-600">
          <Clock
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          No pending marketplace listings awaiting review.
        </div>
      ) : (
        <div className="space-y-3">
          {pendingListings.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1E88E5] uppercase">
                  {item.listingKind} · {item.category}
                </p>
                <h3 className="mt-0.5 font-display text-base font-bold text-[#0B1A2E]">
                  {item.title} — ₦{item.price.toLocaleString()}
                </h3>
                <p className="mt-1 text-xs text-slate-600">{item.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyListingId === item.id}
                  onClick={() => void handleReviewPending(item.id, 'approved')}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Approve Once
                </button>
                <button
                  type="button"
                  disabled={busyListingId === item.id}
                  onClick={() => void handleReviewPending(item.id, 'rejected')}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

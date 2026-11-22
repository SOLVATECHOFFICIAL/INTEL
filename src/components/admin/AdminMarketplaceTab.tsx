import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  MessageCircle,
  Search,
  ShoppingBag,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  adminDeleteMarketplaceListingWithAudit,
  adminUpdateMarketplaceStatusWithAudit,
  reviewMarketplaceListingWithAudit,
  type AdminMarketplaceItem,
} from '../../services/adminDashboard';
import {
  classifyMarketplaceListingBucket,
  type MarketplaceFilterBucket,
  type MarketplaceListing,
  type MarketplaceStatus,
  type UserRole,
} from '../../types/database';
import {
  canActorDeleteMarketplaceListing,
  canActorModerateMarketplaceListing,
} from '../../utils/adminPermissions';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { RoleBadge } from '../RoleBadge';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminMarketplaceTabProps {
  items: AdminMarketplaceItem[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  isFullAdmin: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

const BUCKET_OPTIONS: { id: MarketplaceFilterBucket; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'expired', label: 'Expired' },
  { id: 'sold', label: 'Sold' },
];

function formatShortDate(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Pending timestamp';
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const AdminMarketplaceTab: React.FC<AdminMarketplaceTabProps> = ({
  items,
  loading,
  actorUid,
  actorRole,
  isFullAdmin,
  onSuccess,
  onError,
  onReload,
}) => {
  const [bucketFilter, setBucketFilter] =
    useState<MarketplaceFilterBucket>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketplaceListing | null>(
    null
  );

  const bucketed = useMemo(() => {
    const counts: Record<MarketplaceFilterBucket, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      sold: 0,
    };
    const tagged = items.map((entry) => {
      const expMs = extractTimestampMs(entry.listing.expiresAt);
      const bucket = classifyMarketplaceListingBucket(entry.listing, expMs);
      counts[bucket] += 1;
      return { ...entry, bucket, expMs };
    });
    return { counts, tagged };
  }, [items]);

  const filteredItems = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return bucketed.tagged.filter((entry) => {
      if (entry.bucket !== bucketFilter) return false;
      if (!term) return true;
      const haystack = [
        entry.listing.title,
        entry.listing.description,
        entry.listing.category,
        entry.listing.listingKind,
        entry.seller?.fullName ?? '',
        entry.seller?.username ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [bucketed.tagged, bucketFilter, searchQuery]);

  const handleReview = async (
    item: AdminMarketplaceItem,
    decision: 'approved' | 'rejected'
  ) => {
    if (busyId) return;
    setBusyId(item.listing.id);
    try {
      await reviewMarketplaceListingWithAudit({
        listing: item.listing,
        actorUid,
        actorRole,
        decision,
        note: reviewNote,
      });
      onSuccess(
        decision === 'approved'
          ? `Approved "${item.listing.title}" for 7-day Marketplace visibility.`
          : `Rejected "${item.listing.title}".`
      );
      setReviewNote('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not complete marketplace listing review.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (
    listing: MarketplaceListing,
    nextStatus: MarketplaceStatus
  ) => {
    if (busyId || !isFullAdmin) return;
    setBusyId(listing.id);
    try {
      await adminUpdateMarketplaceStatusWithAudit({
        listing,
        nextStatus,
        actorUid,
        actorRole,
      });
      onSuccess(`Updated "${listing.title}" status to ${nextStatus}.`);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Unable to update marketplace listing status.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    try {
      await adminDeleteMarketplaceListingWithAudit({
        listing: deleteTarget,
        actorUid,
        actorRole,
        reason: reviewNote,
      });
      onSuccess(`Removed marketplace listing "${deleteTarget.title}".`);
      setDeleteTarget(null);
      setReviewNote('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not remove marketplace listing.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {!isFullAdmin && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-[#0B1A2E]">
          <strong>Moderator Scope:</strong> You can approve or reject{' '}
          <strong>pending</strong> listings submitted by ordinary members.
          Verified, Moderator, and Admin submissions, status overrides, and
          permanent listing deletions are restricted to Supreme Admins.
        </div>
      )}

      {/* 5-Bucket Lifecycle Filter Tabs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {BUCKET_OPTIONS.map((opt) => {
          const active = bucketFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setBucketFilter(opt.id)}
              className={`flex min-h-[42px] items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{opt.label}</span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {bucketed.counts[opt.id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="admin-mkt-search"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Search listings
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="admin-mkt-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Item title, category, or seller @username..."
              className="block min-h-[42px] w-full rounded-xl border border-slate-300 py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="admin-mkt-note"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Moderation / audit note (optional)
          </label>
          <input
            id="admin-mkt-note"
            type="text"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="Reason shared in member notification & audit log..."
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
          Loading Campus Marketplace inventory...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <ShoppingBag
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No {bucketFilter} listings found
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Listings matching the selected lifecycle filter appear here from
            Firestore.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((entry) => {
            const { listing, seller, bucket } = entry;
            const isBusy = busyId === listing.id;
            const canReview = canActorModerateMarketplaceListing(
              actorRole,
              seller?.badge,
              listing.approvalStatus
            );
            const canDelete = canActorDeleteMarketplaceListing(actorRole);
            const whatsappHref = buildWhatsAppChatUrl(listing.whatsappNumber);

            return (
              <article
                key={listing.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                        {listing.listingKind} · {listing.category}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                          bucket === 'pending'
                            ? 'bg-amber-100 text-amber-900'
                            : bucket === 'approved'
                            ? 'bg-emerald-100 text-emerald-900'
                            : bucket === 'sold'
                            ? 'bg-blue-100 text-blue-900'
                            : bucket === 'expired'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-red-100 text-red-900'
                        }`}
                      >
                        {bucket}
                      </span>
                      <span className="text-xs font-bold text-[#0B1A2E] tabular-nums">
                        ₦{listing.price.toLocaleString()} · Qty {listing.quantity}
                      </span>
                    </div>

                    <h3 className="mt-2 font-display text-base font-bold text-[#0B1A2E]">
                      {listing.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      {listing.description}
                    </p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        Seller:{' '}
                        <strong className="text-[#0B1A2E]">
                          {seller
                            ? `${seller.fullName} (@${seller.username})`
                            : listing.ownerUID}
                        </strong>
                        {seller && <RoleBadge badge={seller.badge} size="xs" />}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        Expires {formatShortDate(listing.expiresAt)}
                      </span>
                      {whatsappHref && (
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#1E88E5] hover:underline"
                        >
                          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          {listing.whatsappNumber}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {listing.approvalStatus === 'pending_approval' &&
                      (canReview ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReview(entry, 'approved')}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Approve (7 Days)
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReview(entry, 'rejected')}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Supreme Admin Review Required
                        </span>
                      ))}

                    {isFullAdmin &&
                      listing.approvalStatus === 'approved' && (
                        <>
                          {listing.status !== 'sold' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleStatusChange(listing, 'sold')
                              }
                              className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                            >
                              Mark Sold
                            </button>
                          )}
                          {listing.status !== 'expired' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleStatusChange(listing, 'expired')
                              }
                              className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Mark Expired
                            </button>
                          )}
                          {listing.status !== 'active' &&
                            listing.quantity > 0 && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleStatusChange(listing, 'active')
                                }
                                className="inline-flex min-h-[38px] items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                Restore Active
                              </button>
                            )}
                        </>
                      )}

                    {canDelete && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setDeleteTarget(listing)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="This permanently deletes the listing and all associated compressed marketplace images from Firestore and logs the removal."
        confirmLabel="Delete Listing"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

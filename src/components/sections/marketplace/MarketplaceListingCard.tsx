import React from 'react';
import { MessageCircle, ShoppingBag } from 'lucide-react';
import type {
  MarketplaceListing,
  PublicProfileProjection,
} from '../../../types/database';
import { buildWhatsAppChatUrl } from '../../../utils/authValidation';
import { RoleBadge } from '../../RoleBadge';
import { TikTokFollowButton } from '../../TikTokFollowButton';
import { AvatarMedia, FirestoreImage } from '../../media/FirestoreImage';

interface MarketplaceGalleryMediaSource {
  key: string;
  imageId?: string;
  fallbackUrl?: string;
}

function getMarketplaceListingGallerySources(
  listing: MarketplaceListing
): MarketplaceGalleryMediaSource[] {
  const fromMeta: MarketplaceGalleryMediaSource[] = (
    listing.mediaItems ?? []
  ).map((meta, idx) => ({
    key: meta.imageId || `meta-${idx}`,
    imageId: meta.imageId,
    fallbackUrl: listing.mediaUrls?.[idx],
  }));
  if (fromMeta.length > 0) {
    return fromMeta;
  }
  return (listing.mediaUrls ?? []).map((url, idx) => ({
    key: `url-${idx}`,
    fallbackUrl: url,
  }));
}

interface MarketplaceListingCardProps {
  listing: MarketplaceListing;
  seller?: PublicProfileProjection | null;
  onOpenListing: (listingId: string) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth?: () => void;
}

export const MarketplaceListingCard: React.FC<MarketplaceListingCardProps> = ({
  listing,
  seller = null,
  onOpenListing,
  onNavigateProfile,
  onRequireAuth,
}) => {
  const waUrl = buildWhatsAppChatUrl(listing.whatsappNumber);
  const gallery = getMarketplaceListingGallerySources(listing);
  const leadPhoto = gallery[0] ?? null;

  return (
    <article className="group flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1E88E5]/50 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenListing(listing.id)}
        className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left"
      >
        {leadPhoto ? (
          <FirestoreImage
            imageId={leadPhoto.imageId}
            fallbackUrl={leadPhoto.fallbackUrl}
            alt={listing.title}
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
              {listing.listingKind}
            </span>
          </div>
        )}
        <span className="absolute top-2.5 left-2.5 rounded-lg bg-[#0B1A2E]/80 px-2.5 py-1 text-[10px] font-bold text-white uppercase backdrop-blur-xs">
          {listing.listingKind}
        </span>
      </button>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="truncate font-semibold text-[#1E88E5]">
              {listing.category}
            </span>
            <span className="shrink-0">
              {listing.status === 'sold' ? 'Sold' : `Qty: ${listing.quantity}`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onOpenListing(listing.id)}
            className="mt-1.5 text-left"
          >
            <h3 className="line-clamp-2 font-display text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]">
              {listing.title}
            </h3>
          </button>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
            {listing.description}
          </p>

          {seller && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2">
              <button
                type="button"
                onClick={() => onNavigateProfile?.(seller.username)}
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
                onRequireAuth={onRequireAuth}
              />
            </div>
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="font-display text-base font-bold text-[#0B1A2E] tabular-nums">
            ₦{listing.price.toLocaleString()}
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
};

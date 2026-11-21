import React from 'react';
import {
  BadgeCheck,
  Bookmark,
  Clock,
  MapPin,
  Star,
} from 'lucide-react';
import {
  AccommodationLodge,
  AnyListing,
  CampusService,
  MarketplaceItem,
  RoommateProfile,
} from '../types/campus';
import { formatNaira } from '../utils/format';

interface ListingCardProps {
  listing: AnyListing;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  onSelect: (listing: AnyListing) => void;
}

export const ListingCard: React.FC<ListingCardProps> = ({
  listing,
  isSaved,
  onToggleSave,
  onSelect,
}) => {
  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave(listing.id);
  };

  if (listing.kind === 'marketplace') {
    const item: MarketplaceItem = listing;
    return (
      <article
        onClick={() => onSelect(item)}
        className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      >
        <div
          className={`relative flex h-40 items-center justify-center bg-gradient-to-br ${item.imageBg}`}
        >
          <span className="text-5xl select-none" aria-hidden="true">
            {item.emoji}
          </span>
          <span className="absolute top-3 left-3 rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs">
            {item.condition}
          </span>
          <button
            type="button"
            onClick={handleSaveClick}
            aria-label={isSaved ? 'Remove bookmark' : 'Bookmark item'}
            className="absolute top-3 right-3 rounded-lg bg-white/90 p-1.5 text-slate-500 shadow-2xs transition hover:text-[#0066FF]"
          >
            <Bookmark
              className={`h-4 w-4 ${isSaved ? 'fill-[#0066FF] text-[#0066FF]' : ''}`}
            />
          </button>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
            <span className="font-medium text-[#0066FF]">{item.category}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.postedAt}
            </span>
          </div>

          <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold text-slate-900 group-hover:text-[#0066FF]">
            {item.title}
          </h3>

          <p className="mt-2 text-lg font-bold text-slate-900">
            {formatNaira(item.price)}
          </p>

          <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {item.campus}
            </span>
            <span className="inline-flex items-center gap-1 truncate font-medium text-slate-700">
              {item.sellerName.split(' ')[0]}
              {item.verified && (
                <BadgeCheck className="h-3.5 w-3.5 text-[#0066FF]" />
              )}
            </span>
          </div>
        </div>
      </article>
    );
  }

  if (listing.kind === 'services') {
    const srv: CampusService = listing;
    return (
      <article
        onClick={() => onSelect(srv)}
        className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-md bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">
            {srv.category}
          </span>
          <button
            type="button"
            onClick={handleSaveClick}
            aria-label={isSaved ? 'Remove bookmark' : 'Bookmark service'}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-[#0066FF]"
          >
            <Bookmark
              className={`h-4 w-4 ${isSaved ? 'fill-[#0066FF] text-[#0066FF]' : ''}`}
            />
          </button>
        </div>

        <h3 className="mt-3 line-clamp-2 text-base font-semibold text-slate-900 group-hover:text-[#0066FF]">
          {srv.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">
          {srv.description}
        </p>

        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-600">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="font-semibold text-slate-800">
            {srv.rating.toFixed(1)}
          </span>
          <span className="text-slate-400">({srv.reviewsCount} reviews)</span>
          <span className="mx-1 text-slate-300">•</span>
          <span className="truncate">{srv.turnaround}</span>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3.5">
          <div>
            <span className="text-xs text-slate-400">{srv.priceUnit} </span>
            <span className="text-base font-bold text-slate-900">
              {formatNaira(srv.startingPrice)}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
            <MapPin className="h-3.5 w-3.5 text-slate-400" />
            {srv.campus}
            {srv.verified && (
              <BadgeCheck className="h-3.5 w-3.5 text-[#0066FF]" />
            )}
          </span>
        </div>
      </article>
    );
  }

  if (listing.kind === 'accommodation') {
    const lodge: AccommodationLodge = listing;
    return (
      <article
        onClick={() => onSelect(lodge)}
        className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              {lodge.lodgeType}
            </span>
            {lodge.verified && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-[#0066FF]">
                <BadgeCheck className="h-3.5 w-3.5" />
                Verified
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSaveClick}
            aria-label={isSaved ? 'Remove bookmark' : 'Bookmark lodge'}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-[#0066FF]"
          >
            <Bookmark
              className={`h-4 w-4 ${isSaved ? 'fill-[#0066FF] text-[#0066FF]' : ''}`}
            />
          </button>
        </div>

        <h3 className="mt-3 text-base font-semibold text-slate-900 group-hover:text-[#0066FF]">
          {lodge.title}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
          {lodge.campus} — {lodge.distanceToGate}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {lodge.amenities.slice(0, 3).map((amenity) => (
            <span
              key={amenity}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              {amenity}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3.5">
          <div>
            <span className="text-base font-bold text-slate-900">
              {formatNaira(lodge.annualRent)}
            </span>
            <span className="text-xs text-slate-500"> / year</span>
          </div>
          <span className="text-xs font-medium text-emerald-700">
            {lodge.availableRooms}{' '}
            {lodge.availableRooms === 1 ? 'room' : 'rooms'} left
          </span>
        </div>
      </article>
    );
  }

  const mate: RoommateProfile = listing;
  return (
    <article
      onClick={() => onSelect(mate)}
      className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-600">
            {mate.name
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)}
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold text-slate-900 group-hover:text-[#0066FF]">
                {mate.name}
              </h3>
              {mate.verified && (
                <BadgeCheck className="h-3.5 w-3.5 text-[#0066FF]" />
              )}
            </div>
            <p className="text-xs text-slate-500">
              {mate.school} • {mate.department}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSaveClick}
          aria-label={isSaved ? 'Remove bookmark' : 'Bookmark roommate'}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-[#0066FF]"
        >
          <Bookmark
            className={`h-4 w-4 ${isSaved ? 'fill-[#0066FF] text-[#0066FF]' : ''}`}
          />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {mate.roomStatus}
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {mate.gender}
        </span>
      </div>

      <p className="mt-2.5 line-clamp-2 text-sm text-slate-600">{mate.bio}</p>

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3.5 text-xs">
        <span className="font-bold text-slate-900">
          {formatNaira(mate.budgetPerYear)}
          <span className="font-normal text-slate-500"> / yr budget</span>
        </span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-slate-400" />
          {mate.preferredArea}
        </span>
      </div>
    </article>
  );
};

import React, { useState } from 'react';
import {
  BadgeCheck,
  Bookmark,
  CheckCircle2,
  MapPin,
  MessageSquare,
  Star,
  X,
} from 'lucide-react';
import { AnyListing } from '../types/campus';
import { formatNaira } from '../utils/format';

interface ListingModalProps {
  listing: AnyListing | null;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  onClose: () => void;
}

export const ListingModal: React.FC<ListingModalProps> = ({
  listing,
  isSaved,
  onToggleSave,
  onClose,
}) => {
  const [messageText, setMessageText] = useState('');
  const [sentMessages, setSentMessages] = useState<Record<string, string[]>>({});

  if (!listing) return null;

  const existingMessages = sentMessages[listing.id] || [];

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageText.trim();
    if (!trimmed) return;
    setSentMessages((prev) => ({
      ...prev,
      [listing.id]: [...(prev[listing.id] || []), trimmed],
    }));
    setMessageText('');
  };

  const title =
    listing.kind === 'roommates' ? listing.name : listing.title;

  const campusLabel =
    listing.kind === 'roommates' ? listing.preferredArea : listing.campus;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="listing-modal-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold capitalize text-[#0066FF]">
                {listing.kind}
              </span>
              {listing.verified && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Verified Student / Host
                </span>
              )}
            </div>
            <h2
              id="listing-modal-title"
              className="mt-2.5 text-xl font-bold text-slate-900"
            >
              {title}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="h-4 w-4 text-slate-400" />
              {campusLabel}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleSave(listing.id)}
              aria-label={isSaved ? 'Remove bookmark' : 'Save listing'}
              className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-[#0066FF]"
            >
              <Bookmark
                className={`h-4 w-4 ${isSaved ? 'fill-[#0066FF] text-[#0066FF]' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Details Body */}
        <div className="mt-5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
          {listing.kind === 'marketplace' && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Price</p>
                <p className="font-bold text-slate-900">
                  {formatNaira(listing.price)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Condition</p>
                <p className="font-medium text-slate-800">{listing.condition}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Seller</p>
                <p className="font-medium text-slate-800">{listing.sellerName}</p>
              </div>
            </div>
          )}

          {listing.kind === 'services' && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Rate</p>
                <p className="font-bold text-slate-900">
                  {formatNaira(listing.startingPrice)} ({listing.priceUnit})
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Provider</p>
                <p className="font-medium text-slate-800">
                  {listing.providerName}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Rating</p>
                <p className="inline-flex items-center gap-1 font-medium text-slate-800">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {listing.rating.toFixed(1)} ({listing.reviewsCount})
                </p>
              </div>
            </div>
          )}

          {listing.kind === 'accommodation' && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Annual Rent</p>
                <p className="font-bold text-slate-900">
                  {formatNaira(listing.annualRent)} / yr
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Proximity</p>
                <p className="font-medium text-slate-800">
                  {listing.distanceToGate}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Contact</p>
                <p className="font-medium text-slate-800">
                  {listing.caretakerName}
                </p>
              </div>
            </div>
          )}

          {listing.kind === 'roommates' && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Annual Budget</p>
                <p className="font-bold text-slate-900">
                  {formatNaira(listing.budgetPerYear)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">School &amp; Dept</p>
                <p className="font-medium text-slate-800">
                  {listing.school} • {listing.department}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Status</p>
                <p className="font-medium text-slate-800">
                  {listing.roomStatus}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Details
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
            {listing.kind === 'roommates' ? listing.bio : listing.description}
          </p>
        </div>

        {/* Tags */}
        {listing.kind === 'accommodation' && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {listing.amenities.map((amenity) => (
              <span
                key={amenity}
                className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
              >
                {amenity}
              </span>
            ))}
          </div>
        )}

        {listing.kind === 'roommates' && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {listing.habits.map((habit) => (
              <span
                key={habit}
                className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
              >
                {habit}
              </span>
            ))}
          </div>
        )}

        {/* Direct Inquiry Box */}
        <div className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <MessageSquare className="h-4 w-4 text-[#0066FF]" />
            Send Campus Inquiry
          </h3>

          {existingMessages.length > 0 && (
            <div className="mt-3 space-y-2">
              {existingMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <span className="font-semibold">Sent: </span>
                    {msg}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="mt-3 flex gap-2">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Hi, is this still available around LASUED/Epe?"
              className="flex-1 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0066FF] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#0066FF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0052CC]"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

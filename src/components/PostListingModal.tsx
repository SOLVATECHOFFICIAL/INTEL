import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  AnyListing,
  CampusZone,
  UserAccount,
} from '../types/campus';

interface PostListingModalProps {
  isOpen: boolean;
  currentUser: UserAccount | null;
  onClose: () => void;
  onCreateListing: (listing: AnyListing) => void;
}

const CAMPUS_ZONES: CampusZone[] = [
  'LASUED Epe',
  'LASU Epe',
  'Noforija',
  'Odomola',
  'Epe Town',
];

export const PostListingModal: React.FC<PostListingModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onCreateListing,
}) => {
  const [kind, setKind] = useState<
    'marketplace' | 'services' | 'accommodation' | 'roommates'
  >('marketplace');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [campus, setCampus] = useState<CampusZone>('LASUED Epe');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericPrice = Number(price) || 5000;
    const authorName = currentUser?.fullName || 'Campus Student';
    const id = `custom-${Date.now()}`;

    if (kind === 'marketplace') {
      onCreateListing({
        id,
        kind: 'marketplace',
        title: title.trim() || 'Campus Item Listing',
        price: numericPrice,
        category: 'Dorm Essentials',
        condition: 'Neatly Used',
        campus,
        sellerName: authorName,
        sellerDept: currentUser?.department || 'Student',
        verified: true,
        postedAt: 'Just now',
        description:
          description.trim() ||
          'Available for campus pickup around LASUED / LASU Epe.',
        imageBg: 'from-blue-50 to-sky-100',
        emoji: '🛍️',
      });
    } else if (kind === 'services') {
      onCreateListing({
        id,
        kind: 'services',
        title: title.trim() || 'Student Campus Service',
        startingPrice: numericPrice,
        priceUnit: 'from',
        category: 'Tutoring',
        campus,
        providerName: authorName,
        rating: 5.0,
        reviewsCount: 1,
        verified: true,
        turnaround: 'Flexible campus schedule',
        description:
          description.trim() || 'Reliable student service around Epe campus.',
      });
    } else if (kind === 'accommodation') {
      onCreateListing({
        id,
        kind: 'accommodation',
        title: title.trim() || 'Student Off-Campus Lodge',
        annualRent: numericPrice,
        lodgeType: 'Self-Contain',
        campus,
        distanceToGate: '5 mins to Campus Gate',
        amenities: ['Water Supply', 'Fenced Compound', 'Prepaid Meter'],
        availableRooms: 2,
        caretakerName: authorName,
        verified: true,
        description:
          description.trim() ||
          'Clean student lodge available for immediate inspection.',
      });
    } else {
      onCreateListing({
        id,
        kind: 'roommates',
        name: authorName,
        school: currentUser?.school === 'LASU' ? 'LASU' : 'LASUED',
        department: currentUser?.department || 'Student',
        level: '200 Level',
        gender: 'Female',
        preferredArea: campus,
        budgetPerYear: numericPrice,
        roomStatus: 'Looking Together',
        habits: ['Tidy', 'Studious', 'Respects privacy'],
        bio:
          description.trim() ||
          title.trim() ||
          'Looking for a compatible student roommate around Epe.',
        verified: true,
      });
    }

    setTitle('');
    setPrice('');
    setDescription('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-listing-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="post-listing-title"
            className="text-xl font-bold text-slate-900"
          >
            Post on LASUEDPLUG
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close post listing modal"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Section
            </label>
            <select
              value={kind}
              onChange={(e) =>
                setKind(
                  e.target.value as
                    | 'marketplace'
                    | 'services'
                    | 'accommodation'
                    | 'roommates'
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
            >
              <option value="marketplace">Marketplace (Sell an Item)</option>
              <option value="services">Services (Offer a Skill)</option>
              <option value="accommodation">
                Accommodation (List a Lodge)
              </option>
              <option value="roommates">Roommates (Find a Roommate)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              {kind === 'roommates' ? 'Headline' : 'Listing Title'}
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === 'marketplace'
                  ? 'e.g. HP Laptop Charger / EDU 201 Textbook'
                  : kind === 'services'
                    ? 'e.g. Neat Braids & Campus Hair Styling'
                    : kind === 'accommodation'
                      ? 'e.g. Cozy Self-Contain near Noforija'
                      : 'e.g. Looking for a clean female roommate at Noforija'
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {kind === 'accommodation' || kind === 'roommates'
                  ? 'Annual Amount (₦)'
                  : 'Price (₦)'}
              </label>
              <input
                type="number"
                min="0"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="15000"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Campus / Area
              </label>
              <select
                value={campus}
                onChange={(e) => setCampus(e.target.value as CampusZone)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
              >
                {CAMPUS_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Description
            </label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Include pickup spot, condition, or key preferences..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#0066FF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0052CC]"
            >
              Publish Listing
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

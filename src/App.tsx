import React, { useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { CategoryGrid } from './components/CategoryGrid';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { ListingCard } from './components/ListingCard';
import { ListingModal } from './components/ListingModal';
import { Navbar } from './components/Navbar';
import { PostListingModal } from './components/PostListingModal';
import {
  INITIAL_ACCOMMODATIONS,
  INITIAL_MARKETPLACE_ITEMS,
  INITIAL_ROOMMATES,
  INITIAL_SERVICES,
} from './data/campusListings';
import {
  AccommodationLodge,
  AnyListing,
  CampusSection,
  CampusService,
  CampusZone,
  MarketplaceItem,
  RoommateProfile,
  UserAccount,
} from './types/campus';

const CAMPUS_FILTERS: ('All' | CampusZone)[] = [
  'All',
  'LASUED Epe',
  'LASU Epe',
  'Noforija',
  'Odomola',
  'Epe Town',
];

export function App() {
  const [activeSection, setActiveSection] = useState<CampusSection>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [campusFilter, setCampusFilter] = useState<'All' | CampusZone>('All');

  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>(
    INITIAL_MARKETPLACE_ITEMS
  );
  const [services, setServices] = useState<CampusService[]>(INITIAL_SERVICES);
  const [accommodations, setAccommodations] = useState<AccommodationLodge[]>(
    INITIAL_ACCOMMODATIONS
  );
  const [roommates, setRoommates] =
    useState<RoommateProfile[]>(INITIAL_ROOMMATES);

  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [selectedListing, setSelectedListing] = useState<AnyListing | null>(
    null
  );
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);

  const toggleSave = (id: string) => {
    setSavedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectSection = (section: CampusSection) => {
    setActiveSection(section);
    setSubmittedSearch('');
    setCampusFilter('All');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSubmittedSearch('');
  };

  const handleOpenPostModal = () => {
    if (!currentUser) {
      setAuthMode('login');
      return;
    }
    setIsPostModalOpen(true);
  };

  const handleCreateListing = (newListing: AnyListing) => {
    if (newListing.kind === 'marketplace') {
      setMarketplaceItems((prev) => [newListing, ...prev]);
      setActiveSection('marketplace');
    } else if (newListing.kind === 'services') {
      setServices((prev) => [newListing, ...prev]);
      setActiveSection('services');
    } else if (newListing.kind === 'accommodation') {
      setAccommodations((prev) => [newListing, ...prev]);
      setActiveSection('accommodation');
    } else {
      setRoommates((prev) => [newListing, ...prev]);
      setActiveSection('roommates');
    }
  };

  const allListings: AnyListing[] = useMemo(
    () => [...marketplaceItems, ...services, ...accommodations, ...roommates],
    [marketplaceItems, services, accommodations, roommates]
  );

  const activeQuery = (submittedSearch || searchQuery).trim().toLowerCase();

  const matchesQueryAndCampus = (listing: AnyListing): boolean => {
    const zone =
      listing.kind === 'roommates' ? listing.preferredArea : listing.campus;
    if (campusFilter !== 'All' && zone !== campusFilter) {
      return false;
    }

    if (!activeQuery) return true;

    const searchableText =
      listing.kind === 'marketplace'
        ? `${listing.title} ${listing.category} ${listing.description} ${listing.campus} ${listing.sellerName}`
        : listing.kind === 'services'
          ? `${listing.title} ${listing.category} ${listing.description} ${listing.campus} ${listing.providerName}`
          : listing.kind === 'accommodation'
            ? `${listing.title} ${listing.lodgeType} ${listing.description} ${listing.campus} ${listing.amenities.join(' ')}`
            : `${listing.name} ${listing.school} ${listing.department} ${listing.preferredArea} ${listing.bio} ${listing.habits.join(' ')}`;

    return searchableText.toLowerCase().includes(activeQuery);
  };

  const filteredMarketplace = marketplaceItems.filter(matchesQueryAndCampus);
  const filteredServices = services.filter(matchesQueryAndCampus);
  const filteredAccommodations = accommodations.filter(matchesQueryAndCampus);
  const filteredRoommates = roommates.filter(matchesQueryAndCampus);
  const searchResults = allListings.filter(matchesQueryAndCampus);

  const isSearching = activeSection === 'home' && activeQuery.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Navbar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onOpenAuth={(mode) => setAuthMode(mode)}
        onOpenPostModal={handleOpenPostModal}
        currentUser={currentUser}
        onLogout={() => setCurrentUser(null)}
      />

      <main className="flex-1">
        {activeSection === 'home' && (
          <>
            <HeroSection
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchSubmit={handleSearchSubmit}
              onClearSearch={handleClearSearch}
            />

            {isSearching ? (
              <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      Search Results for &ldquo;{searchQuery.trim()}&rdquo;
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Found {searchResults.length} matching{' '}
                      {searchResults.length === 1 ? 'listing' : 'listings'}{' '}
                      across LASUED &amp; Epe.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear search
                  </button>
                </div>

                {searchResults.length === 0 ? (
                  <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-10 text-center">
                    <p className="text-base font-semibold text-slate-800">
                      No matching campus listings found
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Try searching for textbooks, laptops, Noforija, laundry,
                      or self-contain.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {searchResults.map((item) => (
                      <ListingCard
                        key={item.id}
                        listing={item}
                        isSaved={savedIds.includes(item.id)}
                        onToggleSave={toggleSave}
                        onSelect={setSelectedListing}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                <CategoryGrid onSelectCategory={handleSelectSection} />

                {/* Fresh in the Marketplace */}
                <section className="mx-auto max-w-6xl px-4 pt-10 pb-6 sm:px-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                        Fresh in the Marketplace
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Recent textbooks, gadgets, and dorm essentials posted by
                        students.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectSection('marketplace')}
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0066FF] hover:text-[#0052CC]"
                    >
                      View in Marketplace
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {marketplaceItems.slice(0, 3).map((item) => (
                      <ListingCard
                        key={item.id}
                        listing={item}
                        isSaved={savedIds.includes(item.id)}
                        onToggleSave={toggleSave}
                        onSelect={setSelectedListing}
                      />
                    ))}
                  </div>
                </section>

                {/* Popular Campus Services */}
                <section className="mx-auto max-w-6xl px-4 pt-10 pb-6 sm:px-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                        Popular Campus Services
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Trusted student-run services around LASUED, LASU, and
                        Epe.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectSection('services')}
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0066FF] hover:text-[#0052CC]"
                    >
                      View all services
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {services.slice(0, 3).map((srv) => (
                      <ListingCard
                        key={srv.id}
                        listing={srv}
                        isSaved={savedIds.includes(srv.id)}
                        onToggleSave={toggleSave}
                        onSelect={setSelectedListing}
                      />
                    ))}
                  </div>
                </section>

                {/* Off-Campus Lodges & Roommates Preview */}
                <section className="mx-auto max-w-6xl px-4 pt-10 pb-6 sm:px-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                        Verified Off-Campus Lodges
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Inspect hostels and self-contained apartments around
                        Noforija, Odomola, and Epe.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectSection('accommodation')}
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0066FF] hover:text-[#0052CC]"
                    >
                      Explore lodges
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {accommodations.slice(0, 2).map((lodge) => (
                      <ListingCard
                        key={lodge.id}
                        listing={lodge}
                        isSaved={savedIds.includes(lodge.id)}
                        onToggleSave={toggleSave}
                        onSelect={setSelectedListing}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {activeSection !== 'home' && (
          <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
              <div>
                <button
                  type="button"
                  onClick={() => handleSelectSection('home')}
                  className="text-xs font-semibold text-[#0066FF] hover:underline"
                >
                  &larr; Back to Home
                </button>
                <h1 className="mt-2 text-3xl font-extrabold capitalize tracking-tight text-slate-900">
                  {activeSection}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {activeSection === 'marketplace' &&
                    'Buy and sell textbooks, electronics, and dorm essentials with fellow students.'}
                  {activeSection === 'services' &&
                    'Book tutoring, device repairs, laundry, catering, and styling around campus.'}
                  {activeSection === 'accommodation' &&
                    'Browse verified hostels and off-campus apartments in Noforija, Odomola, and Epe.'}
                  {activeSection === 'roommates' &&
                    'Match with compatible LASUED and LASU students looking to share rent.'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleOpenPostModal}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0066FF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0052CC]"
              >
                <Plus className="h-4 w-4" />
                Post in {activeSection}
              </button>
            </div>

            {/* Campus Filter Bar */}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {CAMPUS_FILTERS.map((zone) => (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setCampusFilter(zone)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                      campusFilter === zone
                        ? 'bg-[#0066FF] text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {zone}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Filter ${activeSection}...`}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0066FF] focus:outline-none sm:w-64"
              />
            </div>

            {/* Listings Grid */}
            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {activeSection === 'marketplace' &&
                filteredMarketplace.map((item) => (
                  <ListingCard
                    key={item.id}
                    listing={item}
                    isSaved={savedIds.includes(item.id)}
                    onToggleSave={toggleSave}
                    onSelect={setSelectedListing}
                  />
                ))}
              {activeSection === 'services' &&
                filteredServices.map((srv) => (
                  <ListingCard
                    key={srv.id}
                    listing={srv}
                    isSaved={savedIds.includes(srv.id)}
                    onToggleSave={toggleSave}
                    onSelect={setSelectedListing}
                  />
                ))}
              {activeSection === 'accommodation' &&
                filteredAccommodations.map((lodge) => (
                  <ListingCard
                    key={lodge.id}
                    listing={lodge}
                    isSaved={savedIds.includes(lodge.id)}
                    onToggleSave={toggleSave}
                    onSelect={setSelectedListing}
                  />
                ))}
              {activeSection === 'roommates' &&
                filteredRoommates.map((mate) => (
                  <ListingCard
                    key={mate.id}
                    listing={mate}
                    isSaved={savedIds.includes(mate.id)}
                    onToggleSave={toggleSave}
                    onSelect={setSelectedListing}
                  />
                ))}
            </div>

            {((activeSection === 'marketplace' &&
              filteredMarketplace.length === 0) ||
              (activeSection === 'services' && filteredServices.length === 0) ||
              (activeSection === 'accommodation' &&
                filteredAccommodations.length === 0) ||
              (activeSection === 'roommates' &&
                filteredRoommates.length === 0)) && (
              <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-10 text-center">
                <p className="text-base font-semibold text-slate-800">
                  No listings match your current filters
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Try switching campus area to All or clearing your filter text.
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      <Footer onSelectSection={handleSelectSection} />

      <ListingModal
        listing={selectedListing}
        isSaved={selectedListing ? savedIds.includes(selectedListing.id) : false}
        onToggleSave={toggleSave}
        onClose={() => setSelectedListing(null)}
      />

      <AuthModal
        mode={authMode}
        onSwitchMode={setAuthMode}
        onClose={() => setAuthMode(null)}
        onAuthenticate={setCurrentUser}
      />

      <PostListingModal
        isOpen={isPostModalOpen}
        currentUser={currentUser}
        onClose={() => setIsPostModalOpen(false)}
        onCreateListing={handleCreateListing}
      />
    </div>
  );
}

export default App;

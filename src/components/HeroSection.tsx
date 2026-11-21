import React from 'react';
import { Search, X } from 'lucide-react';

interface HeroSectionProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onClearSearch: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
}) => {
  return (
    <section className="border-b border-slate-200/80 bg-gradient-to-b from-[#F4F7FC] to-[#F8FAFD] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Discover Your Campus Marketplace
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          Your campus marketplace for products, services &amp; accommodation —
          built for LASUED students, LASU students, and the Epe community.
        </p>

        {/* Search Bar */}
        <form
          onSubmit={onSearchSubmit}
          className="mx-auto mt-9 flex max-w-2xl items-center rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition-shadow focus-within:border-[#0066FF] focus-within:ring-2 focus-within:ring-blue-500/15"
        >
          <Search
            className="ml-3 h-5 w-5 shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search products, services, or off-campus lodges..."
            aria-label="Search products, services, or off-campus lodges"
            className="w-full bg-transparent px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-[15px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={onClearSearch}
              aria-label="Clear search"
              className="mr-1.5 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-[#0066FF] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0052CC]"
          >
            Search
          </button>
        </form>
      </div>
    </section>
  );
};

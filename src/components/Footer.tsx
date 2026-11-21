import React from 'react';
import { CampusSection } from '../types/campus';

interface FooterProps {
  onSelectSection: (section: CampusSection) => void;
}

export const Footer: React.FC<FooterProps> = ({ onSelectSection }) => {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50/70">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
        <div>
          <span className="text-sm font-extrabold tracking-tight text-slate-900">
            LASUEDPLUG
          </span>
          <p className="mt-1 text-xs text-slate-500">
            Built for LASUED students, LASU students, and the Epe community.
          </p>
        </div>

        <div className="flex flex-wrap gap-6 text-xs font-medium text-slate-600">
          <button
            type="button"
            onClick={() => onSelectSection('marketplace')}
            className="hover:text-[#0066FF]"
          >
            Marketplace
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('services')}
            className="hover:text-[#0066FF]"
          >
            Services
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('accommodation')}
            className="hover:text-[#0066FF]"
          >
            Accommodation
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('roommates')}
            className="hover:text-[#0066FF]"
          >
            Roommates
          </button>
        </div>
      </div>
    </footer>
  );
};

import React from 'react';
import { BRAND } from '../config/brand';
import { PLATFORM_SECTIONS } from '../config/sections';
import { ActiveRoute } from '../types/platform';
import { BrandLogo } from './BrandLogo';

interface FooterProps {
  onNavigate: (route: ActiveRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50 pb-20 md:pb-0">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div className="max-w-sm">
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className="text-left focus-visible:outline-[#1E88E5]"
            >
              <BrandLogo size="sm" showWordmark />
            </button>
            <p className="mt-3 text-sm font-medium text-[#0B1A2E]">
              {BRAND.tagline}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Foundation architecture for the LASUED Intel student platform.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-4">
            {PLATFORM_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onNavigate(section.id)}
                className="min-h-[36px] text-left text-xs font-medium text-slate-600 transition-colors hover:text-[#1E88E5]"
              >
                {section.title}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-5 text-xs text-slate-500">
          <p>
            {BRAND.name} · Foundation Phase
          </p>
        </div>
      </div>
    </footer>
  );
};

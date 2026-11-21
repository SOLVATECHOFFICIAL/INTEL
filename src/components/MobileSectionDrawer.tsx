import React from 'react';
import { ChevronRight, LayoutGrid, X } from 'lucide-react';
import { PLATFORM_SECTIONS } from '../config/sections';
import { ActiveRoute } from '../types/platform';
import { SectionIcon } from './SectionIcon';

interface MobileSectionDrawerProps {
  isOpen: boolean;
  activeRoute: ActiveRoute;
  onSelectRoute: (route: ActiveRoute) => void;
  onClose: () => void;
}

export const MobileSectionDrawer: React.FC<MobileSectionDrawerProps> = ({
  isOpen,
  activeRoute,
  onSelectRoute,
  onClose,
}) => {
  if (!isOpen) return null;

  const handlePick = (route: ActiveRoute) => {
    onSelectRoute(route);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-[#0B1A2E]/50 backdrop-blur-xs md:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-sections-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white px-4 pt-3 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300"
        />

        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2
              id="mobile-sections-title"
              className="font-display text-lg font-bold text-[#0B1A2E]"
            >
              LASUED Intel Sections
            </h2>
            <p className="text-xs text-slate-500">
              Select a campus section to view its foundation state
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sections menu"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 space-y-1">
          <button
            type="button"
            onClick={() => handlePick('overview')}
            className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold ${
              activeRoute === 'overview'
                ? 'bg-[#0B1A2E] text-white'
                : 'text-[#0B1A2E] hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-3">
              <LayoutGrid className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Platform Overview (All 8)
            </span>
            <ChevronRight className="h-4 w-4 opacity-60" aria-hidden="true" />
          </button>

          {PLATFORM_SECTIONS.map((section) => {
            const isActive = activeRoute === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => handlePick(section.id)}
                className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left ${
                  isActive
                    ? 'bg-[#1E88E5]/10 text-[#1E88E5]'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-3">
                  <SectionIcon
                    sectionId={section.id}
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-[#1E88E5]' : 'text-slate-400'
                    }`}
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {section.title}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {section.group}
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

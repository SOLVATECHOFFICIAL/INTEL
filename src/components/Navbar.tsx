import React, { useState } from 'react';
import { LogOut, Menu, Plus, User as UserIcon, X } from 'lucide-react';
import { CampusSection, UserAccount } from '../types/campus';

interface NavbarProps {
  activeSection: CampusSection;
  onSelectSection: (section: CampusSection) => void;
  onOpenAuth: (mode: 'login' | 'signup') => void;
  onOpenPostModal: () => void;
  currentUser: UserAccount | null;
  onLogout: () => void;
}

const NAV_ITEMS: { id: CampusSection; label: string }[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'services', label: 'Services' },
  { id: 'accommodation', label: 'Accommodation' },
  { id: 'roommates', label: 'Roommates' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeSection,
  onSelectSection,
  onOpenAuth,
  onOpenPostModal,
  currentUser,
  onLogout,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (section: CampusSection) => {
    onSelectSection(section);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand Logo */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="flex items-center gap-2.5 text-left focus:outline-none"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#0F2A5F] to-[#0066FF] text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2v5" />
              <path d="M8 7h8v3a4 4 0 0 1-8 0V7Z" />
              <path d="M12 14v8" />
              <path d="M9 19h6" />
            </svg>
          </span>
          <span className="text-[15px] font-extrabold tracking-tight text-slate-900">
            LASUEDPLUG
          </span>
        </button>

        {/* Center Navigation */}
        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[#0066FF]'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="hidden items-center gap-2.5 md:flex">
          {currentUser ? (
            <>
              <button
                type="button"
                onClick={onOpenPostModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0066FF] px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#0052CC]"
              >
                <Plus className="h-4 w-4" />
                Post Listing
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <UserIcon className="h-4 w-4 text-slate-500" />
                <span className="max-w-[120px] truncate text-sm font-medium text-slate-700">
                  {currentUser.fullName.split(' ')[0]}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  title="Log out"
                  className="ml-1 rounded p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => onOpenAuth('signup')}
                className="rounded-lg bg-[#0066FF] px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#0052CC]"
              >
                Signup
              </button>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 md:hidden"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Dropdown */}
      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`rounded-lg px-3 py-2 text-left text-sm font-medium ${
                  activeSection === item.id
                    ? 'bg-blue-50 text-[#0066FF]'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onOpenPostModal();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0066FF] px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  Post Listing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setMobileOpen(false);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onOpenAuth('login');
                  }}
                  className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onOpenAuth('signup');
                  }}
                  className="flex-1 rounded-lg bg-[#0066FF] px-4 py-2 text-sm font-semibold text-white"
                >
                  Signup
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

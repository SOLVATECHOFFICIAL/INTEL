import React, { useEffect } from 'react';
import {
  Bell,
  Bookmark,
  ChevronRight,
  ExternalLink,
  Flame,
  Lock,
  LogIn,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { PLATFORM_SECTIONS } from '../config/sections';
import { useFirebase } from '../context/firebaseContext';
import { signOutCurrentUser } from '../services/auth';
import {
  ActiveRoute,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
} from '../types/platform';
import {
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
} from '../utils/authValidation';
import { getSearchScopeFromRoute } from '../utils/urlRouting';
import { SectionIcon } from './SectionIcon';

interface MobileSectionDrawerProps {
  isOpen: boolean;
  activeRoute: ActiveRoute;
  marketplaceTab?: MarketplaceTab;
  onSelectRoute: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
      marketplaceTab?: MarketplaceTab;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onClose: () => void;
}

export const MobileSectionDrawer: React.FC<MobileSectionDrawerProps> = ({
  isOpen,
  activeRoute,
  marketplaceTab = 'browse',
  onSelectRoute,
  onRequireAuth,
  onClose,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentSearchScope = getSearchScopeFromRoute(activeRoute);

  const handlePick = (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
      marketplaceTab?: MarketplaceTab;
    }
  ) => {
    onSelectRoute(route, options);
    onClose();
  };

  const handleAuth = (authRoute: 'login' | 'register') => {
    onRequireAuth(authRoute, activeRoute);
    onClose();
  };

  const handleSignOut = async () => {
    await signOutCurrentUser();
    onSelectRoute('for-you');
    onClose();
  };

  const showAdminLink = canAccessAdminDashboard(effectiveTier, isSuspended);
  const isFullAdmin = canAccessFullAdminDashboard(effectiveTier, isSuspended);

  return (
    <div
      id="mobile-navigation-drawer"
      className="fixed inset-0 z-50 flex items-end bg-[#0B1A2E]/50 backdrop-blur-xs lg:hidden"
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
              LASUED Intel Menu
            </h2>
            <p className="text-xs text-slate-500">
              {user
                ? profile?.fullName || user.email || 'Signed in'
                : 'Browsing as guest'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Account / Auth Actions */}
        <div className="mt-3 space-y-1.5 border-b border-slate-100 pb-3">
          {user ? (
            <>
              <button
                type="button"
                onClick={() =>
                  handlePick(
                    'profile',
                    profile?.username ? { username: profile.username } : undefined
                  )
                }
                className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
              >
                <span className="flex items-center gap-3">
                  <ExternalLink
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile?.username
                    ? `My Profile (@${profile.username})`
                    : 'My Profile'}
                </span>
                <ChevronRight
                  className="h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
              </button>

              {profile?.username && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      handlePick('profile', {
                        username: profile.username,
                        profileTab: 'saved',
                      })
                    }
                    className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-3">
                      <Bookmark
                        className="h-4 w-4 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      Saved Content
                    </span>
                    <ChevronRight
                      className="h-4 w-4 text-slate-400"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handlePick('profile', {
                        username: profile.username,
                        profileTab: 'anonymous',
                      })
                    }
                    className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-3">
                      <Lock
                        className="h-4 w-4 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      My Anonymous Posts
                    </span>
                    <ChevronRight
                      className="h-4 w-4 text-slate-400"
                      aria-hidden="true"
                    />
                  </button>
                </>
              )}

              {showAdminLink && (
                <button
                  type="button"
                  onClick={() => handlePick('admin')}
                  className="flex min-h-[48px] w-full items-center justify-between rounded-xl bg-[#0B1A2E] px-3.5 py-2.5 text-left text-sm font-semibold text-white"
                >
                  <span className="flex items-center gap-3">
                    <ShieldCheck className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                    {isFullAdmin ? 'Administrator Dashboard' : 'Moderation Console'}
                  </span>
                  <ChevronRight className="h-4 w-4 opacity-70" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAuth('login')}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0B1A2E]"
              >
                <LogIn className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                Sign In
              </button>
              <button
                type="button"
                onClick={() => handleAuth('register')}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#1E88E5] px-3 text-sm font-semibold text-white"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Register
              </button>
            </div>
          )}
        </div>

        {/* Discovery & Secondary Sections */}
        <div className="mt-3 space-y-1">
          <button
            type="button"
            onClick={() =>
              handlePick('search', { searchScope: currentSearchScope })
            }
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Search and Discovery
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => handlePick('notifications')}
            className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium ${
              activeRoute === 'notifications'
                ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-3">
              <Bell
                className={`h-4 w-4 ${
                  activeRoute === 'notifications' ? 'text-[#1E88E5]' : 'text-slate-500'
                }`}
                aria-hidden="true"
              />
              Notifications
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => handlePick('account')}
            className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium ${
              activeRoute === 'account'
                ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-3">
              <Settings
                className={`h-4 w-4 ${
                  activeRoute === 'account' ? 'text-[#1E88E5]' : 'text-slate-500'
                }`}
                aria-hidden="true"
              />
              Settings
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() =>
              handlePick('marketplace', { marketplaceTab: 'updates' })
            }
            className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left ${
              activeRoute === 'marketplace' && marketplaceTab === 'updates'
                ? 'bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-3">
              <Flame
                className={`h-4 w-4 shrink-0 ${
                  activeRoute === 'marketplace' && marketplaceTab === 'updates'
                    ? 'text-[#1E88E5]'
                    : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-semibold">
                  Marketplace Updates
                </span>
                <span className="block text-xs text-slate-500">
                  Vendor notices and restocks
                </span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          {PLATFORM_SECTIONS.map((section) => {
            const isActive =
              activeRoute === section.id &&
              !(
                section.id === 'marketplace' && marketplaceTab === 'updates'
              );
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

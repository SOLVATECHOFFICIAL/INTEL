import React from 'react';
import { Bell, Menu, Search, User as UserIcon } from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { ActiveRoute, SearchScopeId } from '../types/platform';
import { getSearchScopeFromRoute, isFeedRoute } from '../utils/urlRouting';
import { BrandLogo } from './BrandLogo';

interface HeaderProps {
  activeRoute: ActiveRoute;
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string; searchScope?: SearchScopeId }
  ) => void;
  onOpenMobileDrawer: () => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const DESKTOP_NAV_LINKS: { id: ActiveRoute; label: string }[] = [
  { id: 'for-you', label: 'Home' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'anonymous', label: 'Anonymous' },
  { id: 'trusted-circle', label: 'Trusted Circle' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'upcoming-events', label: 'Events' },
];

export const Header: React.FC<HeaderProps> = ({
  activeRoute,
  onNavigate,
  onOpenMobileDrawer,
  onRequireAuth,
}) => {
  const { user, profile, unreadNotificationsCount } = useFirebase();
  const currentSearchScope = getSearchScopeFromRoute(activeRoute);

  const isNavItemActive = (itemRoute: ActiveRoute) => {
    if (itemRoute === 'for-you') {
      return isFeedRoute(activeRoute);
    }
    return activeRoute === itemRoute;
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 md:h-16 md:gap-6">
        {/* Left: Brand Logo + Desktop Search Trigger */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('for-you')}
            aria-label="LASUED Intel home"
            className="inline-flex min-h-[44px] items-center rounded-lg focus-visible:outline-[#1E88E5]"
          >
            <BrandLogo size="sm" showWordmark />
          </button>

          <button
            type="button"
            onClick={() =>
              onNavigate('search', { searchScope: currentSearchScope })
            }
            aria-label="Search LASUED Intel"
            className={`hidden min-h-[40px] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors lg:inline-flex ${
              activeRoute === 'search'
                ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-[#0B1A2E]'
            }`}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Search</span>
          </button>
        </div>

        {/* Center: Desktop Main Navigation (never forces mobile bottom bar) */}
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-4 md:flex lg:gap-5"
        >
          {DESKTOP_NAV_LINKS.map((item) => {
            const isActive = isNavItemActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  isActive
                    ? 'font-semibold text-[#1E88E5]'
                    : 'text-slate-600 hover:text-[#0B1A2E]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-[#1E88E5]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Notifications & Account Controls (Desktop) + Mobile Quick Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Desktop Search fallback on md tablets */}
          <button
            type="button"
            onClick={() =>
              onNavigate('search', { searchScope: currentSearchScope })
            }
            aria-label="Search"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] lg:hidden"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Desktop Notifications */}
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            aria-label={
              unreadNotificationsCount > 0
                ? `Notifications (${unreadNotificationsCount} unread)`
                : 'Notifications'
            }
            className={`relative hidden min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border transition-colors md:inline-flex ${
              activeRoute === 'notifications'
                ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5]'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E]'
            }`}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {user && unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#1E88E5] px-1 text-[10px] font-bold text-white tabular-nums">
                {unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Account Controls */}
          {user ? (
            <button
              type="button"
              onClick={() => onNavigate('account')}
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors sm:text-sm ${
                activeRoute === 'account'
                  ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                  : 'border-slate-200 bg-white text-[#0B1A2E] hover:bg-slate-50'
              }`}
            >
              <UserIcon className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              <span className="max-w-[110px] truncate">
                {profile?.fullName?.split(' ')[0] || 'Account'}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRequireAuth('login', activeRoute)}
                className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap transition-colors hover:bg-slate-50 sm:text-sm"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onRequireAuth('register', activeRoute)}
                className="hidden min-h-[42px] items-center rounded-lg bg-[#1E88E5] px-3.5 py-1.5 text-sm font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#1565C0] sm:inline-flex"
              >
                Register
              </button>
            </div>
          )}

          {/* Mobile secondary drawer button */}
          <button
            type="button"
            onClick={onOpenMobileDrawer}
            aria-label="Open menu"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 text-[#0B1A2E] hover:bg-slate-50 md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};

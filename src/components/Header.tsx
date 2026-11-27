import React from 'react';
import { Bell, Menu } from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { ActiveRoute, ProfileTab, SearchScopeId } from '../types/platform';
import { formatUnreadBadgeCount } from '../utils/pwa';
import { buildSearchForRoute, isFeedRoute } from '../utils/urlRouting';
import { BrandLogo } from './BrandLogo';
import { AvatarMedia } from './media/FirestoreImage';
import { ThemeToggle } from './shared/ThemeToggle';

interface HeaderProps {
  activeRoute: ActiveRoute;
  isMobileDrawerOpen?: boolean;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
    }
  ) => void;
  onOpenMobileDrawer: () => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

const DESKTOP_NAV_LINKS: { id: ActiveRoute; label: string }[] = [
  { id: 'for-you', label: 'Home' },
  { id: 'updates', label: 'Updates' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'anonymous', label: 'Anonymous' },
  { id: 'trusted-circle', label: 'Trusted Circle' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'upcoming-events', label: 'Events' },
];

export const Header: React.FC<HeaderProps> = ({
  activeRoute,
  isMobileDrawerOpen = false,
  onNavigate,
  onOpenMobileDrawer,
  onRequireAuth,
}) => {
  const { user, profile, unreadNotificationsCount } = useFirebase();
  const unreadBadgeLabel = formatUnreadBadgeCount(unreadNotificationsCount);

  const isNavItemActive = (itemRoute: ActiveRoute) => {
    if (itemRoute === 'for-you') {
      return isFeedRoute(activeRoute);
    }
    return activeRoute === itemRoute;
  };

  const handleNavAnchorClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    route: ActiveRoute
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigate(route);
  };

  return (
    <header className="fixed top-0 right-0 left-0 z-40 w-full max-w-full border-b border-slate-200/90 bg-white/95 shadow-[0_2px_14px_-6px_rgba(11,26,46,0.08)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 dark:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.55)]">
      <div aria-hidden="true" className="h-[env(safe-area-inset-top)] w-full bg-[#0B1A2E] dark:bg-slate-950" />
      <div aria-hidden="true" className="lasued-action-gradient h-[2px] w-full" />
      <div className="mx-auto flex h-14 max-w-7xl min-w-0 items-center justify-between gap-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3 sm:px-5 md:h-16 md:gap-5">
        {/* Left: Brand Logo */}
        <div className="flex min-w-0 flex-1 items-center lg:flex-initial">
          <a
            href={buildSearchForRoute('for-you')}
            onClick={(e) => handleNavAnchorClick(e, 'for-you')}
            aria-label="LASUED Intel home"
            className="inline-flex min-h-[44px] min-w-0 max-w-full items-center overflow-hidden rounded-lg focus-visible:outline-[#1E88E5]"
          >
            <BrandLogo size="sm" showWordmark />
          </a>
        </div>

        {/* Center: Desktop Main Navigation (only when >=1024px alongside sidebar) */}
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-3 lg:flex xl:gap-5"
        >
          {DESKTOP_NAV_LINKS.map((item) => {
            const isActive = isNavItemActive(item.id);
            return (
              <a
                key={item.id}
                href={buildSearchForRoute(item.id)}
                onClick={(e) => handleNavAnchorClick(e, item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  isActive
                    ? 'font-semibold text-[#1E88E5] dark:text-sky-400'
                    : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="lasued-action-gradient absolute right-0 bottom-0 left-0 h-0.5 rounded-full"
                  />
                )}
              </a>
            );
          })}
        </nav>

        {/* Right: Theme Toggle, Notifications & Account Controls + Mobile Drawer Toggle */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle compact />

          {/* Desktop Notifications */}
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            aria-label={
              user && unreadBadgeLabel
                ? `Notifications (${unreadBadgeLabel} unread)`
                : 'Notifications'
            }
            className={`relative hidden min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border transition-colors md:inline-flex ${
              activeRoute === 'notifications'
                ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#1E88E5] dark:bg-sky-500/20 dark:text-sky-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {user && unreadBadgeLabel && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#1E88E5] px-1 text-[10px] font-bold text-white tabular-nums">
                {unreadBadgeLabel}
              </span>
            )}
          </button>

          {/* Account Controls */}
          {user ? (
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  'profile',
                  profile?.username ? { username: profile.username } : undefined
                )
              }
              aria-label="Open my profile"
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-sm ${
                activeRoute === 'profile' || activeRoute === 'account'
                  ? 'lasued-accent-gradient border-transparent text-white shadow-xs'
                  : 'border-slate-200 bg-white text-[#0B1A2E] hover:bg-sky-50/70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <AvatarMedia
                fullName={profile?.fullName || user.displayName || 'Account'}
                photoImageId={profile?.photoImageId}
                photoUrl={profile?.photoUrl}
                sizeClass="h-6 w-6"
                roundedClass="rounded-full"
                textClass="text-[10px]"
              />
              <span className="max-w-[70px] truncate sm:max-w-[110px]">
                {profile?.fullName?.split(' ')[0] || 'Profile'}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => onRequireAuth('login', activeRoute)}
                className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:px-3 sm:text-sm"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onRequireAuth('register', activeRoute)}
                className="lasued-action-gradient hidden min-h-[40px] items-center rounded-xl px-3.5 py-1.5 text-sm font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110 sm:inline-flex"
              >
                Register
              </button>
            </div>
          )}

          {/* Mobile / tablet 3-line navigation drawer button */}
          <button
            type="button"
            onClick={onOpenMobileDrawer}
            aria-label="Open navigation menu"
            aria-expanded={isMobileDrawerOpen}
            aria-controls="mobile-navigation-drawer"
            className="inline-flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-[#0B1A2E] shadow-xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 lg:hidden"
          >
            <Menu className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};

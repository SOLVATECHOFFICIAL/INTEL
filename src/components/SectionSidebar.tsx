import React from 'react';
import {
  Bell,
  Bookmark,
  ExternalLink,
  Flame,
  Lock,
  Search,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
} from '../utils/authValidation';
import { getSectionsByGroup } from '../utils/sectionState';
import { formatUnreadBadgeCount } from '../utils/pwa';
import { getSearchScopeFromRoute } from '../utils/urlRouting';
import {
  ActiveRoute,
  MarketplaceTab,
  ProfileTab,
  SearchScopeId,
} from '../types/platform';
import { SectionIcon } from './SectionIcon';
import { PWAInstallControl } from './pwa/PWAInstallControl';

interface SectionSidebarProps {
  activeRoute: ActiveRoute;
  marketplaceTab?: MarketplaceTab;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
      marketplaceTab?: MarketplaceTab;
    }
  ) => void;
}

export const SectionSidebar: React.FC<SectionSidebarProps> = ({
  activeRoute,
  marketplaceTab = 'browse',
  onNavigate,
}) => {
  const { user, profile, effectiveTier, isSuspended, unreadNotificationsCount } =
    useFirebase();
  const unreadBadgeLabel = formatUnreadBadgeCount(unreadNotificationsCount);
  const feeds = getSectionsByGroup('Feeds');
  const hub = getSectionsByGroup('Campus Hub');
  const showAdmin = canAccessAdminDashboard(effectiveTier, isSuspended);
  const isFullAdmin = canAccessFullAdminDashboard(effectiveTier, isSuspended);
  const currentSearchScope = getSearchScopeFromRoute(activeRoute);

  return (
    <aside
      aria-label="Platform sections"
      className="hidden lg:block lg:w-64 lg:shrink-0"
    >
      <div className="sticky top-24 space-y-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">
            Feeds
          </p>
          <ul className="mt-2 space-y-1">
            {feeds.map((section) => {
              const isActive = activeRoute === section.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-gradient-to-r from-[#1E88E5]/15 via-sky-50 to-transparent font-semibold text-[#1565C0] ring-1 ring-[#1E88E5]/20'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                    }`}
                  >
                    <SectionIcon
                      sectionId={section.id}
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#1E88E5]' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{section.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">
            Campus Hub
          </p>
          <ul className="mt-2 space-y-1">
            {hub.map((section) => {
              const isActive =
                activeRoute === section.id &&
                !(
                  section.id === 'marketplace' && marketplaceTab === 'updates'
                );
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-gradient-to-r from-[#1E88E5]/15 via-sky-50 to-transparent font-semibold text-[#1565C0] ring-1 ring-[#1E88E5]/20'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                    }`}
                  >
                    <SectionIcon
                      sectionId={section.id}
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#1E88E5]' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{section.title}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() =>
                  onNavigate('marketplace', { marketplaceTab: 'updates' })
                }
                aria-current={
                  activeRoute === 'marketplace' && marketplaceTab === 'updates'
                    ? 'page'
                    : undefined
                }
                className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${
                  activeRoute === 'marketplace' && marketplaceTab === 'updates'
                    ? 'bg-gradient-to-r from-[#1E88E5]/15 via-sky-50 to-transparent font-semibold text-[#1565C0] ring-1 ring-[#1E88E5]/20'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                <Flame
                  className={`h-4 w-4 shrink-0 ${
                    activeRoute === 'marketplace' && marketplaceTab === 'updates'
                      ? 'text-[#1E88E5]'
                      : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">Marketplace Updates</span>
              </button>
            </li>
          </ul>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">
            Utilities
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              <button
                type="button"
                onClick={() =>
                  onNavigate('search', { searchScope: currentSearchScope })
                }
                aria-current={activeRoute === 'search' ? 'page' : undefined}
                className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                  activeRoute === 'search'
                    ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Search</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => onNavigate('notifications')}
                aria-current={activeRoute === 'notifications' ? 'page' : undefined}
                className={`flex min-h-[42px] w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                  activeRoute === 'notifications'
                    ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Bell className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Notifications</span>
                </span>
                {user && unreadBadgeLabel && (
                  <span className="text-xs font-bold text-[#1E88E5] tabular-nums">
                    {unreadBadgeLabel}
                  </span>
                )}
              </button>
            </li>
            {user && (
              <li>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      'profile',
                      profile?.username ? { username: profile.username } : undefined
                    )
                  }
                  aria-current={activeRoute === 'profile' ? 'page' : undefined}
                  className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                    activeRoute === 'profile'
                      ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                  }`}
                >
                  <ExternalLink
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                  <span>My Profile</span>
                </button>
              </li>
            )}
            {user && profile?.username && (
              <>
                <li>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('profile', {
                        username: profile.username,
                        profileTab: 'saved',
                      })
                    }
                    className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 hover:text-[#0B1A2E]"
                  >
                    <Bookmark
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    <span>Saved Posts</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('profile', {
                        username: profile.username,
                        profileTab: 'anonymous',
                      })
                    }
                    className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 hover:text-[#0B1A2E]"
                  >
                    <Lock
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    <span>My Anonymous Posts</span>
                  </button>
                </li>
              </>
            )}
            {user && (
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('account')}
                  aria-current={activeRoute === 'account' ? 'page' : undefined}
                  className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                    activeRoute === 'account'
                      ? 'bg-[#1E88E5]/10 font-semibold text-[#1E88E5]'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E]'
                  }`}
                >
                  <UserIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Account Settings</span>
                </button>
              </li>
            )}
            {showAdmin && (
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('admin')}
                  aria-current={activeRoute === 'admin' ? 'page' : undefined}
                  className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-all duration-150 ${
                    activeRoute === 'admin'
                      ? 'lasued-accent-gradient text-white shadow-xs'
                      : 'bg-gradient-to-r from-sky-50/80 to-slate-50 text-[#0B1A2E] ring-1 ring-slate-200/80 hover:from-sky-100/70 hover:to-blue-50/70'
                  }`}
                >
                  <ShieldCheck
                    className={`h-4 w-4 shrink-0 ${
                      activeRoute === 'admin' ? 'text-sky-200' : 'text-[#1E88E5]'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{isFullAdmin ? 'Admin Dashboard' : 'Moderation Console'}</span>
                </button>
              </li>
            )}
          </ul>
        </div>

        <PWAInstallControl variant="sidebar" />
      </div>
    </aside>
  );
};

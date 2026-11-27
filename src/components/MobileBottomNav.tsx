import React from 'react';
import {
  Bell,
  Home,
  MessageSquare,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { ActiveRoute } from '../types/platform';
import { formatUnreadBadgeCount } from '../utils/pwa';
import { isFeedRoute } from '../utils/urlRouting';

interface MobileBottomNavProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeRoute,
  onNavigate,
}) => {
  const { user, unreadNotificationsCount } = useFirebase();
  const unreadBadgeLabel = formatUnreadBadgeCount(unreadNotificationsCount);

  const homeActive = isFeedRoute(activeRoute);

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="fixed right-0 bottom-0 left-0 z-40 max-w-full border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_-6px_rgba(11,26,46,0.12)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 dark:shadow-[0_-4px_20px_-6px_rgba(0,0,0,0.6)] lg:hidden"
    >
      <div aria-hidden="true" className="lasued-action-gradient h-[2px] w-full" />
      <div className="grid h-16 min-w-0 grid-cols-5 items-center pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]">
        <button
          type="button"
          onClick={() => onNavigate('for-you')}
          aria-current={homeActive ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            homeActive
              ? 'bg-gradient-to-b from-sky-100/85 to-blue-50/60 font-semibold text-[#1565C0] dark:from-sky-500/20 dark:to-sky-500/5 dark:text-sky-300'
              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Home className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate">Home</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('marketplace')}
          aria-current={activeRoute === 'marketplace' ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'marketplace'
              ? 'bg-gradient-to-b from-sky-100/85 to-blue-50/60 font-semibold text-[#1565C0] dark:from-sky-500/20 dark:to-sky-500/5 dark:text-sky-300'
              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate">Market</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('anonymous')}
          aria-current={activeRoute === 'anonymous' ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'anonymous'
              ? 'bg-gradient-to-b from-sky-100/85 to-blue-50/60 font-semibold text-[#1565C0] dark:from-sky-500/20 dark:to-sky-500/5 dark:text-sky-300'
              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate">Anonymous</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('trusted-circle')}
          aria-current={activeRoute === 'trusted-circle' ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'trusted-circle'
              ? 'bg-gradient-to-b from-sky-100/85 to-blue-50/60 font-semibold text-[#1565C0] dark:from-sky-500/20 dark:to-sky-500/5 dark:text-sky-300'
              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate">Trusted</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('notifications')}
          aria-current={activeRoute === 'notifications' ? 'page' : undefined}
          aria-label={
            user && unreadBadgeLabel
              ? `Notifications (${unreadBadgeLabel} unread)`
              : 'Notifications'
          }
          className={`relative flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'notifications'
              ? 'bg-gradient-to-b from-sky-100/85 to-blue-50/60 font-semibold text-[#1565C0] dark:from-sky-500/20 dark:to-sky-500/5 dark:text-sky-300'
              : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <span className="relative inline-flex">
            <Bell className="h-5 w-5 shrink-0" aria-hidden="true" />
            {user && unreadBadgeLabel && (
              <span className="lasued-action-gradient absolute -top-1 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white tabular-nums">
                {unreadBadgeLabel}
              </span>
            )}
          </span>
          <span className="max-w-full truncate">Alerts</span>
        </button>
      </div>
    </nav>
  );
};

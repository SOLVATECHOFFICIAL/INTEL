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

  const homeActive = isFeedRoute(activeRoute);

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="fixed right-0 bottom-0 left-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden"
    >
      <div className="grid h-16 grid-cols-5 items-center">
        <button
          type="button"
          onClick={() => onNavigate('for-you')}
          aria-current={homeActive ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            homeActive
              ? 'font-semibold text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('marketplace')}
          aria-current={activeRoute === 'marketplace' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'marketplace'
              ? 'font-semibold text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          <span>Marketplace</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('anonymous')}
          aria-current={activeRoute === 'anonymous' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'anonymous'
              ? 'font-semibold text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
          <span>Anonymous</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('trusted-circle')}
          aria-current={activeRoute === 'trusted-circle' ? 'page' : undefined}
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'trusted-circle'
              ? 'font-semibold text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          <span>Trusted Circle</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('notifications')}
          aria-current={activeRoute === 'notifications' ? 'page' : undefined}
          aria-label={
            user && unreadNotificationsCount > 0
              ? `Notifications (${unreadNotificationsCount} unread)`
              : 'Notifications'
          }
          className={`relative flex min-h-[48px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium whitespace-nowrap transition-colors ${
            activeRoute === 'notifications'
              ? 'font-semibold text-[#1E88E5]'
              : 'text-slate-500 hover:text-[#0B1A2E]'
          }`}
        >
          <span className="relative inline-flex">
            <Bell className="h-5 w-5" aria-hidden="true" />
            {user && unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#1E88E5] px-1 text-[9px] font-bold text-white tabular-nums">
                {unreadNotificationsCount}
              </span>
            )}
          </span>
          <span>Notifications</span>
        </button>
      </div>
    </nav>
  );
};

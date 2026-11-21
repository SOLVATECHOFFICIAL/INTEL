import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { subscribeUserNotifications } from '../../services/firestoreFoundation';
import type { NotificationItem } from '../../types/database';
import { ActiveRoute } from '../../types/platform';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface NotificationsPageProps {
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({
  onRequireAuth,
}) => {
  const { authReady, user, unreadNotificationsCount, isSuspended } =
    useFirebase();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!user) {
      return;
    }

    const unsubscribe = subscribeUserNotifications(user.uid, (nextItems) => {
      setItems(nextItems);
      setStatus('ready');
    });

    return () => {
      unsubscribe();
    };
  }, [authReady, user]);

  if (!authReady) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div role="status" className="space-y-3">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section
        aria-labelledby="notifications-heading"
        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <h1
          id="notifications-heading"
          className="font-display text-2xl font-bold text-[#0B1A2E]"
        >
          Notifications
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Personal notifications are private to your account.
        </p>
        <div className="mt-5">
          <GuestPromptCard
            title="Sign in to view your notifications"
            description="Receive updates on replies, reactions, marketplace listing approvals, new campus opportunities, and upcoming events."
            returnRoute="notifications"
            onRequireAuth={onRequireAuth}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="notifications-heading"
      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <Bell className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
          <h1
            id="notifications-heading"
            className="font-display text-2xl font-bold text-[#0B1A2E]"
          >
            Notifications
          </h1>
        </div>
        <p className="text-xs font-medium text-slate-500 tabular-nums">
          {unreadNotificationsCount} unread
        </p>
      </div>

      {isSuspended && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
        >
          Your account is currently suspended. Interactive notification actions
          are restricted.
        </div>
      )}

      <div className="mt-5">
        {status === 'loading' ? (
          <div role="status" aria-label="Loading notifications" className="space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1A2E]/5 text-[#0B1A2E]">
              <Bell className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-3 font-display text-base font-semibold text-[#0B1A2E]">
              No notifications yet
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
              Your notification center is connected to your account. Real activity
              alerts will appear here as you interact across LASUED Intel.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex items-start justify-between gap-3 py-3.5 ${
                  item.isRead ? 'opacity-80' : 'bg-[#1E88E5]/5 px-3 rounded-xl'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!item.isRead && (
                      <span
                        aria-label="Unread notification"
                        className="h-2 w-2 shrink-0 rounded-full bg-[#1E88E5]"
                      />
                    )}
                    <p className="text-sm font-semibold text-[#0B1A2E]">
                      {item.title}
                    </p>
                  </div>
                  {item.body && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      {item.body}
                    </p>
                  )}
                </div>
                {item.isRead && (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

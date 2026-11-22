import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, CheckCircle2, Loader2 } from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeUserNotifications,
} from '../../services/firestoreFoundation';
import type { NotificationItem } from '../../types/database';
import { ActiveRoute } from '../../types/platform';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { extractActorUsernameFromNotification } from '../../utils/followRelations';
import { parseLocationSearch } from '../../utils/urlRouting';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia } from '../media/FirestoreImage';

interface NotificationsPageProps {
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string | null;
      opportunityId?: string | null;
      eventId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

function formatNotificationTime(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Just now';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({
  onNavigate,
  onRequireAuth,
}) => {
  const { authReady, user, unreadNotificationsCount, isSuspended } =
    useFirebase();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !user) {
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

  const handleMarkAllRead = async () => {
    if (markingAllRead || isSuspended || unreadNotificationsCount === 0) return;
    setMarkingAllRead(true);
    setActionError(null);
    try {
      await markAllNotificationsAsRead(items);
    } catch (err) {
      setActionError(
        formatFirestoreOrAppError(
          err,
          'Unable to mark notifications as read right now.'
        )
      );
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleOpenNotification = (
    item: NotificationItem,
    actorUsername: string | null
  ) => {
    if (!item.isRead) {
      void markNotificationAsRead(item.id).catch(() => {});
    }

    if (actorUsername) {
      onNavigate('profile', { username: actorUsername });
      return;
    }

    if (item.targetPath) {
      const searchPart = item.targetPath.includes('?')
        ? item.targetPath.slice(item.targetPath.indexOf('?'))
        : '';
      if (searchPart) {
        const parsed = parseLocationSearch(searchPart);
        onNavigate(parsed.route, {
          username: parsed.profileUsername,
          opportunityId: parsed.opportunityId,
          eventId: parsed.eventId,
        });
        return;
      }
    }
  };

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
            description="Receive updates on followers, replies, reactions, marketplace listing approvals, new campus opportunities, and upcoming events."
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
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium text-slate-500 tabular-nums">
            {unreadNotificationsCount} unread
          </p>
          {!isSuspended && unreadNotificationsCount > 0 && (
            <button
              type="button"
              disabled={markingAllRead}
              onClick={() => void handleMarkAllRead()}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-100 disabled:opacity-60"
            >
              {markingAllRead ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                  aria-hidden="true"
                />
              ) : (
                <CheckCheck
                  className="h-3.5 w-3.5 text-[#1E88E5]"
                  aria-hidden="true"
                />
              )}
              Mark all read
            </button>
          )}
        </div>
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

      {actionError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
        >
          {actionError}
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
              Your notification center is connected to your account. New
              followers, replies, reactions, and official campus updates will
              appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const actorUsername = extractActorUsernameFromNotification(item);
              const isFollowEvent = item.eventType === 'follow';
              const isActionable = Boolean(actorUsername || item.targetPath || !item.isRead);

              return (
                <li
                  key={item.id}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                    item.isRead
                      ? 'border-slate-200/80 bg-white opacity-90'
                      : 'border-[#1E88E5]/25 bg-[#1E88E5]/5'
                  }`}
                >
                  <button
                    type="button"
                    disabled={!isActionable}
                    onClick={() => handleOpenNotification(item, actorUsername)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default"
                  >
                    {isFollowEvent && (item.actorName || actorUsername) && (
                      <AvatarMedia
                        fullName={item.actorName || actorUsername || 'Member'}
                        photoImageId={item.actorPhotoImageId}
                        photoUrl={item.actorPhotoUrl}
                        sizeClass="h-10 w-10"
                        roundedClass="rounded-full"
                        textClass="text-xs"
                      />
                    )}
                    <div className="min-w-0 flex-1">
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
                      <p className="mt-1 text-[11px] font-medium text-slate-400">
                        {formatNotificationTime(item.createdAt)}
                      </p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    {isFollowEvent && actorUsername && !isSuspended && (
                      <TikTokFollowButton
                        targetUsername={actorUsername}
                        compact
                        onRequireAuth={() =>
                          onRequireAuth('login', 'notifications')
                        }
                      />
                    )}
                    {item.isRead && (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};


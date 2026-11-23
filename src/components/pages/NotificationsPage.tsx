import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Calendar,
  Check,
  CheckCheck,
  CornerDownRight,
  Heart,
  Loader2,
  Megaphone,
  MessageCircle,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  getNotificationsFilterSnapshot,
  saveNotificationsFilterSnapshot,
} from '../../services/navigationStateCache';
import type { NotificationEventType, NotificationItem } from '../../types/database';
import { ActiveRoute } from '../../types/platform';
import { extractActorUsernameFromNotification } from '../../utils/followRelations';
import {
  filterNotifications,
  formatNotificationExactTime,
  formatNotificationRelativeTime,
  getNotificationTypeLabel,
  NOTIFICATION_CATEGORY_FILTERS,
  resolveNotificationDestination,
  type NotificationCategoryFilter,
  type NotificationReadFilter,
} from '../../utils/notifications';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia, FirestoreImage } from '../media/FirestoreImage';

interface NotificationsPageProps {
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string | null;
      opportunityId?: string | null;
      eventId?: string | null;
      postId?: string | null;
      commentId?: string | null;
      listingId?: string | null;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack?: () => void;
}

function renderNotificationTypeVisual(eventType: NotificationEventType) {
  switch (eventType) {
    case 'reaction':
      return {
        bgClass: 'bg-rose-50 text-rose-600 border-rose-200',
        Icon: Heart,
      };
    case 'comment':
      return {
        bgClass: 'bg-[#1E88E5]/10 text-[#1E88E5] border-[#1E88E5]/25',
        Icon: MessageCircle,
      };
    case 'reply':
      return {
        bgClass: 'bg-[#1E88E5]/10 text-[#1E88E5] border-[#1E88E5]/25',
        Icon: CornerDownRight,
      };
    case 'anonymous_reply':
      return {
        bgClass: 'bg-[#0B1A2E] text-[#1E88E5] border-[#0B1A2E]',
        Icon: Shield,
      };
    case 'follow':
      return {
        bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        Icon: UserPlus,
      };
    case 'marketplace_approved':
    case 'marketplace_rejected':
    case 'marketplace_expired':
      return {
        bgClass: 'bg-amber-50 text-amber-700 border-amber-200',
        Icon: ShoppingBag,
      };
    case 'new_event':
      return {
        bgClass: 'bg-sky-50 text-[#1E88E5] border-sky-200',
        Icon: Calendar,
      };
    case 'new_opportunity':
      return {
        bgClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        Icon: Briefcase,
      };
    case 'announcement':
      return {
        bgClass: 'bg-[#0B1A2E] text-white border-[#0B1A2E]',
        Icon: Megaphone,
      };
    case 'badge_change':
    case 'account_change':
    default:
      return {
        bgClass: 'bg-slate-100 text-[#0B1A2E] border-slate-200',
        Icon: ShieldCheck,
      };
  }
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const {
    authReady,
    user,
    isSuspended,
    unreadNotificationsCount,
    notifications,
    notificationsStatus,
    hasMoreNotifications,
    loadingOlderNotifications,
    notificationError,
    notificationPrefs,
    markNotificationReadOptimistic,
    markAllNotificationsReadOptimistic,
    deleteNotificationOptimistic,
    loadOlderNotifications,
    clearNotificationError,
  } = useFirebase();

  const viewerKey = user?.uid ?? 'guest';
  const prevViewerKeyRef = useRef(viewerKey);

  const [readFilter, setReadFilter] = useState<NotificationReadFilter>(
    () => getNotificationsFilterSnapshot(viewerKey)?.readFilter ?? 'all'
  );
  const [categoryFilter, setCategoryFilter] =
    useState<NotificationCategoryFilter>(
      () => getNotificationsFilterSnapshot(viewerKey)?.categoryFilter ?? 'all'
    );

  useEffect(() => {
    if (prevViewerKeyRef.current === viewerKey) return;
    prevViewerKeyRef.current = viewerKey;
    const snap = getNotificationsFilterSnapshot(viewerKey);
    const timer = window.setTimeout(() => {
      setReadFilter(snap?.readFilter ?? 'all');
      setCategoryFilter(snap?.categoryFilter ?? 'all');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewerKey]);

  useEffect(() => {
    saveNotificationsFilterSnapshot({
      viewerKey,
      readFilter,
      categoryFilter,
      cachedAt: Date.now(),
    });
  }, [viewerKey, readFilter, categoryFilter]);

  const visibleNotifications = useMemo(
    () =>
      filterNotifications(notifications, {
        readFilter,
        categoryFilter,
        prefs: notificationPrefs,
      }),
    [notifications, readFilter, categoryFilter, notificationPrefs]
  );

  const handleOpenNotification = (item: NotificationItem) => {
    if (!item.isRead && !isSuspended) {
      void markNotificationReadOptimistic(item.id);
    }

    const destination = resolveNotificationDestination(item);
    if (destination) {
      onNavigate(destination.route, destination.options);
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
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
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
            description="Receive instant updates on likes, comments, replies, followers, marketplace activity, campus events, opportunities, and official announcements."
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
      {onBack && (
        <div className="mb-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        </div>
      )}

      {/* Top Bar */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <Bell className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
          <h1
            id="notifications-heading"
            className="font-display text-2xl font-bold text-[#0B1A2E]"
          >
            Notifications
          </h1>
          <span className="text-xs font-medium text-slate-400">·</span>
          <p className="text-xs font-semibold text-slate-600 tabular-nums">
            {unreadNotificationsCount} unread
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('account')}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-50"
          >
            <Settings className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
            Preferences
          </button>

          {!isSuspended && unreadNotificationsCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllNotificationsReadOptimistic()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#132844]"
            >
              <CheckCheck
                className="h-3.5 w-3.5 text-[#1E88E5]"
                aria-hidden="true"
              />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Read Status & Category Filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Notification read status"
          className="inline-flex self-start rounded-lg bg-slate-100 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={readFilter === 'all'}
            onClick={() => setReadFilter('all')}
            className={`min-h-[34px] rounded-md px-3.5 text-xs font-semibold transition-colors ${
              readFilter === 'all'
                ? 'bg-white text-[#0B1A2E] shadow-2xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={readFilter === 'unread'}
            onClick={() => setReadFilter('unread')}
            className={`min-h-[34px] rounded-md px-3.5 text-xs font-semibold tabular-nums transition-colors ${
              readFilter === 'unread'
                ? 'bg-white text-[#0B1A2E] shadow-2xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            Unread ({unreadNotificationsCount})
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Filter notifications by category"
          className="flex flex-wrap gap-1.5"
        >
          {NOTIFICATION_CATEGORY_FILTERS.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategoryFilter(cat.id)}
                className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
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

      {notificationError && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
        >
          <span>{notificationError}</span>
          <button
            type="button"
            onClick={clearNotificationError}
            aria-label="Dismiss error"
            className="rounded p-1 text-red-700 hover:bg-red-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-5">
        {notificationsStatus === 'loading' ? (
          <div
            role="status"
            aria-label="Loading notifications"
            className="space-y-3"
          >
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
        ) : visibleNotifications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1A2E]/5 text-[#0B1A2E]">
              <Bell className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-3 font-display text-base font-semibold text-[#0B1A2E]">
              {readFilter === 'unread'
                ? 'You are all caught up'
                : categoryFilter !== 'all'
                  ? 'No notifications in this category'
                  : 'No notifications yet'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
              {readFilter === 'unread'
                ? 'All visible notifications have been marked as read.'
                : 'Likes, comments, replies, new followers, marketplace activity, campus events, opportunities, and official announcements will appear here automatically.'}
            </p>
            {(readFilter !== 'all' || categoryFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setReadFilter('all');
                  setCategoryFilter('all');
                }}
                className="mt-4 inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
              >
                Show all notifications
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visibleNotifications.map((item) => {
              const isAnonReply = item.eventType === 'anonymous_reply';
              const actorUsername = isAnonReply
                ? null
                : extractActorUsernameFromNotification(item);
              const actorDisplayName = isAnonReply
                ? null
                : item.actorName || (actorUsername ? `@${actorUsername}` : null);
              const hasPublicActorVisual = Boolean(
                !isAnonReply && (item.actorName || actorUsername)
              );
              const hasContentThumb = Boolean(
                item.targetImageId || item.targetImageUrl
              );
              const destination = resolveNotificationDestination(item);
              const isActionable = Boolean(destination || !item.isRead);
              const typeVisual = renderNotificationTypeVisual(item.eventType);
              const TypeIcon = typeVisual.Icon;
              const typeLabel = getNotificationTypeLabel(item.eventType);
              const relativeTime = formatNotificationRelativeTime(item.createdAt);
              const exactTime = formatNotificationExactTime(item.createdAt);

              return (
                <li
                  key={item.id}
                  data-testid={`notification-item-${item.id}`}
                  className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 transition-colors sm:flex-row sm:items-start ${
                    item.isRead
                      ? 'border-slate-200/80 bg-white'
                      : 'border-[#1E88E5]/30 bg-[#1E88E5]/[0.04]'
                  }`}
                >
                  <button
                    type="button"
                    disabled={!isActionable}
                    onClick={() => handleOpenNotification(item)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default"
                  >
                    {/* Leading Image: Public Actor Avatar -> Content Thumbnail -> Event Type Icon */}
                    {hasPublicActorVisual ? (
                      <AvatarMedia
                        fullName={item.actorName || actorUsername || 'Member'}
                        photoImageId={item.actorPhotoImageId}
                        photoUrl={item.actorPhotoUrl}
                        sizeClass="h-10 w-10"
                        roundedClass="rounded-full"
                        textClass="text-xs"
                      />
                    ) : hasContentThumb ? (
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        <FirestoreImage
                          imageId={item.targetImageId}
                          fallbackUrl={item.targetImageUrl}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${typeVisual.bgClass}`}
                      >
                        <TypeIcon className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-slate-500">
                        <span className="font-semibold text-[#1E88E5]">
                          {typeLabel}
                        </span>
                        {actorDisplayName && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="font-semibold text-[#0B1A2E]">
                              {item.actorName || `@${actorUsername}`}
                            </span>
                            {item.actorName && actorUsername && (
                              <span className="text-slate-500">
                                {' '}
                                @{actorUsername}
                              </span>
                            )}
                          </>
                        )}
                        <span aria-hidden="true"> · </span>
                        <time title={exactTime} className="tabular-nums">
                          {relativeTime}
                        </time>
                      </p>

                      <div className="mt-0.5 flex items-start gap-2">
                        {!item.isRead && (
                          <span
                            aria-label="Unread notification"
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1E88E5]"
                          />
                        )}
                        <p className="text-sm font-semibold text-[#0B1A2E]">
                          {item.title}
                        </p>
                      </div>

                      {item.body && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                          {item.body}
                        </p>
                      )}
                    </div>

                    {hasPublicActorVisual && hasContentThumb && (
                      <div className="hidden h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:block">
                        <FirestoreImage
                          imageId={item.targetImageId}
                          fallbackUrl={item.targetImageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                  </button>

                  {/* Row Actions */}
                  <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5">
                    {item.eventType === 'follow' &&
                      actorUsername &&
                      !isSuspended && (
                        <TikTokFollowButton
                          targetUsername={actorUsername}
                          compact
                          onRequireAuth={() =>
                            onRequireAuth('login', 'notifications')
                          }
                        />
                      )}

                    {!item.isRead && !isSuspended && (
                      <button
                        type="button"
                        onClick={() => void markNotificationReadOptimistic(item.id)}
                        aria-label={`Mark "${item.title}" as read`}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-50"
                      >
                        <Check
                          className="h-3.5 w-3.5 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        <span>Mark read</span>
                      </button>
                    )}

                    {!isSuspended && (
                      <button
                        type="button"
                        onClick={() => void deleteNotificationOptimistic(item.id)}
                        aria-label={`Remove notification "${item.title}"`}
                        title="Remove notification"
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMoreNotifications && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={loadingOlderNotifications}
              onClick={() => void loadOlderNotifications()}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingOlderNotifications && (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                  aria-hidden="true"
                />
              )}
              {loadingOlderNotifications
                ? 'Loading older notifications...'
                : 'Load older notifications'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

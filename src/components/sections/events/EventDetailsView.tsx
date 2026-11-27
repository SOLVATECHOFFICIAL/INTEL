import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Calendar,
  ClipboardCheck,
  ExternalLink,
  Heart,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  UserCheck,
  Video,
} from 'lucide-react';
import type { CampusEvent } from '../../../types/database';
import type { ActiveRoute } from '../../../types/platform';
import {
  formatEventDateTimeRange,
  getEventCategoryLabel,
  getSafeEventUrl,
  resolveEventLifecycle,
} from '../../../utils/events';
import { mediaMetaToGridItems, type GridPhotoItem } from '../../../utils/mediaGrid';
import { GuestPromptCard } from '../../auth/GuestPromptCard';
import { FullScreenImageLightbox } from '../../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../../media/SquareImageGrid';
import { LinkifiedText } from '../../shared/LinkifiedText';
import { EventCommentsSection } from './EventCommentsSection';
import { EventShareButton } from './EventShareButton';

interface EventDetailsViewProps {
  event: CampusEvent;
  nowMs: number;
  isLiked: boolean;
  isSaved: boolean;
  autoFocusComments?: boolean;
  highlightCommentId?: string | null;
  initialLightboxIndex?: number | null;
  onLightboxIndexChange?: (idx: number | null) => void;
  guestPromptMessage: string | null;
  errorMessage: string | null;
  onDismissGuestPrompt: () => void;
  onBack: () => void;
  onToggleLike: (event: CampusEvent) => void;
  onToggleSave: (event: CampusEvent) => void;
  onCommentsCountChange: (eventId: string, nextCount: number) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireGuestAuth: (message: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const EventDetailsView: React.FC<EventDetailsViewProps> = ({
  event,
  nowMs,
  isLiked,
  isSaved,
  autoFocusComments = false,
  highlightCommentId = null,
  initialLightboxIndex = null,
  onLightboxIndexChange,
  guestPromptMessage,
  errorMessage,
  onDismissGuestPrompt,
  onBack,
  onToggleLike,
  onToggleSave,
  onCommentsCountChange,
  onNavigateProfile,
  onRequireGuestAuth,
  onRequireAuth,
}) => {
  const [bannerError, setBannerError] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(
    initialLightboxIndex
  );
  const [focusCommentsNonce, setFocusCommentsNonce] = useState(
    autoFocusComments ? 1 : 0
  );

  const updateLightboxIndex = (idx: number | null) => {
    setLightboxIndex(idx);
    onLightboxIndexChange?.(idx);
  };

  const lifecycle = resolveEventLifecycle(event, nowMs);
  const dateRangeLabel = formatEventDateTimeRange(event);
  const safeRegUrl = getSafeEventUrl(event.registrationUrl);
  const safeMeetingUrl = getSafeEventUrl(event.onlineMeetingUrl);
  const safeBannerUrl = getSafeEventUrl(event.bannerUrl);

  const gridItems: GridPhotoItem[] = useMemo(() => {
    const items = mediaMetaToGridItems(event.mediaItems);
    if (items.length > 0) return items;
    if (safeBannerUrl && !bannerError) {
      return [
        {
          imageId: `banner_${event.id}`,
          directSrc: safeBannerUrl,
        },
      ];
    }
    return [];
  }, [event.mediaItems, event.id, safeBannerUrl, bannerError]);

  const hasFirestoreGallery = Boolean(
    event.mediaItems && event.mediaItems.length > 0
  );

  const statusTextClass =
    lifecycle.state === 'ongoing'
      ? 'text-emerald-700 dark:text-emerald-400'
      : lifecycle.state === 'upcoming'
        ? 'text-[#1E88E5] dark:text-sky-400'
        : lifecycle.state === 'cancelled'
          ? 'text-red-700 dark:text-red-400'
          : 'text-slate-600 dark:text-slate-400';

  const handleFocusComments = () => {
    setFocusCommentsNonce((n) => n + 1);
    const el = document.getElementById('event-comments-section');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5" data-testid={`event-details-${event.id}`}>
      {/* Navigation & Top-Right Share */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Events
        </button>

        <EventShareButton event={event} />
      </div>

      {guestPromptMessage && (
        <GuestPromptCard
          title="Sign in to interact with events"
          description={guestPromptMessage}
          returnRoute="upcoming-events"
          onRequireAuth={onRequireAuth}
          onDismiss={onDismissGuestPrompt}
        />
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {errorMessage}
        </div>
      )}

      <article className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-[#1E88E5] dark:text-sky-400">
              {getEventCategoryLabel(event.category)}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className={`font-bold ${statusTextClass}`}>
              {lifecycle.label}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="font-medium text-slate-600 tabular-nums dark:text-slate-400">
              {dateRangeLabel}
            </span>
          </div>

          <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-[#0B1A2E] sm:text-2xl dark:text-white">
            {event.title}
          </h2>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-[#1E88E5] dark:text-sky-400">
            <UserCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Organised by {event.organiser}</span>
          </p>
        </header>

        {/* Event Cover / Gallery Images */}
        {hasFirestoreGallery ? (
          <SquareImageGrid
            items={gridItems}
            postLabel={event.title}
            showPerPhotoCaptions={false}
            onImageClick={(idx) => updateLightboxIndex(idx)}
          />
        ) : (
          safeBannerUrl &&
          !bannerError && (
            <button
              type="button"
              onClick={() => updateLightboxIndex(0)}
              aria-label={`View full cover image for ${event.title}`}
              className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-[#0B1A2E] focus-visible:ring-2 focus-visible:ring-[#1E88E5] dark:border-slate-800"
            >
              <img
                src={safeBannerUrl}
                alt={`${event.title} cover`}
                onError={() => setBannerError(true)}
                className="max-h-96 w-full object-cover"
              />
            </button>
          )
        )}

        {/* Logistics & Registration Summary */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/50">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <Calendar className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
              Date &amp; Time
            </p>
            <p className="mt-1 text-xs font-semibold text-[#0B1A2E] tabular-nums dark:text-slate-100">
              {dateRangeLabel}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <MapPin className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
              Venue
            </p>
            <p className="mt-1 text-xs font-semibold text-[#0B1A2E] dark:text-slate-100">
              {event.venue}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <ClipboardCheck className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
              Registration
            </p>
            <p className="mt-1 text-xs font-semibold text-[#0B1A2E] dark:text-slate-100">
              {event.registrationRequired
                ? safeRegUrl
                  ? 'Required via link below'
                  : 'Required (see instructions below)'
                : safeRegUrl
                  ? 'Optional RSVP link below'
                  : 'Open to all'}
            </p>
          </div>

          {event.contactInfo && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <Mail className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
                Contact
              </p>
              <LinkifiedText
                text={event.contactInfo}
                className="mt-1 text-xs font-semibold text-[#0B1A2E] dark:text-slate-100"
              />
            </div>
          )}
        </div>

        {/* Full Description */}
        <div>
          <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
            About
          </h3>
          <LinkifiedText
            text={event.description}
            className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-200"
          />
        </div>

        {/* Attendance Instructions */}
        {event.instructions && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
            <h3 className="flex items-center gap-1.5 font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
              <Info className="h-4 w-4 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
              Instructions
            </h3>
            <LinkifiedText
              text={event.instructions}
              className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-700 dark:text-slate-300"
            />
          </div>
        )}

        {/* External Links (Strictly when provided) */}
        {(safeRegUrl || safeMeetingUrl) && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {safeRegUrl && (
              <a
                href={safeRegUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-sky-600 dark:hover:bg-sky-500"
              >
                Register Online
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {safeMeetingUrl && (
              <a
                href={safeMeetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Video className="h-4 w-4 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
                Join Online Session
              </a>
            )}
          </div>
        )}

        {/* Strictly 3 Interaction Actions: Save, Like, Comment */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onToggleSave(event)}
            aria-pressed={isSaved}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSaved
                ? 'bg-[#0B1A2E] text-white dark:bg-sky-500 dark:text-slate-950'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Bookmark
              className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
              aria-hidden="true"
            />
            <span>{isSaved ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleLike(event)}
            aria-pressed={isLiked}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isLiked
                ? 'bg-[#1E88E5]/10 text-[#1E88E5] dark:bg-sky-500/15 dark:text-sky-400'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Heart
              className={`h-4 w-4 ${isLiked ? 'fill-[#1E88E5] dark:fill-sky-400' : ''}`}
              aria-hidden="true"
            />
            <span className="tabular-nums">{event.likesCount ?? 0}</span>
            <span>{isLiked ? 'Liked' : 'Like'}</span>
          </button>

          <button
            type="button"
            onClick={handleFocusComments}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{event.commentsCount ?? 0}</span>
            <span>Comment</span>
          </button>
        </div>
      </article>

      <EventCommentsSection
        key={event.id}
        eventId={event.id}
        commentsCount={event.commentsCount ?? 0}
        autoFocusInput={focusCommentsNonce > 0}
        highlightCommentId={highlightCommentId}
        onCommentsCountChange={(nextCount) =>
          onCommentsCountChange(event.id, nextCount)
        }
        onNavigateProfile={onNavigateProfile}
        onRequireGuestAuth={onRequireGuestAuth}
      />

      {lightboxIndex !== null && gridItems.length > 0 && (
        <FullScreenImageLightbox
          items={gridItems}
          initialIndex={lightboxIndex}
          postTitle={event.title}
          postCaption={event.venue ? `${dateRangeLabel} · ${event.venue}` : dateRangeLabel}
          onIndexChange={(idx) => updateLightboxIndex(idx)}
          onClose={() => updateLightboxIndex(null)}
        />
      )}
    </div>
  );
};

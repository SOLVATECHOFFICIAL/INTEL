import React, { useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Calendar,
  Clock,
  Heart,
  MapPin,
  MessageCircle,
  UserCheck,
} from 'lucide-react';
import type { CampusEvent } from '../../../types/database';
import {
  formatEventLocalDate,
  formatEventLocalTime,
  getEventCategoryShortLabel,
  getEventCoverDirectOrImageId,
  resolveEventLifecycle,
} from '../../../utils/events';
import { FirestoreImage } from '../../media/FirestoreImage';
import { EventShareButton } from './EventShareButton';

interface EventCardProps {
  event: CampusEvent;
  nowMs: number;
  isLiked: boolean;
  isSaved: boolean;
  onOpenDetails: (eventId: string, focusComments?: boolean) => void;
  onToggleLike: (event: CampusEvent) => void;
  onToggleSave: (event: CampusEvent) => void;
}

export const EventCard = React.memo(function EventCard({
  event,
  nowMs,
  isLiked,
  isSaved,
  onOpenDetails,
  onToggleLike,
  onToggleSave,
}: EventCardProps) {
  const [bannerError, setBannerError] = useState(false);

  const lifecycle = resolveEventLifecycle(event, nowMs);
  const cover = getEventCoverDirectOrImageId(event);
  const hasCover = Boolean(cover.imageId || (cover.bannerUrl && !bannerError));

  const startDateText = formatEventLocalDate(event.eventDate);
  const startTimeText =
    event.timeLabel?.trim() || formatEventLocalTime(event.eventDate);

  const statusTextClass =
    lifecycle.state === 'ongoing'
      ? 'text-emerald-700 dark:text-emerald-400'
      : lifecycle.state === 'upcoming'
        ? 'text-[#1E88E5] dark:text-sky-400'
        : lifecycle.state === 'cancelled'
          ? 'text-red-700 dark:text-red-400'
          : 'text-slate-500 dark:text-slate-400';

  return (
    <article
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 sm:p-5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
      data-testid={`event-card-${event.id}`}
    >
      {/* Top row: Category · Status · Date + small top-right Share icon */}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-semibold text-[#1E88E5] dark:text-sky-400">
            {getEventCategoryShortLabel(event.category)}
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
            {startDateText}
          </span>
        </div>

        <EventShareButton event={event} />
      </div>

      {/* Optional Event Cover Image */}
      {hasCover && (
        <button
          type="button"
          onClick={() => onOpenDetails(event.id)}
          className="mt-3 block w-full overflow-hidden rounded-xl border border-slate-100 bg-[#0B1A2E] focus-visible:ring-2 focus-visible:ring-[#1E88E5] dark:border-slate-800"
          aria-label={`Open details for ${event.title}`}
        >
          {cover.imageId ? (
            <FirestoreImage
              imageId={cover.imageId}
              alt={`${event.title} cover`}
              className="aspect-[16/9] max-h-60 w-full object-cover"
              placeholderClassName="aspect-[16/9] max-h-60 w-full bg-[#0B1A2E]"
            />
          ) : (
            <img
              src={cover.bannerUrl ?? ''}
              alt={`${event.title} cover`}
              loading="lazy"
              onError={() => setBannerError(true)}
              className="aspect-[16/9] max-h-60 w-full object-cover"
            />
          )}
        </button>
      )}

      {/* Title & Organiser */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => onOpenDetails(event.id)}
          className="text-left font-display text-base font-bold tracking-tight text-[#0B1A2E] hover:text-[#1E88E5] sm:text-lg dark:text-white dark:hover:text-sky-400"
        >
          {event.title}
        </button>

        <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
          <span className="truncate">{event.organiser}</span>
        </p>
      </div>

      {/* Key Logistics: Date, Start Time, Venue */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
          <span>{startDateText}</span>
        </span>
        {startTimeText && (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
            <span>{startTimeText}</span>
          </span>
        )}
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-[#1E88E5] dark:text-sky-400" aria-hidden="true" />
          <span className="truncate">{event.venue}</span>
        </span>
      </div>

      {/* Short Description + Clear Details Action */}
      <p className="mt-2.5 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        {event.description}
      </p>

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => onOpenDetails(event.id)}
          className="inline-flex min-h-[34px] items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
        >
          View Details
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Strictly 3 Footer Actions: Save, Like, Comment */}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => onToggleSave(event)}
            aria-pressed={isSaved}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
              isSaved
                ? 'bg-[#0B1A2E] text-white dark:bg-sky-500 dark:text-slate-950'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
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
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
              isLiked
                ? 'bg-[#1E88E5]/10 text-[#1E88E5] dark:bg-sky-500/15 dark:text-sky-400'
                : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
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
            onClick={() => onOpenDetails(event.id, true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E] sm:px-3 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{event.commentsCount ?? 0}</span>
            <span>Comment</span>
          </button>
        </div>
      </div>
    </article>
  );
});

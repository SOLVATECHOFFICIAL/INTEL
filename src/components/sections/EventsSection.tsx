import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ExternalLink,
  Loader2,
  MapPin,
  Video,
} from 'lucide-react';
import { fetchAllCampusEvents } from '../../services/adminDashboard';
import {
  categorizeEventByDate,
  type CampusEvent,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';

export const EventsSection: React.FC = () => {
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<'upcoming' | 'archive'>(
    'upcoming'
  );
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    fetchAllCampusEvents()
      .then((items) => {
        if (!active) return;
        setEvents(items);
        setErrorMessage(null);
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load campus events right now.'
          )
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const eventMs = extractTimestampMs(evt.eventDate) ?? 0;
      const effectiveStatus = categorizeEventByDate(eventMs, nowMs, evt.status);
      if (viewFilter === 'upcoming') {
        return effectiveStatus === 'upcoming';
      }
      return effectiveStatus === 'past' || effectiveStatus === 'cancelled';
    });
  }, [events, viewFilter, nowMs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading campus events calendar...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        {(
          [
            { id: 'upcoming', label: 'Upcoming Events' },
            { id: 'archive', label: 'Past & Cancelled' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setViewFilter(tab.id)}
            className={`min-h-[36px] rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              viewFilter === tab.id
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Calendar
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            {viewFilter === 'upcoming'
              ? 'No upcoming events scheduled'
              : 'No past or cancelled events'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            Campus seminars, academic calendars, orientation sessions, and
            student union events published by administrators appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((evt) => {
            const eventMs = extractTimestampMs(evt.eventDate) ?? nowMs;
            const effectiveStatus = categorizeEventByDate(
              eventMs,
              nowMs,
              evt.status
            );

            return (
              <article
                key={evt.id}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 font-bold uppercase ${
                          effectiveStatus === 'upcoming'
                            ? 'bg-emerald-100 text-emerald-900'
                            : effectiveStatus === 'cancelled'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {effectiveStatus}
                      </span>
                      <span className="font-medium text-slate-600">
                        {new Date(eventMs).toLocaleDateString('en-NG', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {evt.timeLabel ? ` · ${evt.timeLabel}` : ''}
                      </span>
                    </div>

                    <h3 className="mt-2 font-display text-base font-bold text-[#0B1A2E] sm:text-lg">
                      {evt.title}
                    </h3>
                    <p className="text-xs font-semibold text-[#1E88E5]">
                      Organised by {evt.organiser}
                    </p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]" aria-hidden="true" />
                      <span>{evt.venue}</span>
                    </p>

                    <p className="mt-2.5 text-xs leading-relaxed text-slate-700 whitespace-pre-line">
                      {evt.description}
                    </p>

                    {evt.instructions && (
                      <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <strong>Note:</strong> {evt.instructions}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {evt.registrationUrl && effectiveStatus === 'upcoming' && (
                      <a
                        href={evt.registrationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132844]"
                      >
                        Register / RSVP
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                    {evt.onlineMeetingUrl && effectiveStatus === 'upcoming' && (
                      <a
                        href={evt.onlineMeetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                      >
                        <Video className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                        Join Online
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

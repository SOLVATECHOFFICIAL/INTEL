import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  Calendar,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  fetchCampusEventById,
  fetchPublishedCampusEvents,
  toggleEventReaction,
} from '../../services/events';
import {
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
  toggleSavedPost,
} from '../../services/socialPosts';
import type { CampusEvent, EventCategory } from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  EVENT_CATEGORIES,
  extractUniqueEventVenues,
  filterAndSortEvents,
  type EventDateWindowFilter,
  type EventStatusFilter,
} from '../../utils/events';
import { computeOptimisticReactionToggle } from '../../utils/optimisticInteractions';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { EventCard } from './events/EventCard';
import { EventDetailsView } from './events/EventDetailsView';

interface EventsSectionProps {
  selectedEventId?: string | null;
  selectedCommentId?: string | null;
  onSelectEvent?: (eventId: string | null) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

type EventsTab = 'all' | 'saved';

export const EventsSection: React.FC<EventsSectionProps> = ({
  selectedEventId = null,
  selectedCommentId = null,
  onSelectEvent,
  onNavigateProfile,
  onRequireAuth,
}) => {
  const { user, isSuspended } = useFirebase();
  const viewerUid = user?.uid ?? null;

  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeTab, setActiveTab] = useState<EventsTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EventCategory>(
    'all'
  );
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('all');
  const [dateWindowFilter, setDateWindowFilter] =
    useState<EventDateWindowFilter>('all');
  const [venueFilter, setVenueFilter] = useState('all');

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(
    selectedEventId
  );
  const [directLookupResult, setDirectLookupResult] = useState<{
    targetId: string;
    event: CampusEvent | null;
  } | null>(null);

  const [focusCommentsOnOpen, setFocusCommentsOnOpen] = useState(false);
  const [guestPromptMessage, setGuestPromptMessage] = useState<string | null>(
    null
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Prevent duplicate concurrent like/save toggles per event ID
  const likeInFlightRef = useRef<Set<string>>(new Set());
  const saveInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;

    const likesPromise = viewerUid
      ? fetchViewerLikedPostIds('events', viewerUid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    const savedPromise = viewerUid
      ? fetchViewerSavedPostIds('events', viewerUid).catch(
          () => new Set<string>()
        )
      : Promise.resolve(new Set<string>());

    Promise.all([fetchPublishedCampusEvents(), likesPromise, savedPromise])
      .then(([loadedEvents, viewerLiked, viewerSaved]) => {
        if (!active) return;
        setEvents(loadedEvents);
        setLikedIds(viewerLiked);
        setSavedIds(viewerSaved);
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
  }, [viewerUid, reloadNonce]);

  const effectiveSelectedId = onSelectEvent ? selectedEventId : localSelectedId;
  const needsDirectLookup = Boolean(
    effectiveSelectedId &&
      !loading &&
      !events.some((evt) => evt.id === effectiveSelectedId)
  );
  const directLookupLoading =
    needsDirectLookup &&
    directLookupResult?.targetId !== effectiveSelectedId;

  // Fallback single-doc lookup for direct shared links when an event isn't in the initial batch
  useEffect(() => {
    if (!needsDirectLookup || !effectiveSelectedId) {
      return;
    }
    const targetId = effectiveSelectedId;
    let active = true;
    fetchCampusEventById(targetId)
      .then((found) => {
        if (!active) return;
        setDirectLookupResult({ targetId, event: found });
        if (found) {
          setEvents((prev) =>
            prev.some((e) => e.id === found.id) ? prev : [...prev, found]
          );
        }
      })
      .catch(() => {
        if (active) setDirectLookupResult({ targetId, event: null });
      });
    return () => {
      active = false;
    };
  }, [needsDirectLookup, effectiveSelectedId]);

  const openDetails = (eventId: string | null, focusComments = false) => {
    setFocusCommentsOnOpen(focusComments);
    setGuestPromptMessage(null);
    if (onSelectEvent) {
      onSelectEvent(eventId);
    } else {
      setLocalSelectedId(eventId);
    }
  };

  const selectedEvent = useMemo(() => {
    if (!effectiveSelectedId) return null;
    const directMatched =
      directLookupResult?.targetId === effectiveSelectedId
        ? directLookupResult.event
        : null;
    return (
      events.find((item) => item.id === effectiveSelectedId) ?? directMatched
    );
  }, [events, effectiveSelectedId, directLookupResult]);

  const availableVenues = useMemo(
    () => extractUniqueEventVenues(events),
    [events]
  );

  const savedEventsCount = useMemo(
    () =>
      filterAndSortEvents(events, { savedOnly: true }, savedIds, nowMs).length,
    [events, savedIds, nowMs]
  );

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      categoryFilter !== 'all' ||
      statusFilter !== 'all' ||
      dateWindowFilter !== 'all' ||
      venueFilter !== 'all'
  );

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setDateWindowFilter('all');
    setVenueFilter('all');
  };

  const filteredEvents = useMemo(
    () =>
      filterAndSortEvents(
        events,
        {
          query: searchQuery,
          category: categoryFilter,
          status: statusFilter,
          dateWindow: dateWindowFilter,
          venue: venueFilter,
          savedOnly: activeTab === 'saved',
        },
        savedIds,
        nowMs
      ),
    [
      events,
      searchQuery,
      categoryFilter,
      statusFilter,
      dateWindowFilter,
      venueFilter,
      activeTab,
      savedIds,
      nowMs,
    ]
  );

  const handleToggleLike = (targetEvent: CampusEvent) => {
    setErrorMessage(null);
    setGuestPromptMessage(null);
    if (!viewerUid) {
      setGuestPromptMessage('Sign in to like campus events.');
      return;
    }
    if (isSuspended) {
      setErrorMessage('Suspended accounts cannot react to campus events.');
      return;
    }
    if (likeInFlightRef.current.has(targetEvent.id)) {
      return;
    }

    likeInFlightRef.current.add(targetEvent.id);
    const prevLiked = likedIds.has(targetEvent.id);
    const prevCount = Number(targetEvent.likesCount ?? 0);
    const { nextLiked, nextCount } = computeOptimisticReactionToggle({
      currentlyLiked: prevLiked,
      currentCount: prevCount,
    });

    // Immediate optimistic update
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (nextLiked) next.add(targetEvent.id);
      else next.delete(targetEvent.id);
      return next;
    });
    setEvents((prev) =>
      prev.map((evt) =>
        evt.id === targetEvent.id ? { ...evt, likesCount: nextCount } : evt
      )
    );

    void toggleEventReaction({
      eventId: targetEvent.id,
      actorUid: viewerUid,
    })
      .then((res) => {
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (res.liked) next.add(targetEvent.id);
          else next.delete(targetEvent.id);
          return next;
        });
        setEvents((prev) =>
          prev.map((evt) =>
            evt.id === targetEvent.id
              ? { ...evt, likesCount: res.likesCount }
              : evt
          )
        );
      })
      .catch((error) => {
        // Reconcile rollback on failure
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (prevLiked) next.add(targetEvent.id);
          else next.delete(targetEvent.id);
          return next;
        });
        setEvents((prev) =>
          prev.map((evt) =>
            evt.id === targetEvent.id ? { ...evt, likesCount: prevCount } : evt
          )
        );
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Could not update your event like right now.'
          )
        );
      })
      .finally(() => {
        likeInFlightRef.current.delete(targetEvent.id);
      });
  };

  const handleToggleSave = (targetEvent: CampusEvent) => {
    setErrorMessage(null);
    setGuestPromptMessage(null);
    if (!viewerUid) {
      setGuestPromptMessage(
        'Sign in to save campus events to your personal schedule.'
      );
      return;
    }
    if (isSuspended) {
      setErrorMessage('Suspended accounts cannot bookmark campus events.');
      return;
    }
    if (saveInFlightRef.current.has(targetEvent.id)) {
      return;
    }

    saveInFlightRef.current.add(targetEvent.id);
    const prevSaved = savedIds.has(targetEvent.id);
    const nextSaved = !prevSaved;

    // Immediate optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (nextSaved) next.add(targetEvent.id);
      else next.delete(targetEvent.id);
      return next;
    });

    void toggleSavedPost({
      actorUid: viewerUid,
      targetCollection: 'events',
      targetId: targetEvent.id,
      currentlySaved: prevSaved,
    })
      .then((res) => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (res.saved) next.add(targetEvent.id);
          else next.delete(targetEvent.id);
          return next;
        });
      })
      .catch((error) => {
        // Rollback on failure
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (prevSaved) next.add(targetEvent.id);
          else next.delete(targetEvent.id);
          return next;
        });
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Could not update your saved events right now.'
          )
        );
      })
      .finally(() => {
        saveInFlightRef.current.delete(targetEvent.id);
      });
  };

  const handleCommentsCountChange = (eventId: string, nextCount: number) => {
    setEvents((prev) =>
      prev.map((evt) =>
        evt.id === eventId ? { ...evt, commentsCount: nextCount } : evt
      )
    );
  };

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

  if (errorMessage && events.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/70 p-6 text-center">
        <AlertCircle
          className="mx-auto mb-2 h-6 w-6 text-red-700"
          aria-hidden="true"
        />
        <p className="font-display text-sm font-bold text-[#0B1A2E]">
          Unable to load campus events
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setErrorMessage(null);
            setReloadNonce((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  // Direct / Deep-Linked Event Details View
  if (effectiveSelectedId) {
    if (directLookupLoading) {
      return (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Opening campus event...
        </div>
      );
    }

    if (!selectedEvent) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => openDetails(null)}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Events
          </button>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
            <Calendar
              className="mx-auto mb-2 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Event not available
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
              This campus event may have been removed or unpublished. Explore all
              currently published LASUED events below.
            </p>
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              Browse All Events
            </button>
          </div>
        </div>
      );
    }

    return (
      <EventDetailsView
        event={selectedEvent}
        nowMs={nowMs}
        isLiked={likedIds.has(selectedEvent.id)}
        isSaved={savedIds.has(selectedEvent.id)}
        autoFocusComments={focusCommentsOnOpen}
        highlightCommentId={
          selectedEvent.id === effectiveSelectedId ? selectedCommentId : null
        }
        guestPromptMessage={guestPromptMessage}
        errorMessage={errorMessage}
        onDismissGuestPrompt={() => setGuestPromptMessage(null)}
        onBack={() => openDetails(null)}
        onToggleLike={handleToggleLike}
        onToggleSave={handleToggleSave}
        onCommentsCountChange={handleCommentsCountChange}
        onNavigateProfile={onNavigateProfile}
        onRequireGuestAuth={(msg) => setGuestPromptMessage(msg)}
        onRequireAuth={onRequireAuth}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Section Tabs: All Events & Saved Events */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Campus events views"
          className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={`min-h-[36px] rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === 'all'
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            All Events ({events.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'saved'}
            onClick={() => {
              if (!viewerUid) {
                setGuestPromptMessage(
                  'Sign in to view and manage your saved campus events.'
                );
                return;
              }
              setActiveTab('saved');
            }}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === 'saved'
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            Saved Events
            {viewerUid && savedEventsCount > 0 && (
              <span className="tabular-nums text-[#1E88E5]">
                ({savedEventsCount})
              </span>
            )}
          </button>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex min-h-[34px] items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {/* Search & Filter Controls */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events by title, organiser, category, venue, or keyword..."
            aria-label="Filter campus events"
            className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
          />
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">
              Category
            </span>
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'all' | EventCategory)
              }
              aria-label="Filter by event category"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
            >
              <option value="all">All Categories</option>
              {EVENT_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as EventStatusFilter)
              }
              aria-label="Filter by event status"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
            >
              <option value="all">All Statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">
              Date
            </span>
            <select
              value={dateWindowFilter}
              onChange={(e) =>
                setDateWindowFilter(e.target.value as EventDateWindowFilter)
              }
              aria-label="Filter by event date"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">
              Venue
            </span>
            <select
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
              aria-label="Filter by event venue"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
            >
              <option value="all">All Venues</option>
              {availableVenues.map((venue) => (
                <option key={venue} value={venue}>
                  {venue}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {guestPromptMessage && (
        <GuestPromptCard
          title="Sign in to interact with campus events"
          description={guestPromptMessage}
          returnRoute="upcoming-events"
          onRequireAuth={onRequireAuth}
          onDismiss={() => setGuestPromptMessage(null)}
        />
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Calendar
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            {activeTab === 'saved'
              ? 'No saved events match your filters'
              : hasActiveFilters
                ? 'No campus events match your filters'
                : 'No campus events published yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            {activeTab === 'saved'
              ? 'Save upcoming lectures, workshops, orientations, or social events to keep track of them here.'
              : hasActiveFilters
                ? 'Try adjusting your category, status, date, venue, or search keywords.'
                : 'Campus lectures, seminars, orientations, competitions, and student union activities will appear here once published.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              Reset All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEvents.map((evt) => (
            <EventCard
              key={evt.id}
              event={evt}
              nowMs={nowMs}
              isLiked={likedIds.has(evt.id)}
              isSaved={savedIds.has(evt.id)}
              onOpenDetails={(id, focusComments) =>
                openDetails(id, Boolean(focusComments))
              }
              onToggleLike={handleToggleLike}
              onToggleSave={handleToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
};

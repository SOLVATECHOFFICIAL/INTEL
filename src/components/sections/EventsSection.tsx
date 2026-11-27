import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  fetchCampusEventById,
  fetchPublishedCampusEvents,
  toggleEventReaction,
} from '../../services/events';
import { prefetchMediaImages } from '../../services/mediaStorage';
import {
  getEventsSessionSnapshot,
  hydrateEventsSnapshot,
  saveEventsSessionSnapshot,
} from '../../services/navigationStateCache';
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
import {
  mergeOrderedRecords,
  reuseSetIfUnchanged,
} from '../../utils/cacheSync';
import { isDataSaverConnection } from '../../utils/mediaCache';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { SectionRibbon } from '../shared/SectionRibbon';
import { EventCard } from './events/EventCard';
import { EventDetailsView } from './events/EventDetailsView';

interface EventsSectionProps {
  selectedEventId?: string | null;
  selectedCommentId?: string | null;
  onSelectEvent?: (eventId: string | null) => void;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const EventsSection: React.FC<EventsSectionProps> = ({
  selectedEventId = null,
  selectedCommentId = null,
  onSelectEvent,
  onNavigateProfile,
  onRequireAuth,
}) => {
  const { user, isSuspended } = useFirebase();
  const viewerUid = user?.uid ?? null;
  const viewerKey = viewerUid ?? 'guest';
  const initialCache = getEventsSessionSnapshot(viewerKey);

  const [events, setEvents] = useState<CampusEvent[]>(
    () => initialCache?.events ?? []
  );
  const [likedIds, setLikedIds] = useState<Set<string>>(
    () => initialCache?.likedIds ?? new Set()
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => initialCache?.savedIds ?? new Set()
  );
  const [loading, setLoading] = useState(() => !initialCache);
  const [hydratedViewerKey, setHydratedViewerKey] = useState<string>(() =>
    initialCache ? viewerKey : ''
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeTab, setActiveTab] = useState<'all' | 'saved'>(
    () => initialCache?.activeTab ?? 'all'
  );
  const [searchQuery, setSearchQuery] = useState(
    () => initialCache?.searchQuery ?? ''
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | EventCategory>(
    () => initialCache?.categoryFilter ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>(
    () => initialCache?.statusFilter ?? 'all'
  );
  const [dateWindowFilter, setDateWindowFilter] =
    useState<EventDateWindowFilter>(
      () => initialCache?.dateWindowFilter ?? 'all'
    );
  const [venueFilter, setVenueFilter] = useState(
    () => initialCache?.venueFilter ?? 'all'
  );

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(
    selectedEventId
  );
  const [directLookupResult, setDirectLookupResult] = useState<{
    targetId: string;
    event: CampusEvent | null;
  } | null>(() => initialCache?.directLookupResult ?? null);
  const [lightboxByEventId, setLightboxByEventId] = useState<
    Record<string, number | null>
  >(() => initialCache?.lightboxByEventId ?? {});

  const [focusCommentsOnOpen, setFocusCommentsOnOpen] = useState(false);
  const [guestPromptMessage, setGuestPromptMessage] = useState<string | null>(
    null
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Prevent duplicate concurrent like/save toggles per event ID
  const likeInFlightRef = useRef<Set<string>>(new Set());
  const saveInFlightRef = useRef<Set<string>>(new Set());
  const lastHandledReloadRef = useRef(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const eventsRef = useRef(events);
  const viewerUidRef = useRef(viewerUid);
  const hydratedViewerKeyRef = useRef(hydratedViewerKey);
  useEffect(() => {
    eventsRef.current = events;
    viewerUidRef.current = viewerUid;
    hydratedViewerKeyRef.current = hydratedViewerKey;
  }, [events, viewerUid, hydratedViewerKey]);

  const prefetchEventMedia = useCallback((items: readonly CampusEvent[]) => {
    if (isDataSaverConnection()) return;
    const ids = items
      .slice(0, 6)
      .map((evt) => evt.mediaItems?.[0]?.imageId);
    if (ids.some(Boolean)) {
      void prefetchMediaImages(ids);
    }
  }, []);

  const syncEventsFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      if (
        mode === 'background' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }

      const uid = viewerUidRef.current;
      const expectedViewerKey = uid ?? 'guest';
      const likesPromise = uid
        ? fetchViewerLikedPostIds('events', uid).catch(() => null)
        : Promise.resolve(new Set<string>());

      const savedPromise = uid
        ? fetchViewerSavedPostIds('events', uid).catch(() => null)
        : Promise.resolve(new Set<string>());

      const [loadedEvents, viewerLiked, viewerSaved] = await Promise.all([
        fetchPublishedCampusEvents(),
        likesPromise,
        savedPromise,
      ]);

      if (isCancelled?.() || viewerUidRef.current !== uid) return;

      const alreadyHydrated = hydratedViewerKeyRef.current === expectedViewerKey;

      setEvents((prev) =>
        mode === 'background' && prev.length > 0
          ? mergeOrderedRecords({
              existing: prev,
              incoming: loadedEvents,
              preferIncomingOrder: false,
              preserveTail: false,
            })
          : loadedEvents
      );
      if (viewerLiked !== null) {
        setLikedIds((prev) => reuseSetIfUnchanged(prev, viewerLiked));
      } else if (mode === 'initial' || !alreadyHydrated) {
        setLikedIds(new Set());
      }
      if (viewerSaved !== null) {
        setSavedIds((prev) => reuseSetIfUnchanged(prev, viewerSaved));
      } else if (mode === 'initial' || !alreadyHydrated) {
        setSavedIds(new Set());
      }
      hydratedViewerKeyRef.current = expectedViewerKey;
      setHydratedViewerKey(expectedViewerKey);
      setErrorMessage(null);
      setLoading(false);
      prefetchEventMedia(loadedEvents);
    },
    [prefetchEventMedia]
  );

  useEffect(() => {
    let active = true;
    let networkSettled = false;
    let timer: number | null = null;

    const cached = getEventsSessionSnapshot(viewerKey);
    if (cached && reloadNonce === lastHandledReloadRef.current) {
      if (hydratedViewerKeyRef.current !== viewerKey) {
        hydratedViewerKeyRef.current = viewerKey;
        timer = window.setTimeout(() => {
          if (!active) return;
          setEvents(cached.events);
          setLikedIds(cached.likedIds);
          setSavedIds(cached.savedIds);
          setActiveTab(cached.activeTab);
          setSearchQuery(cached.searchQuery);
          setCategoryFilter(cached.categoryFilter);
          setStatusFilter(cached.statusFilter);
          setDateWindowFilter(cached.dateWindowFilter);
          setVenueFilter(cached.venueFilter);
          setLightboxByEventId(cached.lightboxByEventId);
          setHydratedViewerKey(viewerKey);
          setLoading(false);
        }, 0);
      }
      prefetchEventMedia(cached.events);
      if (Date.now() - cached.cachedAt > 2_000) {
        void syncEventsFromNetwork('background', () => !active).catch(
          () => undefined
        );
      }
      return () => {
        active = false;
        if (timer !== null) window.clearTimeout(timer);
      };
    }
    lastHandledReloadRef.current = reloadNonce;
    if (hydratedViewerKeyRef.current !== viewerKey) {
      timer = window.setTimeout(() => {
        if (!active || networkSettled) return;
        setLikedIds(new Set());
        setSavedIds(new Set());
      }, 0);
    }

    const run = async () => {
      if (reloadNonce === 0) {
        const persisted = await hydrateEventsSnapshot(viewerKey);
        if (active && !networkSettled && persisted) {
          hydratedViewerKeyRef.current = viewerKey;
          setEvents(persisted.events);
          setLikedIds(persisted.likedIds);
          setSavedIds(persisted.savedIds);
          setActiveTab(persisted.activeTab);
          setSearchQuery(persisted.searchQuery);
          setCategoryFilter(persisted.categoryFilter);
          setStatusFilter(persisted.statusFilter);
          setDateWindowFilter(persisted.dateWindowFilter);
          setVenueFilter(persisted.venueFilter);
          setLightboxByEventId(persisted.lightboxByEventId);
          setHydratedViewerKey(viewerKey);
          setLoading(false);
          prefetchEventMedia(persisted.events);

          await syncEventsFromNetwork('background', () => !active).catch(
            () => undefined
          );
          return;
        }
      }

      await syncEventsFromNetwork('initial', () => !active);
      networkSettled = true;
    };

    void run()
      .catch((error) => {
        if (!active) return;
        if (eventsRef.current.length === 0) {
          setErrorMessage(
            formatFirestoreOrAppError(
              error,
              'Unable to load campus events right now.'
            )
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [viewerKey, viewerUid, reloadNonce, prefetchEventMedia, syncEventsFromNetwork]);

  useActiveBackgroundRefresh({
    enabled: !loading && hydratedViewerKey === viewerKey,
    onRefresh: () => syncEventsFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  useEffect(() => {
    if (loading || hydratedViewerKey !== viewerKey) return;
    saveEventsSessionSnapshot({
      viewerKey,
      events,
      likedIds,
      savedIds,
      activeTab,
      searchQuery,
      categoryFilter,
      statusFilter,
      dateWindowFilter,
      venueFilter,
      directLookupResult,
      lightboxByEventId,
      cachedAt: Date.now(),
    });
  }, [
    loading,
    hydratedViewerKey,
    viewerKey,
    events,
    likedIds,
    savedIds,
    activeTab,
    searchQuery,
    categoryFilter,
    statusFilter,
    dateWindowFilter,
    venueFilter,
    directLookupResult,
    lightboxByEventId,
  ]);

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
      <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-300">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading campus events...
      </div>
    );
  }

  if (errorMessage && events.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/60 dark:bg-red-950/40">
        <AlertCircle
          className="mx-auto mb-2 h-6 w-6 text-red-700 dark:text-red-400"
          aria-hidden="true"
        />
        <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
          Unable to load campus events
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-300">
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setErrorMessage(null);
            setReloadNonce((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
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
        <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-300">
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
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Events
          </button>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
            <Calendar
              className="mx-auto mb-2 h-6 w-6 text-slate-400"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
              Event not available
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400">
              This event may have been removed or unpublished.
            </p>
            <button
              type="button"
              onClick={() => openDetails(null)}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
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
        initialLightboxIndex={lightboxByEventId[selectedEvent.id] ?? null}
        onLightboxIndexChange={(idx) =>
          setLightboxByEventId((prev) => ({
            ...prev,
            [selectedEvent.id]: idx,
          }))
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
        <SectionRibbon
          variant="sublist"
          ariaLabel="Campus events views"
          items={[
            { id: 'all', label: 'All Events', count: events.length },
            {
              id: 'saved',
              label: 'Saved Events',
              count: viewerUid ? savedEventsCount : undefined,
              icon: <Bookmark className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />,
            },
          ]}
          activeId={activeTab}
          onChange={(tabId) => {
            if (tabId === 'saved' && !viewerUid) {
              setGuestPromptMessage('Sign in to view your saved campus events.');
              return;
            }
            setActiveTab(tabId);
          }}
          className="sm:w-fit"
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex min-h-[34px] items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {/* Quick Category Ribbon */}
      <SectionRibbon
        variant="primary"
        ariaLabel="Filter events by category"
        items={[
          { id: 'all', label: 'All Categories' },
          ...EVENT_CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label })),
        ]}
        activeId={categoryFilter}
        onChange={(catId) => setCategoryFilter(catId as 'all' | EventCategory)}
      />

      {/* Search & Filter Controls */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events by title, venue, or organiser..."
            aria-label="Filter campus events"
            className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as EventStatusFilter)
              }
              aria-label="Filter by event status"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All Statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Date
            </span>
            <select
              value={dateWindowFilter}
              onChange={(e) =>
                setDateWindowFilter(e.target.value as EventDateWindowFilter)
              }
              aria-label="Filter by event date"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Venue
            </span>
            <select
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
              aria-label="Filter by event venue"
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <Calendar
            className="mx-auto mb-2.5 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
            {activeTab === 'saved'
              ? 'No saved events match your filters'
              : hasActiveFilters
                ? 'No campus events match your filters'
                : 'No campus events published yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400">
            {activeTab === 'saved'
              ? 'Save events to find them quickly here.'
              : hasActiveFilters
                ? 'Try changing your search or filters.'
                : 'Upcoming campus events will show up here.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 inline-flex min-h-[38px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
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

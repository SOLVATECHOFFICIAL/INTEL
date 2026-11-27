import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  fetchOfficialUpdatesPage,
  fetchSingleOfficialUpdate,
} from '../../services/adminUpdates';
import { subscribeCacheMutations } from '../../services/cacheInvalidation';
import {
  getAdminUpdatesSnapshot,
  saveAdminUpdatesSnapshot,
} from '../../services/navigationStateCache';
import {
  fetchViewerLikedPostIds,
  fetchViewerSavedPostIds,
} from '../../services/socialPosts';
import {
  ALLOWED_ADMIN_UPDATE_CATEGORIES,
  type AdminUpdate,
  type PublicProfileProjection,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  formatFirestoreOrAppError,
  isDesignatedSupremeAdminUser,
} from '../../utils/authValidation';
import {
  mergeAnchoredFeedStream,
  pickFresherRecordPreservingRef,
  reuseSetIfUnchanged,
} from '../../utils/cacheSync';
import { SectionRibbon } from '../shared/SectionRibbon';
import { UpdateCard } from '../updates/UpdateCard';
import { UpdateComposerModal } from '../updates/UpdateComposerModal';

const CATEGORY_FILTER_OPTIONS = [
  { id: 'all', label: 'All Updates' },
  { id: 'announcement', label: 'Announcement' },
  { id: 'academic', label: 'Academic' },
  { id: 'campus_life', label: 'Campus Life' },
  { id: 'security', label: 'Security' },
  { id: 'urgent', label: 'Urgent' },
] as const;

export interface UpdatesSectionProps {
  selectedUpdateId?: string | null;
  focusedCommentId?: string | null;
  onNavigateProfile?: (username: string) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const UpdatesSection: React.FC<UpdatesSectionProps> = ({
  selectedUpdateId = null,
  focusedCommentId = null,
  onNavigateProfile,
  onRequireAuth,
}) => {
  const { user, profile, authReady, effectiveTier, isSuspended } = useFirebase();
  const viewerKey = user?.uid ?? 'guest';
  const initialSnap = getAdminUpdatesSnapshot(viewerKey);

  const canPublishOfficialUpdate =
    authReady &&
    Boolean(user?.uid) &&
    !isSuspended &&
    effectiveTier === 'supreme_admin' &&
    isDesignatedSupremeAdminUser(user);

  const [updates, setUpdates] = useState<AdminUpdate[]>(
    () => initialSnap?.updates ?? []
  );
  const [authorMap, setAuthorMap] = useState<
    Map<string, PublicProfileProjection>
  >(() => initialSnap?.authorMap ?? new Map());
  const [likedIds, setLikedIds] = useState<Set<string>>(
    () => initialSnap?.likedIds ?? new Set()
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => initialSnap?.savedIds ?? new Set()
  );
  const [hasMore, setHasMore] = useState<boolean>(
    () => initialSnap?.hasMore ?? false
  );
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(() => !initialSnap);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<AdminUpdate | null>(null);

  const prevViewerKeyRef = useRef(viewerKey);
  const likedIdsRef = useRef(likedIds);
  const savedIdsRef = useRef(savedIds);
  useEffect(() => {
    likedIdsRef.current = likedIds;
    savedIdsRef.current = savedIds;
  }, [likedIds, savedIds]);

  const activeAnchorUpdateIdRef = useRef<string | null>(null);
  const pendingScrollAdjustRef = useRef<{
    anchorId: string;
    beforeTop: number;
  } | null>(null);

  const loadUpdatesFeed = useCallback(
    async (
      options: { force?: boolean; mode?: 'initial' | 'background' } = {}
    ) => {
      let mode = options.mode ?? 'initial';
      const expectedViewerKey = viewerKey;
      if (!options.force && mode === 'initial' && initialSnap && updates.length > 0) {
        if (Date.now() - initialSnap.cachedAt <= 2_000) {
          return;
        }
        mode = 'background';
      }
      if (
        mode === 'background' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }
      if (mode === 'initial') {
        setLoading(true);
        setErrorMessage(null);
      }
      try {
        const [page, viewerLikes, viewerSaved] = await Promise.all([
          fetchOfficialUpdatesPage({ pageSize: 18 }),
          user?.uid
            ? fetchViewerLikedPostIds('updates', user.uid).catch(() => null)
            : Promise.resolve(new Set<string>()),
          user?.uid
            ? fetchViewerSavedPostIds('updates', user.uid).catch(() => null)
            : Promise.resolve(new Set<string>()),
        ]);

        if (prevViewerKeyRef.current !== expectedViewerKey) {
          return;
        }

        let mergedItems = page.items;
        const mergedAuthors = new Map(page.authorMap);

        if (
          selectedUpdateId &&
          !mergedItems.some((item) => item.id === selectedUpdateId)
        ) {
          const single = await fetchSingleOfficialUpdate(selectedUpdateId).catch(
            () => null
          );
          if (prevViewerKeyRef.current !== expectedViewerKey) {
            return;
          }
          if (single) {
            mergedItems = [single.update, ...mergedItems];
            if (single.author && single.update.ownerUID) {
              mergedAuthors.set(single.update.ownerUID, single.author);
            }
          }
        }

        const isScrolledMidFeed =
          mode === 'background' &&
          typeof window !== 'undefined' &&
          window.scrollY > 140;
        const anchorId = isScrolledMidFeed ? activeAnchorUpdateIdRef.current : null;
        if (anchorId && typeof document !== 'undefined') {
          const el = document.querySelector<HTMLElement>(
            `[data-update-entry-id="${anchorId}"]`
          );
          if (el) {
            pendingScrollAdjustRef.current = {
              anchorId,
              beforeTop: el.getBoundingClientRect().top,
            };
          }
        }

        setUpdates((prev) => {
          if (mode === 'initial' || prev.length === 0) {
            return mergedItems;
          }
          const incomingIds = new Set(mergedItems.map((item) => item.id));
          let lastMatchedIdx = -1;
          for (let i = 0; i < prev.length; i += 1) {
            if (incomingIds.has(prev[i].id)) {
              lastMatchedIdx = i;
            }
          }
          const preserveMissingIds = new Set<string>();
          if (mergedItems.length > 0 && lastMatchedIdx >= 0) {
            let minIncomingTs = 0;
            for (const item of mergedItems) {
              const raw = item.createdAt ?? item.updatedAt;
              const ts =
                typeof raw === 'number'
                  ? raw
                  : typeof (raw as { toMillis?: () => number })?.toMillis === 'function'
                    ? (raw as { toMillis: () => number }).toMillis()
                    : 0;
              if (ts > 0) {
                minIncomingTs = minIncomingTs === 0 ? ts : Math.min(minIncomingTs, ts);
              }
            }
            for (let i = lastMatchedIdx + 1; i < prev.length; i += 1) {
              const item = prev[i];
              if (incomingIds.has(item.id)) continue;
              const raw = item.createdAt ?? item.updatedAt;
              const ts =
                typeof raw === 'number'
                  ? raw
                  : typeof (raw as { toMillis?: () => number })?.toMillis === 'function'
                    ? (raw as { toMillis: () => number }).toMillis()
                    : 0;
              if (minIncomingTs === 0 || ts <= minIncomingTs) {
                preserveMissingIds.add(item.id);
              }
            }
          }
          const merged = mergeAnchoredFeedStream({
            existing: prev,
            incoming: mergedItems,
            anchorId,
            isScrolledMidFeed,
            fallbackPrependUnseen: true,
            pruneMissing: true,
            preserveMissingIds,
            resolveUpdatedItem: (existingItem, nextItem) =>
              pickFresherRecordPreservingRef(existingItem, nextItem),
          });
          return merged.items;
        });
        setAuthorMap((prev) => {
          if (mode === 'initial' || prev.size === 0) return mergedAuthors;
          const next = new Map(prev);
          mergedAuthors.forEach((v, k) => next.set(k, v));
          return next;
        });
        const resolvedLikes =
          viewerLikes !== null
            ? viewerLikes
            : mode === 'initial'
              ? new Set<string>()
              : likedIdsRef.current;
        const resolvedSaved =
          viewerSaved !== null
            ? viewerSaved
            : mode === 'initial'
              ? new Set<string>()
              : savedIdsRef.current;
        if (viewerLikes !== null || mode === 'initial') {
          setLikedIds((prev) => reuseSetIfUnchanged(prev, resolvedLikes));
        }
        if (viewerSaved !== null || mode === 'initial') {
          setSavedIds((prev) => reuseSetIfUnchanged(prev, resolvedSaved));
        }
        if (mode === 'initial') {
          setCursor(page.nextCursor);
          setHasMore(page.hasMore);
        }

        saveAdminUpdatesSnapshot({
          viewerKey: expectedViewerKey,
          updates: mergedItems,
          authorMap: mergedAuthors,
          likedIds: resolvedLikes,
          savedIds: resolvedSaved,
          hasMore: page.hasMore,
          cachedAt: Date.now(),
        });
      } catch (err) {
        if (mode === 'initial') {
          setErrorMessage(
            formatFirestoreOrAppError(
              err,
              'Could not load official updates right now.'
            )
          );
        }
      } finally {
        if (mode === 'initial') {
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerKey, user?.uid, selectedUpdateId]
  );

  useEffect(() => {
    let timer: number | null = null;
    if (prevViewerKeyRef.current !== viewerKey) {
      prevViewerKeyRef.current = viewerKey;
      const snap = getAdminUpdatesSnapshot(viewerKey);
      timer = window.setTimeout(() => {
        setLikedIds(snap?.likedIds ?? new Set());
        setSavedIds(snap?.savedIds ?? new Set());
      }, 0);
      void loadUpdatesFeed({ force: true, mode: 'initial' });
      return () => {
        if (timer !== null) window.clearTimeout(timer);
      };
    }
    void loadUpdatesFeed();
    return undefined;
  }, [viewerKey, loadUpdatesFeed]);

  useActiveBackgroundRefresh({
    enabled: !loading,
    onRefresh: () => loadUpdatesFeed({ mode: 'background', force: true }),
    baseIntervalMs: 5000,
  });

  useLayoutEffect(() => {
    const adjust = pendingScrollAdjustRef.current;
    if (!adjust || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    pendingScrollAdjustRef.current = null;
    const el = document.querySelector<HTMLElement>(
      `[data-update-entry-id="${adjust.anchorId}"]`
    );
    if (!el) return;
    const delta = el.getBoundingClientRect().top - adjust.beforeTop;
    if (Math.abs(delta) > 1) {
      window.scrollBy(0, delta);
    }
  }, [updates]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-update-entry-id]')
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestId: string | null = null;
        let bestDist = Infinity;
        const targetY = typeof window !== 'undefined' ? window.innerHeight * 0.28 : 200;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.updateEntryId;
          if (!id) continue;
          const dist = Math.abs(entry.boundingClientRect.top - targetY);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        }
        if (bestId) {
          activeAnchorUpdateIdRef.current = bestId;
        }
      },
      { threshold: [0.35, 0.65] }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [updates, activeCategory]);

  // Ensure deep-linked update is fetched even if feed already cached
  useEffect(() => {
    if (!selectedUpdateId) return;
    if (updates.some((u) => u.id === selectedUpdateId)) return;
    let active = true;
    void fetchSingleOfficialUpdate(selectedUpdateId)
      .then((res) => {
        if (!active || !res) return;
        setUpdates((prev) =>
          prev.some((u) => u.id === res.update.id)
            ? prev
            : [res.update, ...prev]
        );
        if (res.author && res.update.ownerUID) {
          setAuthorMap((prev) => {
            const next = new Map(prev);
            next.set(res.update.ownerUID!, res.author!);
            return next;
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedUpdateId, updates]);

  // Listen for cross-page cache mutations
  useEffect(() => {
    return subscribeCacheMutations((event) => {
      if (event.type === 'admin_update_created') {
        setUpdates((prev) =>
          prev.some((u) => u.id === event.update.id)
            ? prev
            : [event.update, ...prev]
        );
        if (event.author && event.update.ownerUID) {
          setAuthorMap((prev) => {
            const next = new Map(prev);
            next.set(event.update.ownerUID!, event.author!);
            return next;
          });
        }
      } else if (event.type === 'admin_update_updated') {
        setUpdates((prev) =>
          prev.map((u) => (u.id === event.update.id ? event.update : u))
        );
      } else if (event.type === 'admin_update_deleted') {
        setUpdates((prev) => prev.filter((u) => u.id !== event.updateId));
      } else if (event.type === 'admin_update_reaction') {
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (event.liked) next.add(event.updateId);
          else next.delete(event.updateId);
          return next;
        });
        setUpdates((prev) =>
          prev.map((u) =>
            u.id === event.updateId ? { ...u, likesCount: event.likesCount } : u
          )
        );
      } else if (event.type === 'admin_update_saved') {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (event.saved) next.add(event.updateId);
          else next.delete(event.updateId);
          return next;
        });
      } else if (event.type === 'admin_update_comment_mutated') {
        setUpdates((prev) =>
          prev.map((u) =>
            u.id === event.updateId
              ? { ...u, commentsCount: event.commentsCount }
              : u
          )
        );
      }
    });
  }, []);

  const handleLoadMore = async () => {
    if (!hasMore || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchOfficialUpdatesPage({
        pageSize: 18,
        cursor,
      });
      setUpdates((prev) => {
        const seen = new Set(prev.map((u) => u.id));
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setAuthorMap((prev) => {
        const next = new Map(prev);
        page.authorMap.forEach((v, k) => next.set(k, v));
        return next;
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(err, 'Could not load older updates.')
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredUpdates = useMemo(() => {
    if (activeCategory === 'all') return updates;
    return updates.filter(
      (u) => u.category.toLowerCase() === activeCategory.toLowerCase()
    );
  }, [updates, activeCategory]);

  return (
    <section
      aria-label="Official Administrator Updates"
      className="min-w-0 max-w-full space-y-4 pb-20 sm:pb-12"
    >
      {/* Category Filter Ribbon + Official Update Trigger */}
      <div className="flex min-w-0 max-w-full flex-col gap-2.5 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-sky-50/45 to-blue-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80">
        <div className="min-w-0 flex-1">
          <SectionRibbon
            variant="primary"
            ariaLabel="Official update categories"
            items={CATEGORY_FILTER_OPTIONS.filter(
              (opt) =>
                opt.id === 'all' ||
                ALLOWED_ADMIN_UPDATE_CATEGORIES.includes(
                  opt.id as (typeof ALLOWED_ADMIN_UPDATE_CATEGORIES)[number]
                )
            ).map((cat) => ({ id: cat.id, label: cat.label }))}
            activeId={activeCategory}
            onChange={(id) => setActiveCategory(id)}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {canPublishOfficialUpdate && (
            <button
              type="button"
              data-testid="updates-header-create-btn"
              onClick={() => {
                setEditingUpdate(null);
                setComposerOpen(true);
              }}
              className="lasued-accent-gradient inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Official Update
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadUpdatesFeed({ force: true })}
            disabled={loading}
            aria-label="Refresh official updates"
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feed Content */}
      {loading && updates.length === 0 ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Loader2
            className="h-5 w-5 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          <span>Loading official updates...</span>
        </div>
      ) : errorMessage && updates.length === 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center dark:border-red-900/60 dark:bg-red-950/40">
          <AlertCircle
            className="mx-auto mb-2 h-6 w-6 text-red-700 dark:text-red-400"
            aria-hidden="true"
          />
          <p className="font-display text-sm font-bold text-[#0B1A2E] dark:text-white">
            Unable to load Official Updates
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-300">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => void loadUpdatesFeed({ force: true })}
            className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E88E5] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try Again
          </button>
        </div>
      ) : filteredUpdates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <Megaphone
            className="mx-auto mb-2.5 h-6 w-6 text-[#1E88E5]"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
            No official updates yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400">
            {activeCategory === 'all'
              ? 'Official campus notices will appear here when posted.'
              : 'No official updates in this category right now.'}
          </p>
          {canPublishOfficialUpdate && activeCategory === 'all' && (
            <button
              type="button"
              onClick={() => {
                setEditingUpdate(null);
                setComposerOpen(true);
              }}
              className="lasued-accent-gradient mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Publish First Update
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredUpdates.map((update) => {
            const isTarget = selectedUpdateId === update.id;
            return (
              <div key={update.id} data-update-entry-id={update.id}>
                <UpdateCard
                  update={update}
                  author={
                    update.authorMode === 'public_admin' && update.ownerUID
                      ? authorMap.get(update.ownerUID) ?? null
                      : null
                  }
                  viewerUid={user?.uid ?? null}
                  viewerTier={effectiveTier}
                  viewerSuspended={isSuspended}
                  isLiked={likedIds.has(update.id)}
                  isSaved={savedIds.has(update.id)}
                  defaultCommentsOpen={isTarget && Boolean(focusedCommentId)}
                  isHighlighted={isTarget}
                  highlightCommentId={isTarget ? focusedCommentId : null}
                  onEditUpdate={
                    canPublishOfficialUpdate
                      ? (item) => {
                          setEditingUpdate(item);
                          setComposerOpen(true);
                        }
                      : undefined
                  }
                  onUpdateMutated={(updated) => {
                    setUpdates((prev) =>
                      prev.map((u) => (u.id === updated.id ? updated : u))
                    );
                  }}
                  onUpdateDeleted={(deletedId) => {
                    setUpdates((prev) => prev.filter((u) => u.id !== deletedId));
                  }}
                  onSaveChanged={(id, saved) => {
                    setSavedIds((prev) => {
                      const next = new Set(prev);
                      if (saved) next.add(id);
                      else next.delete(id);
                      return next;
                    });
                  }}
                  onNavigateProfile={onNavigateProfile}
                  onRequireAuth={onRequireAuth}
                  returnRoute="updates"
                />
              </div>
            );
          })}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore()}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
              >
                {loadingMore && (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-[#1E88E5]"
                    aria-hidden="true"
                  />
                )}
                <span>Load older updates</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating + Create Button: Visible STRICTLY to Designated Supreme Admins */}
      {canPublishOfficialUpdate && (
        <button
          type="button"
          data-testid="updates-create-fab"
          aria-label="Create official update"
          title="Create official update"
          onClick={() => {
            setEditingUpdate(null);
            setComposerOpen(true);
          }}
          className="lasued-accent-gradient fixed right-4 bottom-20 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white transition hover:brightness-110 lg:right-8 lg:bottom-8 dark:ring-slate-900"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {/* Create / Edit Official Update Composer Modal */}
      {composerOpen && canPublishOfficialUpdate && user?.uid && (
        <UpdateComposerModal
          actorUid={user.uid}
          actorRole="supreme_admin"
          actorName={profile?.fullName}
          actorPhotoUrl={profile?.photoUrl}
          actorPhotoImageId={profile?.photoImageId}
          initialUpdate={editingUpdate}
          onSuccess={(savedUpdate, createdAuthor) => {
            setUpdates((prev) => {
              const exists = prev.some((u) => u.id === savedUpdate.id);
              if (exists) {
                return prev.map((u) =>
                  u.id === savedUpdate.id ? savedUpdate : u
                );
              }
              return [savedUpdate, ...prev];
            });
            if (createdAuthor && savedUpdate.ownerUID) {
              setAuthorMap((prev) => {
                const next = new Map(prev);
                next.set(savedUpdate.ownerUID!, createdAuthor);
                return next;
              });
            }
            setComposerOpen(false);
            setEditingUpdate(null);
          }}
          onClose={() => {
            setComposerOpen(false);
            setEditingUpdate(null);
          }}
        />
      )}
    </section>
  );
};

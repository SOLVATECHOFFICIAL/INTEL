import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
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

  const loadUpdatesFeed = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!options.force && initialSnap && updates.length > 0) {
        return;
      }
      setLoading(true);
      setErrorMessage(null);
      try {
        const [page, viewerLikes, viewerSaved] = await Promise.all([
          fetchOfficialUpdatesPage({ pageSize: 18 }),
          user?.uid
            ? fetchViewerLikedPostIds('updates', user.uid).catch(
                () => new Set<string>()
              )
            : Promise.resolve(new Set<string>()),
          user?.uid
            ? fetchViewerSavedPostIds('updates', user.uid).catch(
                () => new Set<string>()
              )
            : Promise.resolve(new Set<string>()),
        ]);

        let mergedItems = page.items;
        const mergedAuthors = new Map(page.authorMap);

        if (
          selectedUpdateId &&
          !mergedItems.some((item) => item.id === selectedUpdateId)
        ) {
          const single = await fetchSingleOfficialUpdate(selectedUpdateId).catch(
            () => null
          );
          if (single) {
            mergedItems = [single.update, ...mergedItems];
            if (single.author && single.update.ownerUID) {
              mergedAuthors.set(single.update.ownerUID, single.author);
            }
          }
        }

        setUpdates(mergedItems);
        setAuthorMap(mergedAuthors);
        setLikedIds(viewerLikes);
        setSavedIds(viewerSaved);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);

        saveAdminUpdatesSnapshot({
          viewerKey,
          updates: mergedItems,
          authorMap: mergedAuthors,
          likedIds: viewerLikes,
          savedIds: viewerSaved,
          hasMore: page.hasMore,
          cachedAt: Date.now(),
        });
      } catch (err) {
        setErrorMessage(
          formatFirestoreOrAppError(
            err,
            'Could not load official updates right now.'
          )
        );
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerKey, user?.uid, selectedUpdateId]
  );

  useEffect(() => {
    if (prevViewerKeyRef.current !== viewerKey) {
      prevViewerKeyRef.current = viewerKey;
      void loadUpdatesFeed({ force: true });
      return;
    }
    void loadUpdatesFeed();
  }, [viewerKey, loadUpdatesFeed]);

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
      className="space-y-4 pb-12"
    >
      {/* Category Filter Strip */}
      <div className="flex flex-nowrap items-center justify-between gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4">
        <div className="flex flex-nowrap items-center gap-1.5">
          {CATEGORY_FILTER_OPTIONS.filter(
            (opt) =>
              opt.id === 'all' ||
              ALLOWED_ADMIN_UPDATE_CATEGORIES.includes(
                opt.id as (typeof ALLOWED_ADMIN_UPDATE_CATEGORIES)[number]
              )
          ).map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`min-h-[34px] shrink-0 rounded-lg px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#0B1A2E] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void loadUpdatesFeed({ force: true })}
          disabled={loading}
          aria-label="Refresh official updates"
          className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Feed Content */}
      {loading && updates.length === 0 ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-600">
          <Loader2
            className="h-5 w-5 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          <span>Loading official administrator updates...</span>
        </div>
      ) : errorMessage && updates.length === 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center">
          <AlertCircle
            className="mx-auto mb-2 h-6 w-6 text-red-700"
            aria-hidden="true"
          />
          <p className="font-display text-sm font-bold text-[#0B1A2E]">
            Unable to load Official Updates
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => void loadUpdatesFeed({ force: true })}
            className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E88E5]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try Again
          </button>
        </div>
      ) : filteredUpdates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <Megaphone
            className="mx-auto mb-2.5 h-6 w-6 text-[#1E88E5]"
            aria-hidden="true"
          />
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            No official updates yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            {activeCategory === 'all'
              ? 'Official university notices and administrator updates will appear here as soon as they are published.'
              : 'There are no published official updates in this category right now.'}
          </p>
          {canPublishOfficialUpdate && activeCategory === 'all' && (
            <button
              type="button"
              onClick={() => {
                setEditingUpdate(null);
                setComposerOpen(true);
              }}
              className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E88E5]"
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
              <UpdateCard
                key={update.id}
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
            );
          })}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore()}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
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
          className="fixed right-4 bottom-20 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#0B1A2E] text-white shadow-lg ring-2 ring-white transition hover:bg-[#1E88E5] lg:right-8 lg:bottom-8"
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

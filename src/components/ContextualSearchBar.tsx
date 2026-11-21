import React, { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Calendar,
  ExternalLink,
  Loader2,
  MessageCircle,
  Search,
  ShoppingBag,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import {
  fetchViewerFollowingUsernames,
  followMemberByUsername,
  searchAnonymousScope,
  searchEventsScope,
  searchHomeScope,
  searchMarketplaceScope,
  searchOpportunitiesScope,
  searchTrustedCircleScope,
  unfollowMemberByUsername,
  type HomeSearchResult,
} from '../services/firestoreFoundation';
import type {
  AnonymousPost,
  CampusEvent,
  MarketplaceListing,
  Opportunity,
  TrustedContact,
} from '../types/database';
import type { ActiveRoute, SearchScopeId } from '../types/platform';
import { buildWhatsAppChatUrl } from '../utils/authValidation';
import {
  FIRESTORE_SEARCH_SCOPE_NOTE,
  SEARCH_SCOPE_CONFIG,
} from '../utils/contextualSearch';
import { GuestPromptCard } from './auth/GuestPromptCard';

interface ContextualSearchBarProps {
  scope: SearchScopeId;
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string; searchScope?: SearchScopeId }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  returnRoute: ActiveRoute;
  embedded?: boolean;
}

export const ContextualSearchBar: React.FC<ContextualSearchBarProps> = ({
  scope,
  onNavigate,
  onRequireAuth,
  returnRoute,
  embedded = false,
}) => {
  const { user, profile, isSuspended, refreshAccountState } = useFirebase();
  const scopeMeta = SEARCH_SCOPE_CONFIG[scope];

  const [queryText, setQueryText] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );

  const [homeResults, setHomeResults] = useState<HomeSearchResult>({
    members: [],
    posts: [],
  });
  const [anonymousResults, setAnonymousResults] = useState<AnonymousPost[]>([]);
  const [marketplaceResults, setMarketplaceResults] = useState<
    MarketplaceListing[]
  >([]);
  const [trustedResults, setTrustedResults] = useState<TrustedContact[]>([]);
  const [opportunityResults, setOpportunityResults] = useState<Opportunity[]>(
    []
  );
  const [eventResults, setEventResults] = useState<CampusEvent[]>([]);

  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [pendingFollowUser, setPendingFollowUser] = useState<string | null>(
    null
  );
  const [guestPromptTarget, setGuestPromptTarget] = useState<string | null>(
    null
  );
  const [followError, setFollowError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || scope !== 'home') {
      return;
    }
    let active = true;
    fetchViewerFollowingUsernames(user.uid)
      .then((usernames) => {
        if (active) setFollowingSet(usernames);
      })
      .catch(() => {
        // Non-blocking enrichment
      });
    return () => {
      active = false;
    };
  }, [user, scope]);

  const executeSearch = useCallback(
    async (rawTerm: string) => {
      const trimmed = rawTerm.trim();
      setSubmittedQuery(trimmed);
      if (!trimmed) {
        setStatus('idle');
        return;
      }

      setStatus('loading');
      setFollowError(null);

      try {
        if (scope === 'home') {
          const data = await searchHomeScope(trimmed);
          setHomeResults(data);
        } else if (scope === 'anonymous') {
          const data = await searchAnonymousScope(trimmed);
          setAnonymousResults(data);
        } else if (scope === 'marketplace') {
          const data = await searchMarketplaceScope(trimmed);
          setMarketplaceResults(data);
        } else if (scope === 'trusted-circle') {
          const data = await searchTrustedCircleScope(trimmed);
          setTrustedResults(data);
        } else if (scope === 'opportunities') {
          const data = await searchOpportunitiesScope(trimmed);
          setOpportunityResults(data);
        } else if (scope === 'upcoming-events') {
          const data = await searchEventsScope(trimmed);
          setEventResults(data);
        }
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [scope]
  );

  useEffect(() => {
    const trimmed = queryText.trim();
    if (!trimmed) {
      return;
    }

    const timer = window.setTimeout(() => {
      void executeSearch(trimmed);
    }, 280);

    return () => window.clearTimeout(timer);
  }, [queryText, executeSearch]);

  const handleQueryChange = (value: string) => {
    setQueryText(value);
    if (!value.trim()) {
      setSubmittedQuery('');
      setStatus('idle');
    }
  };

  const handleToggleFollow = async (targetUsername: string) => {
    if (pendingFollowUser) return;
    setFollowError(null);

    if (!user) {
      setGuestPromptTarget(targetUsername);
      return;
    }
    if (isSuspended) {
      setFollowError('Suspended accounts cannot follow other members.');
      return;
    }
    if (profile?.username === targetUsername) {
      return;
    }

    const wasFollowing = followingSet.has(targetUsername);
    setPendingFollowUser(targetUsername);

    try {
      if (wasFollowing) {
        await unfollowMemberByUsername(user.uid, targetUsername);
      } else {
        await followMemberByUsername(user.uid, targetUsername);
      }
      setFollowingSet((prev) => {
        const next = new Set(prev);
        if (wasFollowing) {
          next.delete(targetUsername);
        } else {
          next.add(targetUsername);
        }
        return next;
      });
      await refreshAccountState();
    } catch (error) {
      setFollowError(
        error instanceof Error
          ? error.message
          : 'Unable to update follow status right now.'
      );
    } finally {
      setPendingFollowUser(null);
    }
  };

  const activeFollowingSet = user ? followingSet : new Set<string>();

  const hasResults =
    (scope === 'home' &&
      (homeResults.members.length > 0 || homeResults.posts.length > 0)) ||
    (scope === 'anonymous' && anonymousResults.length > 0) ||
    (scope === 'marketplace' && marketplaceResults.length > 0) ||
    (scope === 'trusted-circle' && trustedResults.length > 0) ||
    (scope === 'opportunities' && opportunityResults.length > 0) ||
    (scope === 'upcoming-events' && eventResults.length > 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-sm font-bold text-[#0B1A2E]">
            Search {scopeMeta.label}
          </p>
          <p className="text-xs text-slate-600">{scopeMeta.description}</p>
        </div>
        {embedded && (
          <button
            type="button"
            onClick={() => onNavigate('search', { searchScope: scope })}
            className="text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            Open Full Search
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void executeSearch(queryText);
        }}
        className="relative mt-3 flex gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={queryText}
            onChange={(e) => handleQueryChange(e.target.value)}
            aria-label={`Search ${scopeMeta.label}`}
            placeholder={scopeMeta.placeholder}
            className="block min-h-[44px] w-full rounded-xl border border-slate-300 bg-white py-2 pr-9 pl-10 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
          />
          {queryText && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              aria-label="Clear search query"
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] sm:text-sm"
        >
          Search
        </button>
      </form>

      {guestPromptTarget && (
        <div className="mt-4">
          <GuestPromptCard
            title={`Sign in to follow @${guestPromptTarget}`}
            description="Create a free account or sign in to follow campus members."
            returnRoute={returnRoute}
            onRequireAuth={onRequireAuth}
            onDismiss={() => setGuestPromptTarget(null)}
          />
        </div>
      )}

      {followError && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {followError}
        </div>
      )}

      {status === 'loading' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <Loader2
            className="h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          <span>Searching {scopeMeta.label.toLowerCase()}...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span>Unable to run contextual search right now.</span>
          <button
            type="button"
            onClick={() => void executeSearch(queryText)}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && !hasResults && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center">
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No matches for &ldquo;{submittedQuery}&rdquo;
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Nothing matched inside {scopeMeta.label}. {FIRESTORE_SEARCH_SCOPE_NOTE}
          </p>
        </div>
      )}

      {status === 'ready' && hasResults && (
        <div className="mt-4 space-y-4">
          {scope === 'home' && (
            <>
              {homeResults.members.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Campus Members ({homeResults.members.length})
                  </p>
                  <div className="space-y-2.5">
                    {homeResults.members.map((member) => {
                      const isOwn = profile?.username === member.username;
                      const isFollowing = activeFollowingSet.has(
                        member.username
                      );
                      const isBusy = pendingFollowUser === member.username;

                      return (
                        <div
                          key={member.username}
                          className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate('profile', {
                                username: member.username,
                              })
                            }
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0B1A2E] text-xs font-bold text-white">
                              {member.photoUrl ? (
                                <img
                                  src={member.photoUrl}
                                  alt={member.fullName}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span>
                                  {member.fullName.slice(0, 2).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-display text-sm font-bold text-[#0B1A2E]">
                                  {member.fullName}
                                </span>
                                {member.badge !== 'none' && (
                                  <BadgeCheck
                                    className="h-4 w-4 shrink-0 text-[#1E88E5]"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-600">
                                @{member.username}
                                {member.department
                                  ? ` · ${member.department}`
                                  : ''}
                                {member.level ? ` · ${member.level}` : ''}
                              </p>
                            </div>
                          </button>

                          {!isOwn && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleToggleFollow(member.username)
                              }
                              className={`inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                                isFollowing
                                  ? 'border border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50'
                                  : 'bg-[#1E88E5] text-white hover:bg-[#1565C0]'
                              }`}
                            >
                              {isBusy ? (
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : isFollowing ? (
                                <UserCheck
                                  className="h-3.5 w-3.5 text-[#1E88E5]"
                                  aria-hidden="true"
                                />
                              ) : (
                                <UserPlus
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{isFollowing ? 'Following' : 'Follow'}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {homeResults.posts.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Published Community Posts ({homeResults.posts.length})
                  </p>
                  <div className="space-y-2.5">
                    {homeResults.posts.map(({ post, author }) => (
                      <article
                        key={post.id}
                        className="rounded-xl border border-slate-200 p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          {author ? (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('profile', {
                                  username: author.username,
                                })
                              }
                              className="font-semibold text-[#0B1A2E] hover:text-[#1E88E5]"
                            >
                              {author.fullName} (@{author.username})
                            </button>
                          ) : (
                            <span>Campus Contributor</span>
                          )}
                          <span>{post.category}</span>
                        </div>
                        {post.title && (
                          <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                            {post.title}
                          </h3>
                        )}
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-700 sm:text-sm">
                          {post.body}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {scope === 'anonymous' && (
            <div className="space-y-2.5">
              {anonymousResults.map((post) => (
                <article
                  key={post.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Anonymous · {post.category}</span>
                    <span>Identity hidden</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                    {post.body}
                  </p>
                </article>
              ))}
            </div>
          )}

          {scope === 'marketplace' && (
            <div className="space-y-2.5">
              {marketplaceResults.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3.5 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <ShoppingBag
                        className="h-3.5 w-3.5 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      <span>
                        {item.listingKind} · {item.category}
                      </span>
                    </p>
                    <h3 className="mt-0.5 font-display text-sm font-bold text-[#0B1A2E]">
                      {item.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {item.description}
                    </p>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p className="font-display text-base font-bold text-[#0B1A2E] tabular-nums">
                      ₦{item.price.toLocaleString()}
                    </p>
                    {buildWhatsAppChatUrl(item.whatsappNumber) && (
                      <a
                        href={buildWhatsAppChatUrl(item.whatsappNumber)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#0B1A2E] px-3 py-1 text-xs font-semibold text-white hover:bg-[#132844]"
                      >
                        <MessageCircle
                          className="h-3 w-3 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        WhatsApp Seller
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {scope === 'trusted-circle' && (
            <div className="space-y-2.5">
              {trustedResults.map((contact) => (
                <article
                  key={contact.id}
                  className="rounded-xl border border-slate-200 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
                      {contact.fullName}
                    </h3>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      Official Contact (Admin-Listed)
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-[#1E88E5]">
                    {contact.roleTitle}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {[contact.department, contact.faculty]
                        .filter(Boolean)
                        .join(' · ') || 'Campus Office'}
                    </span>
                  </p>
                </article>
              ))}
            </div>
          )}

          {scope === 'opportunities' && (
            <div className="space-y-2.5">
              {opportunityResults.map((opp) => (
                <article
                  key={opp.id}
                  className="rounded-xl border border-slate-200 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-[#1E88E5]">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {opp.category}
                    </span>
                    <span>{opp.organisation}</span>
                  </div>
                  <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                    {opp.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                    {opp.description}
                  </p>
                  <a
                    href={opp.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
                  >
                    Open Application Link
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>
          )}

          {scope === 'upcoming-events' && (
            <div className="space-y-2.5">
              {eventResults.map((ev) => (
                <article
                  key={ev.id}
                  className="rounded-xl border border-slate-200 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-[#1E88E5]">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {ev.status === 'past' ? 'Past Event' : 'Upcoming Event'}
                    </span>
                    <span>{ev.organiser}</span>
                  </div>
                  <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                    {ev.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Venue: {ev.venue}
                    {ev.timeLabel ? ` · ${ev.timeLabel}` : ''}
                  </p>
                </article>
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            {FIRESTORE_SEARCH_SCOPE_NOTE}
          </p>
        </div>
      )}
    </div>
  );
};

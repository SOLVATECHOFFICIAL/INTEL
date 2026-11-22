import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { getAnonymousBackgroundTheme } from '../config/anonymousBackgrounds';
import {
  searchAnonymousScope,
  searchEventsScope,
  searchHomeScope,
  searchMarketplaceScope,
  searchOpportunitiesScope,
  searchTrustedCircleScope,
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
import { TRUSTED_CONTACT_CATEGORY_LABELS } from '../utils/followRelations';
import {
  formatOpportunityDeadlineSummary,
  getOpportunityCategoryLabel,
  getSafeApplicationUrl,
  resolveOpportunityLifecycle,
} from '../utils/opportunities';
import {
  formatEventDateTimeRange,
  getEventCategoryLabel,
  resolveEventLifecycle,
} from '../utils/events';
import { RoleBadge } from './RoleBadge';
import { TikTokFollowButton } from './TikTokFollowButton';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { AvatarMedia, FirestoreImage } from './media/FirestoreImage';

interface ContextualSearchBarProps {
  scope: SearchScopeId;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      searchScope?: SearchScopeId;
      opportunityId?: string | null;
      eventId?: string | null;
    }
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

  const [guestPromptTarget, setGuestPromptTarget] = useState<string | null>(
    null
  );

  const executeSearch = useCallback(
    async (rawTerm: string) => {
      const trimmed = rawTerm.trim();
      setSubmittedQuery(trimmed);
      if (!trimmed) {
        setStatus('idle');
        return;
      }

      setStatus('loading');

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
                    {homeResults.members.map((member) => (
                      <div
                        key={member.username}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
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
                          <AvatarMedia
                            fullName={member.fullName}
                            photoImageId={member.photoImageId}
                            photoUrl={member.photoUrl}
                            sizeClass="h-11 w-11"
                            roundedClass="rounded-xl"
                            textClass="text-xs"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-display text-sm font-bold text-[#0B1A2E]">
                                {member.fullName}
                              </span>
                              <RoleBadge badge={member.badge} size="xs" />
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

                        <TikTokFollowButton
                          targetUsername={member.username}
                          compact
                          onRequireAuth={() =>
                            setGuestPromptTarget(member.username)
                          }
                        />
                      </div>
                    ))}
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
                            <div className="flex flex-wrap items-center gap-1.5">
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
                              <RoleBadge badge={author.badge} size="xs" />
                              <TikTokFollowButton
                                targetUsername={author.username}
                                compact
                                onRequireAuth={() =>
                                  setGuestPromptTarget(author.username)
                                }
                              />
                            </div>
                          ) : (
                            <span>Campus Contributor</span>
                          )}
                          <div className="flex items-center gap-2">
                            {post.mediaItems && post.mediaItems.length > 0 && (
                              <span className="inline-flex items-center gap-1 font-medium text-[#1E88E5]">
                                <ImageIcon className="h-3 w-3" aria-hidden="true" />
                                {post.mediaItems.length}
                              </span>
                            )}
                            <span>{post.category}</span>
                          </div>
                        </div>
                        {post.title && (
                          <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                            {post.title}
                          </h3>
                        )}
                        {post.mediaItems && post.mediaItems.length > 0 && (
                          <div className="mt-2 grid grid-cols-4 gap-1.5">
                            {post.mediaItems.slice(0, 4).map((media) => (
                              <div
                                key={media.imageId}
                                className="aspect-square overflow-hidden rounded-lg bg-[#0B1A2E]"
                              >
                                <FirestoreImage
                                  imageId={media.imageId}
                                  alt={media.caption || post.title || 'Post photograph'}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {post.body && (
                          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-700 sm:text-sm">
                            {post.body}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {scope === 'anonymous' && (
            <div className="space-y-2.5">
              {anonymousResults.map((post) => {
                const hasMedia =
                  Boolean(post.mediaItems) && post.mediaItems!.length > 0;
                const theme = getAnonymousBackgroundTheme(
                  hasMedia ? 'plain' : post.backgroundStyle
                );
                const isStyledTextOnly = !hasMedia && theme.isDark;

                return (
                  <article
                    key={post.id}
                    style={
                      isStyledTextOnly
                        ? { background: theme.backgroundCss }
                        : undefined
                    }
                    className={`rounded-xl border p-3.5 ${
                      isStyledTextOnly
                        ? theme.borderClass
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between text-xs ${
                        isStyledTextOnly
                          ? theme.metaColorClass
                          : 'text-slate-500'
                      }`}
                    >
                      <span>Anonymous · {post.category}</span>
                      <span>Identity hidden</span>
                    </div>
                    {hasMedia && (
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {post.mediaItems!.slice(0, 4).map((media) => (
                          <div
                            key={media.imageId}
                            className="aspect-square overflow-hidden rounded-lg bg-[#0B1A2E]"
                          >
                            <FirestoreImage
                              imageId={media.imageId}
                              alt={media.caption || 'Anonymous photograph'}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {post.body && (
                      <p
                        className={`mt-2 text-sm leading-relaxed ${
                          isStyledTextOnly
                            ? `${theme.textColorClass} font-semibold`
                            : 'text-slate-700'
                        }`}
                      >
                        {post.body}
                      </p>
                    )}
                  </article>
                );
              })}
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
                  <div className="flex items-start gap-3">
                    {(contact.photoImageId || contact.photoUrl) && (
                      <AvatarMedia
                        fullName={contact.fullName}
                        photoImageId={contact.photoImageId}
                        photoUrl={contact.photoUrl}
                        sizeClass="h-10 w-10"
                        roundedClass="rounded-xl"
                        textClass="text-xs"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
                          {contact.fullName}
                        </h3>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {contact.badgeLabel ||
                            TRUSTED_CONTACT_CATEGORY_LABELS[contact.category] ||
                            'Directory Profile'}
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
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {scope === 'opportunities' && (
            <div className="space-y-2.5">
              {opportunityResults.map((opp) => {
                const lifecycle = resolveOpportunityLifecycle(opp);
                const safeUrl = getSafeApplicationUrl(opp.applicationUrl);
                return (
                  <article
                    key={opp.id}
                    className="rounded-xl border border-slate-200 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1E88E5]">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{getOpportunityCategoryLabel(opp.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            lifecycle.state === 'closing_soon'
                              ? 'font-semibold text-amber-700'
                              : lifecycle.state === 'closed'
                                ? 'text-slate-600'
                                : 'font-semibold text-emerald-700'
                          }
                        >
                          {lifecycle.label}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                        {opp.organisation}
                        {opp.isVerified === true && (
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-label="Verified opportunity"
                          />
                        )}
                      </span>
                    </div>
                    <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                      {opp.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {opp.description}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">
                        {formatOpportunityDeadlineSummary(lifecycle)}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate('opportunities', {
                              opportunityId: opp.id,
                            })
                          }
                          className="text-xs font-semibold text-[#0B1A2E] hover:text-[#1E88E5] hover:underline"
                        >
                          View Details
                        </button>
                        {safeUrl && !lifecycle.isPastDeadline && (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
                          >
                            Apply
                            <ExternalLink
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {scope === 'upcoming-events' && (
            <div className="space-y-2.5">
              {eventResults.map((ev) => {
                const lifecycle = resolveEventLifecycle(ev);
                return (
                  <article
                    key={ev.id}
                    className="rounded-xl border border-slate-200 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1E88E5]">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{getEventCategoryLabel(ev.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            lifecycle.state === 'ongoing'
                              ? 'font-semibold text-[#1E88E5]'
                              : lifecycle.state === 'upcoming'
                                ? 'font-semibold text-emerald-700'
                                : lifecycle.state === 'cancelled'
                                  ? 'font-semibold text-red-700'
                                  : 'text-slate-600'
                          }
                        >
                          {lifecycle.label}
                        </span>
                      </span>
                      <span className="font-medium text-slate-600">
                        {ev.organiser}
                      </span>
                    </div>
                    <h3 className="mt-1 font-display text-sm font-bold text-[#0B1A2E]">
                      {ev.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {ev.description}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">
                        {formatEventDateTimeRange(ev)} · {ev.venue}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('upcoming-events', {
                            eventId: ev.id,
                          })
                        }
                        className="text-xs font-semibold text-[#0B1A2E] hover:text-[#1E88E5] hover:underline"
                      >
                        View Details
                      </button>
                    </div>
                  </article>
                );
              })}
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

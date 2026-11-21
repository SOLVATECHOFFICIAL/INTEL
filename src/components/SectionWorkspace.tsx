import React, { useEffect, useState } from 'react';
import { MessageSquare, ShieldAlert } from 'lucide-react';
import { useFirebase } from '../context/firebaseContext';
import { fetchPublicAnonymousFeed } from '../services/firestoreFoundation';
import type { AnonymousPost } from '../types/database';
import {
  ActiveRoute,
  SearchScopeId,
  SectionId,
  ViewState,
} from '../types/platform';
import { getSectionById } from '../utils/sectionState';
import { ContextualSearchBar } from './ContextualSearchBar';
import { GuestPromptCard } from './auth/GuestPromptCard';
import { SectionIcon } from './SectionIcon';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

interface SectionWorkspaceProps {
  sectionId: Exclude<SectionId, 'for-you' | 'following' | 'latest'>;
  sectionStates: Record<SectionId, ViewState>;
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string; searchScope?: SearchScopeId }
  ) => void;
  onRetry: (sectionId: SectionId) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
}

export const SectionWorkspace: React.FC<SectionWorkspaceProps> = ({
  sectionId,
  sectionStates,
  onNavigate,
  onRetry,
  onRequireAuth,
}) => {
  const { user, isSuspended } = useFirebase();
  const activeSection = getSectionById(sectionId);
  const fallbackState = sectionStates[activeSection.id];

  const [anonymousPosts, setAnonymousPosts] = useState<AnonymousPost[]>([]);
  const [anonLoadState, setAnonLoadState] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [retryToken, setRetryToken] = useState(0);
  const [actionPrompt, setActionPrompt] = useState<
    'none' | 'guest' | 'suspended' | 'member_ready'
  >('none');

  useEffect(() => {
    if (sectionId !== 'anonymous') {
      return;
    }

    let active = true;
    fetchPublicAnonymousFeed(15)
      .then((items) => {
        if (!active) return;
        setAnonymousPosts(items);
        setAnonLoadState('ready');
      })
      .catch(() => {
        if (!active) return;
        setAnonLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [sectionId, retryToken]);

  const loadAnonymous = () => {
    setAnonLoadState('loading');
    setRetryToken((prev) => prev + 1);
  };

  const handleAnonymousPostClick = () => {
    if (!user) {
      setActionPrompt('guest');
      return;
    }
    if (isSuspended) {
      setActionPrompt('suspended');
      return;
    }
    setActionPrompt('member_ready');
  };

  return (
    <section
      aria-labelledby="active-section-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Inline Contextual Search scoped strictly to this section */}
      <ContextualSearchBar
        scope={sectionId}
        embedded
        onNavigate={onNavigate}
        onRequireAuth={onRequireAuth}
        returnRoute={sectionId}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <button
                type="button"
                onClick={() => onNavigate('for-you')}
                className="text-[#1E88E5] hover:underline"
              >
                Home
              </button>
              <span aria-hidden="true">/</span>
              <span>{activeSection.group}</span>
            </div>

            <h1
              id="active-section-heading"
              className="mt-2 flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-[#0B1A2E] sm:text-3xl"
            >
              <SectionIcon
                sectionId={activeSection.id}
                className="h-6 w-6 shrink-0 text-[#1E88E5]"
              />
              <span>{activeSection.title}</span>
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              {activeSection.summary}
            </p>
          </div>

          {sectionId === 'anonymous' && (
            <button
              type="button"
              onClick={handleAnonymousPostClick}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844]"
            >
              <MessageSquare className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Post Anonymously
            </button>
          )}
        </div>

        {actionPrompt === 'guest' && (
          <div className="mt-5">
            <GuestPromptCard
              title="Sign in to post anonymously"
              description="Guests can browse public anonymous posts freely. Sign in or create a free LASUED Intel account to publish anonymous posts or replies."
              returnRoute="anonymous"
              onRequireAuth={onRequireAuth}
              onDismiss={() => setActionPrompt('none')}
            />
          </div>
        )}

        {actionPrompt === 'suspended' && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Your account is suspended and cannot create anonymous posts or
              replies.
            </span>
          </div>
        )}

        {actionPrompt === 'member_ready' && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/5 p-4 text-sm text-[#0B1A2E]"
          >
            Your authenticated account is verified for anonymous contributions.
            The full anonymous publishing composer will be enabled in the next
            feature prompt while keeping author identities strictly isolated.
          </div>
        )}

        <div className="mt-6">
          {sectionId === 'anonymous' ? (
            anonLoadState === 'loading' ? (
              <LoadingState sectionTitle={activeSection.title} />
            ) : anonLoadState === 'error' ? (
              <ErrorState
                section={activeSection}
                onRetry={() => void loadAnonymous()}
              />
            ) : anonymousPosts.length === 0 ? (
              <EmptyState section={activeSection} />
            ) : (
              <div className="space-y-4">
                {anonymousPosts.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Anonymous · {item.category}</span>
                      <span>Identity hidden</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      {item.body}
                    </p>
                  </article>
                ))}
              </div>
            )
          ) : (
            <>
              {fallbackState === 'loading' && (
                <LoadingState sectionTitle={activeSection.title} />
              )}
              {fallbackState === 'empty' && (
                <EmptyState section={activeSection} />
              )}
              {fallbackState === 'error' && (
                <ErrorState
                  section={activeSection}
                  onRetry={() => onRetry(activeSection.id)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

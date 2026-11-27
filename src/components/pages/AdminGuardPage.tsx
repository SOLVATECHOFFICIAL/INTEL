import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BarChart3,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Compass,
  FileText,
  Loader2,
  Mail,
  Megaphone,
  PenSquare,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  Users,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { requestEmailVerification } from '../../services/auth';
import {
  fetchAdminCommunityContentBundle,
  fetchAdminMarketplaceDirectory,
  fetchAllCampusEvents,
  fetchAllOpportunities,
  fetchGlobalPlatformSettings,
  fetchPlatformOverviewData,
  fetchUnifiedAuditLogFeed,
  type AdminCommunityPostItem,
  type AdminMarketplaceItem,
  type AdminOverviewBundle,
  type AdminPostCommentItem,
  type UnifiedAuditEntry,
} from '../../services/adminDashboard';
import {
  fetchAdminMemberDirectory,
  fetchTrustedCircleDirectory,
  type AdminManagedMember,
} from '../../services/governance';
import type {
  AnonymousPost,
  AnonymousReport,
  CampusEvent,
  Opportunity,
  PlatformSetting,
  PublicProfileProjection,
  TrustedContact,
  UserRole,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  buildAdminNavGroups,
  findGroupForAdminSection,
  getSimpleAdminSectionMeta,
  resolveDefaultSectionForGroup,
  type AdminGroupId,
} from '../../utils/adminNavigation';
import {
  canActorAccessAdminSection,
  getVisibleAdminSections,
  type AdminDashboardSectionId,
} from '../../utils/adminPermissions';
import {
  DESIGNATED_SUPREME_ADMIN_EMAILS,
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
  canRevealAnonymousAuthor,
  formatFirestoreOrAppError,
  getAccountTierDisplayLabel,
  isDesignatedSupremeAdminUser,
  isUndergroundSupremeAdminUser,
  mapFirebaseAuthError,
} from '../../utils/authValidation';
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { AdminAuditLogTab } from '../admin/AdminAuditLogTab';
import { AdminBadgesTab } from '../admin/AdminBadgesTab';
import { AdminContentTab, type ContentSubTab } from '../admin/AdminContentTab';
import { AdminEventsTab } from '../admin/AdminEventsTab';
import { AdminMarketplaceTab } from '../admin/AdminMarketplaceTab';
import { AdminMembersTab } from '../admin/AdminMembersTab';
import { AdminOpportunitiesTab } from '../admin/AdminOpportunitiesTab';
import { AdminOverviewTab } from '../admin/AdminOverviewTab';
import { AdminSettingsTab } from '../admin/AdminSettingsTab';
import { AdminTrustedCircleTab } from '../admin/AdminTrustedCircleTab';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { PostComposer } from '../posts/PostComposer';
import { SectionRibbon } from '../shared/SectionRibbon';
import { UpdateComposerModal } from '../updates/UpdateComposerModal';

interface AdminGuardPageProps {
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack?: () => void;
}

const SECTION_ICONS: Record<
  AdminDashboardSectionId,
  React.ComponentType<{ className?: string }>
> = {
  overview: BarChart3,
  members: Users,
  badges: Award,
  marketplace: ShoppingBag,
  content: FileText,
  opportunities: Briefcase,
  events: Calendar,
  'trusted-circle': UserCheck,
  'audit-log': ClipboardList,
  settings: Settings,
};

const GROUP_ICONS: Record<
  AdminGroupId,
  React.ComponentType<{ className?: string }>
> = {
  overview: BarChart3,
  people: Users,
  moderation: ShieldCheck,
  campus: Compass,
};

export const AdminGuardPage: React.FC<AdminGuardPageProps> = ({
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const {
    authReady,
    user,
    profile,
    effectiveTier,
    isSuspended,
    refreshAccountState,
  } = useFirebase();

  const isEmailVerified = Boolean(user?.emailVerified);
  const normalizedUserEmail = user?.email?.trim().toLowerCase() ?? '';
  const hasDesignatedSupremeAdminEmail = Boolean(
    user &&
      (DESIGNATED_SUPREME_ADMIN_EMAILS as readonly string[]).includes(
        normalizedUserEmail
      )
  );
  const hasAccess =
    canAccessAdminDashboard(effectiveTier, isSuspended) &&
    (effectiveTier !== 'supreme_admin' || isEmailVerified);
  const needsEmailVerificationForAdmin =
    Boolean(user) &&
    !isEmailVerified &&
    !isSuspended &&
    hasDesignatedSupremeAdminEmail;
  const isFullAdmin = canAccessFullAdminDashboard(effectiveTier, isSuspended);

  const visibleSections = getVisibleAdminSections(effectiveTier, isSuspended);
  const [requestedSection, setRequestedSection] =
    useState<AdminDashboardSectionId>('overview');
  const [contentInitialSubTab, setContentInitialSubTab] =
    useState<ContentSubTab>('ordinary_posts');

  const activeSection: AdminDashboardSectionId = canActorAccessAdminSection(
    effectiveTier,
    isSuspended,
    requestedSection
  )
    ? requestedSection
    : 'overview';

  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [resendingVerification, setResendingVerification] = useState(false);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminQuickComposer, setAdminQuickComposer] = useState<
    'none' | 'official_update' | 'campus_post'
  >('none');
  const isUndergroundAdmin = isUndergroundSupremeAdminUser(user);

  // Per-section real Firebase state
  const [overviewBundle, setOverviewBundle] =
    useState<AdminOverviewBundle | null>(null);
  const [members, setMembers] = useState<AdminManagedMember[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<
    AdminMarketplaceItem[]
  >([]);
  const [contentBundle, setContentBundle] = useState<{
    ordinaryPosts: AdminCommunityPostItem[];
    anonymousPosts: AnonymousPost[];
    ordinaryComments: AdminPostCommentItem[];
    anonymousComments: AdminPostCommentItem[];
    anonymousReports: AnonymousReport[];
  }>({
    ordinaryPosts: [],
    anonymousPosts: [],
    ordinaryComments: [],
    anonymousComments: [],
    anonymousReports: [],
  });
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [trustedCircleData, setTrustedCircleData] = useState<{
    supremeAdmins: PublicProfileProjection[];
    verifiedMembers: PublicProfileProjection[];
    officialContacts: TrustedContact[];
  }>({ supremeAdmins: [], verifiedMembers: [], officialContacts: [] });
  const [auditEntries, setAuditEntries] = useState<UnifiedAuditEntry[]>([]);
  const [globalSettings, setGlobalSettings] = useState<PlatformSetting | null>(
    null
  );

  const actorRole: UserRole =
    effectiveTier === 'supreme_admin' ? 'supreme_admin' : 'moderator';

  const currentLoadKey = `${activeSection}:${actorRole}:${memberSearchQuery}:${refreshToken}`;
  const loadingSection = hasAccess && loadedKey !== currentLoadKey;

  const selectSection = (
    nextId: AdminDashboardSectionId,
    options?: { contentSubTab?: ContentSubTab }
  ) => {
    setErrorMessage(null);
    if (options?.contentSubTab) {
      setContentInitialSubTab(options.contentSubTab);
    } else if (nextId === 'content') {
      setContentInitialSubTab('ordinary_posts');
    }
    setRequestedSection(nextId);
  };

  const reloadCurrentSection = () => {
    setErrorMessage(null);
    setRefreshToken((prev) => prev + 1);
  };

  useEffect(() => {
    if (!hasAccess) return;
    let active = true;

    let loadPromise: Promise<void>;
    switch (activeSection) {
      case 'overview':
        loadPromise = fetchPlatformOverviewData({ actorRole }).then((data) => {
          if (active) setOverviewBundle(data);
        });
        break;
      case 'members':
      case 'badges':
        loadPromise = fetchAdminMemberDirectory(
          memberSearchQuery,
          isUndergroundAdmin
        ).then((list) => {
          if (active) setMembers(list);
        });
        break;
      case 'marketplace':
        loadPromise = fetchAdminMarketplaceDirectory().then((list) => {
          if (active) setMarketplaceItems(list);
        });
        break;
      case 'content':
        loadPromise = fetchAdminCommunityContentBundle().then((bundle) => {
          if (active) setContentBundle(bundle);
        });
        break;
      case 'opportunities':
        loadPromise = fetchAllOpportunities().then((list) => {
          if (active) setOpportunities(list);
        });
        break;
      case 'events':
        loadPromise = fetchAllCampusEvents().then((list) => {
          if (active) setEvents(list);
        });
        break;
      case 'trusted-circle':
        loadPromise = fetchTrustedCircleDirectory().then((data) => {
          if (active) setTrustedCircleData(data);
        });
        break;
      case 'audit-log':
        loadPromise = fetchUnifiedAuditLogFeed(100).then((list) => {
          if (active) setAuditEntries(list);
        });
        break;
      case 'settings':
        loadPromise = fetchGlobalPlatformSettings().then((docItem) => {
          if (active) setGlobalSettings(docItem);
        });
        break;
      default:
        loadPromise = Promise.resolve();
        break;
    }

    loadPromise
      .catch((error) => {
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load dashboard data right now.'
          )
        );
      })
      .finally(() => {
        if (active) setLoadedKey(currentLoadKey);
      });

    return () => {
      active = false;
    };
  }, [
    hasAccess,
    activeSection,
    actorRole,
    isUndergroundAdmin,
    memberSearchQuery,
    refreshToken,
    currentLoadKey,
  ]);

  if (!authReady) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70" />
          <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70" />
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section
        aria-labelledby="admin-restricted-heading"
        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900"
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm dark:text-slate-300 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
        <h1
          id="admin-restricted-heading"
          className="font-display text-2xl font-bold text-[#0B1A2E] dark:text-slate-100"
        >
          Admin &amp; Moderator Sign-In Required
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Only authorized LASUED Intel admins and moderators can open this page.
        </p>
        <div className="mt-5">
          <GuestPromptCard
            title="Sign in with an authorized account"
            description="Public visitors cannot view admin or moderation tools."
            returnRoute="admin"
            onRequireAuth={onRequireAuth}
          />
        </div>
      </section>
    );
  }

  if (needsEmailVerificationForAdmin) {
    const handleResendAdminVerification = async () => {
      if (resendingVerification) return;
      setResendingVerification(true);
      setVerificationError(null);
      setVerificationFeedback(null);
      try {
        await requestEmailVerification(user);
        setVerificationFeedback(
          `Verification link sent to ${user.email || 'your email'}. Open the link in your inbox, then tap "I Verified — Refresh Session".`
        );
      } catch (err) {
        setVerificationError(mapFirebaseAuthError(err));
      } finally {
        setResendingVerification(false);
      }
    };

    const handleRefreshVerifiedClaim = async () => {
      if (refreshingSession) return;
      setRefreshingSession(true);
      setVerificationError(null);
      setVerificationFeedback(null);
      try {
        await user.reload();
        await user.getIdToken(true);
        await refreshAccountState();
        if (!user.emailVerified) {
          setVerificationFeedback(
            'Your email is not verified yet. Please open the link sent to your inbox first.'
          );
        } else {
          setVerificationFeedback('Verified session refreshed.');
          reloadCurrentSection();
        }
      } catch (err) {
        setVerificationError(mapFirebaseAuthError(err));
      } finally {
        setRefreshingSession(false);
      }
    };

    return (
      <section
        aria-labelledby="admin-verify-heading"
        className="min-w-0 flex-1 rounded-2xl border border-amber-200 bg-white p-5 sm:p-6 dark:border-amber-800/60 dark:bg-slate-900"
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm dark:text-slate-300 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1
              id="admin-verify-heading"
              className="font-display text-xl font-bold text-[#0B1A2E] dark:text-slate-100"
            >
              Verify Your Email to Open Admin Tools
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Please verify <strong>{user.email}</strong> first, then refresh your
              session to enter the admin dashboard safely.
            </p>

            {verificationFeedback && (
              <div
                role="status"
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                {verificationFeedback}
              </div>
            )}

            {verificationError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
              >
                {verificationError}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={refreshingSession}
                onClick={() => void handleRefreshVerifiedClaim()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] disabled:opacity-60 sm:text-sm dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
              >
                {refreshingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-sky-300" aria-hidden="true" />
                )}
                I Verified — Refresh Session
              </button>

              <button
                type="button"
                disabled={resendingVerification}
                onClick={() => void handleResendAdminVerification()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-50 disabled:opacity-60 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {resendingVerification ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                )}
                Resend Verification Link
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!hasAccess) {
    return (
      <section
        aria-labelledby="admin-denied-heading"
        className="min-w-0 flex-1 rounded-2xl border border-red-200 bg-white p-5 sm:p-6 dark:border-red-900/60 dark:bg-slate-900"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1
              id="admin-denied-heading"
              className="font-display text-xl font-bold text-[#0B1A2E] dark:text-slate-100"
            >
              Access Restricted
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {isSuspended
                ? 'Your account is currently suspended and dashboard access is disabled.'
                : `Your account (${getAccountTierDisplayLabel(
                    effectiveTier
                  )}) does not have admin or moderator access.`}
            </p>
            <button
              type="button"
              onClick={onBack ?? (() => onNavigate('for-you'))}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {onBack ? 'Back' : 'Return to Home Feed'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const navGroups = buildAdminNavGroups(effectiveTier, isSuspended);
  const activeGroup = findGroupForAdminSection(navGroups, activeSection);
  const rawActiveMeta =
    visibleSections.find((sec) => sec.id === activeSection) ??
    visibleSections[0];
  const activeMeta = rawActiveMeta ? getSimpleAdminSectionMeta(rawActiveMeta) : undefined;

  return (
    <section
      aria-labelledby="admin-heading"
      className="min-w-0 max-w-full flex-1 space-y-4"
    >
      {/* Simple Clean Header + Quick Create + Two-Tier Ribbon */}
      <div className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        {onBack && (
          <div className="mb-2.5">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
          </div>
        )}

        <div className="flex flex-col justify-between gap-3.5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lasued-brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs">
              <ShieldCheck className="h-5 w-5 text-sky-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  id="admin-heading"
                  className="font-display text-lg font-bold text-[#0B1A2E] sm:text-xl dark:text-slate-100"
                >
                  {isFullAdmin ? 'Admin Dashboard' : 'Moderation Console'}
                </h1>
                {isFullAdmin ? (
                  isUndergroundAdmin ? (
                    <span className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      Private Admin
                    </span>
                  ) : (
                    <RoleBadge badge="supreme_admin" size="sm" />
                  )
                ) : (
                  <ProfileBadgesRow
                    profile={{
                      badge: 'moderator',
                      isVerified: Boolean(profile?.isVerified),
                    }}
                    size="sm"
                  />
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {isFullAdmin
                  ? 'Manage members, approve listings, post updates, and configure campus tools.'
                  : 'Review pending marketplace items, posts, and flagged reports.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isFullAdmin && isDesignatedSupremeAdminUser(user) && (
              <>
                <button
                  type="button"
                  data-testid="admin-new-official-update-btn"
                  onClick={() => setAdminQuickComposer('official_update')}
                  className="lasued-action-gradient inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shadow-xs transition hover:brightness-110"
                >
                  <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
                  Official Update
                </button>
                <button
                  type="button"
                  data-testid="admin-new-campus-post-btn"
                  onClick={() => setAdminQuickComposer('campus_post')}
                  className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <PenSquare className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  Campus Post
                </button>
              </>
            )}
            <button
              type="button"
              onClick={reloadCurrentSection}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#1E88E5] ${
                  loadingSection ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </div>

        {/* Tier 1 Group Ribbon + Tier 2 Sub-list Ribbon */}
        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3.5 dark:border-slate-800">
          <SectionRibbon
            ariaLabel="Admin categories"
            activeId={activeGroup?.id ?? 'overview'}
            onChange={(nextGroupId) => {
              const targetGroup = navGroups.find((g) => g.id === nextGroupId);
              if (targetGroup) {
                selectSection(resolveDefaultSectionForGroup(targetGroup));
              }
            }}
            items={navGroups.map((group) => {
              const GroupIcon = GROUP_ICONS[group.id];
              return {
                id: group.id,
                label: group.label,
                icon: <GroupIcon className="h-3.5 w-3.5" aria-hidden="true" />,
                count: group.sections.length > 1 ? group.sections.length : undefined,
              };
            })}
          />

          {activeGroup && activeGroup.sections.length > 1 && (
            <SectionRibbon
              ariaLabel={`${activeGroup.label} sections`}
              variant="sublist"
              activeId={activeSection}
              onChange={(nextSectionId) =>
                selectSection(nextSectionId as AdminDashboardSectionId)
              }
              items={activeGroup.sections.map((sec) => {
                const Icon = SECTION_ICONS[sec.id];
                return {
                  id: sec.id,
                  label: sec.label,
                  icon: <Icon className="h-3.5 w-3.5" aria-hidden="true" />,
                };
              })}
            />
          )}
        </div>

        {statusMessage && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {errorMessage}
          </div>
        )}
      </div>

      {/* Focused Main Workspace Panel */}
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {activeMeta && (
          <div className="mb-5 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>{isFullAdmin ? 'Admin' : 'Moderator'}</span>
              {activeGroup && activeGroup.id !== 'overview' && (
                <>
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  <span>{activeGroup.label}</span>
                </>
              )}
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              <span className="text-[#1E88E5]">{activeMeta.label}</span>
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100">
              {activeMeta.label}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              {activeMeta.description}
            </p>
          </div>
        )}

          {activeSection === 'overview' && (
            <AdminOverviewTab
              bundle={overviewBundle}
              loading={loadingSection && !overviewBundle}
              isFullAdmin={isFullAdmin}
              onSelectSection={selectSection}
            />
          )}

          {activeSection === 'members' && isFullAdmin && (
            <AdminMembersTab
              members={members}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              searchQuery={memberSearchQuery}
              onSearchChange={setMemberSearchQuery}
              onNavigateProfile={(username) =>
                onNavigate('profile', { username })
              }
              onJumpToBadges={(username) => {
                setMemberSearchQuery(username);
                selectSection('badges');
              }}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'badges' && isFullAdmin && (
            <AdminBadgesTab
              members={members}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              searchQuery={memberSearchQuery}
              onSearchChange={setMemberSearchQuery}
              onNavigateProfile={(username) =>
                onNavigate('profile', { username })
              }
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={() => {
                void refreshAccountState();
                reloadCurrentSection();
              }}
            />
          )}

          {activeSection === 'marketplace' && (
            <AdminMarketplaceTab
              items={marketplaceItems}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              isFullAdmin={isFullAdmin}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'content' && (
            <AdminContentTab
              ordinaryPosts={contentBundle.ordinaryPosts}
              anonymousPosts={contentBundle.anonymousPosts}
              ordinaryComments={contentBundle.ordinaryComments}
              anonymousComments={contentBundle.anonymousComments}
              anonymousReports={contentBundle.anonymousReports}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              isFullAdmin={isFullAdmin}
              canRevealAnonymous={canRevealAnonymousAuthor(user)}
              initialSubTab={contentInitialSubTab}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'opportunities' && isFullAdmin && (
            <AdminOpportunitiesTab
              opportunities={opportunities}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'events' && isFullAdmin && (
            <AdminEventsTab
              events={events}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'trusted-circle' && isFullAdmin && (
            <AdminTrustedCircleTab
              supremeAdmins={trustedCircleData.supremeAdmins}
              verifiedMembers={trustedCircleData.verifiedMembers}
              officialContacts={trustedCircleData.officialContacts}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              onJumpToBadges={() => selectSection('badges')}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onReload={reloadCurrentSection}
            />
          )}

          {activeSection === 'audit-log' && isFullAdmin && (
            <AdminAuditLogTab
              entries={auditEntries}
              loading={loadingSection}
            />
          )}

          {activeSection === 'settings' && isFullAdmin && (
            <AdminSettingsTab
              key={String(globalSettings?.updatedAt ?? 'default')}
              settings={globalSettings}
              loading={loadingSection}
              actorUid={user.uid}
              actorRole={actorRole}
              onSuccess={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
              onSaved={(nextSettings) => setGlobalSettings(nextSettings)}
            />
          )}
      </div>

      {adminQuickComposer === 'official_update' &&
        isFullAdmin &&
        isDesignatedSupremeAdminUser(user) &&
        user?.uid && (
          <UpdateComposerModal
            actorUid={user.uid}
            actorRole="supreme_admin"
            actorName={profile?.fullName || user.displayName || undefined}
            actorPhotoUrl={profile?.photoUrl}
            actorPhotoImageId={profile?.photoImageId}
            onSuccess={() => {
              setAdminQuickComposer('none');
              setErrorMessage(null);
              setStatusMessage('Official update published to campus feed.');
              reloadCurrentSection();
            }}
            onClose={() => setAdminQuickComposer('none')}
          />
        )}

      {adminQuickComposer === 'campus_post' &&
        isFullAdmin &&
        isDesignatedSupremeAdminUser(user) &&
        user?.uid && (
          <PostComposer
            mode="ordinary"
            initialOrdinaryType="photo"
            actorUid={user.uid}
            actorRole={actorRole}
            actorName={profile?.fullName || user.displayName || undefined}
            actorUsername={profile?.username}
            onSuccess={() => {
              setAdminQuickComposer('none');
              setErrorMessage(null);
              setStatusMessage('Campus post published live to community feed.');
              reloadCurrentSection();
            }}
            onClose={() => setAdminQuickComposer('none')}
          />
        )}
    </section>
  );
};

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BarChart3,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Crown,
  FileText,
  Loader2,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  Users,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
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
  bootstrapPermanentOwnerRoleRecord,
  fetchAdminMemberDirectory,
  fetchTrustedCircleDirectory,
  type AdminManagedMember,
} from '../../services/governance';
import { updateUndergroundBadgeVisibilitySetting } from '../../services/firestoreFoundation';
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
  canActorAccessAdminSection,
  getVisibleAdminSections,
  type AdminDashboardSectionId,
} from '../../utils/adminPermissions';
import {
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
  canRevealAnonymousAuthor,
  formatFirestoreOrAppError,
  getAccountTierDisplayLabel,
  isPermanentOwnerUser,
  isUndergroundSupremeAdminUser,
} from '../../utils/authValidation';
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { AdminAuditLogTab } from '../admin/AdminAuditLogTab';
import { AdminBadgesTab } from '../admin/AdminBadgesTab';
import { AdminContentTab } from '../admin/AdminContentTab';
import { AdminEventsTab } from '../admin/AdminEventsTab';
import { AdminMarketplaceTab } from '../admin/AdminMarketplaceTab';
import { AdminMembersTab } from '../admin/AdminMembersTab';
import { AdminOpportunitiesTab } from '../admin/AdminOpportunitiesTab';
import { AdminOverviewTab } from '../admin/AdminOverviewTab';
import { AdminSettingsTab } from '../admin/AdminSettingsTab';
import { AdminTrustedCircleTab } from '../admin/AdminTrustedCircleTab';
import { GuestPromptCard } from '../auth/GuestPromptCard';

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

export const AdminGuardPage: React.FC<AdminGuardPageProps> = ({
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const {
    authReady,
    user,
    profile,
    roleRecord,
    effectiveTier,
    isSuspended,
    refreshAccountState,
  } = useFirebase();

  const hasAccess = canAccessAdminDashboard(effectiveTier, isSuspended);
  const isFullAdmin = canAccessFullAdminDashboard(effectiveTier, isSuspended);
  const isOwnerEmail = isPermanentOwnerUser(user);
  const needsOwnerBootstrap =
    isOwnerEmail && roleRecord?.role !== 'owner';

  const visibleSections = getVisibleAdminSections(effectiveTier, isSuspended);
  const [requestedSection, setRequestedSection] =
    useState<AdminDashboardSectionId>('overview');

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

  const [bootstrappingOwner, setBootstrappingOwner] = useState(false);
  const [togglingBadgeVisibility, setTogglingBadgeVisibility] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isUndergroundAdmin = isUndergroundSupremeAdminUser(user);
  const isSupremeBadgeVisible =
    isUndergroundAdmin && profile?.badge === 'supreme_admin';

  const handleToggleSelfSupremeBadge = async () => {
    if (!user || !isUndergroundAdmin || isSuspended || togglingBadgeVisibility) {
      return;
    }
    setTogglingBadgeVisibility(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const nextShow = !isSupremeBadgeVisible;
      const savedShow = await updateUndergroundBadgeVisibilitySetting(
        user.uid,
        nextShow
      );
      await refreshAccountState();
      setStatusMessage(
        savedShow
          ? 'Your Supreme Admin badge is now visible on your profile and posts.'
          : 'Your Supreme Admin badge is now hidden while your full Supreme Admin permissions remain active.'
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Unable to update your Supreme Admin badge visibility.'
        )
      );
    } finally {
      setTogglingBadgeVisibility(false);
    }
  };

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
    effectiveTier === 'owner'
      ? 'owner'
      : effectiveTier === 'supreme_admin'
      ? 'supreme_admin'
      : 'moderator';

  const currentLoadKey = `${activeSection}:${actorRole}:${memberSearchQuery}:${refreshToken}`;
  const loadingSection = hasAccess && loadedKey !== currentLoadKey;

  const selectSection = (nextId: AdminDashboardSectionId) => {
    setErrorMessage(null);
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
          effectiveTier === 'owner'
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
    effectiveTier,
    memberSearchQuery,
    refreshToken,
    currentLoadKey,
  ]);

  if (!authReady) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section
        aria-labelledby="admin-restricted-heading"
        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
        <h1
          id="admin-restricted-heading"
          className="font-display text-2xl font-bold text-[#0B1A2E]"
        >
          Administrator &amp; Moderation Access Required
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          This area is restricted to authorized LASUED Intel Supreme Admins,
          Moderators, and the Platform Owner.
        </p>
        <div className="mt-5">
          <GuestPromptCard
            title="Sign in with an authorized account"
            description="Public visitors cannot view administrative, moderation, or platform governance controls."
            returnRoute="admin"
            onRequireAuth={onRequireAuth}
          />
        </div>
      </section>
    );
  }

  if (!hasAccess) {
    return (
      <section
        aria-labelledby="admin-denied-heading"
        className="min-w-0 flex-1 rounded-2xl border border-red-200 bg-white p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1
              id="admin-denied-heading"
              className="font-display text-xl font-bold text-[#0B1A2E]"
            >
              Access Restricted
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {isSuspended
                ? 'Your account is currently suspended and all administrative and moderation access is disabled.'
                : `Your account tier (${getAccountTierDisplayLabel(
                    effectiveTier
                  )}) does not have Moderator or Administrator permissions. Ordinary and Verified accounts cannot access dashboard controls.`}
            </p>
            <button
              type="button"
              onClick={onBack ?? (() => onNavigate('for-you'))}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132844]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {onBack ? 'Back' : 'Return to Campus Feed'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const handleBootstrapOwner = async () => {
    if (bootstrappingOwner) return;
    setBootstrappingOwner(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await bootstrapPermanentOwnerRoleRecord(user.uid);
      await refreshAccountState();
      setStatusMessage(
        'Permanent Owner authority and Supreme Admin badge have been synchronized in Firestore.'
      );
      reloadCurrentSection();
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not synchronize Permanent Owner authority record.'
        )
      );
    } finally {
      setBootstrappingOwner(false);
    }
  };

  const activeMeta =
    visibleSections.find((sec) => sec.id === activeSection) ??
    visibleSections[0];

  return (
    <section
      aria-labelledby="admin-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Top Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        {onBack && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
          </div>
        )}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B1A2E] text-white">
              <ShieldCheck className="h-5 w-5 text-[#1E88E5]" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  id="admin-heading"
                  className="font-display text-xl font-bold text-[#0B1A2E] sm:text-2xl"
                >
                  {isFullAdmin
                    ? 'LASUED Intel Admin Dashboard'
                    : 'LASUED Intel Moderation Console'}
                </h1>
                {isFullAdmin ? (
                  <RoleBadge badge="supreme_admin" size="sm" />
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
              <p className="mt-0.5 text-xs text-slate-600">
                Authority: {getAccountTierDisplayLabel(effectiveTier)} ·{' '}
                {isFullAdmin
                  ? 'Full 10-section governance enforced by Firebase Security Rules.'
                  : 'Scoped 3-section moderation console enforced by Firebase Security Rules.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isUndergroundAdmin && (
              <button
                type="button"
                role="switch"
                aria-checked={isSupremeBadgeVisible}
                onClick={() => void handleToggleSelfSupremeBadge()}
                disabled={isSuspended || togglingBadgeVisibility}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  isSupremeBadgeVisible
                    ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#0B1A2E]'
                    : 'border-slate-300 bg-slate-50 text-[#0B1A2E] hover:bg-slate-100'
                }`}
              >
                {togglingBadgeVisibility ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Crown className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                )}
                {isSupremeBadgeVisible ? 'Public Badge: ON' : 'Public Badge: OFF'}
              </button>
            )}

            <button
              type="button"
              onClick={reloadCurrentSection}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#1E88E5] ${
                  loadingSection ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
              Refresh Data
            </button>
          </div>
        </div>

        {needsOwnerBootstrap && (
          <div className="mt-4 flex flex-col justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50 p-4 text-xs text-purple-950 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5">
              <Crown
                className="mt-0.5 h-4 w-4 shrink-0 text-purple-700"
                aria-hidden="true"
              />
              <span>
                Your verified Permanent Owner email is active. Sync your hidden
                Permanent Owner authority record into Firestore so server-side
                rules reflect full owner privileges.
              </span>
            </div>
            <button
              type="button"
              disabled={bootstrappingOwner}
              onClick={() => void handleBootstrapOwner()}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-purple-800 px-3.5 py-1.5 font-semibold text-white hover:bg-purple-900 disabled:opacity-60"
            >
              {bootstrappingOwner && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Sync Owner Authority
            </button>
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {errorMessage}
          </div>
        )}
      </div>

      {/* Responsive Workspace Shell: Horizontal Scrollable Pills on Mobile + Left Rail on Desktop */}
      <div className="flex flex-col gap-5 xl:flex-row">
        <nav
          aria-label="Admin dashboard sections"
          className="xl:w-60 xl:shrink-0"
        >
          <div className="flex gap-1.5 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible xl:rounded-2xl xl:border xl:border-slate-200 xl:bg-white xl:p-3">
            {visibleSections.map((sec) => {
              const Icon = SECTION_ICONS[sec.id];
              const isSelected = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  aria-current={isSelected ? 'page' : undefined}
                  onClick={() => selectSection(sec.id)}
                  className={`flex min-h-[42px] shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2 text-left text-xs font-semibold whitespace-nowrap transition-colors xl:w-full ${
                    isSelected
                      ? 'bg-[#0B1A2E] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-[#0B1A2E] xl:border-transparent'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isSelected ? 'text-[#1E88E5]' : 'text-slate-400'
                    }`}
                  />
                  <span>
                    {sec.number}. {sec.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Main Workspace Panel */}
        <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          {activeMeta && (
            <div className="mb-5 border-b border-slate-100 pb-4">
              <h2 className="font-display text-lg font-bold text-[#0B1A2E]">
                {activeMeta.number}. {activeMeta.label}
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
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
              isPermanentOwner={effectiveTier === 'owner'}
              onJumpToBadges={() => selectSection('badges')}
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
      </div>
    </section>
  );
};

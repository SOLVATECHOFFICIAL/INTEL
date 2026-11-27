import React, { useState } from 'react';
import {
  Award,
  Ban,
  ExternalLink,
  Eye,
  Loader2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  fetchMemberDetailsForAdmin,
  type AdminMemberDetailsBundle,
} from '../../services/adminDashboard';
import {
  toggleMemberAccountSuspensionAtomically,
  type AdminManagedMember,
} from '../../services/governance';
import {
  BLUEPRINT_LIMITS,
  canActorUpdateTargetRoleRecord,
  type UserRole,
} from '../../types/database';
import { formatAdminAuditActionLabel } from '../../utils/adminPermissions';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { ProfileBadgesRow } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';
import { SectionRibbon } from '../shared/SectionRibbon';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminMembersTabProps {
  members: AdminManagedMember[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onNavigateProfile: (username: string) => void;
  onJumpToBadges: (username: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

function formatDateLabel(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Not available';
  return new Date(ms).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const AdminMembersTab: React.FC<AdminMembersTabProps> = ({
  members,
  loading,
  actorUid,
  actorRole,
  searchQuery,
  onSearchChange,
  onNavigateProfile,
  onJumpToBadges,
  onSuccess,
  onError,
  onReload,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>(
    'all'
  );
  const [reasonNote, setReasonNote] = useState('');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminManagedMember | null>(
    null
  );

  // Member Details Inspector Drawer/Modal
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedDetails, setSelectedDetails] =
    useState<AdminMemberDetailsBundle | null>(null);

  const filteredMembers = members.filter((entry) => {
    if (statusFilter === 'active') {
      return entry.profile.accountStatus === 'active';
    }
    if (statusFilter === 'suspended') {
      return entry.profile.accountStatus === 'suspended';
    }
    return true;
  });

  const handleOpenDetails = async (uid: string) => {
    setDetailsLoading(true);
    setSelectedDetails(null);
    try {
      const bundle = await fetchMemberDetailsForAdmin(uid);
      setSelectedDetails(bundle);
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to load member account details.')
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleConfirmSuspensionToggle = async () => {
    if (!confirmTarget || busyUid) return;
    const nextStatus =
      confirmTarget.profile.accountStatus === 'suspended'
        ? 'active'
        : 'suspended';
    setBusyUid(confirmTarget.profile.uid);
    try {
      await toggleMemberAccountSuspensionAtomically({
        actorUid,
        actorRole,
        targetUid: confirmTarget.profile.uid,
        nextStatus,
        reason: reasonNote,
      });
      onSuccess(
        nextStatus === 'suspended'
          ? `@${confirmTarget.profile.username} was suspended and recorded in the audit trail.`
          : `@${confirmTarget.profile.username} was restored to active status.`
      );
      if (
        selectedDetails &&
        selectedDetails.profile.uid === confirmTarget.profile.uid
      ) {
        setSelectedDetails({
          ...selectedDetails,
          profile: { ...selectedDetails.profile, accountStatus: nextStatus },
        });
      }
      setConfirmTarget(null);
      setReasonNote('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to update account status.')
      );
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label
            htmlFor="members-tab-search"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Find member
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="members-tab-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Name, @username, or department..."
              className="block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="members-tab-reason"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Reason note (optional)
          </label>
          <input
            id="members-tab-reason"
            type="text"
            maxLength={BLUEPRINT_LIMITS.auditReasonMax}
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Optional note for suspend/restore..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div>
          <span className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200">
            Account status
          </span>
          <div className="mt-1">
            <SectionRibbon
              ariaLabel="Filter members by status"
              variant="sublist"
              activeId={statusFilter}
              onChange={(id) =>
                setStatusFilter(id as 'all' | 'active' | 'suspended')
              }
              items={[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'suspended', label: 'Suspended' },
              ]}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-400">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading members...
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          No members match your filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMembers.map((entry) => {
            const { profile, effectiveRole } = entry;
            const isSelf = profile.uid === actorUid;
            const isBusy = busyUid === profile.uid;
            const canModify = canActorUpdateTargetRoleRecord(
              actorRole,
              false,
              effectiveRole,
              undefined,
              actorUid,
              profile.uid
            );

            return (
              <div
                key={profile.uid}
                className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center dark:border-slate-800 dark:bg-slate-900/70"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AvatarMedia
                    fullName={profile.fullName}
                    photoImageId={profile.photoImageId}
                    photoUrl={profile.photoUrl}
                    sizeClass="h-11 w-11"
                    roundedClass="rounded-xl"
                    textClass="text-xs"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        {profile.fullName}
                      </span>
                      <ProfileBadgesRow profile={profile} size="xs" />
                      {profile.accountStatus === 'suspended' ? (
                        <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950/60 dark:text-red-300">
                          Suspended
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                          Active
                        </span>
                      )}
                      {isSelf && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          You
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">
                      @{profile.username}
                      {profile.accountCategory
                        ? ` · ${profile.accountCategory}`
                        : ''}
                      {profile.department ? ` · ${profile.department}` : ''}
                      {profile.level ? ` · ${profile.level}` : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Joined {formatDateLabel(profile.createdAt)} · Role:{' '}
                      <span className="font-semibold uppercase">
                        {effectiveRole}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpenDetails(profile.uid)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <Eye className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                    Details
                  </button>

                  <button
                    type="button"
                    onClick={() => onJumpToBadges(profile.username)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <Award className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                    Badges
                  </button>

                  {!canModify ? (
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      {isSelf ? 'Self protected' : 'Supreme Admin protected'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmTarget(entry)}
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                        profile.accountStatus === 'suspended'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                          : 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60'
                      }`}
                    >
                      {profile.accountStatus === 'suspended' ? (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {profile.accountStatus === 'suspended'
                        ? 'Restore'
                        : 'Suspend'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Member Account Details Modal */}
      {(detailsLoading || selectedDetails) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs dark:bg-black/75"
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-details-modal-title"
          onClick={() => setSelectedDetails(null)}
        >
          <div
            className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3
                id="member-details-modal-title"
                className="font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100"
              >
                Member Details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedDetails(null)}
                aria-label="Close member details"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E] dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailsLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-400">
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                  aria-hidden="true"
                />
                Loading member details...
              </div>
            ) : selectedDetails ? (
              <div className="mt-4 space-y-5">
                <div className="flex items-start gap-3.5">
                  <AvatarMedia
                    fullName={selectedDetails.profile.fullName}
                    photoImageId={selectedDetails.profile.photoImageId}
                    photoUrl={selectedDetails.profile.photoUrl}
                    sizeClass="h-14 w-14"
                    roundedClass="rounded-2xl"
                    textClass="text-base"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold text-[#0B1A2E] dark:text-slate-100">
                        {selectedDetails.profile.fullName}
                      </span>
                      <ProfileBadgesRow profile={selectedDetails.profile} size="sm" />
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      @{selectedDetails.profile.username} · ID:{' '}
                      {selectedDetails.profile.memberId}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Status:{' '}
                      <strong
                        className={
                          selectedDetails.profile.accountStatus === 'suspended'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {selectedDetails.profile.accountStatus.toUpperCase()}
                      </strong>{' '}
                      · Joined {formatDateLabel(selectedDetails.profile.createdAt)}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Category</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] dark:text-slate-100">
                      {selectedDetails.profile.accountCategory || 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Department</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] dark:text-slate-100">
                      {selectedDetails.profile.department || 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Level</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] dark:text-slate-100">
                      {selectedDetails.profile.level || 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Posts</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                      {selectedDetails.publishedPostsCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Listings</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                      {selectedDetails.listingsCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Followers / Following</dt>
                    <dd className="mt-0.5 font-semibold text-[#0B1A2E] tabular-nums dark:text-slate-100">
                      {selectedDetails.profile.followersCount} /{' '}
                      {selectedDetails.profile.followingCount}
                    </dd>
                  </div>
                </dl>

                {selectedDetails.profile.bio && (
                  <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700 dark:border-slate-800 dark:text-slate-300">
                    <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">Bio: </span>
                    {selectedDetails.profile.bio}
                  </div>
                )}

                <div>
                  <h4 className="font-display text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Recent Role &amp; Status History
                  </h4>
                  {selectedDetails.recentBadgeAudits.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      No changes recorded for this account.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedDetails.recentBadgeAudits.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">
                              {formatAdminAuditActionLabel(log.action)}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {formatDateLabel(log.createdAt)}
                            </span>
                          </div>
                          {log.reason && (
                            <p className="mt-0.5 text-slate-600 dark:text-slate-400">{log.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateProfile(selectedDetails.profile.username);
                      setSelectedDetails(null);
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                    View Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onJumpToBadges(selectedDetails.profile.username);
                      setSelectedDetails(null);
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132844] dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
                  >
                    <Award className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />
                    Manage Badges
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <AdminConfirmDialog
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.profile.accountStatus === 'suspended'
            ? `Restore @${confirmTarget.profile.username}?`
            : `Suspend @${confirmTarget?.profile.username}?`
        }
        description={
          confirmTarget?.profile.accountStatus === 'suspended'
            ? 'Restoring this account immediately re-enables posting, commenting, and marketplace participation while preserving existing records.'
            : 'Suspending this account blocks posting, commenting, reactions, and marketplace submissions via Firebase Security Rules while keeping existing content intact.'
        }
        confirmLabel={
          confirmTarget?.profile.accountStatus === 'suspended'
            ? 'Restore Account'
            : 'Suspend Account'
        }
        tone={
          confirmTarget?.profile.accountStatus === 'suspended'
            ? 'primary'
            : 'danger'
        }
        busy={Boolean(busyUid)}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => void handleConfirmSuspensionToggle()}
      />
    </div>
  );
};

import React, { useState } from 'react';
import { Loader2, Search, UserCheck } from 'lucide-react';
import {
  assignMemberRoleAndBadgeAtomically,
  toggleModeratorVerifiedStatusAtomically,
  type AdminManagedMember,
} from '../../services/governance';
import {
  BLUEPRINT_LIMITS,
  canActorUpdateTargetRoleRecord,
  type UserRole,
} from '../../types/database';
import { formatAdminAuditActionLabel } from '../../utils/adminPermissions';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminBadgesTabProps {
  members: AdminManagedMember[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onNavigateProfile: (username: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

export const AdminBadgesTab: React.FC<AdminBadgesTabProps> = ({
  members,
  loading,
  actorUid,
  actorRole,
  searchQuery,
  onSearchChange,
  onNavigateProfile,
  onSuccess,
  onError,
  onReload,
}) => {
  const [auditReason, setAuditReason] = useState('');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: AdminManagedMember;
    nextRole: 'member' | 'verified' | 'moderator';
    label: string;
  } | null>(null);

  const executeRoleChange = async () => {
    if (!pendingRoleChange || busyUid) return;
    const { member, nextRole } = pendingRoleChange;
    setBusyUid(member.profile.uid);
    try {
      const res = await assignMemberRoleAndBadgeAtomically({
        actorUid,
        actorRole,
        targetUid: member.profile.uid,
        nextRole,
        reason: auditReason,
      });
      onSuccess(
        `@${member.profile.username}: ${formatAdminAuditActionLabel(res.action)}.`
      );
      setAuditReason('');
      setPendingRoleChange(null);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Unable to update this member role and badge.'
        )
      );
    } finally {
      setBusyUid(null);
    }
  };

  const handleToggleModeratorVerified = async (member: AdminManagedMember) => {
    if (busyUid) return;
    const nextVerified = !member.profile.isVerified;
    setBusyUid(member.profile.uid);
    try {
      await toggleModeratorVerifiedStatusAtomically({
        actorUid,
        actorRole,
        targetUid: member.profile.uid,
        isVerified: nextVerified,
        reason: auditReason,
      });
      onSuccess(
        `@${member.profile.username}: ${
          nextVerified
            ? 'Granted Verified dual badge alongside Moderator.'
            : 'Removed Verified dual badge from Moderator.'
        }`
      );
      setAuditReason('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Unable to update Moderator Verified status.'
        )
      );
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-semibold text-[#0B1A2E] dark:text-slate-100">Badge guide:</span>
          <span className="inline-flex items-center gap-1">
            <RoleBadge badge="verified" variant="icon" size="xs" />
            <RoleBadge badge="verified" variant="full" size="xs" />
          </span>
          <span className="inline-flex items-center gap-1">
            <RoleBadge badge="moderator" variant="icon" size="xs" />
            <RoleBadge badge="moderator" variant="full" size="xs" />
          </span>
          <span className="inline-flex items-center gap-1">
            <RoleBadge badge="trust" variant="icon" size="xs" />
            <RoleBadge badge="trust" variant="full" size="xs" />
          </span>
          <span className="inline-flex items-center gap-1">
            <RoleBadge badge="supreme_admin" variant="icon" size="xs" />
            <RoleBadge badge="supreme_admin" variant="full" size="xs" />
          </span>
        </div>
        <p className="mt-1.5 text-slate-600 dark:text-slate-400">
          Updates the member&apos;s badge immediately and records the change in Activity Log.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="badges-member-search"
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
              id="badges-member-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Name, @username, department, or role..."
              className="block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="badges-audit-reason"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Reason note (optional)
          </label>
          <input
            id="badges-audit-reason"
            type="text"
            maxLength={BLUEPRINT_LIMITS.auditReasonMax}
            value={auditReason}
            onChange={(e) => setAuditReason(e.target.value)}
            placeholder="e.g. Verified lecturer / faculty moderator..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-600 dark:text-slate-400">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading members...
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          No members match your search.
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((entry) => {
            const { profile, effectiveRole } = entry;
            const isSelf = profile.uid === actorUid;
            const isBusy = busyUid === profile.uid;
            const canModifyTarget = canActorUpdateTargetRoleRecord(
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
                      <button
                        type="button"
                        onClick={() => onNavigateProfile(profile.username)}
                        className="truncate font-display text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5] dark:text-slate-100"
                      >
                        {profile.fullName}
                      </button>
                      <ProfileBadgesRow profile={profile} size="xs" />
                      {profile.accountStatus === 'suspended' && (
                        <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950/60 dark:text-red-300">
                          Suspended
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">
                      @{profile.username}
                      {profile.department ? ` · ${profile.department}` : ''}
                      {profile.level ? ` · ${profile.level}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!canModifyTarget ? (
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      {isSelf
                        ? 'Self-modification disabled'
                        : 'Protected Supreme Admin'}
                    </span>
                  ) : (
                    <>
                      {effectiveRole === 'member' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'verified',
                                label: 'Grant Verified Badge',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
                          >
                            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            Make Verified
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'moderator',
                                label: 'Grant Moderator Role',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            Make Moderator
                          </button>
                        </>
                      )}

                      {effectiveRole === 'verified' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'moderator',
                                label: 'Promote to Moderator',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            Make Moderator
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'member',
                                label: 'Remove Verified Badge',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Remove Verified
                          </button>
                        </>
                      )}

                      {effectiveRole === 'moderator' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleModeratorVerified(entry)}
                            className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                              profile.isVerified
                                ? 'border border-[#1E88E5]/40 bg-[#1E88E5]/10 text-[#1565C0] hover:bg-[#1E88E5]/20 dark:text-sky-300'
                                : 'bg-[#1E88E5] text-white hover:bg-[#1565C0]'
                            }`}
                          >
                            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            {profile.isVerified ? 'Remove Verified' : 'Add Verified'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'verified',
                                label: 'Demote Moderator to Verified',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-[#1E88E5]/40 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-60 dark:border-sky-500/40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                          >
                            Set Verified Only
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'member',
                                label: 'Remove Moderator Role',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Remove Moderator
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AdminConfirmDialog
        open={Boolean(pendingRoleChange)}
        title={pendingRoleChange?.label || 'Confirm Role Change'}
        description={
          pendingRoleChange
            ? `Update @${pendingRoleChange.member.profile.username} from ${pendingRoleChange.member.effectiveRole.replace('_', ' ')} to ${pendingRoleChange.nextRole.replace('_', ' ')}?`
            : ''
        }
        confirmLabel="Confirm"
        tone={
          pendingRoleChange?.nextRole === 'member' ? 'danger' : 'primary'
        }
        busy={Boolean(busyUid)}
        onCancel={() => setPendingRoleChange(null)}
        onConfirm={() => void executeRoleChange()}
      />
    </div>
  );
};

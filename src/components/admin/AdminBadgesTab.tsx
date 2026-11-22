import React, { useState } from 'react';
import { Crown, Loader2, Search, UserCheck } from 'lucide-react';
import {
  assignMemberRoleAndBadgeAtomically,
  type AdminManagedMember,
} from '../../services/governance';
import {
  BLUEPRINT_LIMITS,
  canActorUpdateTargetRoleRecord,
  type UserRole,
} from '../../types/database';
import { formatAdminAuditActionLabel } from '../../utils/adminPermissions';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { RoleBadge } from '../RoleBadge';
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
    nextRole: Exclude<UserRole, 'owner'>;
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

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[#0B1A2E]">Platform Badges:</span>
          <RoleBadge badge="supreme_admin" size="xs" />
          <RoleBadge badge="moderator" size="xs" />
          <RoleBadge badge="verified" size="xs" />
        </div>
        <p className="mt-1.5 text-slate-600">
          Every role assignment or removal updates both <code>users</code> and{' '}
          <code>userRoles</code> atomically, records an immutable{' '}
          <code>badgeAuditLogs</code> entry, and notifies the member.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="badges-member-search"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Search member for badge/role assignment
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
              className="block min-h-[42px] w-full rounded-xl border border-slate-300 py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="badges-audit-reason"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Audit log note (optional)
          </label>
          <input
            id="badges-audit-reason"
            type="text"
            maxLength={BLUEPRINT_LIMITS.auditReasonMax}
            value={auditReason}
            onChange={(e) => setAuditReason(e.target.value)}
            placeholder="e.g. Verified CSC lecturer / faculty moderator..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading badge governance directory...
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
          No members matched your search filter.
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((entry) => {
            const { profile, effectiveRole, isPermanentOwner } = entry;
            const isSelf = profile.uid === actorUid;
            const isBusy = busyUid === profile.uid;
            const canModifyTarget = canActorUpdateTargetRoleRecord(
              actorRole,
              isPermanentOwner,
              effectiveRole,
              undefined,
              actorUid,
              profile.uid
            );

            return (
              <div
                key={profile.uid}
                className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center"
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
                        className="truncate font-display text-sm font-bold text-[#0B1A2E] hover:text-[#1E88E5]"
                      >
                        {profile.fullName}
                      </button>
                      <RoleBadge badge={profile.badge} size="xs" />
                      {profile.accountStatus === 'suspended' && (
                        <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                          Suspended
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      @{profile.username}
                      {profile.department ? ` · ${profile.department}` : ''}
                      {profile.level ? ` · ${profile.level}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isPermanentOwner ? (
                    <span className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-900">
                      Protected Owner
                    </span>
                  ) : !canModifyTarget ? (
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
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
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            Grant Verified
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
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            Grant Moderator
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
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            Promote to Moderator
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
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
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
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'verified',
                                label: 'Demote Moderator to Verified',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                          >
                            Demote to Verified
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
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Remove Moderator
                          </button>
                        </>
                      )}

                      {actorRole === 'owner' &&
                        effectiveRole !== 'supreme_admin' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'supreme_admin',
                                label: 'Assign Supreme Admin',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-800 disabled:opacity-60"
                          >
                            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                            Grant Supreme Admin
                          </button>
                        )}

                      {actorRole === 'owner' &&
                        effectiveRole === 'supreme_admin' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setPendingRoleChange({
                                member: entry,
                                nextRole: 'verified',
                                label: 'Remove Supreme Admin',
                              })
                            }
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-900 hover:bg-purple-100 disabled:opacity-60"
                          >
                            Remove Supreme Admin
                          </button>
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
            ? `Update @${pendingRoleChange.member.profile.username} from ${pendingRoleChange.member.effectiveRole.replace('_', ' ')} to ${pendingRoleChange.nextRole.replace('_', ' ')}? This writes an immutable audit entry and sends a notification to the member.`
            : ''
        }
        confirmLabel="Confirm Change"
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

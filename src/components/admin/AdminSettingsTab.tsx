import React, { useState } from 'react';
import { Crown, Loader2, Save, ShieldCheck } from 'lucide-react';
import { saveGlobalPlatformSettings } from '../../services/adminDashboard';
import type { PlatformSetting, UserRole } from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';

interface AdminSettingsTabProps {
  settings: PlatformSetting | null;
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  isPermanentOwner: boolean;
  onJumpToBadges: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved: (nextSettings: PlatformSetting) => void;
}

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  settings,
  loading,
  actorUid,
  actorRole,
  isPermanentOwner,
  onJumpToBadges,
  onSuccess,
  onError,
  onSaved,
}) => {
  const [maintenanceNotice, setMaintenanceNotice] = useState(
    settings?.maintenanceNotice ?? ''
  );
  const [pinnedAnnouncementPostId, setPinnedAnnouncementPostId] = useState(
    settings?.pinnedAnnouncementPostId ?? ''
  );
  const [marketplaceSubmissionsOpen, setMarketplaceSubmissionsOpen] = useState(
    settings?.marketplaceSubmissionsOpen ?? true
  );
  const [anonymousPostingOpen, setAnonymousPostingOpen] = useState(
    settings?.anonymousPostingOpen ?? true
  );
  const [newRegistrationsOpen, setNewRegistrationsOpen] = useState(
    settings?.newRegistrationsOpen ?? true
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveGlobalPlatformSettings({
        actorUid,
        actorRole,
        maintenanceNotice,
        pinnedAnnouncementPostId,
        marketplaceSubmissionsOpen,
        anonymousPostingOpen,
        newRegistrationsOpen,
      });
      onSaved(saved);
      onSuccess('Global platform settings saved to Firestore.');
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not save platform settings.')
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading platform settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 text-xs leading-relaxed text-purple-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-display text-sm font-bold">
            <Crown className="h-4 w-4 text-purple-700" aria-hidden="true" />
            Protected Owner &amp; Supreme Admin Authority
          </div>
          {isPermanentOwner && (
            <button
              type="button"
              onClick={onJumpToBadges}
              className="rounded-lg bg-purple-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-900"
            >
              Manage Supreme Admin Access
            </button>
          )}
        </div>
        <p className="mt-2">
          The Permanent Owner authority remains protected against demotion,
          suspension, or deletion through dashboard actions and is excluded
          from public member directories and Trusted Circle listings.
          Authorized customer Supreme Admin accounts receive delegated
          platform management privileges without being able to alter the
          Permanent Owner or peer Supreme Admins.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <ShieldCheck className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
            Global Platform Configuration (<code>platformSettings/global</code>)
          </h2>
        </div>

        <div>
          <label
            htmlFor="settings-notice"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Platform Notice / Campus Banner Message (optional)
          </label>
          <textarea
            id="settings-notice"
            rows={2}
            maxLength={400}
            value={maintenanceNotice}
            onChange={(e) => setMaintenanceNotice(e.target.value)}
            placeholder="Leave empty for no notice banner, or enter a campus-wide advisory..."
            className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
          />
        </div>

        <div>
          <label
            htmlFor="settings-pinned-post"
            className="block text-xs font-semibold text-[#0B1A2E]"
          >
            Featured Announcement Post ID (optional)
          </label>
          <input
            id="settings-pinned-post"
            type="text"
            maxLength={128}
            value={pinnedAnnouncementPostId}
            onChange={(e) => setPinnedAnnouncementPostId(e.target.value)}
            placeholder="Optional published post ID..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
          />
        </div>

        <div className="space-y-2.5 pt-1">
          {[
            {
              label: 'Accept New Marketplace Submissions',
              desc: 'Allows eligible members to submit new products, services, and accommodation listings.',
              checked: marketplaceSubmissionsOpen,
              onChange: setMarketplaceSubmissionsOpen,
            },
            {
              label: 'Allow Anonymous Community Posting',
              desc: 'Keeps The Unfiltered anonymous composer open for signed-in members.',
              checked: anonymousPostingOpen,
              onChange: setAnonymousPostingOpen,
            },
            {
              label: 'Allow New Member Registrations',
              desc: 'Controls whether public sign-up onboarding is currently open.',
              checked: newRegistrationsOpen,
              onChange: setNewRegistrationsOpen,
            },
          ].map((toggle) => (
            <label
              key={toggle.label}
              className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 hover:bg-slate-50/70"
            >
              <div>
                <p className="text-xs font-bold text-[#0B1A2E]">
                  {toggle.label}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {toggle.desc}
                </p>
              </div>
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
              />
            </label>
          ))}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            )}
            Save Platform Settings
          </button>
        </div>
      </form>
    </div>
  );
};

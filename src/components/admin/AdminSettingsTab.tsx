import React, { useState } from 'react';
import { Crown, Loader2, Megaphone, Save, Send, ShieldCheck } from 'lucide-react';
import {
  broadcastOfficialAnnouncementNotification,
  saveGlobalPlatformSettings,
  type AnnouncementDestinationRoute,
} from '../../services/adminDashboard';
import type { PlatformSetting, UserRole } from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';

interface AdminSettingsTabProps {
  settings: PlatformSetting | null;
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved: (nextSettings: PlatformSetting) => void;
}

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  settings,
  loading,
  actorUid,
  actorRole,
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

  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementRoute, setAnnouncementRoute] =
    useState<AnnouncementDestinationRoute>('for-you');
  const [broadcastingAnnouncement, setBroadcastingAnnouncement] =
    useState(false);

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

  const handleBroadcastAnnouncement = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (broadcastingAnnouncement) return;
    setBroadcastingAnnouncement(true);
    try {
      const result = await broadcastOfficialAnnouncementNotification({
        title: announcementTitle,
        body: announcementBody,
        targetRoute: announcementRoute,
        actorUid,
        actorRole,
      });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      onSuccess(
        `Official community announcement delivered to ${result.sentCount} member notification center${result.sentCount === 1 ? '' : 's'}.`
      );
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not publish official announcement.'
        )
      );
    } finally {
      setBroadcastingAnnouncement(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600 dark:text-slate-300">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
        <div className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
          <Crown className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          Protected Supreme Admin Access
        </div>
        <p className="mt-1.5">
          Only the two designated Supreme Admins can edit platform settings or
          broadcast announcements.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <ShieldCheck className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
            Platform Settings
          </h2>
        </div>

        <div>
          <label
            htmlFor="settings-notice"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Site-Wide Banner Message (optional)
          </label>
          <textarea
            id="settings-notice"
            rows={2}
            maxLength={400}
            value={maintenanceNotice}
            onChange={(e) => setMaintenanceNotice(e.target.value)}
            placeholder="Leave blank for none, or write an urgent campus notice..."
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div>
          <label
            htmlFor="settings-pinned-post"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Featured Post ID (optional)
          </label>
          <input
            id="settings-pinned-post"
            type="text"
            maxLength={128}
            value={pinnedAnnouncementPostId}
            onChange={(e) => setPinnedAnnouncementPostId(e.target.value)}
            placeholder="Optional published post ID..."
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div className="space-y-2.5 pt-1">
          {[
            {
              label: 'Accept Marketplace Listings',
              desc: 'Let members submit products, services, and accommodation listings.',
              checked: marketplaceSubmissionsOpen,
              onChange: setMarketplaceSubmissionsOpen,
            },
            {
              label: 'Allow Anonymous Posting',
              desc: 'Keep The Unfiltered anonymous composer open for members.',
              checked: anonymousPostingOpen,
              onChange: setAnonymousPostingOpen,
            },
            {
              label: 'Allow New Sign-ups',
              desc: 'Control whether new students can create accounts.',
              checked: newRegistrationsOpen,
              onChange: setNewRegistrationsOpen,
            },
          ].map((toggle) => (
            <label
              key={toggle.label}
              className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/50"
            >
              <div>
                <p className="text-xs font-bold text-[#0B1A2E] dark:text-slate-100">
                  {toggle.label}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
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
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60 dark:bg-[#1E88E5] dark:hover:bg-[#1565C0]"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4 text-[#1E88E5] dark:text-white" aria-hidden="true" />
            )}
            Save Settings
          </button>
        </div>
      </form>

      <form
        onSubmit={handleBroadcastAnnouncement}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <Megaphone className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          <div>
            <h2 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
              Broadcast Announcement
            </h2>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Send an official notice to every member&apos;s notification feed.
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="announcement-title"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Headline
          </label>
          <input
            id="announcement-title"
            type="text"
            required
            minLength={3}
            maxLength={160}
            value={announcementTitle}
            onChange={(e) => setAnnouncementTitle(e.target.value)}
            placeholder="e.g. Updated Second Semester Academic Calendar Released"
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div>
          <label
            htmlFor="announcement-body"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Message
          </label>
          <textarea
            id="announcement-body"
            rows={3}
            required
            minLength={5}
            maxLength={500}
            value={announcementBody}
            onChange={(e) => setAnnouncementBody(e.target.value)}
            placeholder="Write the official notice for members..."
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div>
          <label
            htmlFor="announcement-route"
            className="block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
          >
            Open When Tapped
          </label>
          <select
            id="announcement-route"
            value={announcementRoute}
            onChange={(e) =>
              setAnnouncementRoute(
                e.target.value as AnnouncementDestinationRoute
              )
            }
            className="mt-1 block min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="for-you">Home Feed (Updates)</option>
            <option value="upcoming-events">Campus Events</option>
            <option value="opportunities">Opportunities</option>
            <option value="marketplace">Campus Marketplace</option>
            <option value="trusted-circle">Trusted Circle</option>
            <option value="anonymous">Anonymous Feed</option>
            <option value="account">Account Settings</option>
          </select>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={broadcastingAnnouncement}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#1E88E5] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
          >
            {broadcastingAnnouncement ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Send Announcement
          </button>
        </div>
      </form>
    </div>
  );
};

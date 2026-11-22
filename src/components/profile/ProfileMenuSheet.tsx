import React, { useState } from 'react';
import {
  Bookmark,
  ChevronRight,
  Edit3,
  Loader2,
  Lock,
  LogOut,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { signOutCurrentUser } from '../../services/auth';
import { updateMemberPrivacySettings } from '../../services/firestoreFoundation';
import { formatFirestoreOrAppError } from '../../utils/authValidation';

interface ProfileMenuSheetProps {
  uid: string;
  username: string;
  showWhatsappPublicly: boolean;
  isSuspended: boolean;
  onEditProfile: () => void;
  onOpenAccountSettings: () => void;
  onSelectSavedTab: () => void;
  onSelectAnonymousTab: () => void;
  onPrivacyUpdated: (showWhatsappPublicly: boolean) => Promise<void>;
  onSignedOut: () => void;
  onClose: () => void;
}

export const ProfileMenuSheet: React.FC<ProfileMenuSheetProps> = ({
  uid,
  username,
  showWhatsappPublicly,
  isSuspended,
  onEditProfile,
  onOpenAccountSettings,
  onSelectSavedTab,
  onSelectAnonymousTab,
  onPrivacyUpdated,
  onSignedOut,
  onClose,
}) => {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [whatsappVisible, setWhatsappVisible] = useState(showWhatsappPublicly);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleToggleWhatsappVisibility = async () => {
    if (privacyBusy || isSuspended) return;
    const next = !whatsappVisible;
    setPrivacyBusy(true);
    setPrivacyError(null);
    setPrivacyMessage(null);
    try {
      await updateMemberPrivacySettings(uid, { showWhatsappPublicly: next });
      setWhatsappVisible(next);
      await onPrivacyUpdated(next);
      setPrivacyMessage(
        next
          ? 'Your WhatsApp contact button is now visible on your public profile.'
          : 'Your WhatsApp contact button is now hidden from your public profile.'
      );
    } catch (error) {
      setPrivacyError(
        formatFirestoreOrAppError(
          error,
          'Could not update privacy settings right now.'
        )
      );
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutCurrentUser();
      onClose();
      onSignedOut();
    } catch (error) {
      setPrivacyError(
        formatFirestoreOrAppError(error, 'Unable to sign out right now.')
      );
      setSigningOut(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/60 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-menu-sheet-title"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-4 pt-3 pb-6 shadow-2xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden"
        />

        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2
              id="profile-menu-sheet-title"
              className="font-display text-base font-bold text-[#0B1A2E]"
            >
              Profile &amp; Settings
            </h2>
            <p className="text-xs text-slate-500">@{username}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile menu"
            className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 space-y-1.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onEditProfile();
            }}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Edit3 className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Edit Profile
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAccountSettings();
            }}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Settings className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Account Settings
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-expanded={privacyOpen}
            onClick={() => setPrivacyOpen((prev) => !prev)}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Privacy Settings
            </span>
            <ChevronRight
              className={`h-4 w-4 text-slate-400 transition-transform ${
                privacyOpen ? 'rotate-90' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          {privacyOpen && (
            <div className="mx-1 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#0B1A2E]">
                    Show WhatsApp on Public Profile
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    Controls the WhatsApp contact button visible to campus
                    visitors.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={whatsappVisible}
                  disabled={privacyBusy || isSuspended}
                  onClick={() => void handleToggleWhatsappVisibility()}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    whatsappVisible ? 'bg-[#1E88E5]' : 'bg-slate-300'
                  }`}
                >
                  <span className="sr-only">Toggle WhatsApp visibility</span>
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                      whatsappVisible ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {privacyBusy && (
                <p className="mt-2 flex items-center gap-1.5 text-slate-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Saving privacy preference...
                </p>
              )}
              {privacyMessage && (
                <p className="mt-2 font-medium text-emerald-700">
                  {privacyMessage}
                </p>
              )}
              {privacyError && (
                <p className="mt-2 font-medium text-red-700">{privacyError}</p>
              )}

              <p className="mt-3 border-t border-slate-200 pt-2.5 leading-relaxed text-slate-600">
                Your email, internal UID, Saved Content, and My Anonymous Posts
                are always private and never shown to visitors.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectAnonymousTab();
            }}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              My Anonymous Posts
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectSavedTab();
            }}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <Bookmark className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
              Saved Content
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </button>

          <div className="border-t border-slate-100 pt-2">
            <button
              type="button"
              disabled={signingOut}
              onClick={() => void handleLogout()}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden="true" />
              )}
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

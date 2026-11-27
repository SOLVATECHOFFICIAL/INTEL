import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Monitor,
  Moon,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
  Volume2,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { useTheme } from '../../context/themeContext';
import type { ThemePreference } from '../../utils/theme';
import {
  changeAccountPassword,
  deleteAuthenticatedUser,
  reauthenticateCurrentUser,
  requestAccountEmailChange,
  requestEmailVerification,
  sendPasswordRecoveryEmail,
  signOutCurrentUser,
} from '../../services/auth';
import {
  checkUsernameAvailability,
  deleteOwnMemberFirestoreData,
  updateMemberAccountProfileAndUsername,
  updateMemberPrivacySettings,
} from '../../services/firestoreFoundation';
import {
  getAccountSectionSnapshot,
  saveAccountSectionSnapshot,
} from '../../services/navigationStateCache';
import { BLUEPRINT_LIMITS } from '../../types/database';
import type {
  AccountSettingsSection,
  ActiveRoute,
  ProfileTab,
  SearchScopeId,
} from '../../types/platform';
import {
  ACCOUNT_CATEGORY_OPTIONS,
  buildWhatsAppChatUrl,
  CAMPUS_STATUS_OPTIONS,
  canAccessAdminDashboard,
  canAccessFullAdminDashboard,
  formatFirestoreOrAppError,
  isDesignatedSupremeAdminUser,
  isUndergroundSupremeAdminUser,
  isValidEmailAddress,
  mapFirebaseAuthError,
  normalizeUsername,
  validatePasswordChangeForm,
  validateProfileSettingsForm,
  validateUsernameCandidate,
  type PasswordChangeValidationErrors,
  type ProfileSettingsFormInput,
  type ProfileSettingsValidationErrors,
} from '../../utils/authValidation';
import {
  FEED_INTEREST_OPTIONS,
} from '../../utils/feedRanking';
import {
  NOTIFICATION_PREFERENCE_OPTIONS,
  type NotificationPrefKey,
} from '../../utils/notifications';
import {
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
} from '../../utils/notificationSound';
import { ProfileBadgesRow } from '../RoleBadge';
import { GuestPromptCard } from '../auth/GuestPromptCard';
import { AvatarMedia } from '../media/FirestoreImage';
import {
  ProfileMediaUploaders,
  type ProfileMediaUploadersHandle,
} from '../media/ProfileMediaUploaders';
import { PWAInstallControl } from '../pwa/PWAInstallControl';
import { PushTestControls } from '../pwa/PushTestControls';
import { WebPushNotificationButton } from '../pwa/WebPushNotificationButton';
import { SectionRibbon } from '../shared/SectionRibbon';

export type { AccountSettingsSection };

interface AccountPageProps {
  initialSection?: AccountSettingsSection;
  onSectionChange?: (section: AccountSettingsSection) => void;
  onNavigate: (
    route: ActiveRoute,
    options?: {
      username?: string;
      profileTab?: ProfileTab;
      searchScope?: SearchScopeId;
    }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack?: () => void;
}

export const AccountPage: React.FC<AccountPageProps> = ({
  initialSection = 'profile',
  onSectionChange,
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
    notificationPrefs,
    interestCategories,
    updateNotificationPrefsOptimistic,
    updateInterestCategoriesOptimistic,
    refreshAccountState,
  } = useFirebase();

  const viewerKey = user?.uid ?? 'guest';

  const [activeTab, setActiveTab] = useState<AccountSettingsSection>(() => {
    if (initialSection && initialSection !== 'profile') {
      return initialSection;
    }
    return getAccountSectionSnapshot(viewerKey)?.activeTab ?? initialSection;
  });

  // Shared status feedback
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const lastInitialSectionRef = React.useRef(initialSection);
  useEffect(() => {
    if (lastInitialSectionRef.current === initialSection) return;
    lastInitialSectionRef.current = initialSection;
    const timer = window.setTimeout(() => {
      setActiveTab(initialSection);
      setErrorMessage(null);
      setStatusMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialSection]);

  useEffect(() => {
    saveAccountSectionSnapshot({
      viewerKey,
      activeTab,
      cachedAt: Date.now(),
    });
  }, [viewerKey, activeTab]);

  // Section B: Account Security state
  const [signingOut, setSigningOut] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [refreshingVerification, setRefreshingVerification] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordErrors, setPasswordErrors] =
    useState<PasswordChangeValidationErrors>({});
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [nextEmail, setNextEmail] = useState('');
  const [isChangingEmail, setIsChangingEmail] = useState(false);

  // Section C: Privacy toggle state
  const [togglingWhatsapp, setTogglingWhatsapp] = useState(false);
  const isUndergroundAdmin = isUndergroundSupremeAdminUser(user);
  const isProtectedAdmin = isDesignatedSupremeAdminUser(user);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    isNotificationSoundEnabled()
  );

  // Section D: Account Deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const { preference: themeMode, setThemePreference: setThemeMode } = useTheme();

  if (!authReady) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-4 h-24 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
      </section>
    );
  }

  if (!user) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
        <h1 className="font-display text-2xl font-bold text-[#0B1A2E] dark:text-slate-100">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Sign in to edit your profile, security, privacy, and theme settings.
        </p>
        <div className="mt-5">
          <GuestPromptCard
            title="Sign in to manage your account"
            description="Edit your @username, photos, bio, security settings, and public WhatsApp contact."
            returnRoute="account"
            onRequireAuth={onRequireAuth}
          />
        </div>
      </section>
    );
  }

  const handlePasswordChange = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isChangingPassword) return;

    setErrorMessage(null);
    setStatusMessage(null);

    const errors = validatePasswordChangeForm({
      currentPassword,
      newPassword,
      confirmNewPassword,
    });
    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    setPasswordErrors({});
    setIsChangingPassword(true);
    try {
      await changeAccountPassword(user, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setStatusMessage('Your account password has been updated.');
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleEmailChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isChangingEmail) return;

    setErrorMessage(null);
    setStatusMessage(null);

    if (!emailChangePassword) {
      setErrorMessage('Enter your current password to request an email change.');
      return;
    }
    if (!isValidEmailAddress(nextEmail)) {
      setErrorMessage('Enter a valid new email address.');
      return;
    }

    setIsChangingEmail(true);
    try {
      await requestAccountEmailChange(user, emailChangePassword, nextEmail);
      setEmailChangePassword('');
      setNextEmail('');
      setStatusMessage(
        'A verification link has been sent to your new email address. Your login email updates once you confirm that link.'
      );
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setIsChangingEmail(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!user.email || sendingReset) return;
    setSendingReset(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await sendPasswordRecoveryEmail(user.email);
      setStatusMessage(
        `A password reset link was sent to ${user.email}.`
      );
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setSendingReset(false);
    }
  };

  const handleResendVerification = async () => {
    setSendingVerification(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await requestEmailVerification(user);
      setStatusMessage(
        'Verification email sent. Check your inbox and click "I Verified — Refresh" once done.'
      );
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setSendingVerification(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (refreshingVerification) return;
    setRefreshingVerification(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await user.reload();
      await user.getIdToken(true);
      await refreshAccountState();
      setStatusMessage(
        user.emailVerified
          ? 'Email verified! Your Firebase session permissions are now updated.'
          : 'Your email still appears unverified in Firebase Auth. Please click the verification link in your inbox first.'
      );
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setRefreshingVerification(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentUser();
      onNavigate('for-you');
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setSigningOut(false);
    }
  };

  const handleTogglePublicWhatsapp = async () => {
    if (!user || !profile || isSuspended || togglingWhatsapp) return;
    setTogglingWhatsapp(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const nextShow = !(profile.showWhatsappPublicly ?? true);
      await updateMemberPrivacySettings(user.uid, {
        showWhatsappPublicly: nextShow,
      });
      await refreshAccountState();
      setStatusMessage(
        nextShow
          ? 'WhatsApp contact button is now visible on your public profile.'
          : 'WhatsApp contact button is now hidden from your public profile.'
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Unable to update your WhatsApp visibility preference right now.'
        )
      );
    } finally {
      setTogglingWhatsapp(false);
    }
  };

  const handleDeleteAccount = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isDeletingAccount || isProtectedAdmin) return;

    setErrorMessage(null);
    setStatusMessage(null);

    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setErrorMessage('Type DELETE in the confirmation box to proceed.');
      return;
    }
    if (!deletePassword) {
      setErrorMessage(
        'Enter your current password to reauthenticate and delete your account.'
      );
      return;
    }

    setIsDeletingAccount(true);
    try {
      await reauthenticateCurrentUser(user, deletePassword);
      await deleteOwnMemberFirestoreData(user.uid);
      await deleteAuthenticatedUser(user);
      onNavigate('for-you');
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const showAdminDashboard = canAccessAdminDashboard(
    effectiveTier,
    isSuspended
  );
  const whatsappChatUrl = profile?.publicWhatsapp
    ? buildWhatsAppChatUrl(profile.publicWhatsapp)
    : null;

  const accountRibbonItems: { id: AccountSettingsSection; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    { id: 'privacy', label: 'Preferences' },
    { id: 'management', label: 'Account' },
  ];

  const themeRibbonItems: {
    id: ThemePreference;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'light',
      label: 'Light',
      icon: <Sun className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    {
      id: 'dark',
      label: 'Dark',
      icon: <Moon className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    {
      id: 'system',
      label: 'System',
      icon: <Monitor className="h-3.5 w-3.5" aria-hidden="true" />,
    },
  ];

  return (
    <section
      aria-labelledby="account-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      {/* Account Summary Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {onBack && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-colors hover:text-[#0B1A2E] sm:text-sm dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
          </div>
        )}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex items-start gap-3.5">
            <AvatarMedia
              fullName={profile?.fullName || user.displayName || 'LASUED Member'}
              photoImageId={profile?.photoImageId}
              photoUrl={profile?.photoUrl}
              sizeClass="h-14 w-14"
              roundedClass="rounded-xl"
              textClass="text-base"
            />
            <div>
              <h1
                id="account-heading"
                className="font-display text-xl font-bold text-[#0B1A2E] sm:text-2xl dark:text-slate-100"
              >
                {profile?.fullName || user.displayName || 'LASUED Member'}
              </h1>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                {profile?.username ? `@${profile.username}` : 'Profile synced'}
                {profile ? (
                  <>
                    {' · '}
                    <span className="tabular-nums">
                      {profile.followersCount} Followers
                    </span>
                    {' · '}
                    <span className="tabular-nums">
                      {profile.followingCount} Following
                    </span>
                  </>
                ) : null}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {isUndergroundAdmin ? (
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Role: Ordinary Member
                  </span>
                ) : effectiveTier === 'supreme_admin' ||
                  effectiveTier === 'moderator' ||
                  effectiveTier === 'verified' ? (
                  <ProfileBadgesRow
                    profile={{
                      badge: effectiveTier,
                      isVerified: Boolean(profile?.isVerified),
                    }}
                    size="md"
                  />
                ) : (
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Role: Ordinary Member
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {profile?.username && (
              <button
                type="button"
                onClick={() =>
                  onNavigate('profile', { username: profile.username })
                }
                className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#132844] sm:text-sm dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
              >
                <ExternalLink
                  className="h-4 w-4 text-[#1E88E5] dark:text-white"
                  aria-hidden="true"
                />
                View Profile
              </button>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap transition-colors hover:bg-slate-50 disabled:opacity-60 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
              )}
              Sign Out
            </button>
          </div>
        </div>

        {isSuspended && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Your account is suspended. Profile edits and protected actions are paused.
            </span>
          </div>
        )}

        {!profile && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/10 p-3.5 text-sm text-[#0B1A2E] dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200"
          >
            <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]" aria-hidden="true" />
            <span>
              Finish and save your <strong>Profile</strong> details below to set up your @username.
            </span>
          </div>
        )}

        {!user.emailVerified && (
          <div className="mt-4 flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950 sm:flex-row sm:items-center dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
            <div className="flex items-start gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Verify your email address, then click Refresh to unlock all member tools.
              </span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRefreshVerification()}
                disabled={refreshingVerification}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0B1A2E] whitespace-nowrap hover:bg-amber-100/60 disabled:opacity-60 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800"
              >
                {refreshingVerification ? 'Refreshing...' : 'I Verified — Refresh'}
              </button>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={sendingVerification}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-[#132844] disabled:opacity-60 dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
              >
                {sendingVerification ? 'Sending...' : 'Resend email'}
              </button>
            </div>
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
          >
            {errorMessage}
          </div>
        )}

        {showAdminDashboard && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#132844] sm:text-sm dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
            >
              <ShieldCheck className="h-4 w-4 text-[#1E88E5] dark:text-white" aria-hidden="true" />
              {canAccessFullAdminDashboard(effectiveTier, isSuspended)
                ? 'Open Admin Dashboard'
                : 'Open Moderation Console'}
            </button>
          </div>
        )}
      </div>

      {/* Organized Settings Ribbon */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <SectionRibbon
            items={accountRibbonItems}
            activeId={activeTab}
            onChange={(id) => {
              setActiveTab(id);
              onSectionChange?.(id);
              setErrorMessage(null);
              setStatusMessage(null);
            }}
            ariaLabel="Account Settings Sections"
            variant="primary"
          />
        </div>

        <div className="p-5 sm:p-6">
          {/* PROFILE INFORMATION */}
          {activeTab === 'profile' && (
            <ProfileInformationForm
              key={`${user.uid}:${profile?.username ?? ''}:${profile?.fullName ?? ''}:${profile?.bio ?? ''}:${profile?.department ?? ''}:${profile?.faculty ?? ''}:${profile?.level ?? ''}:${profile?.accountCategory ?? ''}:${profile?.publicWhatsapp ?? ''}:${profile?.showWhatsappPublicly ?? true}:${profile?.photoImageId ?? ''}:${profile?.coverImageId ?? ''}`}
              uid={user.uid}
              hasInitializedProfile={Boolean(profile)}
              authEmail={user.email || ''}
              currentUsername={profile?.username ?? ''}
              currentPhotoImageId={profile?.photoImageId}
              currentCoverImageId={profile?.coverImageId}
              initialValues={{
                fullName: profile?.fullName || user.displayName || '',
                username: profile?.username || '',
                bio: profile?.bio || '',
                department: profile?.department || '',
                faculty: profile?.faculty || '',
                level: profile?.level || '',
                accountCategory: profile?.accountCategory || '',
                publicWhatsapp: profile?.publicWhatsapp || '',
                showWhatsappPublicly: profile?.showWhatsappPublicly ?? true,
                photoUrl: profile?.photoUrl || '',
                coverUrl: profile?.coverUrl || '',
              }}
              isSuspended={isSuspended}
              onRefreshAccount={refreshAccountState}
              onStatus={(msg) => {
                setErrorMessage(null);
                setStatusMessage(msg);
              }}
              onError={(msg) => {
                setStatusMessage(null);
                setErrorMessage(msg);
              }}
            />
          )}

          {/* ACCOUNT SECURITY */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100">
                  Security &amp; Sign-In
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Update your password, login email, and verification status.
                </p>
              </div>

              {/* Security Overview */}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-950/70">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Sign-In Email
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-[#0B1A2E] dark:text-slate-100">
                    {user.email || 'Not configured'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Verification Status
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-[#0B1A2E] dark:text-slate-100">
                    {user.emailVerified
                      ? 'Verified Email'
                      : 'Pending Email Verification'}
                  </p>
                </div>
              </div>

              {/* Change Password */}
              <form
                onSubmit={handlePasswordChange}
                noValidate
                className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    <KeyRound
                      className="h-4 w-4 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    Change Password
                  </h3>
                  <button
                    type="button"
                    onClick={() => void handleSendPasswordReset()}
                    disabled={sendingReset}
                    className="text-xs font-semibold text-[#1E88E5] hover:underline disabled:opacity-60 dark:text-sky-400"
                  >
                    {sendingReset
                      ? 'Sending reset email...'
                      : 'Send reset email instead'}
                  </button>
                </div>

                <div>
                  <label
                    htmlFor="sec-current-password"
                    className="block text-xs font-medium text-[#0B1A2E] dark:text-slate-200"
                  >
                    Current password
                  </label>
                  <input
                    id="sec-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  {passwordErrors.currentPassword && (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                      {passwordErrors.currentPassword}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="sec-new-password"
                      className="block text-xs font-medium text-[#0B1A2E] dark:text-slate-200"
                    >
                      New password
                    </label>
                    <input
                      id="sec-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    {passwordErrors.newPassword && (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                        {passwordErrors.newPassword}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="sec-confirm-password"
                      className="block text-xs font-medium text-[#0B1A2E] dark:text-slate-200"
                    >
                      Confirm new password
                    </label>
                    <input
                      id="sec-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    {passwordErrors.confirmNewPassword && (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                        {passwordErrors.confirmNewPassword}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60 dark:bg-[#1E88E5] dark:hover:bg-[#1976D2]"
                >
                  {isChangingPassword && (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Update Password
                </button>
              </form>

              {/* Change Email */}
              <form
                onSubmit={handleEmailChange}
                noValidate
                className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                  <Mail className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                  Change Sign-In Email
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  We send a confirmation link to your new email before updating your login.
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="sec-next-email"
                      className="block text-xs font-medium text-[#0B1A2E] dark:text-slate-200"
                    >
                      New email address
                    </label>
                    <input
                      id="sec-next-email"
                      type="email"
                      value={nextEmail}
                      onChange={(e) => setNextEmail(e.target.value)}
                      placeholder="new@example.com"
                      className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sec-email-password"
                      className="block text-xs font-medium text-[#0B1A2E] dark:text-slate-200"
                    >
                      Current password
                    </label>
                    <input
                      id="sec-email-password"
                      type="password"
                      autoComplete="current-password"
                      value={emailChangePassword}
                      onChange={(e) => setEmailChangePassword(e.target.value)}
                      className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isChangingEmail}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  {isChangingEmail && (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Send Verification to New Email
                </button>
              </form>
            </div>
          )}

          {/* PREFERENCES, APPEARANCE & PRIVACY */}
          {activeTab === 'privacy' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100">
                  Preferences &amp; Privacy
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Choose your theme, notifications, feed interests, and WhatsApp visibility.
                </p>
              </div>

              <div className="space-y-3">
                {/* Appearance / Theme Mode */}
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        <Moon
                          className="h-4 w-4 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        Appearance
                      </h3>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        Switch between Light, Dark, or match your device setting.
                      </p>
                    </div>
                    <div className="shrink-0" data-testid="account-appearance-ribbon">
                      <SectionRibbon
                        items={themeRibbonItems}
                        activeId={themeMode}
                        onChange={(nextMode) => setThemeMode(nextMode)}
                        ariaLabel="Theme appearance"
                        variant="sublist"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        <MessageCircle
                          className="h-4 w-4 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        Public WhatsApp Contact
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Show or hide the WhatsApp button ({profile?.publicWhatsapp || 'not set'}) on your public profile.
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={profile ? (profile.showWhatsappPublicly ?? true) : true}
                      aria-label="Show WhatsApp contact button on public profile"
                      disabled={!profile || isSuspended || togglingWhatsapp}
                      onClick={() => void handleTogglePublicWhatsapp()}
                      className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        (profile?.showWhatsappPublicly ?? true)
                          ? 'border-[#1E88E5]/40 bg-[#1E88E5]/10 text-[#0B1A2E] dark:border-sky-700/60 dark:bg-sky-950/60 dark:text-sky-200'
                          : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {togglingWhatsapp ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            (profile?.showWhatsappPublicly ?? true)
                              ? 'bg-[#1E88E5]'
                              : 'bg-slate-400'
                          }`}
                        />
                      )}
                      {(profile?.showWhatsappPublicly ?? true)
                        ? 'Visible on Profile'
                        : 'Hidden on Profile'}
                    </button>
                  </div>

                  {whatsappChatUrl && (profile?.showWhatsappPublicly ?? true) && (
                    <a
                      href={whatsappChatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E88E5] hover:underline dark:text-sky-400"
                    >
                      Preview WhatsApp link
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>

                {isUndergroundAdmin && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                    <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                      <Shield
                        className="h-4 w-4 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      Underground Directory Privacy
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Admin badges and directory listing stay hidden while full moderation tools stay active.
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    <Lock
                      className="h-4 w-4 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    Private Email
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Your email address is never shown publicly. Only your @username is shared.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start gap-2.5">
                    <Bell
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        Notification Preferences
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Pick which alerts appear in your Notification Centre and push notifications.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3.5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/40 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/50">
                    {NOTIFICATION_PREFERENCE_OPTIONS.map((opt) => {
                      const enabled = notificationPrefs[opt.key] !== false;
                      return (
                        <div
                          key={opt.key}
                          className="flex items-center justify-between gap-3 px-3.5 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#0B1A2E] dark:text-slate-100">
                              {opt.label}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                              {opt.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            aria-label={`Toggle ${opt.label} notifications`}
                            disabled={isSuspended}
                            onClick={() => {
                              setErrorMessage(null);
                              setStatusMessage(null);
                              const nextPrefs: Record<
                                NotificationPrefKey,
                                boolean
                              > = {
                                ...notificationPrefs,
                                [opt.key]: !enabled,
                              };
                              void updateNotificationPrefsOptimistic(
                                nextPrefs
                              ).catch((err) => {
                                setErrorMessage(
                                  formatFirestoreOrAppError(
                                    err,
                                    'Could not save notification preferences.'
                                  )
                                );
                              });
                            }}
                            className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
                              enabled
                                ? 'border-[#1E88E5]/40 bg-[#1E88E5]/10 text-[#0B1A2E] dark:border-sky-700/60 dark:bg-sky-950/60 dark:text-sky-200'
                                : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`inline-block h-2 w-2 rounded-full ${
                                enabled ? 'bg-[#1E88E5]' : 'bg-slate-400'
                              }`}
                            />
                            {enabled ? 'On' : 'Off'}
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-[#0B1A2E] dark:text-slate-100">
                          <Volume2 className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                          Alert Sound &amp; Vibration
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                          Play a chime when new likes, replies, or followers arrive.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            playNotificationSound(null, { force: true });
                          }}
                          className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                          Test chime
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={soundEnabled}
                          aria-label="Toggle notification sound and vibration"
                          data-testid="toggle-notification-sound"
                          onClick={() => {
                            const next = !soundEnabled;
                            setSoundEnabled(next);
                            setNotificationSoundEnabled(next);
                            if (next) {
                              playNotificationSound(null, { force: true });
                            }
                          }}
                          className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                            soundEnabled
                              ? 'border-[#1E88E5]/40 bg-[#1E88E5]/10 text-[#0B1A2E] dark:border-sky-700/60 dark:bg-sky-950/60 dark:text-sky-200'
                              : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`inline-block h-2 w-2 rounded-full ${
                              soundEnabled ? 'bg-[#1E88E5]' : 'bg-slate-400'
                            }`}
                          />
                          {soundEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        <Bell
                          className="h-4 w-4 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        App Install &amp; Push Alerts
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Install LASUED Intel to your home screen and turn on device push notifications.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex flex-wrap items-center gap-3">
                    <PWAInstallControl variant="settings" />
                    <WebPushNotificationButton
                      variant="full"
                      allowDisable
                      showIosHint
                      allCategoriesDisabled={NOTIFICATION_PREFERENCE_OPTIONS.every(
                        (opt) => notificationPrefs[opt.key] === false
                      )}
                    />
                  </div>
                  {!isSuspended && (
                    <div className="mt-3 empty:hidden">
                      <PushTestControls compact />
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start gap-2.5">
                    <Sparkles
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                        For You Feed Topics
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Pick campus topics you want to see more of in For You.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {FEED_INTEREST_OPTIONS.map((topic) => {
                      const selected = interestCategories.some(
                        (item) => item.toLowerCase() === topic.toLowerCase()
                      );
                      return (
                        <button
                          key={topic}
                          type="button"
                          aria-pressed={selected}
                          disabled={isSuspended}
                          onClick={() => {
                            setErrorMessage(null);
                            setStatusMessage(null);
                            const nextTopics = selected
                              ? interestCategories.filter(
                                  (item) =>
                                    item.toLowerCase() !== topic.toLowerCase()
                                )
                              : [...interestCategories, topic];
                            void updateInterestCategoriesOptimistic(nextTopics)
                              .then(() => {
                                setStatusMessage(
                                  'Feed topics updated.'
                                );
                              })
                              .catch((err) => {
                                setErrorMessage(
                                  formatFirestoreOrAppError(
                                    err,
                                    'Could not save feed topic preferences right now.'
                                  )
                                );
                              });
                          }}
                          className={`inline-flex min-h-[36px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                            selected
                              ? 'border-[#1E88E5] bg-[#1E88E5] text-white'
                              : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {topic}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
                    <Shield
                      className="h-4 w-4 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                    Anonymous Privacy
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Anonymous posts and replies never appear on your public profile or in search.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ACCOUNT MANAGEMENT */}
          {activeTab === 'management' && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100">
                  Account Management
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Close and permanently delete your LASUED Intel account.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
                <h3 className="flex items-center gap-2 font-display text-sm font-bold text-red-900 dark:text-red-200">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete Account
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-300">
                  This permanently deletes your profile, @username, saved items, and notifications.
                </p>

                {isProtectedAdmin ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-white p-3 text-xs font-medium text-red-900 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-200">
                    Protected Supreme Admin accounts cannot be self-deleted.
                  </p>
                ) : !showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="mt-3 inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                  >
                    Delete Account
                  </button>
                ) : (
                  <form
                    onSubmit={handleDeleteAccount}
                    className="mt-4 space-y-3 border-t border-red-200 pt-4 dark:border-red-900/60"
                  >
                    <div>
                      <label
                        htmlFor="del-confirm-word"
                        className="block text-xs font-semibold text-red-900 dark:text-red-200"
                      >
                        Type DELETE to confirm
                      </label>
                      <input
                        id="del-confirm-word"
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                        className="mt-1 block min-h-[42px] w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] dark:border-red-800 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="del-password"
                        className="block text-xs font-semibold text-red-900 dark:text-red-200"
                      >
                        Current password
                      </label>
                      <input
                        id="del-password"
                        type="password"
                        autoComplete="current-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        className="mt-1 block min-h-[42px] w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] dark:border-red-800 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={isDeletingAccount}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                      >
                        {isDeletingAccount && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        )}
                        Permanently Delete Account
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingAccount}
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmText('');
                          setDeletePassword('');
                        }}
                        className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

interface ProfileInformationFormProps {
  uid: string;
  hasInitializedProfile: boolean;
  authEmail: string;
  currentUsername: string;
  currentPhotoImageId?: string;
  currentCoverImageId?: string;
  initialValues: ProfileSettingsFormInput;
  isSuspended: boolean;
  onRefreshAccount: () => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

const ProfileInformationForm: React.FC<ProfileInformationFormProps> = ({
  uid,
  hasInitializedProfile,
  authEmail,
  currentUsername,
  currentPhotoImageId,
  currentCoverImageId,
  initialValues,
  isSuspended,
  onRefreshAccount,
  onStatus,
  onError,
}) => {
  const [editFullName, setEditFullName] = useState(initialValues.fullName);
  const [editUsername, setEditUsername] = useState(initialValues.username);
  const [editBio, setEditBio] = useState(initialValues.bio);
  const [editDepartment, setEditDepartment] = useState(
    initialValues.department
  );
  const [editFaculty, setEditFaculty] = useState(initialValues.faculty);
  const [editLevel, setEditLevel] = useState(initialValues.level);
  const [editAccountCategory, setEditAccountCategory] = useState(
    initialValues.accountCategory
  );
  const [editWhatsapp, setEditWhatsapp] = useState(
    initialValues.publicWhatsapp
  );

  const { user: activeAuthUser } = useFirebase();
  const allowReservedUsername = isDesignatedSupremeAdminUser(activeAuthUser);
  const mediaUploadersRef = React.useRef<ProfileMediaUploadersHandle | null>(null);

  const [profileErrors, setProfileErrors] =
    useState<ProfileSettingsValidationErrors>({});
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'checking' | 'available' | 'taken';
    message?: string;
  }>({ state: 'idle' });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    const candidate = normalizeUsername(editUsername);
    const current = normalizeUsername(currentUsername);
    if (
      !candidate ||
      candidate === current ||
      validateUsernameCandidate(candidate, { allowReserved: allowReservedUsername })
    ) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(candidate, uid, {
        allowReserved: allowReservedUsername,
      })
        .then((result) => {
          if (!active) return;
          setUsernameStatus({
            state: result.available ? 'available' : 'taken',
            message:
              result.reason ??
              (result.available
                ? `@${result.normalized} is available.`
                : 'Username unavailable.'),
          });
        })
        .catch(() => {
          if (!active) return;
          setUsernameStatus({ state: 'idle' });
        });
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [editUsername, currentUsername, uid, allowReservedUsername]);

  const handleUsernameChange = (raw: string) => {
    const lower = raw.toLowerCase();
    setEditUsername(lower);
    const candidate = normalizeUsername(lower);
    const current = normalizeUsername(currentUsername);

    if (!candidate || candidate === current) {
      setUsernameStatus({ state: 'idle' });
      return;
    }

    const syncError = validateUsernameCandidate(candidate, {
      allowReserved: allowReservedUsername,
    });
    if (syncError) {
      setUsernameStatus({ state: 'taken', message: syncError });
    } else {
      setUsernameStatus({
        state: 'checking',
        message: 'Checking username availability...',
      });
    }
  };

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingProfile || isSuspended) return;

    const sanitizeStoredUrl = (raw: string): string => {
      const trimmed = raw.trim();
      if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
        return '';
      }
      return /^https?:\/\//i.test(trimmed)
        ? trimmed.slice(0, BLUEPRINT_LIMITS.urlMax)
        : '';
    };

    const payload: ProfileSettingsFormInput = {
      fullName: editFullName,
      username: editUsername,
      bio: editBio,
      department: editDepartment,
      faculty: editFaculty,
      level: editLevel,
      accountCategory: editAccountCategory,
      publicWhatsapp: editWhatsapp,
      showWhatsappPublicly: initialValues.showWhatsappPublicly,
      photoUrl: sanitizeStoredUrl(initialValues.photoUrl),
      coverUrl: sanitizeStoredUrl(initialValues.coverUrl),
    };

    const validationErrors = validateProfileSettingsForm(payload, {
      currentUsername,
      allowReserved: allowReservedUsername,
    });
    const firstValidationError = Object.values(validationErrors)[0];
    if (firstValidationError) {
      setProfileErrors(validationErrors);
      onError(firstValidationError);
      return;
    }

    setProfileErrors({});
    setIsSavingProfile(true);
    try {
      await mediaUploadersRef.current?.flushPendingMedia();
      const result = await updateMemberAccountProfileAndUsername(
        uid,
        currentUsername,
        payload,
        authEmail
      );
      await onRefreshAccount();
      onStatus(
        !currentUsername
          ? `Your member profile (@${result.updatedUsername}) has been initialized and saved.`
          : result.updatedUsername !== currentUsername
          ? `Profile updated. Your public profile URL now uses @${result.updatedUsername}, and your previous handle redirects cleanly.`
          : 'Your profile details have been updated.'
      );
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Unable to update your profile settings right now.'
        )
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <form onSubmit={handleSaveProfile} noValidate className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-[#0B1A2E] dark:text-slate-100">
          Profile Information
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Update your photos, name, @username, bio, and WhatsApp contact.
        </p>
      </div>

      {hasInitializedProfile ? (
        <ProfileMediaUploaders
          ref={mediaUploadersRef}
          uid={uid}
          username={currentUsername || undefined}
          fullName={editFullName || 'LASUED Member'}
          currentPhotoImageId={currentPhotoImageId}
          currentPhotoUrl={initialValues.photoUrl}
          currentCoverImageId={currentCoverImageId}
          currentCoverUrl={initialValues.coverUrl}
          isSuspended={isSuspended}
          onUpdated={onRefreshAccount}
          onStatus={onStatus}
          onError={onError}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          Save your profile details below first before uploading a photo or cover banner.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="settings-fullname"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Full name <span className="text-red-600">*</span>
          </label>
          <input
            id="settings-fullname"
            type="text"
            required
            disabled={isSuspended}
            value={editFullName}
            onChange={(e) => setEditFullName(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {profileErrors.fullName && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              {profileErrors.fullName}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="settings-username"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Unique username <span className="text-red-600">*</span>
          </label>
          <input
            id="settings-username"
            type="text"
            required
            disabled={isSuspended}
            value={editUsername}
            onChange={(e) => handleUsernameChange(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Old profile links redirect to your updated @username automatically.
          </p>
          {usernameStatus.state !== 'idle' && (
            <p
              className={`mt-1 text-xs font-medium ${
                usernameStatus.state === 'available'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : usernameStatus.state === 'taken'
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {usernameStatus.message}
            </p>
          )}
          {profileErrors.username && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              {profileErrors.username}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="settings-department"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Department / Unit <span className="text-red-600">*</span>
          </label>
          <input
            id="settings-department"
            type="text"
            required
            disabled={isSuspended}
            value={editDepartment}
            onChange={(e) => setEditDepartment(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {profileErrors.department && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              {profileErrors.department}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="settings-faculty"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Faculty / College (optional)
          </label>
          <input
            id="settings-faculty"
            type="text"
            disabled={isSuspended}
            value={editFaculty}
            onChange={(e) => setEditFaculty(e.target.value)}
            placeholder="e.g. Science and Technology Education"
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {profileErrors.faculty && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">{profileErrors.faculty}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="settings-level"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Academic Level / Campus Status{' '}
            <span className="text-red-600">*</span>
          </label>
          <select
            id="settings-level"
            required
            disabled={isSuspended}
            value={editLevel}
            onChange={(e) => setEditLevel(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Select your status or level</option>
            {CAMPUS_STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {profileErrors.level && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">{profileErrors.level}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="settings-account-category"
            className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
          >
            Account Category (optional)
          </label>
          <select
            id="settings-account-category"
            disabled={isSuspended}
            value={editAccountCategory}
            onChange={(e) => setEditAccountCategory(e.target.value)}
            className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Select category</option>
            {ACCOUNT_CATEGORY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {profileErrors.accountCategory && (
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              {profileErrors.accountCategory}
            </p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="settings-whatsapp"
          className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
        >
          Public WhatsApp number <span className="text-red-600">*</span>
        </label>
        <input
          id="settings-whatsapp"
          type="tel"
          required
          disabled={isSuspended}
          value={editWhatsapp}
          onChange={(e) => setEditWhatsapp(e.target.value)}
          placeholder="+234 800 000 0000"
          className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        {profileErrors.publicWhatsapp && (
          <p className="mt-1 text-xs text-red-700 dark:text-red-400">
            {profileErrors.publicWhatsapp}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="settings-bio"
          className="block text-sm font-medium text-[#0B1A2E] dark:text-slate-200"
        >
          Bio (optional)
        </label>
        <textarea
          id="settings-bio"
          rows={3}
          disabled={isSuspended}
          maxLength={BLUEPRINT_LIMITS.bioMax}
          value={editBio}
          onChange={(e) => setEditBio(e.target.value)}
          placeholder="Short introduction, course focus, or campus role..."
          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {editBio.trim().length} / {BLUEPRINT_LIMITS.bioMax} characters
        </p>
        {profileErrors.bio && (
          <p className="mt-1 text-xs text-red-700 dark:text-red-400">{profileErrors.bio}</p>
        )}
      </div>

      <div className="pt-1">
        <button
          type="submit"
          disabled={
            isSavingProfile || isSuspended || usernameStatus.state === 'taken'
          }
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1565C0] disabled:opacity-60"
        >
          {isSavingProfile && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {isSavingProfile ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
};

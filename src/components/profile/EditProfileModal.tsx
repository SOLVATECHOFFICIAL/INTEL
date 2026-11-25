import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  checkUsernameAvailability,
  updateMemberAccountProfileAndUsername,
} from '../../services/firestoreFoundation';
import { BLUEPRINT_LIMITS, type PublicUserProfile } from '../../types/database';
import {
  ACCOUNT_CATEGORY_OPTIONS,
  CAMPUS_STATUS_OPTIONS,
  formatFirestoreOrAppError,
  normalizeUsername,
  validateProfileSettingsForm,
  validateUsernameCandidate,
  type ProfileSettingsFormInput,
  type ProfileSettingsValidationErrors,
} from '../../utils/authValidation';
import { ProfileMediaUploaders } from '../media/ProfileMediaUploaders';

interface EditProfileModalProps {
  uid: string;
  authEmail: string;
  profile: PublicUserProfile | null;
  isSuspended: boolean;
  onRefreshAccount: () => Promise<void>;
  onSaved: (updatedUsername: string) => void;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  uid,
  authEmail,
  profile,
  isSuspended,
  onRefreshAccount,
  onSaved,
  onClose,
}) => {
  const currentUsername = profile?.username ?? '';

  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [department, setDepartment] = useState(profile?.department ?? '');
  const [faculty, setFaculty] = useState(profile?.faculty ?? '');
  const [level, setLevel] = useState(profile?.level ?? '');
  const [accountCategory, setAccountCategory] = useState(
    profile?.accountCategory ?? ''
  );
  const [publicWhatsapp, setPublicWhatsapp] = useState(
    profile?.publicWhatsapp ?? ''
  );

  const [errors, setErrors] = useState<ProfileSettingsValidationErrors>({});
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'checking' | 'available' | 'taken';
    message?: string;
  }>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const candidate = normalizeUsername(username);
    const current = normalizeUsername(currentUsername);
    if (!candidate || candidate === current || validateUsernameCandidate(candidate)) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(candidate, uid)
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
  }, [username, currentUsername, uid]);

  const handleUsernameChange = (raw: string) => {
    const lower = raw.toLowerCase();
    setUsername(lower);
    const candidate = normalizeUsername(lower);
    const current = normalizeUsername(currentUsername);

    if (!candidate || candidate === current) {
      setUsernameStatus({ state: 'idle' });
      return;
    }

    const syncErr = validateUsernameCandidate(candidate);
    if (syncErr) {
      setUsernameStatus({ state: 'taken', message: syncErr });
    } else {
      setUsernameStatus({
        state: 'checking',
        message: 'Checking username availability...',
      });
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || isSuspended) return;

    setErrorMessage(null);
    setStatusMessage(null);

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
      fullName,
      username,
      bio,
      department,
      faculty,
      level,
      accountCategory,
      publicWhatsapp,
      showWhatsappPublicly: profile?.showWhatsappPublicly ?? true,
      photoUrl: sanitizeStoredUrl(profile?.photoUrl ?? ''),
      coverUrl: sanitizeStoredUrl(profile?.coverUrl ?? ''),
    };

    const validationErrors = validateProfileSettingsForm(payload);
    const firstValidationError = Object.values(validationErrors)[0];
    if (firstValidationError) {
      setErrors(validationErrors);
      setErrorMessage(firstValidationError);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const result = await updateMemberAccountProfileAndUsername(
        uid,
        currentUsername,
        payload,
        authEmail
      );
      await onRefreshAccount();
      onSaved(result.updatedUsername);
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Unable to save your profile updates right now.'
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-modal-title"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2
              id="edit-profile-modal-title"
              className="font-display text-lg font-bold text-[#0B1A2E]"
            >
              Edit Profile
            </h2>
            <p className="text-xs text-slate-500">
              Updates sync everywhere on LASUED Intel automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit profile"
            className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {statusMessage && (
            <div
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900"
            >
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
            >
              {errorMessage}
            </div>
          )}

          {profile && (
            <ProfileMediaUploaders
              uid={uid}
              username={currentUsername || undefined}
              fullName={fullName || profile.fullName || 'LASUED Member'}
              currentPhotoImageId={profile.photoImageId}
              currentPhotoUrl={profile.photoUrl}
              currentCoverImageId={profile.coverImageId}
              currentCoverUrl={profile.coverUrl}
              isSuspended={isSuspended}
              onUpdated={onRefreshAccount}
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

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="modal-fullname"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Full name <span className="text-red-600">*</span>
                </label>
                <input
                  id="modal-fullname"
                  type="text"
                  required
                  disabled={isSuspended}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
                {errors.fullName && (
                  <p className="mt-1 text-xs text-red-700">{errors.fullName}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="modal-username"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Username <span className="text-red-600">*</span>
                </label>
                <input
                  id="modal-username"
                  type="text"
                  required
                  disabled={isSuspended}
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
                {usernameStatus.state !== 'idle' && (
                  <p
                    className={`mt-1 text-xs font-medium ${
                      usernameStatus.state === 'available'
                        ? 'text-emerald-700'
                        : usernameStatus.state === 'taken'
                        ? 'text-red-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {usernameStatus.message}
                  </p>
                )}
                {errors.username && (
                  <p className="mt-1 text-xs text-red-700">{errors.username}</p>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="modal-bio"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Bio
              </label>
              <textarea
                id="modal-bio"
                rows={3}
                disabled={isSuspended}
                maxLength={BLUEPRINT_LIMITS.bioMax}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell classmates about your course, campus role, or interests..."
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {bio.trim().length} / {BLUEPRINT_LIMITS.bioMax} characters
              </p>
              {errors.bio && (
                <p className="mt-1 text-xs text-red-700">{errors.bio}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="modal-department"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Department <span className="text-red-600">*</span>
                </label>
                <input
                  id="modal-department"
                  type="text"
                  required
                  disabled={isSuspended}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
                {errors.department && (
                  <p className="mt-1 text-xs text-red-700">
                    {errors.department}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="modal-faculty"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Faculty / College
                </label>
                <input
                  id="modal-faculty"
                  type="text"
                  disabled={isSuspended}
                  value={faculty}
                  onChange={(e) => setFaculty(e.target.value)}
                  placeholder="e.g. Science and Technology Education"
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
                {errors.faculty && (
                  <p className="mt-1 text-xs text-red-700">{errors.faculty}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="modal-level"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Level / Campus Status <span className="text-red-600">*</span>
                </label>
                <select
                  id="modal-level"
                  required
                  disabled={isSuspended}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                >
                  <option value="">Select level or status</option>
                  {CAMPUS_STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {errors.level && (
                  <p className="mt-1 text-xs text-red-700">{errors.level}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="modal-category"
                  className="block text-sm font-medium text-[#0B1A2E]"
                >
                  Account Category
                </label>
                <select
                  id="modal-category"
                  disabled={isSuspended}
                  value={accountCategory}
                  onChange={(e) => setAccountCategory(e.target.value)}
                  className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                >
                  <option value="">Select category (optional)</option>
                  {ACCOUNT_CATEGORY_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {errors.accountCategory && (
                  <p className="mt-1 text-xs text-red-700">
                    {errors.accountCategory}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="modal-whatsapp"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                WhatsApp Number <span className="text-red-600">*</span>
              </label>
              <input
                id="modal-whatsapp"
                type="tel"
                required
                disabled={isSuspended}
                value={publicWhatsapp}
                onChange={(e) => setPublicWhatsapp(e.target.value)}
                placeholder="+234 800 000 0000"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              {errors.publicWhatsapp && (
                <p className="mt-1 text-xs text-red-700">
                  {errors.publicWhatsapp}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  saving || isSuspended || usernameStatus.state === 'taken'
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
              >
                {saving && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { registerWithEmail } from '../../services/auth';
import {
  checkUsernameAvailability,
  createInitialMemberAccountDocs,
  isUsernameAvailable,
} from '../../services/firestoreFoundation';
import {
  CAMPUS_STATUS_OPTIONS,
  mapFirebaseAuthError,
  normalizeUsername,
  validateRegistrationForm,
  validateUsernameCandidate,
  type RegistrationValidationErrors,
} from '../../utils/authValidation';
import { ActiveRoute } from '../../types/platform';

interface RegisterPageProps {
  returnRoute: ActiveRoute;
  onSuccess: (destination: ActiveRoute) => void;
  onNavigate: (route: ActiveRoute) => void;
  onBack?: () => void;
  onRefreshAccount: () => Promise<void>;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  returnRoute,
  onSuccess,
  onNavigate,
  onBack,
  onRefreshAccount,
}) => {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<RegistrationValidationErrors>(
    {}
  );
  const [usernameCheck, setUsernameCheck] = useState<{
    state: 'idle' | 'checking' | 'available' | 'unavailable';
    message?: string;
  }>({ state: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const normalized = normalizeUsername(username);
    if (!normalized || validateUsernameCandidate(normalized)) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(normalized)
        .then((res) => {
          if (!active) return;
          setUsernameCheck({
            state: res.available ? 'available' : 'unavailable',
            message: res.available
              ? `@${res.normalized} is available.`
              : res.reason ?? 'Username unavailable.',
          });
        })
        .catch(() => {
          if (!active) return;
          setUsernameCheck({ state: 'idle' });
        });
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username]);

  const handleUsernameChange = (raw: string) => {
    const lower = raw.toLowerCase();
    setUsername(lower);
    const normalized = normalizeUsername(lower);
    if (!normalized) {
      setUsernameCheck({ state: 'idle' });
      return;
    }
    const syncError = validateUsernameCandidate(normalized);
    if (syncError) {
      setUsernameCheck({ state: 'unavailable', message: syncError });
    } else {
      setUsernameCheck({
        state: 'checking',
        message: 'Checking username availability...',
      });
    }
  };

  const handleRegisterSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);
    const errors = validateRegistrationForm({
      fullName,
      username,
      email,
      whatsappNumber,
      password,
      confirmPassword,
      department,
      level,
      acceptedTerms,
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please fill in all compulsory fields highlighted below.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const cleanUsername = normalizeUsername(username);
      setProgressMessage('Checking username availability...');
      const available = await isUsernameAvailable(cleanUsername);
      if (!available) {
        setFieldErrors({
          username: 'This username is already taken or reserved. Choose another.',
        });
        setFormError('Username is unavailable.');
        setProgressMessage(null);
        setIsSubmitting(false);
        return;
      }

      setProgressMessage('Creating your LASUED Intel account...');
      const createdUser = await registerWithEmail(email, password, fullName);

      setProgressMessage('Generating member ID and saving profile...');
      await createInitialMemberAccountDocs({
        uid: createdUser.uid,
        authEmail: createdUser.email || email.trim(),
        fullName,
        username: cleanUsername,
        whatsappNumber,
        department,
        level,
      });

      await onRefreshAccount();
      setProgressMessage('Account created. Redirecting...');
      onSuccess(returnRoute);
    } catch (error) {
      setFormError(mapFirebaseAuthError(error));
      setProgressMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="register-heading"
      className="mx-auto w-full max-w-2xl"
    >
      <div className="mb-4">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : onNavigate(returnRoute))}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <h1
          id="register-heading"
          className="font-display text-2xl font-bold tracking-tight text-[#0B1A2E]"
        >
          Create your LASUED Intel account
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          All fields below are compulsory for students, finalists, graduates,
          lecturers, and staff. Your email stays private for login and password
          recovery, while your WhatsApp number becomes your public profile
          message contact. You can update your bio and details later in Account
          Settings.
        </p>

        {formError && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        {progressMessage && !formError && (
          <div
            role="status"
            aria-live="polite"
            className="mt-5 flex items-center gap-2.5 rounded-xl border border-[#1E88E5]/30 bg-[#1E88E5]/10 p-3.5 text-sm font-medium text-[#0B1A2E]"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#1E88E5]" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>{progressMessage}</span>
          </div>
        )}

        <form
          onSubmit={handleRegisterSubmit}
          noValidate
          className="mt-6 space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="reg-fullname"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Full name <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-fullname"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Adebayo Oluwaseun"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              {fieldErrors.fullName && (
                <p className="mt-1 text-xs text-red-700">{fieldErrors.fullName}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="reg-username"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Username <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="e.g. adebayo_01"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              <p className="mt-1 text-xs text-slate-500">
                Case-insensitive, lowercase letters, numbers, and underscores only.
              </p>
              {usernameCheck.state !== 'idle' && !fieldErrors.username && (
                <p
                  className={`mt-1 text-xs font-medium ${
                    usernameCheck.state === 'available'
                      ? 'text-emerald-700'
                      : usernameCheck.state === 'unavailable'
                      ? 'text-red-700'
                      : 'text-slate-600'
                  }`}
                >
                  {usernameCheck.message}
                </p>
              )}
              {fieldErrors.username && (
                <p className="mt-1 text-xs text-red-700">{fieldErrors.username}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="reg-email"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Email address (compulsory) <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              <p className="mt-1 text-xs text-slate-500">
                Private by default. Required for login, verification, and password
                reset.
              </p>
              {fieldErrors.email && (
                <p className="mt-1 text-xs text-red-700">{fieldErrors.email}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="reg-whatsapp"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                WhatsApp number (compulsory · public){' '}
                <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-whatsapp"
                type="tel"
                autoComplete="tel"
                required
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="+234 800 000 0000"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              <p className="mt-1 flex items-start gap-1 text-xs text-slate-600">
                <MessageCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1E88E5]"
                  aria-hidden="true"
                />
                <span>
                  Shown publicly on your profile so campus members can message
                  you on WhatsApp (including when verified).
                </span>
              </p>
              {fieldErrors.whatsappNumber && (
                <p className="mt-1 text-xs text-red-700">
                  {fieldErrors.whatsappNumber}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="reg-department"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Department / Unit <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-department"
                type="text"
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Computer Science"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              {fieldErrors.department && (
                <p className="mt-1 text-xs text-red-700">
                  {fieldErrors.department}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="reg-level"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Campus Status / Academic Level{' '}
                <span className="text-red-600">*</span>
              </label>
              <select
                id="reg-level"
                required
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              >
                <option value="">Select your status or level</option>
                {CAMPUS_STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Includes undergraduates, finalists, graduates/alumni, lecturers,
                and staff.
              </p>
              {fieldErrors.level && (
                <p className="mt-1 text-xs text-red-700">{fieldErrors.level}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="reg-password"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Password <span className="text-red-600">*</span>
              </label>
              <div className="relative mt-1.5">
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex min-w-[44px] items-center justify-center text-slate-500 hover:text-[#0B1A2E]"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="mt-1 text-xs text-red-700">{fieldErrors.password}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="reg-confirm-password"
                className="block text-sm font-medium text-[#0B1A2E]"
              >
                Confirm password <span className="text-red-600">*</span>
              </label>
              <input
                id="reg-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
              />
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-700">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
              />
              <span className="text-sm text-slate-700">
                I accept the LASUED Intel Terms of Use and Privacy Policy.{' '}
                <span className="text-red-600">*</span>
              </span>
            </label>
            {fieldErrors.acceptedTerms && (
              <p className="mt-1 text-xs text-red-700">
                {fieldErrors.acceptedTerms}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1565C0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {isSubmitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="font-semibold text-[#1E88E5] hover:underline"
          >
            Sign in
          </button>
        </p>
      </div>
    </section>
  );
};

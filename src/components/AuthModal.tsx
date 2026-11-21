import React, { useState } from 'react';
import { X } from 'lucide-react';
import { UserAccount } from '../types/campus';

interface AuthModalProps {
  mode: 'login' | 'signup' | null;
  onSwitchMode: (mode: 'login' | 'signup') => void;
  onClose: () => void;
  onAuthenticate: (user: UserAccount) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  mode,
  onSwitchMode,
  onClose,
  onAuthenticate,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [school, setSchool] = useState<'LASUED' | 'LASU' | 'Epe Community'>(
    'LASUED'
  );
  const [department, setDepartment] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!mode) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }

    if (mode === 'signup' && !fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    const derivedName =
      fullName.trim() ||
      email
        .split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    onAuthenticate({
      id: `user-${Date.now()}`,
      fullName: derivedName,
      email: email.trim(),
      school,
      department: department.trim() || 'Student Member',
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="auth-modal-title"
              className="text-xl font-bold text-slate-900"
            >
              {mode === 'login'
                ? 'Welcome back to LASUEDPLUG'
                : 'Create your campus account'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'login'
                ? 'Sign in to post listings and message students.'
                : 'Join LASUED, LASU, and Epe students on campus.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Esther Awoyinfa"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Campus
                  </label>
                  <select
                    value={school}
                    onChange={(e) =>
                      setSchool(
                        e.target.value as 'LASUED' | 'LASU' | 'Epe Community'
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
                  >
                    <option value="LASUED">LASUED</option>
                    <option value="LASU">LASU Epe</option>
                    <option value="Epe Community">Epe Community</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Department / Role
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. Computer Sci."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@lasued.edu.ng"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0066FF] focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-[#0066FF] py-2.5 text-sm font-semibold text-white transition hover:bg-[#0052CC]"
          >
            {mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          {mode === 'login'
            ? "Don't have an account? "
            : 'Already have an account? '}
          <button
            type="button"
            onClick={() =>
              onSwitchMode(mode === 'login' ? 'signup' : 'login')
            }
            className="font-semibold text-[#0066FF] hover:underline"
          >
            {mode === 'login' ? 'Signup' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};

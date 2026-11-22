import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  createTrustedContactRecord,
  deleteTrustedContactRecord,
  fetchTrustedCircleDirectory,
} from '../../services/governance';
import type {
  PublicProfileProjection,
  TrustedContact,
  TrustedContactCategory,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import {
  buildWhatsAppChatUrl,
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import { RoleBadge } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';

interface TrustedCircleSectionProps {
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string }
  ) => void;
}

const CONTACT_CATEGORY_LABELS: Record<TrustedContactCategory, string> = {
  lecturer: 'Lecturer',
  department_rep: 'Department Rep',
  faculty_president: 'Faculty President',
  class_rep: 'Class Rep',
  departmental_executive: 'Departmental Executive',
  student_union_rep: 'Student Union Rep',
};

export const TrustedCircleSection: React.FC<TrustedCircleSectionProps> = ({
  onNavigate,
}) => {
  const { user, effectiveTier, isSuspended } = useFirebase();
  const isSupremeAdminOrOwner =
    !isSuspended &&
    (effectiveTier === 'supreme_admin' || effectiveTier === 'owner');

  const [verifiedMembers, setVerifiedMembers] = useState<
    PublicProfileProjection[]
  >([]);
  const [officialContacts, setOfficialContacts] = useState<TrustedContact[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [category, setCategory] =
    useState<TrustedContactCategory>('lecturer');
  const [roleTitle, setRoleTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [faculty, setFaculty] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    fetchTrustedCircleDirectory()
      .then((data) => {
        if (!active) return;
        setVerifiedMembers(data.verifiedMembers);
        setOfficialContacts(data.officialContacts);
        setErrorMessage(null);
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(
          formatFirestoreOrAppError(
            error,
            'Unable to load the Trusted Circle directory right now.'
          )
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleAddContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !isSupremeAdminOrOwner || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const created = await createTrustedContactRecord({
        fullName,
        category,
        roleTitle,
        department,
        faculty,
        contactNumber,
        description,
        createdByUid: user.uid,
      });
      setOfficialContacts((prev) =>
        [created, ...prev].sort((a, b) => a.fullName.localeCompare(b.fullName))
      );
      setFullName('');
      setRoleTitle('');
      setDepartment('');
      setFaculty('');
      setContactNumber('');
      setDescription('');
      setShowAddForm(false);
      setStatusMessage('Official campus contact added to Trusted Circle.');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not add official campus contact.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!isSupremeAdminOrOwner) return;
    setErrorMessage(null);
    try {
      await deleteTrustedContactRecord(contactId);
      setOfficialContacts((prev) =>
        prev.filter((item) => item.id !== contactId)
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not remove that contact.')
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading Trusted Circle...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {/* 1. Verified Community Members */}
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#0B1A2E]">
            Verified Community Members ({verifiedMembers.length})
          </h2>
          <p className="text-xs text-slate-600">
            Recognized LASUED students, lecturers, graduates, and campus
            contributors with the green VERIFIED badge.
          </p>
        </div>

        {verifiedMembers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
            <Users
              className="mx-auto mb-2 h-5 w-5 text-slate-400"
              aria-hidden="true"
            />
            No public Verified members listed yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {verifiedMembers.map((member) => (
              <button
                key={member.username}
                type="button"
                onClick={() =>
                  onNavigate('profile', { username: member.username })
                }
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#1E88E5] hover:bg-slate-50"
              >
                <AvatarMedia
                  fullName={member.fullName}
                  photoImageId={member.photoImageId}
                  photoUrl={member.photoUrl}
                  sizeClass="h-11 w-11"
                  roundedClass="rounded-xl"
                  textClass="text-xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-display text-sm font-bold text-[#0B1A2E]">
                      {member.fullName}
                    </span>
                    <RoleBadge badge="verified" size="xs" />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-600">
                    @{member.username}
                    {member.department ? ` · ${member.department}` : ''}
                    {member.level ? ` · ${member.level}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Official Campus Contacts */}
      <div className="space-y-3 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Official Campus Contacts ({officialContacts.length})
            </h2>
            <p className="text-xs text-slate-600">
              Admin-curated lecturers, course advisers, and recognized student
              representatives.
            </p>
          </div>

          {isSupremeAdminOrOwner && (
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              <Plus className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
              {showAddForm ? 'Close Form' : 'Add Official Contact'}
            </button>
          )}
        </div>

        {showAddForm && isSupremeAdminOrOwner && (
          <form
            onSubmit={handleAddContact}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name / Office title"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as TrustedContactCategory)
                }
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                {Object.entries(CONTACT_CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="text"
                required
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Role (e.g. Level Adviser)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Department"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <input
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="Phone / WhatsApp (+234...)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Save Official Contact
            </button>
          </form>
        )}

        {officialContacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
            No official campus contacts added yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {officialContacts.map((contact) => {
              const waUrl = contact.contactNumber
                ? buildWhatsAppChatUrl(contact.contactNumber)
                : contact.whatsappLink || null;

              return (
                <article
                  key={contact.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {CONTACT_CATEGORY_LABELS[contact.category] ||
                          'Official Contact'}
                      </span>
                      <h3 className="mt-1.5 font-display text-sm font-bold text-[#0B1A2E]">
                        {contact.fullName}
                      </h3>
                      <p className="text-xs font-medium text-[#1E88E5]">
                        {contact.roleTitle}
                      </p>
                    </div>
                    {isSupremeAdminOrOwner && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteContact(contact.id)}
                        aria-label={`Remove ${contact.fullName}`}
                        className="rounded-lg p-1.5 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {(contact.department || contact.faculty) && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                      <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {[contact.department, contact.faculty]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </p>
                  )}

                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1 text-xs font-semibold text-white hover:bg-[#132844]"
                    >
                      <MessageCircle
                        className="h-3.5 w-3.5 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      WhatsApp Contact
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

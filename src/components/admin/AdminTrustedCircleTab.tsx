import React, { useRef, useState } from 'react';
import {
  Building2,
  Camera,
  Edit3,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  createTrustedContactWithAudit,
  deleteTrustedContactWithAudit,
  updateTrustedContactWithAudit,
} from '../../services/adminDashboard';
import type {
  PublicProfileProjection,
  TrustedContact,
  TrustedContactCategory,
  UserRole,
} from '../../types/database';
import {
  formatFirestoreOrAppError,
} from '../../utils/authValidation';
import { TRUSTED_CONTACT_CATEGORY_LABELS } from '../../utils/followRelations';
import {
  ALL_IMAGE_FILE_ACCEPT,
  compressImageFile,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import {
  resolveTrustedContactWhatsappUrl,
  validateTrustedContactWhatsapp,
} from '../../utils/trustedDirectory';
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminTrustedCircleTabProps {
  supremeAdmins: PublicProfileProjection[];
  verifiedMembers: PublicProfileProjection[];
  officialContacts: TrustedContact[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  onJumpToBadges: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

export const AdminTrustedCircleTab: React.FC<AdminTrustedCircleTabProps> = ({
  supremeAdmins,
  verifiedMembers,
  officialContacts,
  loading,
  actorUid,
  actorRole,
  onJumpToBadges,
  onSuccess,
  onError,
  onReload,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TrustedContact | null>(null);

  const [fullName, setFullName] = useState('');
  const [category, setCategory] =
    useState<TrustedContactCategory>('community_recommended');
  const [badgeLabel, setBadgeLabel] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [faculty, setFaculty] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [compressedPhoto, setCompressedPhoto] =
    useState<CompressedImageResult | null>(null);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);
  const [compressingPhoto, setCompressingPhoto] = useState(false);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrustedContact | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setEditing(null);
    setFullName('');
    setCategory('community_recommended');
    setBadgeLabel('');
    setRoleTitle('');
    setDepartment('');
    setFaculty('');
    setContactNumber('');
    setWhatsappLink('');
    setPhotoUrl('');
    setCompressedPhoto(null);
    setRemoveExistingPhoto(false);
    setDescription('');
    setShowForm(false);
  };

  const startEdit = (contact: TrustedContact) => {
    setEditing(contact);
    setFullName(contact.fullName);
    setCategory(contact.category);
    setBadgeLabel(contact.badgeLabel ?? '');
    setRoleTitle(contact.roleTitle);
    setDepartment(contact.department ?? '');
    setFaculty(contact.faculty ?? '');
    setContactNumber(contact.contactNumber ?? '');
    setWhatsappLink(contact.whatsappLink ?? '');
    setPhotoUrl(contact.photoUrl ?? '');
    setCompressedPhoto(null);
    setRemoveExistingPhoto(false);
    setDescription(contact.description ?? '');
    setShowForm(true);
  };

  const handleSelectPhoto = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || compressingPhoto) return;
    setCompressingPhoto(true);
    try {
      const compressed = await compressImageFile(file, 'avatar');
      setCompressedPhoto(compressed);
      setRemoveExistingPhoto(false);
      setPhotoUrl('');
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not compress Trusted Circle profile photo.'
        )
      );
    } finally {
      setCompressingPhoto(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const validatedWhatsapp = validateTrustedContactWhatsapp(
        contactNumber.trim() || whatsappLink.trim()
      );
      if (editing) {
        await updateTrustedContactWithAudit({
          existing: editing,
          fullName,
          category,
          badgeLabel,
          roleTitle,
          department,
          faculty,
          photoUrl,
          compressedPhoto,
          removePhoto: removeExistingPhoto,
          contactNumber: validatedWhatsapp.contactNumber,
          whatsappLink: validatedWhatsapp.whatsappLink,
          description,
          actorUid,
          actorRole,
        });
        onSuccess(`Updated Trusted Circle profile "${fullName.trim()}".`);
      } else {
        await createTrustedContactWithAudit({
          fullName,
          category,
          badgeLabel,
          roleTitle,
          department,
          faculty,
          photoUrl,
          compressedPhoto,
          contactNumber: validatedWhatsapp.contactNumber,
          whatsappLink: validatedWhatsapp.whatsappLink,
          description,
          actorUid,
          actorRole,
        });
        onSuccess(`Added "${fullName.trim()}" to Trusted Circle.`);
      }
      resetForm();
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not save Trusted Circle profile.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteTrustedContactWithAudit({
        contact: deleteTarget,
        actorUid,
        actorRole,
      });
      onSuccess(`Removed "${deleteTarget.fullName}" from Trusted Circle.`);
      setDeleteTarget(null);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not remove Trusted Circle contact.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading Trusted Circle records...
      </div>
    );
  }

  const hasExistingStoredPhoto = Boolean(
    editing && !removeExistingPhoto && (editing.photoImageId || editing.photoUrl)
  );

  return (
    <div className="space-y-6">
      {/* 1. Admin-Listed Directory-Only Profiles (Non-Account Entries) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
              Admin-Curated Directory Profiles ({officialContacts.length})
            </h2>
            <p className="text-xs text-slate-600">
              Non-account directory entries for Officially Verified figures,
              Community Recommended contacts, lecturers, and student leaders
              (never user accounts).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (showForm) resetForm();
              else setShowForm(true);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
          >
            <Plus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            {showForm ? 'Close Form' : 'Add Trusted Entry'}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
          >
            <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
              {editing
                ? `Edit Directory Profile: ${editing.fullName}`
                : 'Add Directory-Only Profile'}
            </h3>

            {/* Profile Photo Upload + Preview */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              {compressedPhoto ? (
                <img
                  src={compressedPhoto.dataUrl}
                  alt="Contact preview"
                  className="h-14 w-14 rounded-xl object-cover ring-1 ring-slate-200"
                />
              ) : hasExistingStoredPhoto && editing ? (
                <AvatarMedia
                  fullName={editing.fullName}
                  photoImageId={editing.photoImageId}
                  photoUrl={editing.photoUrl}
                  sizeClass="h-14 w-14"
                  roundedClass="rounded-xl"
                  textClass="text-sm"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                  <Camera className="h-5 w-5" aria-hidden="true" />
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={compressingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60"
                  >
                    {compressingPhoto ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Camera
                        className="h-3.5 w-3.5 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {compressingPhoto ? 'Compressing...' : 'Upload Photo'}
                    </span>
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept={ALL_IMAGE_FILE_ACCEPT}
                    disabled={compressingPhoto}
                    onChange={handleSelectPhoto}
                    className="hidden"
                  />

                  {(compressedPhoto || hasExistingStoredPhoto) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCompressedPhoto(null);
                        setPhotoUrl('');
                        setRemoveExistingPhoto(true);
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove Photo
                    </button>
                  )}
                </div>
                <input
                  type="url"
                  value={photoUrl}
                  disabled={Boolean(compressedPhoto)}
                  onChange={(e) => {
                    setPhotoUrl(e.target.value);
                    setRemoveExistingPhoto(false);
                  }}
                  placeholder="Or paste external https:// image URL (optional)"
                  className="min-h-[34px] w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-[#0B1A2E] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name or Office title"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as TrustedContactCategory)
                }
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                {Object.entries(TRUSTED_CONTACT_CATEGORY_LABELS).map(
                  ([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  )
                )}
              </select>
              <input
                type="text"
                maxLength={64}
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value)}
                placeholder="Badge label (e.g. Officially Verified)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="text"
                required
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Role / Position (e.g. 200L Course Adviser)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Department (optional)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <input
                type="text"
                value={faculty}
                onChange={(e) => setFaculty(e.target.value)}
                placeholder="Faculty / College (optional)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="tel"
                required
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="WhatsApp number (required, e.g. +2348012345678)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
              <input
                type="url"
                value={whatsappLink}
                onChange={(e) => setWhatsappLink(e.target.value)}
                placeholder="Direct WhatsApp URL (optional https://wa.me/...)"
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>

            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Role summary, office hours, or recommendation notes..."
              className="block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={submitting || compressingPhoto}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
              >
                {submitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                {editing ? 'Update Entry' : 'Save Directory Entry'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={resetForm}
                className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {officialContacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-600">
            No admin-listed campus contacts created yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {officialContacts.map((contact) => {
              const waUrl = resolveTrustedContactWhatsappUrl(contact);

              return (
                <article
                  key={contact.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <AvatarMedia
                        fullName={contact.fullName}
                        photoImageId={contact.photoImageId}
                        photoUrl={contact.photoUrl}
                        sizeClass="h-11 w-11"
                        roundedClass="rounded-xl"
                        textClass="text-xs"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RoleBadge badge="trust" size="xs" />
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {contact.badgeLabel ||
                              TRUSTED_CONTACT_CATEGORY_LABELS[contact.category]}
                          </span>
                        </div>
                        <h3 className="mt-1.5 font-display text-sm font-bold text-[#0B1A2E]">
                          {contact.fullName}
                        </h3>
                        <p className="text-xs font-semibold text-[#1E88E5]">
                          {contact.roleTitle}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(contact)}
                        aria-label={`Edit ${contact.fullName}`}
                        className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(contact)}
                        aria-label={`Delete ${contact.fullName}`}
                        className="rounded-lg p-1.5 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {(contact.department || contact.faculty) && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                      <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {[contact.department, contact.faculty]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}

                  {contact.description && (
                    <p className="mt-1.5 text-xs text-slate-600">
                      {contact.description}
                    </p>
                  )}

                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      {contact.contactNumber || 'WhatsApp Link'}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Registered Supreme Admin & Verified Badge Holders */}
      <div className="space-y-4 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
              Registered Badge Holders ({supremeAdmins.length + verifiedMembers.length})
            </h2>
            <p className="text-xs text-slate-600">
              Registered members carrying official public Supreme Admin or Verified
              badges. Underground admin accounts remain hidden from public listings.
            </p>
          </div>
          <button
            type="button"
            onClick={onJumpToBadges}
            className="text-xs font-semibold text-[#1E88E5] hover:underline"
          >
            Manage Badges &amp; Roles
          </button>
        </div>

        {supremeAdmins.length === 0 && verifiedMembers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-xs text-slate-600">
            <Users
              className="mx-auto mb-1.5 h-5 w-5 text-slate-400"
              aria-hidden="true"
            />
            No public Supreme Admin or Verified badge holders yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {[...supremeAdmins, ...verifiedMembers].map((member) => (
              <div
                key={member.username}
                className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3"
              >
                <AvatarMedia
                  fullName={member.fullName}
                  photoImageId={member.photoImageId}
                  photoUrl={member.photoUrl}
                  sizeClass="h-9 w-9"
                  roundedClass="rounded-lg"
                  textClass="text-xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="truncate text-xs font-bold text-[#0B1A2E]">
                      {member.fullName}
                    </span>
                    <ProfileBadgesRow profile={member} size="xs" />
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    @{member.username}
                    {member.department ? ` · ${member.department}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Remove "${deleteTarget?.fullName}"?`}
        description="This permanently removes the non-account contact entry from the Trusted Circle directory and records the deletion in the audit log."
        confirmLabel="Remove Entry"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

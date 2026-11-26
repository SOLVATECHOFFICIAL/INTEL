import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Camera,
  CheckCircle2,
  Crown,
  Edit3,
  Loader2,
  MessageCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import { useActiveBackgroundRefresh } from '../../hooks/useActiveBackgroundRefresh';
import {
  createTrustedContactWithAudit,
  deleteTrustedContactWithAudit,
  updateTrustedContactWithAudit,
} from '../../services/adminDashboard';
import { fetchTrustedCircleDirectory } from '../../services/governance';
import { prefetchMediaImages } from '../../services/mediaStorage';
import {
  getTrustedCircleSnapshot,
  hydrateTrustedCircleSnapshot,
  saveTrustedCircleSnapshot,
} from '../../services/navigationStateCache';
import type {
  PublicProfileProjection,
  TrustedContact,
  TrustedContactCategory,
  UserRole,
} from '../../types/database';
import type { ActiveRoute } from '../../types/platform';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  partitionTrustedCircleDirectory,
  TRUSTED_CONTACT_CATEGORY_LABELS,
} from '../../utils/followRelations';
import {
  ALL_IMAGE_FILE_ACCEPT,
  compressImageFile,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import { isDataSaverConnection } from '../../utils/mediaCache';
import {
  resolveTrustedContactWhatsappUrl,
  rotateTrustedContactsDeterministically,
  validateTrustedContactWhatsapp,
} from '../../utils/trustedDirectory';
import { ProfileBadgesRow, RoleBadge } from '../RoleBadge';
import { TikTokFollowButton } from '../TikTokFollowButton';
import { AvatarMedia } from '../media/FirestoreImage';
import { LinkifiedText } from '../shared/LinkifiedText';

interface TrustedCircleSectionProps {
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string }
  ) => void;
  onRequireAuth?: (
    authRoute: 'login' | 'register',
    returnTo: ActiveRoute
  ) => void;
}

type ActiveTrustedFilterTab =
  | 'all'
  | 'supreme_admin'
  | 'officially_verified'
  | 'trust_contacts';

const FILTER_TABS: Array<{
  id: ActiveTrustedFilterTab;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'supreme_admin', label: 'Supreme Admin' },
  { id: 'officially_verified', label: 'Officially Verified' },
  { id: 'trust_contacts', label: 'Trust Contacts' },
];

function normalizeTrustedCircleFilter(
  value: unknown
): ActiveTrustedFilterTab {
  if (
    value === 'all' ||
    value === 'supreme_admin' ||
    value === 'officially_verified' ||
    value === 'trust_contacts'
  ) {
    return value;
  }
  if (value === 'community_recommended' || value === 'official_contacts') {
    return 'trust_contacts';
  }
  return 'all';
}

export const TrustedCircleSection: React.FC<TrustedCircleSectionProps> = ({
  onNavigate,
  onRequireAuth,
}) => {
  const { user, profile, effectiveTier, isSuspended } = useFirebase();
  const isSupremeAdminOrOwner =
    !isSuspended && effectiveTier === 'supreme_admin';
  const actorRole: UserRole = 'supreme_admin';

  const viewerKey = user?.uid ?? 'guest';
  const initialCache = getTrustedCircleSnapshot(viewerKey);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [supremeAdmins, setSupremeAdmins] = useState<PublicProfileProjection[]>(
    () => initialCache?.supremeAdmins ?? []
  );
  const [verifiedMembers, setVerifiedMembers] = useState<
    PublicProfileProjection[]
  >(() => initialCache?.verifiedMembers ?? []);
  const [officialContacts, setOfficialContacts] = useState<TrustedContact[]>(
    () => initialCache?.officialContacts ?? []
  );
  const [activeFilter, setActiveFilter] = useState<ActiveTrustedFilterTab>(() =>
    normalizeTrustedCircleFilter(initialCache?.activeFilter)
  );
  const [selectedTrustContact, setSelectedTrustContact] =
    useState<TrustedContact | null>(null);
  const [rotationTimestampMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(() => !initialCache);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Admin inline Create / Edit form state for Directory-Only profiles
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<TrustedContact | null>(
    null
  );
  const [fullName, setFullName] = useState('');
  const [category, setCategory] = useState<TrustedContactCategory>(
    'community_recommended'
  );
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const hasDirectoryDataRef = useRef(Boolean(initialCache));

  const prefetchDirectoryAvatars = useCallback(
    (
      admins: readonly PublicProfileProjection[],
      verified: readonly PublicProfileProjection[],
      contacts: readonly TrustedContact[]
    ) => {
      if (isDataSaverConnection()) return;
      const ids = [
        ...admins.slice(0, 4).map((m) => m.photoImageId),
        ...verified.slice(0, 4).map((m) => m.photoImageId),
        ...contacts.slice(0, 4).map((c) => c.photoImageId),
      ];
      if (ids.some(Boolean)) {
        void prefetchMediaImages(ids);
      }
    },
    []
  );

  const syncTrustedCircleFromNetwork = useCallback(
    async (
      mode: 'initial' | 'background',
      isCancelled?: () => boolean
    ): Promise<void> => {
      if (
        mode === 'background' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        return;
      }

      const data = await fetchTrustedCircleDirectory();
      if (isCancelled?.()) return;

      setSupremeAdmins(data.supremeAdmins);
      setVerifiedMembers(data.verifiedMembers);
      setOfficialContacts(data.officialContacts);
      hasDirectoryDataRef.current = true;
      setErrorMessage(null);
      setLoading(false);
      prefetchDirectoryAvatars(
        data.supremeAdmins,
        data.verifiedMembers,
        data.officialContacts
      );
    },
    [prefetchDirectoryAvatars]
  );

  useEffect(() => {
    let active = true;
    let networkSettled = false;

    const ramHit = getTrustedCircleSnapshot(viewerKey);
    if (ramHit) {
      prefetchDirectoryAvatars(
        ramHit.supremeAdmins,
        ramHit.verifiedMembers,
        ramHit.officialContacts
      );
      let timer: number | null = null;
      if (Date.now() - ramHit.cachedAt > 2_000) {
        timer = window.setTimeout(() => {
          if (!active) return;
          void syncTrustedCircleFromNetwork('background', () => !active).catch(
            () => undefined
          );
        }, 0);
      }
      return () => {
        active = false;
        if (timer !== null) window.clearTimeout(timer);
      };
    }

    const run = async () => {
      const persisted = await hydrateTrustedCircleSnapshot(viewerKey);
      if (active && !networkSettled && persisted) {
        setSupremeAdmins(persisted.supremeAdmins);
        setVerifiedMembers(persisted.verifiedMembers);
        setOfficialContacts(persisted.officialContacts);
        if (persisted.activeFilter) {
          setActiveFilter(normalizeTrustedCircleFilter(persisted.activeFilter));
        }
        hasDirectoryDataRef.current = true;
        setLoading(false);
        prefetchDirectoryAvatars(
          persisted.supremeAdmins,
          persisted.verifiedMembers,
          persisted.officialContacts
        );

        await syncTrustedCircleFromNetwork('background', () => !active).catch(
          () => undefined
        );
        return;
      }

      await syncTrustedCircleFromNetwork('initial', () => !active);
      networkSettled = true;
    };

    void run()
      .catch((error) => {
        if (!active) return;
        if (!hasDirectoryDataRef.current) {
          setErrorMessage(
            formatFirestoreOrAppError(
              error,
              'Unable to load the Trusted Circle directory right now.'
            )
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [viewerKey, prefetchDirectoryAvatars, syncTrustedCircleFromNetwork]);

  useEffect(() => {
    if (loading) return;
    saveTrustedCircleSnapshot({
      viewerKey,
      supremeAdmins,
      verifiedMembers,
      officialContacts,
      activeFilter,
      cachedAt: Date.now(),
    });
  }, [
    loading,
    viewerKey,
    supremeAdmins,
    verifiedMembers,
    officialContacts,
    activeFilter,
  ]);

  useActiveBackgroundRefresh({
    enabled: !loading,
    onRefresh: () => syncTrustedCircleFromNetwork('background'),
    baseIntervalMs: 5000,
  });

  const partitioned = useMemo(
    () =>
      partitionTrustedCircleDirectory({
        supremeAdmins,
        verifiedMembers,
        officialContacts,
      }),
    [supremeAdmins, verifiedMembers, officialContacts]
  );

  const rotatedTrustContacts = useMemo(
    () =>
      rotateTrustedContactsDeterministically(
        partitioned.trustContacts,
        rotationTimestampMs
      ),
    [partitioned.trustContacts, rotationTimestampMs]
  );

  const resetForm = () => {
    setEditingContact(null);
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
    setShowContactForm(false);
  };

  const startEditContact = (contact: TrustedContact) => {
    setEditingContact(contact);
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
    setShowContactForm(true);
  };

  const handleSelectPhoto = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || compressingPhoto) return;
    setCompressingPhoto(true);
    setErrorMessage(null);
    try {
      const compressed = await compressImageFile(file, 'avatar');
      setCompressedPhoto(compressed);
      setRemoveExistingPhoto(false);
      setPhotoUrl('');
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not compress profile photo.')
      );
    } finally {
      setCompressingPhoto(false);
    }
  };

  const handleSaveContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !isSupremeAdminOrOwner || submitting) return;
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      validateTrustedContactWhatsapp(
        contactNumber.trim() || whatsappLink.trim()
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'A valid WhatsApp phone number or WhatsApp link is required for Trusted Contacts.'
        )
      );
      return;
    }

    setSubmitting(true);

    try {
      if (editingContact) {
        const updated = await updateTrustedContactWithAudit({
          existing: editingContact,
          fullName,
          category,
          badgeLabel,
          roleTitle,
          department,
          faculty,
          photoUrl,
          compressedPhoto,
          removePhoto: removeExistingPhoto,
          contactNumber,
          whatsappLink,
          description,
          actorUid: user.uid,
          actorRole,
        });
        setOfficialContacts((prev) =>
          prev
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => a.fullName.localeCompare(b.fullName))
        );
        setStatusMessage(`Updated "${updated.fullName}" in Trusted Circle.`);
      } else {
        const created = await createTrustedContactWithAudit({
          fullName,
          category,
          badgeLabel,
          roleTitle,
          department,
          faculty,
          photoUrl,
          compressedPhoto,
          contactNumber,
          whatsappLink,
          description,
          actorUid: user.uid,
          actorRole,
        });
        setOfficialContacts((prev) =>
          [created, ...prev].sort((a, b) => a.fullName.localeCompare(b.fullName))
        );
        setStatusMessage(`Added "${created.fullName}" to Trusted Circle.`);
      }
      resetForm();
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not save Trusted Circle entry.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeleteContact = async (contact: TrustedContact) => {
    if (!user || !isSupremeAdminOrOwner || deletingId) return;
    setDeletingId(contact.id);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await deleteTrustedContactWithAudit({
        contact,
        actorUid: user.uid,
        actorRole,
      });
      setOfficialContacts((prev) =>
        prev.filter((item) => item.id !== contact.id)
      );
      setConfirmDeleteId(null);
      setStatusMessage(`Removed "${contact.fullName}" from Trusted Circle.`);
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(error, 'Could not remove that entry.')
      );
    } finally {
      setDeletingId(null);
    }
  };

  const renderRegisteredAccountCard = (member: PublicProfileProjection) => {
    const isSelf =
      Boolean(profile?.username) &&
      profile?.username.toLowerCase() === member.username.toLowerCase();

    return (
      <div
        key={member.username}
        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-[#1E88E5]/60 hover:bg-slate-50/60"
      >
        <button
          type="button"
          onClick={() => onNavigate('profile', { username: member.username })}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
              <ProfileBadgesRow profile={member} size="xs" />
              {isSelf && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  You
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-600">
              @{member.username}
              {member.department ? ` · ${member.department}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500 tabular-nums">
              {member.followersCount} followers · {member.followingCount}{' '}
              following
            </p>
          </div>
        </button>

        <TikTokFollowButton
          targetUsername={member.username}
          compact
          onRequireAuth={() => onRequireAuth?.('login', 'trusted-circle')}
        />
      </div>
    );
  };

  // Directory-only Trust Contacts strictly NEVER have user accounts, fake follower counts, or follow buttons.
  const renderDirectoryOnlyCard = (contact: TrustedContact) => {
    const waUrl = resolveTrustedContactWhatsappUrl(contact);
    const isConfirmingDelete = confirmDeleteId === contact.id;
    const categoryLabel =
      contact.badgeLabel ||
      TRUSTED_CONTACT_CATEGORY_LABELS[contact.category] ||
      'Trust Contact';

    return (
      <article
        key={contact.id}
        data-directory-entry-id={contact.id}
        className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-purple-300"
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedTrustContact(contact)}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            <AvatarMedia
              fullName={contact.fullName}
              photoImageId={contact.photoImageId}
              photoUrl={contact.photoUrl}
              sizeClass="h-11 w-11"
              roundedClass="rounded-xl"
              textClass="text-xs"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="inline-flex min-w-0 items-center gap-1 font-display text-sm font-bold text-[#0B1A2E] hover:text-purple-700">
                  <span className="truncate">{contact.fullName}</span>
                  <RoleBadge badge="trust" size="xs" />
                </h3>
                <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800">
                  {categoryLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-[#1E88E5]">
                {contact.roleTitle}
              </p>
            </div>
          </button>

          {isSupremeAdminOrOwner && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => startEditContact(contact)}
                aria-label={`Edit ${contact.fullName}`}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E]"
              >
                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirmDeleteId((prev) =>
                    prev === contact.id ? null : contact.id
                  )
                }
                aria-label={`Remove ${contact.fullName}`}
                className="rounded-lg p-1.5 text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {(contact.department || contact.faculty) && (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-600">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {[contact.department, contact.faculty]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
        )}

        {contact.description && (
          <LinkifiedText
            text={contact.description}
            className="mt-1.5 text-xs leading-relaxed text-slate-600"
          />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1 text-xs font-semibold text-white hover:bg-[#132844]"
            >
              <MessageCircle
                className="h-3.5 w-3.5 text-[#1E88E5]"
                aria-hidden="true"
              />
              Message on WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => setSelectedTrustContact(contact)}
            className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
          >
            Contact Info
          </button>
        </div>

        {isConfirmingDelete && isSupremeAdminOrOwner && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
            <span>Remove {contact.fullName} from Trusted Circle?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deletingId === contact.id}
                onClick={() => void handleConfirmDeleteContact(contact)}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-red-700 px-2.5 py-1 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {deletingId === contact.id && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                )}
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="min-h-[32px] rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-[#0B1A2E]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </article>
    );
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

  const filterCounts: Record<ActiveTrustedFilterTab, number> = {
    all:
      partitioned.supremeAdmins.length +
      partitioned.officiallyVerifiedUsers.length +
      partitioned.trustContacts.length,
    supreme_admin: partitioned.supremeAdmins.length,
    officially_verified: partitioned.officiallyVerifiedUsers.length,
    trust_contacts: partitioned.trustContacts.length,
  };

  const showSupremeAdminSection =
    activeFilter === 'all' || activeFilter === 'supreme_admin';
  const showOfficiallyVerifiedSection =
    activeFilter === 'all' || activeFilter === 'officially_verified';
  const showTrustContactsSection =
    activeFilter === 'all' || activeFilter === 'trust_contacts';

  const hasExistingStoredPhoto = Boolean(
    editingContact &&
      !removeExistingPhoto &&
      (editingContact.photoImageId || editingContact.photoUrl)
  );

  return (
    <div className="space-y-6">
      {/* Category Filter Bar + Admin Entry Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Trusted Circle categories"
          className="flex flex-wrap gap-1.5"
        >
          {FILTER_TABS.map((tab) => {
            const isSelected = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveFilter(tab.id)}
                className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isSelected
                    ? 'bg-[#0B1A2E] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label} ({filterCounts[tab.id]})
              </button>
            );
          })}
        </div>

        {isSupremeAdminOrOwner && (
          <button
            type="button"
            onClick={() => {
              if (showContactForm) resetForm();
              else setShowContactForm(true);
            }}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132844]"
          >
            <Plus className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            {showContactForm ? 'Close Form' : 'Add Directory Entry'}
          </button>
        )}
      </div>

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

      {/* Admin Inline Form: Create / Edit Directory-Only Profiles */}
      {showContactForm && isSupremeAdminOrOwner && (
        <form
          onSubmit={handleSaveContact}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
              {editingContact
                ? `Edit Directory Profile: ${editingContact.fullName}`
                : 'Add Directory-Only Profile'}
            </h2>
            <span className="text-[11px] font-medium text-slate-500">
              Non-account directory entry
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            {compressedPhoto ? (
              <img
                src={compressedPhoto.dataUrl}
                alt="Contact preview"
                className="h-12 w-12 rounded-xl object-cover"
              />
            ) : hasExistingStoredPhoto && editingContact ? (
              <AvatarMedia
                fullName={editingContact.fullName}
                photoImageId={editingContact.photoImageId}
                photoUrl={editingContact.photoUrl}
                sizeClass="h-12 w-12"
                roundedClass="rounded-xl"
                textClass="text-xs"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
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
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
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
                placeholder="Or external https:// photo URL (optional)"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-[#0B1A2E] disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              placeholder="Recognition badge label (optional)"
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              type="text"
              required
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Role / Position (e.g. Level Adviser)"
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
              required={!whatsappLink.trim()}
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="Required WhatsApp number (+234...)"
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
            <input
              type="url"
              value={whatsappLink}
              onChange={(e) => setWhatsappLink(e.target.value)}
              placeholder="Or WhatsApp link (https://wa.me/...)"
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
          </div>

          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description, role summary, or office hours (optional)..."
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
              {editingContact ? 'Update Entry' : 'Save Directory Entry'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-[#0B1A2E]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* 1. Supreme Admin (Registered Public Administrators with Blue Star Badge) */}
      {showSupremeAdminSection && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Supreme Admin ({partitioned.supremeAdmins.length})
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Publicly visible LASUED Intel Supreme Administrators responsible for
            campus governance and official verification.
          </p>

          {partitioned.supremeAdmins.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-xs text-slate-600">
              No public Supreme Admin profiles listed yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {partitioned.supremeAdmins.map(renderRegisteredAccountCard)}
            </div>
          )}
        </div>
      )}

      {/* 2. Officially Verified (Registered Blue VERIFIED Badge Holders & Verified Moderators) */}
      {showOfficiallyVerifiedSection && (
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-4 w-4 text-[#1E88E5]"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-bold text-[#0B1A2E]">
              Officially Verified ({filterCounts.officially_verified})
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Recognized LASUED contributors and moderators holding the official
            blue VERIFIED badge.
          </p>

          {filterCounts.officially_verified === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
              <Users
                className="mx-auto mb-2 h-5 w-5 text-slate-400"
                aria-hidden="true"
              />
              No Officially Verified accounts listed yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {partitioned.officiallyVerifiedUsers.map(
                renderRegisteredAccountCard
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Trust Contacts (Unified Directory of Verified Offices, Faculty Reps & Mentors) */}
      {showTrustContactsSection && (
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RoleBadge badge="trust" size="sm" />
              <h2 className="font-display text-base font-bold text-[#0B1A2E]">
                Trust Contacts ({rotatedTrustContacts.length})
              </h2>
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Curated campus offices, faculty presidents, advisers, and trusted
            student contacts. Tap any card to view full details and open
            WhatsApp directly.
          </p>

          {rotatedTrustContacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
              No Trust Contacts added yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {rotatedTrustContacts.map(renderDirectoryOnlyCard)}
            </div>
          )}
        </div>
      )}

      {/* Trust Contact Info & WhatsApp Modal */}
      {selectedTrustContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs"
          onClick={() => setSelectedTrustContact(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`trust-modal-${selectedTrustContact.id}`}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AvatarMedia
                  fullName={selectedTrustContact.fullName}
                  photoImageId={selectedTrustContact.photoImageId}
                  photoUrl={selectedTrustContact.photoUrl}
                  sizeClass="h-12 w-12"
                  roundedClass="rounded-xl"
                  textClass="text-sm"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RoleBadge badge="trust" size="sm" />
                    <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800">
                      {selectedTrustContact.badgeLabel ||
                        TRUSTED_CONTACT_CATEGORY_LABELS[
                          selectedTrustContact.category
                        ] ||
                        'Trust Contact'}
                    </span>
                  </div>
                  <h3
                    id={`trust-modal-${selectedTrustContact.id}`}
                    className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]"
                  >
                    {selectedTrustContact.fullName}
                  </h3>
                  <p className="text-xs font-medium text-[#1E88E5]">
                    {selectedTrustContact.roleTitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close contact info"
                onClick={() => setSelectedTrustContact(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {(selectedTrustContact.department ||
              selectedTrustContact.faculty) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {[
                    selectedTrustContact.department,
                    selectedTrustContact.faculty,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
            )}

            {selectedTrustContact.contactNumber && (
              <p className="mt-2 text-xs font-medium text-slate-700">
                WhatsApp:{' '}
                <span className="font-mono">
                  {selectedTrustContact.contactNumber}
                </span>
              </p>
            )}

            {selectedTrustContact.description && (
              <LinkifiedText
                text={selectedTrustContact.description}
                className="mt-2.5 text-xs leading-relaxed text-slate-700"
              />
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              {resolveTrustedContactWhatsappUrl(selectedTrustContact) && (
                <a
                  href={
                    resolveTrustedContactWhatsappUrl(selectedTrustContact)!
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#132844]"
                >
                  <MessageCircle
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Message on WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => setSelectedTrustContact(null)}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

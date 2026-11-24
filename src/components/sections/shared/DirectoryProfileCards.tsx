import React, { useState } from 'react';
import { Building2, MessageCircle, X } from 'lucide-react';
import type { PublicProfileProjection, TrustedContact } from '../../../types/database';
import { TRUSTED_CONTACT_CATEGORY_LABELS } from '../../../utils/followRelations';
import { resolveTrustedContactWhatsappUrl } from '../../../utils/trustedDirectory';
import { ProfileBadgesRow, RoleBadge } from '../../RoleBadge';
import { TikTokFollowButton } from '../../TikTokFollowButton';
import { AvatarMedia } from '../../media/FirestoreImage';

interface MemberDirectoryCardProps {
  member: PublicProfileProjection;
  viewerUsername?: string | null;
  hydratingStats?: boolean;
  onOpenProfile: (username: string) => void;
  onRequireAuth?: () => void;
}

export const MemberDirectoryCard = React.memo(function MemberDirectoryCard({
  member,
  viewerUsername = null,
  hydratingStats = false,
  onOpenProfile,
  onRequireAuth,
}: MemberDirectoryCardProps) {
  const isSelf =
    Boolean(viewerUsername) &&
    viewerUsername!.toLowerCase() === member.username.toLowerCase();

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-[#1E88E5]/60 hover:bg-slate-50/60">
      <button
        type="button"
        onClick={() => onOpenProfile(member.username)}
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
            {member.level ? ` · ${member.level}` : ''}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500 tabular-nums">
            {hydratingStats &&
            (member.followersCount ?? 0) === 0 &&
            (member.followingCount ?? 0) === 0 ? (
              <span className="font-normal text-slate-400">
                Loading follower stats...
              </span>
            ) : (
              <>
                {member.followersCount} followers · {member.followingCount}{' '}
                following
                {hydratingStats && (
                  <span className="ml-1.5 font-normal text-slate-400">
                    · Updating...
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      </button>

      <TikTokFollowButton
        targetUsername={member.username}
        compact
        onRequireAuth={onRequireAuth}
      />
    </div>
  );
});

interface TrustedDirectoryCardProps {
  contact: TrustedContact;
}

export const TrustedDirectoryCard = React.memo(function TrustedDirectoryCard({
  contact,
}: TrustedDirectoryCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const waUrl = resolveTrustedContactWhatsappUrl(contact);
  const categoryLabel =
    contact.badgeLabel ||
    TRUSTED_CONTACT_CATEGORY_LABELS[contact.category] ||
    'Trust Contact';

  return (
    <>
      <article
        data-directory-entry-id={contact.id}
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-purple-300"
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
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
        </div>

        {(contact.department || contact.faculty) && (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-600">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {[contact.department, contact.faculty].filter(Boolean).join(' · ')}
            </span>
          </p>
        )}

        {contact.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
            {contact.description}
          </p>
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
            onClick={() => setModalOpen(true)}
            className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
          >
            Contact Info
          </button>
        </div>
      </article>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`trusted-dir-modal-${contact.id}`}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AvatarMedia
                  fullName={contact.fullName}
                  photoImageId={contact.photoImageId}
                  photoUrl={contact.photoUrl}
                  sizeClass="h-12 w-12"
                  roundedClass="rounded-xl"
                  textClass="text-sm"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RoleBadge badge="trust" size="sm" />
                    <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800">
                      {categoryLabel}
                    </span>
                  </div>
                  <h3
                    id={`trusted-dir-modal-${contact.id}`}
                    className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]"
                  >
                    {contact.fullName}
                  </h3>
                  <p className="text-xs font-medium text-[#1E88E5]">
                    {contact.roleTitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close contact info"
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {(contact.department || contact.faculty) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {[contact.department, contact.faculty]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
            )}

            {contact.contactNumber && (
              <p className="mt-2 text-xs font-medium text-slate-700">
                WhatsApp: <span className="font-mono">{contact.contactNumber}</span>
              </p>
            )}

            {contact.description && (
              <p className="mt-2.5 text-xs leading-relaxed text-slate-700">
                {contact.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              {waUrl && (
                <a
                  href={waUrl}
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
                onClick={() => setModalOpen(false)}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

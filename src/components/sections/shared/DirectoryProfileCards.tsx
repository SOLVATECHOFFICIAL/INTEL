import React from 'react';
import { Building2, MessageCircle } from 'lucide-react';
import type { PublicProfileProjection, TrustedContact } from '../../../types/database';
import { buildWhatsAppChatUrl } from '../../../utils/authValidation';
import { TRUSTED_CONTACT_CATEGORY_LABELS } from '../../../utils/followRelations';
import { RoleBadge } from '../../RoleBadge';
import { TikTokFollowButton } from '../../TikTokFollowButton';
import { AvatarMedia } from '../../media/FirestoreImage';

interface MemberDirectoryCardProps {
  member: PublicProfileProjection;
  viewerUsername?: string | null;
  onOpenProfile: (username: string) => void;
  onRequireAuth?: () => void;
}

export const MemberDirectoryCard = React.memo(function MemberDirectoryCard({
  member,
  viewerUsername = null,
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
            <RoleBadge badge={member.badge} size="xs" />
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
            {member.followersCount} followers · {member.followingCount} following
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
  const waUrl = contact.contactNumber
    ? buildWhatsAppChatUrl(contact.contactNumber)
    : contact.whatsappLink || null;

  return (
    <article
      data-directory-entry-id={contact.id}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
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
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {contact.badgeLabel ||
                TRUSTED_CONTACT_CATEGORY_LABELS[contact.category] ||
                'Directory Profile'}
            </span>
            <span className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              Directory Profile
            </span>
          </div>
          <h3 className="mt-1.5 font-display text-sm font-bold text-[#0B1A2E]">
            {contact.fullName}
          </h3>
          <p className="text-xs font-medium text-[#1E88E5]">
            {contact.roleTitle}
          </p>
        </div>
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
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          {contact.description}
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
});

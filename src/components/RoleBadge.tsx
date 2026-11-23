import React from 'react';
import { Award, BadgeCheck, Check, Crown, Shield } from 'lucide-react';
import {
  resolveBadgeRenderVariant,
  resolvePublicBadgesForProfile,
  type BadgeRenderVariant,
  type BadgeType,
  type PublicProfileProjection,
} from '../types/database';

interface RoleBadgeProps {
  badge: BadgeType | 'trust' | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  variant?: BadgeRenderVariant;
  className?: string;
}

/**
 * Renders official platform badges:
 * - variant="icon" (default for size="xs"): small TikTok-style circular icon at the end of a user's name on posts, comments, replies, and cards.
 * - variant="full" (default for size="sm" | "md"): full rectangular badge inside opened profiles, contact modals, and admin headers.
 *
 * Colors:
 * - VERIFIED      — Blue
 * - MODERATOR     — Green
 * - TRUST         — Purple (for non-account Trust contacts)
 * - SUPREME ADMIN — Navy & Royal Blue (shown only when badge visibility is active)
 *
 * Ordinary members ('none') render nothing. Never use in Anonymous feeds or replies.
 */
export const RoleBadge: React.FC<RoleBadgeProps> = ({
  badge,
  size = 'sm',
  variant,
  className = '',
}) => {
  if (!badge || badge === 'none') {
    return null;
  }

  const resolvedVariant = resolveBadgeRenderVariant(size, variant);

  if (resolvedVariant === 'icon') {
    const circleDimensions =
      size === 'md'
        ? 'h-5 w-5'
        : size === 'sm'
        ? 'h-[18px] w-[18px]'
        : 'h-4 w-4';
    const glyphSize =
      size === 'md'
        ? 'h-3 w-3'
        : size === 'sm'
        ? 'h-2.5 w-2.5'
        : 'h-2.5 w-2.5';

    if (badge === 'supreme_admin') {
      return (
        <span
          data-badge-type="supreme_admin"
          data-badge-variant="icon"
          title="Supreme Admin"
          aria-label="Supreme Admin badge"
          className={`inline-flex ${circleDimensions} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0B1A2E] via-[#13386C] to-[#1E88E5] text-white ring-1 ring-[#64B5F6] shadow-2xs ${className}`}
        >
          <Crown className={`${glyphSize} shrink-0`} strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    }

    if (badge === 'moderator') {
      return (
        <span
          data-badge-type="moderator"
          data-badge-variant="icon"
          title="Moderator"
          aria-label="Moderator badge"
          className={`inline-flex ${circleDimensions} shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xs ${className}`}
        >
          <Shield className={`${glyphSize} shrink-0`} strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    }

    if (badge === 'trust') {
      return (
        <span
          data-badge-type="trust"
          data-badge-variant="icon"
          title="Trust Contact"
          aria-label="Trust badge"
          className={`inline-flex ${circleDimensions} shrink-0 items-center justify-center rounded-full bg-purple-700 text-white shadow-2xs ${className}`}
        >
          <Award className={`${glyphSize} shrink-0`} strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    }

    return (
      <span
        data-badge-type="verified"
        data-badge-variant="icon"
        title="Verified"
        aria-label="Verified badge"
        className={`inline-flex ${circleDimensions} shrink-0 items-center justify-center rounded-full bg-[#1E88E5] text-white shadow-2xs ${className}`}
      >
        <Check className={`${glyphSize} shrink-0`} strokeWidth={3.2} aria-hidden="true" />
      </span>
    );
  }

  const sizeStyles =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[10px] gap-1'
      : size === 'md'
      ? 'px-3 py-1 text-xs gap-1.5'
      : 'px-2 py-0.5 text-[11px] gap-1';

  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';

  if (badge === 'supreme_admin') {
    return (
      <span
        data-badge-type="supreme_admin"
        data-badge-variant="full"
        className={`relative inline-flex shrink-0 items-center overflow-hidden rounded-lg border-2 border-[#64B5F6] bg-gradient-to-r from-[#0B1A2E] via-[#13386C] to-[#1E88E5] font-extrabold tracking-wide text-white uppercase shadow-[0_2px_10px_rgba(30,136,229,0.35)] ring-1 ring-[#1E88E5]/40 ${sizeStyles} ${className}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
        />
        <Crown className={`relative ${iconSize} shrink-0`} aria-hidden="true" />
        <span className="relative whitespace-nowrap">SUPREME ADMIN</span>
      </span>
    );
  }

  if (badge === 'moderator') {
    return (
      <span
        data-badge-type="moderator"
        data-badge-variant="full"
        className={`inline-flex shrink-0 items-center rounded-lg border border-emerald-700 bg-emerald-600 font-bold tracking-wide text-white uppercase shadow-xs ${sizeStyles} ${className}`}
      >
        <Shield className={`${iconSize} shrink-0`} aria-hidden="true" />
        <span className="whitespace-nowrap">MODERATOR</span>
      </span>
    );
  }

  if (badge === 'trust') {
    return (
      <span
        data-badge-type="trust"
        data-badge-variant="full"
        className={`inline-flex shrink-0 items-center rounded-lg border border-purple-800 bg-purple-700 font-bold tracking-wide text-white uppercase shadow-xs ${sizeStyles} ${className}`}
      >
        <Award className={`${iconSize} shrink-0`} aria-hidden="true" />
        <span className="whitespace-nowrap">TRUST</span>
      </span>
    );
  }

  return (
    <span
      data-badge-type="verified"
      data-badge-variant="full"
      className={`inline-flex shrink-0 items-center rounded-lg border border-[#1565C0] bg-[#1E88E5] font-bold tracking-wide text-white uppercase shadow-xs ${sizeStyles} ${className}`}
    >
      <BadgeCheck className={`${iconSize} shrink-0`} aria-hidden="true" />
      <span className="whitespace-nowrap">VERIFIED</span>
    </span>
  );
};

interface ProfileBadgesRowProps {
  profile?: Pick<PublicProfileProjection, 'badge' | 'isVerified'> | null;
  fallbackBadge?: BadgeType | 'trust' | null;
  size?: 'xs' | 'sm' | 'md';
  variant?: BadgeRenderVariant;
  className?: string;
}

export const ProfileBadgesRow: React.FC<ProfileBadgesRowProps> = ({
  profile,
  fallbackBadge,
  size = 'sm',
  variant,
  className = '',
}) => {
  const badges = profile
    ? resolvePublicBadgesForProfile(profile)
    : fallbackBadge && fallbackBadge !== 'none'
    ? [fallbackBadge]
    : [];

  if (badges.length === 0) {
    return null;
  }

  if (badges.length === 1) {
    return (
      <RoleBadge
        badge={badges[0]}
        size={size}
        variant={variant}
        className={className}
      />
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {badges.map((badgeItem) => (
        <RoleBadge
          key={badgeItem}
          badge={badgeItem}
          size={size}
          variant={variant}
        />
      ))}
    </span>
  );
};

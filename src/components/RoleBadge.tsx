import React from 'react';
import { BadgeCheck, Crown, Shield } from 'lucide-react';
import type { BadgeType } from '../types/database';

interface RoleBadgeProps {
  badge: BadgeType | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

/**
 * Strictly renders ONLY the three official platform badges:
 * 1. SUPREME ADMIN — Purple, thick, shiny, highly distinctive
 * 2. MODERATOR     — Red, displays MODERATOR
 * 3. VERIFIED      — Green, displays VERIFIED
 *
 * Ordinary members ('none') render nothing. Never use in Anonymous feeds or replies.
 */
export const RoleBadge: React.FC<RoleBadgeProps> = ({
  badge,
  size = 'sm',
  className = '',
}) => {
  if (!badge || badge === 'none') {
    return null;
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
        className={`relative inline-flex shrink-0 items-center overflow-hidden rounded-lg border-2 border-purple-300 bg-gradient-to-r from-purple-700 via-fuchsia-600 to-purple-800 font-extrabold tracking-wide text-white uppercase shadow-[0_2px_10px_rgba(147,51,234,0.38)] ring-1 ring-purple-500/40 ${sizeStyles} ${className}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent"
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
        className={`inline-flex shrink-0 items-center rounded-lg border border-red-700 bg-red-600 font-bold tracking-wide text-white uppercase shadow-xs ${sizeStyles} ${className}`}
      >
        <Shield className={`${iconSize} shrink-0`} aria-hidden="true" />
        <span className="whitespace-nowrap">MODERATOR</span>
      </span>
    );
  }

  return (
    <span
      data-badge-type="verified"
      className={`inline-flex shrink-0 items-center rounded-lg border border-emerald-700 bg-emerald-600 font-bold tracking-wide text-white uppercase shadow-xs ${sizeStyles} ${className}`}
    >
      <BadgeCheck className={`${iconSize} shrink-0`} aria-hidden="true" />
      <span className="whitespace-nowrap">VERIFIED</span>
    </span>
  );
};

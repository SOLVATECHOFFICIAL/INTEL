import React, { useState } from 'react';
import { BRAND } from '../config/brand';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  inverted?: boolean;
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-12 w-12 rounded-xl',
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showWordmark = true,
  inverted = false,
}) => {
  const [imageError, setImageError] = useState(false);

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 sm:gap-2.5">
      {imageError ? (
        <span
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center bg-[#0B1A2E] font-display text-sm font-extrabold tracking-tight text-white ring-1 ring-[#1E88E5]/40 ${SIZE_CLASSES[size]}`}
        >
          {BRAND.monogram}
        </span>
      ) : (
        <img
          src={BRAND.logoPath}
          alt={BRAND.logoAlt}
          width={size === 'lg' ? 48 : size === 'md' ? 36 : 32}
          height={size === 'lg' ? 48 : size === 'md' ? 36 : 32}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className={`object-contain shrink-0 ${SIZE_CLASSES[size]}`}
        />
      )}

      {showWordmark && (
        <span
          className={`truncate font-display text-base font-bold tracking-tight sm:text-lg ${
            inverted ? 'text-white' : 'text-[#0B1A2E]'
          }`}
        >
          {BRAND.name}
        </span>
      )}
    </span>
  );
};

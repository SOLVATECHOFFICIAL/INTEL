import type { AnonymousBackgroundId } from '../types/database';

export interface AnonymousBackgroundTheme {
  id: AnonymousBackgroundId;
  label: string;
  backgroundCss: string;
  swatchCss: string;
  textColorClass: string;
  metaColorClass: string;
  borderClass: string;
  isDark: boolean;
}

export const ANONYMOUS_BACKGROUND_THEMES: readonly AnonymousBackgroundTheme[] =
  [
    {
      id: 'plain',
      label: 'Classic Card',
      backgroundCss: '#ffffff',
      swatchCss: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
      textColorClass: 'text-[#0B1A2E]',
      metaColorClass: 'text-slate-600',
      borderClass: 'border-slate-200',
      isDark: false,
    },
    {
      id: 'navy_slate',
      label: 'Deep Navy',
      backgroundCss: 'linear-gradient(135deg, #0B1A2E 0%, #153459 100%)',
      swatchCss: 'linear-gradient(135deg, #0B1A2E 0%, #153459 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-slate-200',
      borderClass: 'border-[#0B1A2E]',
      isDark: true,
    },
    {
      id: 'ocean_blue',
      label: 'Campus Ocean',
      backgroundCss: 'linear-gradient(135deg, #0F4C81 0%, #1E88E5 100%)',
      swatchCss: 'linear-gradient(135deg, #0F4C81 0%, #1E88E5 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-blue-100',
      borderClass: 'border-[#0F4C81]',
      isDark: true,
    },
    {
      id: 'cobalt_indigo',
      label: 'Midnight Indigo',
      backgroundCss: 'linear-gradient(135deg, #1E1B4B 0%, #3730A3 100%)',
      swatchCss: 'linear-gradient(135deg, #1E1B4B 0%, #3730A3 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-indigo-100',
      borderClass: 'border-indigo-950',
      isDark: true,
    },
    {
      id: 'midnight_emerald',
      label: 'Forest Emerald',
      backgroundCss: 'linear-gradient(135deg, #064E3B 0%, #047857 100%)',
      swatchCss: 'linear-gradient(135deg, #064E3B 0%, #047857 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-emerald-100',
      borderClass: 'border-emerald-950',
      isDark: true,
    },
    {
      id: 'sunset_amber',
      label: 'Amber Terracotta',
      backgroundCss: 'linear-gradient(135deg, #7C2D12 0%, #B45309 100%)',
      swatchCss: 'linear-gradient(135deg, #7C2D12 0%, #B45309 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-amber-100',
      borderClass: 'border-amber-950',
      isDark: true,
    },
    {
      id: 'crimson_rose',
      label: 'Burgundy Rose',
      backgroundCss: 'linear-gradient(135deg, #7F1D1D 0%, #BE123C 100%)',
      swatchCss: 'linear-gradient(135deg, #7F1D1D 0%, #BE123C 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-rose-100',
      borderClass: 'border-rose-950',
      isDark: true,
    },
    {
      id: 'royal_plum',
      label: 'Royal Plum',
      backgroundCss: 'linear-gradient(135deg, #4C1D95 0%, #7E22CE 100%)',
      swatchCss: 'linear-gradient(135deg, #4C1D95 0%, #7E22CE 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-purple-100',
      borderClass: 'border-purple-950',
      isDark: true,
    },
    {
      id: 'warm_charcoal',
      label: 'Slate Charcoal',
      backgroundCss: 'linear-gradient(135deg, #1E293B 0%, #334155 100%)',
      swatchCss: 'linear-gradient(135deg, #1E293B 0%, #334155 100%)',
      textColorClass: 'text-white',
      metaColorClass: 'text-slate-200',
      borderClass: 'border-slate-800',
      isDark: true,
    },
  ] as const;

export function getAnonymousBackgroundTheme(
  id?: AnonymousBackgroundId | string | null
): AnonymousBackgroundTheme {
  return (
    ANONYMOUS_BACKGROUND_THEMES.find((theme) => theme.id === id) ??
    ANONYMOUS_BACKGROUND_THEMES[0]
  );
}

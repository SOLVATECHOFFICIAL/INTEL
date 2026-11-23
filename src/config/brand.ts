const resolvedAppName =
  (
    import.meta as { env?: Record<string, string | undefined> }
  ).env?.VITE_APP_NAME?.trim() || 'LASUED Intel';

export const BRAND = {
  name: resolvedAppName,
  monogram: 'LI',
  tagline: 'Your Campus. Your Information. Your Community.',
  logoPath: '/lasued-intel.webp',
  logoAlt: `${resolvedAppName} logo`,
  colors: {
    navy: '#0B1A2E',
    blue: '#1E88E5',
    white: '#FFFFFF',
  },
} as const;

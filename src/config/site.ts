const DEFAULT_FALLBACK_PUBLIC_ORIGIN = 'https://lasuedintel.app';

export function normalizePublicOrigin(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getConfiguredPublicBaseUrl(): string | null {
  try {
    const envVal = import.meta?.env?.VITE_PUBLIC_BASE_URL;
    return normalizePublicOrigin(
      typeof envVal === 'string' ? envVal : null
    );
  } catch {
    return null;
  }
}

export function getPublicSiteBaseUrl(originOverride?: string): string {
  const fromOverride = normalizePublicOrigin(originOverride);
  if (fromOverride) return fromOverride;

  if (typeof window !== 'undefined' && window.location?.origin) {
    const runtimeOrigin = normalizePublicOrigin(window.location.origin);
    if (runtimeOrigin) {
      return runtimeOrigin;
    }
  }

  return getConfiguredPublicBaseUrl() ?? DEFAULT_FALLBACK_PUBLIC_ORIGIN;
}

export function buildPublicAppUrl(
  relativePathAndSearch = '/',
  originOverride?: string
): string {
  const base = getPublicSiteBaseUrl(originOverride);
  const cleanRel = relativePathAndSearch.startsWith('/')
    ? relativePathAndSearch
    : `/${relativePathAndSearch}`;
  return `${base}${cleanRel}`;
}

export function buildProfileShareUrl(
  username: string,
  originOverride?: string
): string {
  const cleanUsername = username.trim().toLowerCase();
  const pathname =
    typeof window !== 'undefined' && window.location?.pathname
      ? window.location.pathname
      : '/';
  const basePath = pathname.endsWith('/') ? pathname : `${pathname}`;
  return buildPublicAppUrl(
    `${basePath}?view=profile&username=${encodeURIComponent(cleanUsername)}`,
    originOverride
  );
}

export function buildMarketplaceListingShareUrl(
  listingId: string,
  originOverride?: string
): string {
  return buildPublicAppUrl(
    `/?view=marketplace&listingId=${encodeURIComponent(listingId.trim())}`,
    originOverride
  );
}

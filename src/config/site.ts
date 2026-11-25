const DEFAULT_FALLBACK_PUBLIC_ORIGIN = 'https://lasuedintel.com.ng';

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

export function getCanonicalProductionOrigin(originOverride?: string): string {
  const fromOverride = normalizePublicOrigin(originOverride);
  if (fromOverride) return fromOverride;

  return getConfiguredPublicBaseUrl() ?? DEFAULT_FALLBACK_PUBLIC_ORIGIN;
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

export function buildCanonicalPublicAppUrl(
  relativePathAndSearch = '/',
  originOverride?: string
): string {
  const base = getCanonicalProductionOrigin(originOverride);
  const cleanRel = relativePathAndSearch.startsWith('/')
    ? relativePathAndSearch
    : `/${relativePathAndSearch}`;
  return `${base}${cleanRel}`;
}

export function buildPublicImageUrl(
  relativeAssetPath = '/og-share.png',
  originOverride?: string
): string {
  return buildCanonicalPublicAppUrl(relativeAssetPath, originOverride);
}

export function buildProfileShareUrl(
  username: string,
  originOverride?: string
): string {
  const cleanUsername = username.trim().toLowerCase();
  return buildCanonicalPublicAppUrl(
    `/?view=profile&username=${encodeURIComponent(cleanUsername)}`,
    originOverride
  );
}

export function buildMarketplaceListingShareUrl(
  listingId: string,
  originOverride?: string
): string {
  return buildCanonicalPublicAppUrl(
    `/?view=marketplace&listingId=${encodeURIComponent(listingId.trim())}`,
    originOverride
  );
}

export function buildPostShareUrl(
  kind: 'ordinary' | 'anonymous',
  postId: string,
  originOverride?: string
): string {
  const view = kind === 'anonymous' ? 'anonymous' : 'for-you';
  return buildCanonicalPublicAppUrl(
    `/?view=${view}&postId=${encodeURIComponent(postId.trim())}`,
    originOverride
  );
}

export function buildUpdateShareUrl(
  updateId: string,
  originOverride?: string
): string {
  return buildCanonicalPublicAppUrl(
    `/?view=updates&postId=${encodeURIComponent(updateId.trim())}`,
    originOverride
  );
}

export function buildOpportunityShareUrl(
  opportunityId: string,
  originOverride?: string
): string {
  return buildCanonicalPublicAppUrl(
    `/?view=opportunities&opportunityId=${encodeURIComponent(opportunityId.trim())}`,
    originOverride
  );
}


export interface LinkTextSegment {
  type: 'text' | 'link';
  value: string;
  href?: string;
  label?: string;
}

const KNOWN_LINK_TLDS = new Set([
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'mil',
  'int',
  'ng',
  'uk',
  'us',
  'ca',
  'de',
  'fr',
  'eu',
  'in',
  'za',
  'gh',
  'ke',
  'io',
  'co',
  'me',
  'ly',
  'be',
  'gg',
  'gl',
  'gle',
  'ee',
  'to',
  'tv',
  'cc',
  'ai',
  'app',
  'dev',
  'xyz',
  'info',
  'biz',
  'name',
  'pro',
  'tech',
  'site',
  'online',
  'store',
  'shop',
  'club',
  'live',
  'news',
  'blog',
  'link',
  'bio',
  'fm',
  'im',
  'vc',
  'so',
  'sh',
  'ws',
  'tk',
  'page',
  'cloud',
  'studio',
  'design',
  'agency',
  'media',
  'academy',
  'school',
  'university',
]);

// Matches explicit http(s):// URLs, www. domains, or domain.tld(/path)? candidates
const CANDIDATE_LINK_PATTERN =
  /(?:https?:\/\/[^\s<>"'`]+|(?<![\w@./:-])(?:www\.[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,24})(?::\d{2,5})?(?:\/[^\s<>"'`]*)?(?:\?[^\s<>"'`]*)?(?:#[^\s<>"'`]*)?)/gi;

const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', '"', "'", '…']);

function countChar(str: string, target: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i += 1) {
    if (str[i] === target) count += 1;
  }
  return count;
}

function trimTrailingPunctuation(raw: string): { clean: string; trailing: string } {
  let clean = raw;
  let trailing = '';

  while (clean.length > 0) {
    const last = clean[clean.length - 1];
    if (TRAILING_PUNCTUATION.has(last)) {
      trailing = last + trailing;
      clean = clean.slice(0, -1);
      continue;
    }
    if (last === ')' && countChar(clean, ')') > countChar(clean, '(')) {
      trailing = last + trailing;
      clean = clean.slice(0, -1);
      continue;
    }
    if (last === ']' && countChar(clean, ']') > countChar(clean, '[')) {
      trailing = last + trailing;
      clean = clean.slice(0, -1);
      continue;
    }
    if (last === '}' && countChar(clean, '}') > countChar(clean, '{')) {
      trailing = last + trailing;
      clean = clean.slice(0, -1);
      continue;
    }
    break;
  }

  return { clean, trailing };
}

export function sanitizeExternalHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed) || /^vbscript:/i.test(trimmed)) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return null;
    }
    if (/^\d+\.\d+$/.test(parsed.hostname)) {
      return null;
    }
    const labels = parsed.hostname.toLowerCase().split('.').filter(Boolean);
    if (labels.length < 2) {
      return null;
    }
    const tld = labels[labels.length - 1];
    const hasExplicitScheme = /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
    if (!hasExplicitScheme && !KNOWN_LINK_TLDS.has(tld)) {
      return null;
    }
    if (/[^a-z0-9.-]/i.test(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function formatDisplayLinkLabel(rawOrHref: string, maxLength = 54): string {
  const trimmed = rawOrHref.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(12, maxLength - 1))}…`;
}

function appendTextSegment(segments: LinkTextSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') {
    last.value += text;
  } else {
    segments.push({ type: 'text', value: text });
  }
}

/**
 * Splits arbitrary post, update, announcement, comment, reply, or caption text
 * into plain-text and validated external link segments without misclassifying
 * emails, decimal numbers, or sentence-ending punctuation.
 */
export function parseLinkSegments(text: string): LinkTextSegment[] {
  if (!text) return [];
  const segments: LinkTextSegment[] = [];
  let cursor = 0;

  CANDIDATE_LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CANDIDATE_LINK_PATTERN.exec(text)) !== null) {
    const startIndex = match.index;
    const rawCandidate = match[0];

    // Guard against email local-part prefixes or mid-token artifacts
    const prevChar = startIndex > 0 ? text[startIndex - 1] : '';
    if (prevChar === '@') {
      continue;
    }

    // Reject javascript:/data: prefixed directly before candidate
    const prefixWindow = text.slice(Math.max(0, startIndex - 16), startIndex).toLowerCase();
    if (
      prefixWindow.endsWith('javascript:') ||
      prefixWindow.endsWith('data:') ||
      prefixWindow.endsWith('vbscript:')
    ) {
      continue;
    }

    const { clean, trailing } = trimTrailingPunctuation(rawCandidate);
    const safeHref = clean ? sanitizeExternalHttpUrl(clean) : null;

    if (!safeHref) {
      continue;
    }

    if (startIndex > cursor) {
      appendTextSegment(segments, text.slice(cursor, startIndex));
    }

    segments.push({
      type: 'link',
      value: clean,
      href: safeHref,
      label: formatDisplayLinkLabel(clean),
    });

    if (trailing) {
      appendTextSegment(segments, trailing);
    }

    cursor = startIndex + rawCandidate.length;
  }

  if (cursor < text.length) {
    appendTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function extractLinksFromText(text: string): string[] {
  return parseLinkSegments(text)
    .filter((segment): segment is LinkTextSegment & { href: string } => segment.type === 'link' && Boolean(segment.href))
    .map((segment) => segment.href);
}

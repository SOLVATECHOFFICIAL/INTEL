import { buildWhatsAppChatUrl } from './authValidation';

export const TRUSTED_DIRECTORY_ROTATION_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function getTrustedDirectoryRotationSlot(
  nowMs: number = Date.now()
): number {
  if (!Number.isFinite(nowMs) || nowMs < 0) return 0;
  return Math.floor(nowMs / TRUSTED_DIRECTORY_ROTATION_INTERVAL_MS);
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically rotates the Trust contact directory display order every 2 hours.
 * Never mutates, drops, duplicates, or alters badges/permissions of any contact.
 */
export function rotateTrustedContactsDeterministically<
  T extends { id: string },
>(contacts: readonly T[], nowMs: number = Date.now()): T[] {
  if (contacts.length <= 1) {
    return [...contacts];
  }
  const slot = getTrustedDirectoryRotationSlot(nowMs);
  // Sort deterministically by ID first so input query order doesn't perturb the slot order
  const ordered = [...contacts].sort((a, b) => a.id.localeCompare(b.id));
  const seed = hashSeed(`lasued_trust_dir_slot_${slot}_${ordered.length}`);
  const rand = createMulberry32(seed);

  for (let i = ordered.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = ordered[i]!;
    ordered[i] = ordered[j]!;
    ordered[j] = tmp;
  }

  return ordered;
}

export function validateTrustedContactWhatsapp(whatsappInput: string): {
  contactNumber: string;
  whatsappLink: string;
} {
  const trimmed = whatsappInput.trim();
  if (!trimmed) {
    throw new Error(
      'A valid WhatsApp number is compulsory before publishing a Trust contact.'
    );
  }
  const whatsappLink = buildWhatsAppChatUrl(trimmed);
  if (!whatsappLink) {
    throw new Error(
      'Enter a valid WhatsApp number (7–24 digits/phone characters) so members can reach this contact on WhatsApp.'
    );
  }
  return {
    contactNumber: trimmed,
    whatsappLink,
  };
}

export function resolveTrustedContactWhatsappUrl(contact: {
  contactNumber?: string;
  whatsappLink?: string;
}): string | null {
  if (contact.contactNumber) {
    const fromNumber = buildWhatsAppChatUrl(contact.contactNumber);
    if (fromNumber) return fromNumber;
  }
  const link = contact.whatsappLink?.trim();
  if (link && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(link)) {
    return link;
  }
  return null;
}

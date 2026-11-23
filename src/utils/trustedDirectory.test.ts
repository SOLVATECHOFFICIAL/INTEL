import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTrustedDirectoryRotationSlot,
  resolveTrustedContactWhatsappUrl,
  rotateTrustedContactsDeterministically,
  TRUSTED_DIRECTORY_ROTATION_INTERVAL_MS,
  validateTrustedContactWhatsapp,
} from './trustedDirectory';

test('rotateTrustedContactsDeterministically preserves all entries, stays stable within 2 hours, and rotates across 2-hour slots', () => {
  const sample = Array.from({ length: 8 }, (_, idx) => ({
    id: `contact_${idx + 1}`,
    fullName: `Contact ${idx + 1}`,
    badge: 'trust',
  }));

  const slotZeroStart = 1_800_000_000_000;
  const withinSameSlot = slotZeroStart + 30 * 60 * 1000; // +30 mins
  const nextSlot = slotZeroStart + TRUSTED_DIRECTORY_ROTATION_INTERVAL_MS; // +2 hours

  assert.equal(
    getTrustedDirectoryRotationSlot(slotZeroStart),
    getTrustedDirectoryRotationSlot(withinSameSlot)
  );
  assert.notEqual(
    getTrustedDirectoryRotationSlot(slotZeroStart),
    getTrustedDirectoryRotationSlot(nextSlot)
  );

  const firstRun = rotateTrustedContactsDeterministically(sample, slotZeroStart);
  const sameSlotRun = rotateTrustedContactsDeterministically(
    [...sample].reverse(),
    withinSameSlot
  );
  const nextSlotRun = rotateTrustedContactsDeterministically(sample, nextSlot);

  assert.deepEqual(
    firstRun.map((c) => c.id),
    sameSlotRun.map((c) => c.id)
  );
  assert.notDeepEqual(
    firstRun.map((c) => c.id),
    nextSlotRun.map((c) => c.id)
  );
  assert.equal(nextSlotRun.length, sample.length);
  assert.equal(new Set(nextSlotRun.map((c) => c.id)).size, sample.length);
  assert.ok(nextSlotRun.every((c) => c.badge === 'trust'));
});

test('validateTrustedContactWhatsapp enforces compulsory valid WhatsApp numbers', () => {
  assert.throws(() => validateTrustedContactWhatsapp(''), /compulsory/i);
  assert.throws(() => validateTrustedContactWhatsapp('   '), /compulsory/i);
  assert.throws(() => validateTrustedContactWhatsapp('abc'), /valid WhatsApp number/i);

  const valid = validateTrustedContactWhatsapp('08012345678');
  assert.equal(valid.contactNumber, '08012345678');
  assert.equal(valid.whatsappLink, 'https://wa.me/2348012345678');

  assert.equal(
    resolveTrustedContactWhatsappUrl({ contactNumber: '+2348099998888' }),
    'https://wa.me/2348099998888'
  );
  assert.equal(
    resolveTrustedContactWhatsappUrl({ whatsappLink: 'https://wa.me/2348099998888' }),
    'https://wa.me/2348099998888'
  );
  assert.equal(
    resolveTrustedContactWhatsappUrl({ whatsappLink: 'javascript:alert(1)' }),
    null
  );
});

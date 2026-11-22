import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaDataUrl,
  computeTargetDimensions,
  estimateBase64DecodedBytes,
  formatByteSize,
  validateImageFileCandidate,
  validatePostImageCountAfterAdd,
} from './imageCompression';

test('validateImageFileCandidate rejects videos, empty files, and oversized source files', () => {
  assert.match(
    validateImageFileCandidate({
      type: 'video/mp4',
      size: 500_000,
      name: 'clip.mp4',
    }) ?? '',
    /Video uploads are not supported/i
  );

  assert.match(
    validateImageFileCandidate({
      type: '',
      size: 500_000,
      name: 'lecture.mov',
    }) ?? '',
    /Video uploads are not supported/i
  );

  assert.match(
    validateImageFileCandidate({
      type: 'application/pdf',
      size: 50_000,
      name: 'notes.pdf',
    }) ?? '',
    /valid image file/i
  );

  assert.match(
    validateImageFileCandidate({
      type: 'image/jpeg',
      size: 0,
      name: 'empty.jpg',
    }) ?? '',
    /empty/i
  );

  assert.match(
    validateImageFileCandidate({
      type: 'image/jpeg',
      size: 26 * 1024 * 1024,
      name: 'huge.jpg',
    }) ?? '',
    /too large/i
  );

  assert.equal(
    validateImageFileCandidate({
      type: 'image/webp',
      size: 1_250_000,
      name: 'campus_event.webp',
    }),
    null
  );
});

test('validatePostImageCountAfterAdd strictly enforces 4-image post maximum', () => {
  assert.equal(validatePostImageCountAfterAdd(0, 4), null);
  assert.equal(validatePostImageCountAfterAdd(2, 2), null);
  assert.match(
    validatePostImageCountAfterAdd(4, 1) ?? '',
    /Maximum 4 images/i
  );
  assert.match(
    validatePostImageCountAfterAdd(1, 4) ?? '',
    /Maximum 4 images/i
  );
});

test('computeTargetDimensions preserves aspect ratio when resizing oversized photos', () => {
  assert.deepEqual(computeTargetDimensions(800, 600, 1200), {
    width: 800,
    height: 600,
  });

  assert.deepEqual(computeTargetDimensions(2400, 1200, 1200), {
    width: 1200,
    height: 600,
  });

  assert.deepEqual(computeTargetDimensions(1000, 2000, 1000), {
    width: 500,
    height: 1000,
  });
});

test('estimateBase64DecodedBytes, buildMediaDataUrl, and formatByteSize calculate accurately', () => {
  const sample = Buffer.from('LASUED Intel Campus Media').toString('base64');
  assert.equal(
    estimateBase64DecodedBytes(sample),
    Buffer.byteLength('LASUED Intel Campus Media')
  );
  assert.equal(estimateBase64DecodedBytes(''), 0);

  assert.equal(
    buildMediaDataUrl('image/webp', 'UklGRg=='),
    'data:image/webp;base64,UklGRg=='
  );
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(102400), '100.0 KB');
  assert.equal(formatByteSize(1572864), '1.50 MB');
});

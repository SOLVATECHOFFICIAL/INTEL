import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_IMAGE_FILE_ACCEPT,
  buildMediaDataUrl,
  computeTargetDimensions,
  estimateBase64DecodedBytes,
  formatByteSize,
  validateImageFileCandidate,
  validatePostImageCountAfterAdd,
} from './imageCompression';

test('validateImageFileCandidate rejects videos, audio, documents, empty files, and oversized files', () => {
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
      type: 'audio/mpeg',
      size: 200_000,
      name: 'voice.mp3',
    }) ?? '',
    /Audio files cannot be uploaded/i
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
      size: 41 * 1024 * 1024,
      name: 'huge.jpg',
    }) ?? '',
    /too large/i
  );
});

test('validateImageFileCandidate accepts all standard, modern, vector, and mobile-gallery image formats', () => {
  const acceptedCandidates = [
    { type: 'image/webp', size: 1_250_000, name: 'campus_event.webp' },
    { type: 'image/heic', size: 3_400_000, name: 'IMG_0192.HEIC' },
    { type: 'image/heif', size: 2_800_000, name: 'shot.heif' },
    { type: 'image/avif', size: 650_000, name: 'banner.avif' },
    { type: 'image/svg+xml', size: 42_000, name: 'crest.svg' },
    { type: 'image/tiff', size: 5_000_000, name: 'scan.tiff' },
    { type: 'image/bmp', size: 2_100_000, name: 'bitmap.bmp' },
    { type: 'image/x-icon', size: 18_000, name: 'favicon.ico' },
    { type: '', size: 1_400_000, name: 'photo.jfif' },
    { type: 'application/octet-stream', size: 900_000, name: 'gallery_blob' },
    { type: '', size: 750_000, name: '1000048291' },
  ];

  for (const candidate of acceptedCandidates) {
    assert.equal(
      validateImageFileCandidate(candidate),
      null,
      `Expected ${candidate.name} (${candidate.type || 'empty mime'}) to be accepted`
    );
  }

  assert.match(ALL_IMAGE_FILE_ACCEPT, /image\/\*/);
  assert.match(ALL_IMAGE_FILE_ACCEPT, /\.heic/i);
  assert.match(ALL_IMAGE_FILE_ACCEPT, /\.avif/i);
  assert.match(ALL_IMAGE_FILE_ACCEPT, /\.svg/i);
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

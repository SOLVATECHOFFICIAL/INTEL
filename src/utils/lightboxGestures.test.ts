import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  clampPanOffset,
  clampZoomScale,
  computeAdjacentGalleryIndices,
  computeNextPinchZoom,
  computePinchDistance,
} from './lightboxGestures';

test('clampZoomScale keeps zoom within [1, 4]', () => {
  assert.equal(clampZoomScale(0.2), LIGHTBOX_MIN_ZOOM);
  assert.equal(clampZoomScale(8), LIGHTBOX_MAX_ZOOM);
  assert.equal(clampZoomScale(2.25), 2.25);
  assert.equal(clampZoomScale(Number.NaN), LIGHTBOX_MIN_ZOOM);
});

test('computePinchDistance and computeNextPinchZoom scale smoothly on mobile touch', () => {
  const dStart = computePinchDistance({ clientX: 100, clientY: 200 }, { clientX: 200, clientY: 200 });
  assert.equal(dStart, 100);

  const dSpread = computePinchDistance({ clientX: 50, clientY: 200 }, { clientX: 250, clientY: 200 });
  assert.equal(dSpread, 200);
  assert.equal(computeNextPinchZoom(dStart, dSpread, 1), 2);
  assert.equal(computeNextPinchZoom(dStart, dSpread, 2.5), LIGHTBOX_MAX_ZOOM);
  assert.equal(computeNextPinchZoom(dStart, 20, 1), LIGHTBOX_MIN_ZOOM);
});

test('clampPanOffset resets at 1x and bounds pan offset proportionally at higher zoom', () => {
  assert.deepEqual(
    clampPanOffset({ x: 80, y: -40, scale: 1, stageWidth: 400, stageHeight: 600 }),
    { x: 0, y: 0 }
  );

  const clamped = clampPanOffset({
    x: 999,
    y: -999,
    scale: 2,
    stageWidth: 400,
    stageHeight: 600,
  });
  assert.deepEqual(clamped, { x: 200, y: -300 });
});

test('computeAdjacentGalleryIndices prioritizes next, prev, then +2 without duplicates', () => {
  assert.deepEqual(computeAdjacentGalleryIndices(0, 1), []);
  assert.deepEqual(computeAdjacentGalleryIndices(0, 2), [1]);
  assert.deepEqual(computeAdjacentGalleryIndices(0, 4), [1, 3, 2]);
  assert.deepEqual(computeAdjacentGalleryIndices(3, 5), [4, 2, 0]);
});

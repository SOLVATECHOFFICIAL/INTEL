export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 4;

export interface TouchPointLike {
  clientX: number;
  clientY: number;
}

export function clampZoomScale(scale: number): number {
  if (!Number.isFinite(scale)) return LIGHTBOX_MIN_ZOOM;
  return Number(
    Math.min(LIGHTBOX_MAX_ZOOM, Math.max(LIGHTBOX_MIN_ZOOM, scale)).toFixed(3)
  );
}

export function computePinchDistance(
  p1: TouchPointLike,
  p2: TouchPointLike
): number {
  const dx = p2.clientX - p1.clientX;
  const dy = p2.clientY - p1.clientY;
  return Math.hypot(dx, dy);
}

export function computeNextPinchZoom(
  initialDistance: number,
  currentDistance: number,
  initialScale: number
): number {
  if (!Number.isFinite(initialDistance) || initialDistance <= 4) {
    return clampZoomScale(initialScale);
  }
  if (!Number.isFinite(currentDistance) || currentDistance <= 0) {
    return clampZoomScale(initialScale);
  }
  return clampZoomScale(initialScale * (currentDistance / initialDistance));
}

export function clampPanOffset(input: {
  x: number;
  y: number;
  scale: number;
  stageWidth: number;
  stageHeight: number;
}): { x: number; y: number } {
  const safeScale = clampZoomScale(input.scale);
  if (safeScale <= 1.01) {
    return { x: 0, y: 0 };
  }
  const maxX = Math.max(0, ((safeScale - 1) * Math.max(240, input.stageWidth)) / 2);
  const maxY = Math.max(0, ((safeScale - 1) * Math.max(240, input.stageHeight)) / 2);
  const x = Math.min(maxX, Math.max(-maxX, Number.isFinite(input.x) ? input.x : 0));
  const y = Math.min(maxY, Math.max(-maxY, Number.isFinite(input.y) ? input.y : 0));
  return { x, y };
}

export function computeAdjacentGalleryIndices(
  currentIndex: number,
  count: number
): number[] {
  if (count <= 1 || currentIndex < 0 || currentIndex >= count) return [];
  const candidates = [
    (currentIndex + 1) % count,
    (currentIndex - 1 + count) % count,
    ...(count > 2 ? [(currentIndex + 2) % count] : []),
  ];
  return Array.from(new Set(candidates)).filter((idx) => idx !== currentIndex);
}

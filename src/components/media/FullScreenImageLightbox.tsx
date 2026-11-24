import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  getCachedMediaImageDataUrl,
  predecodeImageSrc,
  prefetchMediaImagesPriority,
} from '../../services/mediaStorage';
import {
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  clampPanOffset,
  clampZoomScale,
  computeAdjacentGalleryIndices,
  computeNextPinchZoom,
  computePinchDistance,
} from '../../utils/lightboxGestures';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { FirestoreImage } from './FirestoreImage';

interface FullScreenImageLightboxProps {
  items: GridPhotoItem[];
  initialIndex: number;
  postCaption?: string;
  postTitle?: string;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}

export const FullScreenImageLightbox: React.FC<
  FullScreenImageLightboxProps
> = ({
  items,
  initialIndex,
  postCaption,
  postTitle,
  onIndexChange,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
  );
  const [zoomScale, setZoomScale] = useState<number>(LIGHTBOX_MIN_ZOOM);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isEntered, setIsEntered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [readySlideKey, setReadySlideKey] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const didDragRef = useRef(false);
  const pinchRef = useRef<{
    initialDistance: number;
    initialScale: number;
  } | null>(null);
  const closingTimerRef = useRef<number | null>(null);

  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  useEffect(() => {
    onIndexChangeRef.current?.(currentIndex);
  }, [currentIndex]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setIsEntered(true));
    return () => {
      window.cancelAnimationFrame(raf);
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  const count = items.length;
  const activeItem = items[currentIndex];
  const slideKey = activeItem
    ? `${currentIndex}:${activeItem.directSrc || activeItem.imageId || activeItem.fallbackUrl || ''}`
    : '';

  const isCachedInstant = Boolean(
    activeItem &&
      (activeItem.directSrc ||
        (activeItem.imageId && getCachedMediaImageDataUrl(activeItem.imageId)))
  );
  const activeReady = Boolean(isCachedInstant || readySlideKey === slideKey);

  const handleRequestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closingTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 160);
  }, [isClosing, onClose]);

  const resetTransform = useCallback(() => {
    setZoomScale(LIGHTBOX_MIN_ZOOM);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handlePrev = useCallback(() => {
    if (count <= 1) return;
    resetTransform();
    setCurrentIndex((prev) => (prev - 1 + count) % count);
  }, [count, resetTransform]);

  const handleNext = useCallback(() => {
    if (count <= 1) return;
    resetTransform();
    setCurrentIndex((prev) => (prev + 1) % count);
  }, [count, resetTransform]);

  const handleZoomIn = useCallback(() => {
    setZoomScale((prev) => clampZoomScale(prev + 0.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomScale((prev) => {
      const next = clampZoomScale(prev - 0.5);
      if (next <= 1.01) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  // Preserve underlying scroll position cleanly on mobile & desktop
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Preload & pre-decode adjacent slides cleanly so Next/Prev switches are instantaneous
  useEffect(() => {
    if (count <= 1) return;
    const adjacentIndices = computeAdjacentGalleryIndices(currentIndex, count);
    if (adjacentIndices.length === 0) return;

    const highIds: string[] = [];
    const normalIds: string[] = [];
    adjacentIndices.forEach((idx, order) => {
      const item = items[idx];
      if (!item) return;
      if (item.directSrc || !item.imageId) {
        const directOrFallback = item.directSrc || item.fallbackUrl;
        if (directOrFallback) {
          void predecodeImageSrc(directOrFallback);
        }
        return;
      }
      if (order < 2) {
        highIds.push(item.imageId);
      } else {
        normalIds.push(item.imageId);
      }
    });

    if (highIds.length > 0 || normalIds.length > 0) {
      void prefetchMediaImagesPriority({
        highPriority: highIds,
        normalPriority: normalIds,
        predecode: true,
        maxTotal: 4,
      });
    }
  }, [currentIndex, count, items]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleRequestClose();
      } else if (event.key === 'ArrowLeft' && count > 1) {
        handlePrev();
      } else if (event.key === 'ArrowRight' && count > 1) {
        handleNext();
      } else if (event.key === '+' || event.key === '=') {
        handleZoomIn();
      } else if (event.key === '-') {
        handleZoomOut();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    count,
    handleNext,
    handlePrev,
    handleRequestClose,
    handleZoomIn,
    handleZoomOut,
  ]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    didDragRef.current = false;
    if (e.touches.length === 2) {
      touchStartX.current = null;
      dragStartRef.current = null;
      pinchRef.current = {
        initialDistance: computePinchDistance(e.touches[0], e.touches[1]),
        initialScale: zoomScale,
      };
      setIsInteracting(true);
      return;
    }

    if (e.touches.length === 1) {
      pinchRef.current = null;
      const touch = e.touches[0];
      if (zoomScale > 1.02) {
        touchStartX.current = null;
        dragStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          originX: panOffset.x,
          originY: panOffset.y,
        };
        setIsInteracting(true);
      } else {
        dragStartRef.current = null;
        touchStartX.current = touch.clientX;
        setIsInteracting(false);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      didDragRef.current = true;
      const distance = computePinchDistance(e.touches[0], e.touches[1]);
      const nextScale = computeNextPinchZoom(
        pinchRef.current.initialDistance,
        distance,
        pinchRef.current.initialScale
      );
      setZoomScale(nextScale);
      const rect = stageRef.current?.getBoundingClientRect();
      setPanOffset((prev) =>
        clampPanOffset({
          x: prev.x,
          y: prev.y,
          scale: nextScale,
          stageWidth: rect?.width ?? 360,
          stageHeight: rect?.height ?? 480,
        })
      );
      return;
    }

    if (e.touches.length === 1 && dragStartRef.current && zoomScale > 1.02) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        didDragRef.current = true;
      }
      const rect = stageRef.current?.getBoundingClientRect();
      setPanOffset(
        clampPanOffset({
          x: dragStartRef.current.originX + dx,
          y: dragStartRef.current.originY + dy,
          scale: zoomScale,
          stageWidth: rect?.width ?? 360,
          stageHeight: rect?.height ?? 480,
        })
      );
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pinchRef.current && e.touches.length < 2) {
      pinchRef.current = null;
      setIsInteracting(false);
      if (zoomScale <= 1.02) {
        resetTransform();
      }
      return;
    }

    dragStartRef.current = null;
    setIsInteracting(false);

    if (touchStartX.current === null || count <= 1 || zoomScale > 1.02) {
      touchStartX.current = null;
      return;
    }

    const delta =
      (e.changedTouches[0]?.clientX ?? touchStartX.current) -
      touchStartX.current;
    touchStartX.current = null;
    if (delta > 48) handlePrev();
    else if (delta < -48) handleNext();
  };

  if (!activeItem) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen image viewer"
      className={`fixed inset-0 z-50 flex flex-col bg-[#060F1C]/95 text-white backdrop-blur-sm transition-opacity duration-150 ${
        isEntered && !isClosing ? 'opacity-100' : 'opacity-0'
      }`}
      data-testid="fullscreen-lightbox"
    >
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-200 sm:gap-3 sm:text-sm">
          <span className="shrink-0 whitespace-nowrap tabular-nums">
            {currentIndex + 1} / {count}
          </span>
          {postTitle && (
            <>
              <span aria-hidden="true" className="shrink-0 text-slate-500">
                ·
              </span>
              <span className="min-w-0 truncate">{postTitle}</span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoomScale <= LIGHTBOX_MIN_ZOOM}
            aria-label="Zoom out"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-40 sm:h-[42px] sm:w-[42px]"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[38px] text-center text-xs font-semibold text-slate-200 tabular-nums sm:min-w-[48px]">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoomScale >= LIGHTBOX_MAX_ZOOM}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-40 sm:h-[42px] sm:w-[42px]"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
          {zoomScale > LIGHTBOX_MIN_ZOOM && (
            <button
              type="button"
              onClick={resetTransform}
              aria-label="Reset zoom"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 sm:h-[42px] sm:w-[42px]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={handleRequestClose}
            aria-label="Close image viewer"
            className="ml-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 sm:ml-1 sm:h-[42px] sm:w-[42px]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Shared Post Caption Visible at Top of Viewer */}
      {postCaption && (
        <div
          className="border-b border-white/10 bg-[#0B1A2E]/90 px-4 py-3 sm:px-6"
          data-testid="lightbox-shared-caption"
        >
          <div className="mx-auto max-w-3xl">
            <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-100 sm:text-sm">
              {postCaption}
            </p>
          </div>
        </div>
      )}

      {/* Main Viewport with pinch-to-zoom, pan, swipe & instant cache rendering */}
      <div
        ref={stageRef}
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden p-4 select-none sm:p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget && !didDragRef.current) {
            handleRequestClose();
          }
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          pinchRef.current = null;
          dragStartRef.current = null;
          touchStartX.current = null;
          setIsInteracting(false);
        }}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous photograph"
            className="fixed left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 hover:bg-black/80 sm:left-6"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        )}

        {!activeReady && (
          <div
            role="status"
            aria-label="Loading full-resolution image"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B1A2E]/85 text-white ring-1 ring-white/20">
              <Loader2
                className="h-5 w-5 animate-spin text-[#64B5F6]"
                aria-hidden="true"
              />
            </span>
          </div>
        )}

        <div
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            if (zoomScale > 1.02) {
              resetTransform();
            } else {
              setZoomScale(2);
            }
          }}
          className={`flex max-h-full max-w-4xl items-center justify-center transition-transform ${
            isInteracting ? 'duration-0' : 'duration-150'
          } ${zoomScale > 1.02 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
          style={{
            transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${
              isEntered && !isClosing ? zoomScale : zoomScale * 0.96
            })`,
            transformOrigin: 'center center',
          }}
        >
          <div className="max-h-[68vh] max-w-full overflow-hidden rounded-xl bg-[#0B1A2E]">
            <FirestoreImage
              key={slideKey}
              imageId={activeItem.directSrc ? null : activeItem.imageId}
              fallbackUrl={activeItem.fallbackUrl}
              directSrc={activeItem.directSrc}
              alt={
                activeItem.caption ||
                postCaption ||
                `Photograph ${currentIndex + 1}`
              }
              eager
              onImageLoaded={() => setReadySlideKey(slideKey)}
              className="max-h-[68vh] w-auto max-w-full object-contain"
              placeholderClassName="bg-[#0B1A2E] min-h-[220px] min-w-[220px]"
            />
          </div>
        </div>

        {count > 1 && (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next photograph"
            className="fixed right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 hover:bg-black/80 sm:right-6"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Multi-Image Thumbnail Strip for Quick Touch & Desktop Navigation */}
      {count > 1 && (
        <div className="border-t border-white/10 bg-[#0B1A2E]/90 px-4 py-2.5">
          <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 overflow-x-auto">
            {items.map((thumb, idx) => (
              <button
                key={`${thumb.imageId}-${idx}`}
                type="button"
                onClick={() => {
                  resetTransform();
                  setCurrentIndex(idx);
                }}
                aria-label={`View photograph ${idx + 1} of ${count}`}
                aria-current={idx === currentIndex ? 'true' : undefined}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                  idx === currentIndex
                    ? 'scale-105 border-[#1E88E5] ring-2 ring-[#1E88E5]/40'
                    : 'border-white/20 opacity-65 hover:opacity-100'
                }`}
              >
                <FirestoreImage
                  imageId={thumb.directSrc ? null : thumb.imageId}
                  fallbackUrl={thumb.fallbackUrl}
                  directSrc={thumb.directSrc}
                  alt={`Thumbnail ${idx + 1}`}
                  eager
                  className="h-full w-full object-cover"
                  placeholderClassName="bg-[#0B1A2E]"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Optional Per-Photo Caption (when present) */}
      {activeItem.caption && (
        <div className="border-t border-white/10 bg-[#0B1A2E]/90 px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-semibold text-white">
              <span className="text-[#64B5F6]">
                Photo {currentIndex + 1}:
              </span>{' '}
              {activeItem.caption}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};


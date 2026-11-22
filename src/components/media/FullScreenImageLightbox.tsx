import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { prefetchMediaImages } from '../../services/mediaStorage';
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
  const [zoomScale, setZoomScale] = useState<number>(1);
  const touchStartX = useRef<number | null>(null);
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  useEffect(() => {
    onIndexChangeRef.current?.(currentIndex);
  }, [currentIndex]);

  const count = items.length;
  const activeItem = items[currentIndex];

  const handlePrev = () => {
    setZoomScale(1);
    setCurrentIndex((prev) => (prev - 1 + count) % count);
  };

  const handleNext = () => {
    setZoomScale(1);
    setCurrentIndex((prev) => (prev + 1) % count);
  };

  const handleZoomIn = () => {
    setZoomScale((prev) => Math.min(3, Number((prev + 0.5).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoomScale((prev) => Math.max(1, Number((prev - 0.5).toFixed(2))));
  };

  // Preserve exact underlying scroll position cleanly on mobile & desktop
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Prewarm adjacent gallery images cleanly when switching slides
  useEffect(() => {
    if (count <= 1) return;
    const prevIdx = (currentIndex - 1 + count) % count;
    const nextIdx = (currentIndex + 1) % count;
    const candidateIds = [items[prevIdx], items[nextIdx]]
      .filter((item) => item && !item.directSrc && item.imageId)
      .map((item) => item.imageId);
    if (candidateIds.length > 0) {
      void prefetchMediaImages(candidateIds);
    }
  }, [currentIndex, count, items]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft' && count > 1) {
        setZoomScale(1);
        setCurrentIndex((prev) => (prev - 1 + count) % count);
      } else if (event.key === 'ArrowRight' && count > 1) {
        setZoomScale(1);
        setCurrentIndex((prev) => (prev + 1) % count);
      } else if (event.key === '+' || event.key === '=') {
        setZoomScale((prev) => Math.min(3, Number((prev + 0.5).toFixed(2))));
      } else if (event.key === '-') {
        setZoomScale((prev) => Math.max(1, Number((prev - 0.5).toFixed(2))));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [count, onClose]);

  if (!activeItem) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen image viewer"
      className="fixed inset-0 z-50 flex flex-col bg-[#060F1C]/95 text-white backdrop-blur-sm"
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
            disabled={zoomScale <= 1}
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
            disabled={zoomScale >= 3}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-40 sm:h-[42px] sm:w-[42px]"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
          {zoomScale > 1 && (
            <button
              type="button"
              onClick={() => setZoomScale(1)}
              aria-label="Reset zoom"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 sm:h-[42px] sm:w-[42px]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
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

      {/* Main Viewport */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-auto p-4 sm:p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null || count <= 1 || zoomScale > 1) {
            touchStartX.current = null;
            return;
          }
          const delta =
            (e.changedTouches[0]?.clientX ?? touchStartX.current) -
            touchStartX.current;
          touchStartX.current = null;
          if (delta > 50) handlePrev();
          else if (delta < -50) handleNext();
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

        <div
          onClick={() =>
            setZoomScale((prev) => (prev === 1 ? 2 : 1))
          }
          className={`flex max-h-full max-w-4xl items-center justify-center transition-transform duration-200 ${
            zoomScale > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'
          }`}
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: 'center center',
          }}
        >
          <div className="max-h-[68vh] max-w-full overflow-hidden rounded-xl bg-[#0B1A2E]">
            <FirestoreImage
              imageId={activeItem.directSrc ? null : activeItem.imageId}
              fallbackUrl={activeItem.fallbackUrl}
              directSrc={activeItem.directSrc}
              alt={
                activeItem.caption ||
                postCaption ||
                `Photograph ${currentIndex + 1}`
              }
              eager
              className="max-h-[68vh] w-auto max-w-full object-contain"
              placeholderClassName="bg-[#0B1A2E] min-h-[240px] min-w-[240px]"
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
                  setZoomScale(1);
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

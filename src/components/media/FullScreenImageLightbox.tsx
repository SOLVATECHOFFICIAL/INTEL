import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { FirestoreImage } from './FirestoreImage';

interface FullScreenImageLightboxProps {
  items: GridPhotoItem[];
  initialIndex: number;
  postCaption?: string;
  postTitle?: string;
  onClose: () => void;
}

export const FullScreenImageLightbox: React.FC<
  FullScreenImageLightboxProps
> = ({ items, initialIndex, postCaption, postTitle, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
  );
  const [zoomScale, setZoomScale] = useState<number>(1);
  const touchStartX = useRef<number | null>(null);

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
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 text-xs font-semibold text-slate-200 sm:text-sm">
          <span className="tabular-nums">
            {currentIndex + 1} / {count}
          </span>
          {postTitle && (
            <>
              <span aria-hidden="true" className="text-slate-500">
                ·
              </span>
              <span className="max-w-[200px] truncate sm:max-w-md">
                {postTitle}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoomScale <= 1}
            aria-label="Zoom out"
            className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[48px] text-center text-xs font-semibold text-slate-200 tabular-nums">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoomScale >= 3}
            aria-label="Zoom in"
            className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
          {zoomScale > 1 && (
            <button
              type="button"
              onClick={() => setZoomScale(1)}
              aria-label="Reset zoom"
              className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg text-slate-200 hover:bg-white/10"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image viewer"
            className="ml-1 flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
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

      {/* Optional Per-Photo Caption (Anonymous Posts Only) */}
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

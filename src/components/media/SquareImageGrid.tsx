import React from 'react';
import { Trash2 } from 'lucide-react';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { FirestoreImage } from './FirestoreImage';

interface SquareImageGridProps {
  items: GridPhotoItem[];
  postLabel: string;
  onImageClick: (index: number) => void;
  onRemoveImage?: (imageId: string) => void;
  showPerPhotoCaptions?: boolean;
}

export const SquareImageGrid: React.FC<SquareImageGridProps> = ({
  items,
  postLabel,
  onImageClick,
  onRemoveImage,
  showPerPhotoCaptions = true,
}) => {
  const photos = items.slice(0, 4);
  const count = photos.length;
  if (count === 0) return null;

  const gridContainerClass =
    count === 1
      ? 'grid grid-cols-1 max-w-xl'
      : count === 2
      ? 'grid grid-cols-2 gap-1.5'
      : count === 3
      ? 'grid grid-cols-3 grid-rows-2 gap-1.5'
      : 'grid grid-cols-2 gap-1.5';

  return (
    <div
      className={`${gridContainerClass} overflow-hidden rounded-xl`}
      data-testid={`square-image-grid-${count}`}
    >
      {photos.map((photo, index) => {
        const spanClass =
          count === 3 && index === 0 ? 'col-span-2 row-span-2' : '';
        const visibleCaption = showPerPhotoCaptions ? photo.caption : undefined;

        return (
          <div
            key={photo.imageId}
            className={`group relative aspect-square w-full overflow-hidden rounded-lg bg-[#0B1A2E] ${spanClass}`}
          >
            <button
              type="button"
              onClick={() => onImageClick(index)}
              aria-label={`View ${postLabel} photograph ${index + 1} of ${count}${
                visibleCaption ? `: ${visibleCaption}` : ''
              }`}
              className="block h-full w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-[#1E88E5]"
            >
              <FirestoreImage
                imageId={photo.directSrc ? null : photo.imageId}
                directSrc={photo.directSrc}
                alt={
                  visibleCaption
                    ? visibleCaption
                    : `${postLabel} photograph ${index + 1}`
                }
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                placeholderClassName="bg-[#0B1A2E]"
              />
            </button>

            {visibleCaption && (
              <div className="pointer-events-none absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pt-5 pb-2">
                <p className="truncate text-[11px] font-medium text-white">
                  {visibleCaption}
                </p>
              </div>
            )}

            {onRemoveImage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveImage(photo.imageId);
                }}
                aria-label={`Delete photograph ${index + 1}`}
                title="Delete photograph"
                className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

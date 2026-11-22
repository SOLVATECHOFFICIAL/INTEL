import type { PostMediaMeta } from '../types/database';

export interface GridPhotoItem {
  imageId: string;
  caption?: string;
  directSrc?: string;
}

export function mediaMetaToGridItems(
  mediaItems?: PostMediaMeta[]
): GridPhotoItem[] {
  if (!mediaItems || mediaItems.length === 0) return [];
  return [...mediaItems]
    .sort((a, b) => a.order - b.order)
    .slice(0, 4)
    .map((item) => ({
      imageId: item.imageId,
      caption: item.caption,
    }));
}

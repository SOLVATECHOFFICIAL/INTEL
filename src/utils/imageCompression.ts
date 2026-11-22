import {
  BLUEPRINT_LIMITS,
  type SupportedImageMimeType,
} from '../types/database';
import { computeFileSelectionFingerprint } from './mediaCache';

export type ImageCompressionPreset = 'avatar' | 'cover' | 'post' | 'marketplace';

export interface CompressedImageResult {
  base64Data: string;
  dataUrl: string;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteSize: number;
  originalBytes: number;
  fingerprint?: string;
}

const PRESET_MAX_DIMENSION: Record<ImageCompressionPreset, number> = {
  avatar: 640,
  cover: 1440,
  post: 1280,
  marketplace: 1280,
};

// Target high crispness without exceeding Firestore per-document ceilings
const PRESET_TARGET_BYTES: Record<ImageCompressionPreset, number> = {
  avatar: 120 * 1024,
  cover: 155 * 1024,
  post: 145 * 1024,
  marketplace: 155 * 1024,
};

const MAX_RAW_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB safety guard before decoding

export function validateImageFileCandidate(candidate: {
  type?: string;
  size?: number;
  name?: string;
}): string | null {
  const mime = (candidate.type ?? '').toLowerCase();
  const name = (candidate.name ?? '').toLowerCase();

  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|3gp)$/i.test(name)) {
    return 'Video uploads are not supported yet. Please select a photograph.';
  }

  const looksLikeImageByMime = mime.startsWith('image/');
  const looksLikeImageByExtension = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(
    name
  );

  if (!looksLikeImageByMime && !looksLikeImageByExtension) {
    return 'Please select a valid image file from your gallery or camera.';
  }

  if (typeof candidate.size === 'number') {
    if (candidate.size <= 0) {
      return 'The selected image file is empty.';
    }
    if (candidate.size > MAX_RAW_INPUT_BYTES) {
      return 'Selected image is too large to process (max 25 MB source file).';
    }
  }

  return null;
}

export function validatePostImageCountAfterAdd(
  existingCount: number,
  incomingCount: number
): string | null {
  if (incomingCount < 0 || existingCount < 0) {
    return 'Invalid image selection count.';
  }
  if (existingCount + incomingCount > BLUEPRINT_LIMITS.mediaPostMaxCount) {
    return `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`;
  }
  return null;
}

export function estimateBase64DecodedBytes(base64Data: string): number {
  const cleaned = base64Data.replace(/[\r\n\s]/g, '');
  if (!cleaned) return 0;
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

export function buildMediaDataUrl(
  mimeType: SupportedImageMimeType,
  base64Data: string
): string {
  return `data:${mimeType};base64,${base64Data}`;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function computeTargetDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxDimension: number
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(naturalWidth));
  const safeH = Math.max(1, Math.round(naturalHeight));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxDimension) {
    return { width: safeW, height: safeH };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

function detectWebpEncodingSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const dataUrl = canvas.toDataURL('image/webp', 0.8);
    return dataUrl.startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function decodeImageSource(
  file: File
): Promise<{
  width: number;
  height: number;
  drawToCanvas: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      return {
        width: bitmap.width,
        height: bitmap.height,
        drawToCanvas: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall back to standard HTMLImageElement below
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        drawToCanvas: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          'Unable to decode that photograph. Try selecting another JPEG, PNG, or WebP image.'
        )
      );
    };
    img.src = objectUrl;
  });
}

function encodeCanvasSync(
  canvas: HTMLCanvasElement,
  mimeType: SupportedImageMimeType,
  quality: number
): { base64Data: string; dataUrl: string; byteSize: number } {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Browser canvas failed to export compressed image data.');
  }
  const base64Data = dataUrl.slice(prefix.length);
  return {
    base64Data,
    dataUrl,
    byteSize: estimateBase64DecodedBytes(base64Data),
  };
}

/**
 * Compresses any gallery/camera photograph on the client while preserving clarity:
 * - Preserves aspect ratio & camera EXIF orientation cleanly
 * - Draws onto a fresh canvas (stripping all EXIF/GPS/filename metadata)
 * - Encodes as WebP (JPEG fallback) starting at high visual quality (0.86)
 * - Balances clarity, data efficiency, and Firestore safety ceilings (<250 KB / <280k Base64 chars)
 */
export async function compressImageFile(
  file: File,
  preset: ImageCompressionPreset = 'post'
): Promise<CompressedImageResult> {
  const candidateError = validateImageFileCandidate(file);
  if (candidateError) {
    throw new Error(candidateError);
  }

  const fingerprint = computeFileSelectionFingerprint(file);
  const decoded = await decodeImageSource(file);
  try {
    const mimeType: SupportedImageMimeType = detectWebpEncodingSupport()
      ? 'image/webp'
      : 'image/jpeg';

    const maxInitialDim = PRESET_MAX_DIMENSION[preset];
    const targetByteCeiling = PRESET_TARGET_BYTES[preset];
    const currentDims = computeTargetDimensions(
      decoded.width,
      decoded.height,
      maxInitialDim
    );

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D graphics context is unavailable on this device.');
    }

    const scaleSteps = [1, 0.85, 0.7, 0.56];
    const qualitySteps = [0.86, 0.8, 0.74, 0.66, 0.56, 0.45];

    let bestAttempt: {
      base64Data: string;
      dataUrl: string;
      byteSize: number;
      width: number;
      height: number;
    } | null = null;

    for (const scale of scaleSteps) {
      const targetW = Math.max(1, Math.round(currentDims.width * scale));
      const targetH = Math.max(1, Math.round(currentDims.height * scale));
      canvas.width = targetW;
      canvas.height = targetH;

      // High-quality resampling + opaque backdrop for transparent PNGs
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      decoded.drawToCanvas(ctx, targetW, targetH);

      for (const quality of qualitySteps) {
        const encoded = encodeCanvasSync(canvas, mimeType, quality);
        if (!bestAttempt || encoded.byteSize < bestAttempt.byteSize) {
          bestAttempt = {
            ...encoded,
            width: targetW,
            height: targetH,
          };
        }

        if (
          encoded.byteSize <= targetByteCeiling &&
          encoded.byteSize <= BLUEPRINT_LIMITS.mediaMaxBytes &&
          encoded.base64Data.length <= BLUEPRINT_LIMITS.mediaBase64MaxChars
        ) {
          return {
            base64Data: encoded.base64Data,
            dataUrl: encoded.dataUrl,
            mimeType,
            width: targetW,
            height: targetH,
            byteSize: encoded.byteSize,
            originalBytes: file.size,
            fingerprint,
          };
        }
      }
    }

    if (
      bestAttempt &&
      bestAttempt.byteSize <= BLUEPRINT_LIMITS.mediaMaxBytes &&
      bestAttempt.base64Data.length <= BLUEPRINT_LIMITS.mediaBase64MaxChars
    ) {
      return {
        base64Data: bestAttempt.base64Data,
        dataUrl: bestAttempt.dataUrl,
        mimeType,
        width: bestAttempt.width,
        height: bestAttempt.height,
        byteSize: bestAttempt.byteSize,
        originalBytes: file.size,
        fingerprint,
      };
    }

    throw new Error(
      'Unable to optimise this photograph below safe upload limits. Please select a clearer or smaller image.'
    );
  } finally {
    decoded.cleanup();
  }
}

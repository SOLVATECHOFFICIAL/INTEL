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

/**
 * Broad `<input type="file" accept=...>` string so phones, tablets, and desktops
 * let members & admins pick any photo format (JPEG, PNG, WebP, HEIC/HEIF, AVIF,
 * GIF, BMP, TIFF, SVG, ICO, JFIF, camera RAW previews, etc.).
 */
export const ALL_IMAGE_FILE_ACCEPT =
  'image/*,.jpg,.jpeg,.jfif,.pjpeg,.pjp,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.svg,.ico,.cur,.tif,.tiff,.dng,.cr2,.nef,.arw';

const PRESET_MAX_DIMENSION: Record<ImageCompressionPreset, number> = {
  avatar: 480,
  cover: 1200,
  post: 1080,
  marketplace: 1080,
};

// Compact, fast-loading targets safely inside Firestore document ceilings (<250 KB)
const PRESET_TARGET_BYTES: Record<ImageCompressionPreset, number> = {
  avatar: 55 * 1024,
  cover: 90 * 1024,
  post: 80 * 1024,
  marketplace: 85 * 1024,
};

const MAX_RAW_INPUT_BYTES = 40 * 1024 * 1024; // 40 MB safety guard before client downscaling

const DISALLOWED_NON_IMAGE_EXT_RE =
  /\.(mp4|mov|webm|mkv|avi|3gp|m4v|flv|wmv|mp3|wav|ogg|m4a|aac|flac|opus|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|txt|csv|json|xml|html?|js|ts|apk|exe|dmg|iso)$/i;

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|3gp|m4v|flv|wmv)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;
const IMAGE_EXT_RE =
  /\.(jpe?g|jfif|pjpeg|pjp|png|webp|gif|bmp|avif|heic|heif|svg|ico|cur|tiff?|dng|cr2|nef|arw|orf|rw2)$/i;

export function validateImageFileCandidate(candidate: {
  type?: string;
  size?: number;
  name?: string;
}): string | null {
  const mime = (candidate.type ?? '').trim().toLowerCase();
  const name = (candidate.name ?? '').trim().toLowerCase();

  if (mime.startsWith('video/') || VIDEO_EXT_RE.test(name)) {
    return 'Video uploads are not supported yet. Please select a photograph.';
  }

  if (mime.startsWith('audio/') || AUDIO_EXT_RE.test(name)) {
    return 'Audio files cannot be uploaded as photographs. Please select an image.';
  }

  const isExplicitNonImageMime =
    mime.length > 0 &&
    !mime.startsWith('image/') &&
    mime !== 'application/octet-stream' &&
    mime !== 'binary/octet-stream';

  const isExplicitNonImageExt = DISALLOWED_NON_IMAGE_EXT_RE.test(name);

  if (isExplicitNonImageMime || (isExplicitNonImageExt && !mime.startsWith('image/'))) {
    return 'Please select a valid image file from your gallery or camera.';
  }

  // Allow any image/* MIME, any image extension, or extensionless/generic picker blobs
  // (common on Android/iOS galleries) which decodeImageSource will verify safely.
  const looksAcceptable =
    mime.startsWith('image/') ||
    IMAGE_EXT_RE.test(name) ||
    mime === '' ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream';

  if (!looksAcceptable) {
    return 'Please select a valid image file from your gallery or camera.';
  }

  if (typeof candidate.size === 'number') {
    if (candidate.size <= 0) {
      return 'The selected image file is empty.';
    }
    if (candidate.size > MAX_RAW_INPUT_BYTES) {
      return 'Selected image is too large to process (max 40 MB source file).';
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

interface DecodedImageSource {
  width: number;
  height: number;
  drawToCanvas: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}

function loadHtmlImageFromUrl(
  src: string,
  revokeOnCleanup = false
): Promise<DecodedImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width || 1080;
      const h = img.naturalHeight || img.height || 1080;
      resolve({
        width: w,
        height: h,
        drawToCanvas: (ctx, targetW, targetH) =>
          ctx.drawImage(img, 0, 0, targetW, targetH),
        cleanup: () => {
          if (revokeOnCleanup) {
            URL.revokeObjectURL(src);
          }
        },
      });
    };
    img.onerror = () => {
      if (revokeOnCleanup) {
        URL.revokeObjectURL(src);
      }
      reject(new Error('Image decode failed.'));
    };
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file as Data URL.'));
      }
    };
    reader.onerror = () => reject(new Error('File read error.'));
    reader.readAsDataURL(file);
  });
}

async function decodeSvgFallback(file: File): Promise<DecodedImageSource> {
  const rawSvg = await file.text();
  if (!/<svg[\s>]/i.test(rawSvg)) {
    throw new Error('Not a valid SVG document.');
  }
  const normalizedSvg = /width\s*=|height\s*=/i.test(rawSvg)
    ? rawSvg
    : rawSvg.replace(/<svg\b/i, '<svg width="1080" height="1080"');
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizedSvg)}`;
  return loadHtmlImageFromUrl(encoded, false);
}

async function decodeImageSource(file: File): Promise<DecodedImageSource> {
  const mime = (file.type ?? '').toLowerCase();
  const name = (file.name ?? '').toLowerCase();
  const isSvg = mime === 'image/svg+xml' || /\.svg$/i.test(name);

  if (typeof createImageBitmap === 'function' && !isSvg) {
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
      try {
        const bitmap = await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          drawToCanvas: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
          cleanup: () => bitmap.close(),
        };
      } catch {
        // Fall through to Image / FileReader / SVG decoders
      }
    }
  }

  if (isSvg) {
    try {
      return await decodeSvgFallback(file);
    } catch {
      // Fall through to object URL / Data URL attempt
    }
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    return await loadHtmlImageFromUrl(objectUrl, true);
  } catch {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return await loadHtmlImageFromUrl(dataUrl, false);
    } catch {
      throw new Error(
        'This file format could not be decoded on your device browser. If it is a camera RAW/HEIC file not natively supported by this browser, convert or screenshot it and try again.'
      );
    }
  }
}

function encodeCanvasSync(
  canvas: HTMLCanvasElement,
  mimeType: SupportedImageMimeType,
  quality: number
): {
  base64Data: string;
  dataUrl: string;
  byteSize: number;
  mimeType: SupportedImageMimeType;
} {
  let activeMime: SupportedImageMimeType = mimeType;
  let dataUrl = canvas.toDataURL(activeMime, quality);
  let prefix = `data:${activeMime};base64,`;
  if (!dataUrl.startsWith(prefix) && activeMime === 'image/webp') {
    activeMime = 'image/jpeg';
    dataUrl = canvas.toDataURL(activeMime, quality);
    prefix = `data:${activeMime};base64,`;
  }
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Browser canvas failed to export compressed image data.');
  }
  const base64Data = dataUrl.slice(prefix.length);
  return {
    base64Data,
    dataUrl,
    byteSize: estimateBase64DecodedBytes(base64Data),
    mimeType: activeMime,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/**
 * Compresses any gallery/camera photograph on the client cleanly & rapidly:
 * - Accepts any browser-decodable photo format (JPEG, PNG, WebP, GIF, AVIF, BMP, SVG, HEIC/HEIF where supported)
 * - Strips all EXIF/GPS/filename metadata by rasterizing onto a fresh 2D canvas
 * - Targets compact WebP/JPEG payloads (55–90 KB) so feed & profile images load fast
 * - Guarantees compliance with Firestore safety ceilings (<250 KB / <280k Base64 chars)
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
    const preferredMime: SupportedImageMimeType = detectWebpEncodingSupport()
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

    const scaleSteps = [1, 0.78, 0.6, 0.45];
    const qualitySteps = [0.78, 0.66, 0.54, 0.42];

    let bestAttempt: {
      base64Data: string;
      dataUrl: string;
      byteSize: number;
      mimeType: SupportedImageMimeType;
      width: number;
      height: number;
    } | null = null;

    for (let sIdx = 0; sIdx < scaleSteps.length; sIdx += 1) {
      if (sIdx > 0 && typeof window !== 'undefined') {
        await yieldToMainThread();
      }
      const scale = scaleSteps[sIdx];
      const targetW = Math.max(1, Math.round(currentDims.width * scale));
      const targetH = Math.max(1, Math.round(currentDims.height * scale));
      canvas.width = targetW;
      canvas.height = targetH;

      // High-quality resampling + opaque backdrop for transparent PNGs/SVGs
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      decoded.drawToCanvas(ctx, targetW, targetH);

      for (const quality of qualitySteps) {
        const encoded = encodeCanvasSync(canvas, preferredMime, quality);
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
            mimeType: encoded.mimeType,
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
        mimeType: bestAttempt.mimeType,
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

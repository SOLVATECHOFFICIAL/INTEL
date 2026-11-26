import {
  BLUEPRINT_LIMITS,
  isSupportedImageMimeType,
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
  'image/*,.jpg,.jpeg,.jfif,.pjpeg,.pjp,.png,.apng,.webp,.gif,.bmp,.avif,.heic,.heif,.svg,.ico,.cur,.tif,.tiff,.dng,.cr2,.nef,.arw';

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
  /\.(jpe?g|jfif|pjpeg|pjp|a?png|webp|gif|bmp|avif|heic|heif|svg|ico|cur|tiff?|dng|cr2|nef|arw|orf|rw2)$/i;

export function inferSupportedImageMimeType(candidate: {
  type?: string;
  name?: string;
}): SupportedImageMimeType | null {
  const rawMime = (candidate.type ?? '').trim().toLowerCase();
  if (rawMime === 'image/jpg' || rawMime === 'image/pjpeg') {
    return 'image/jpeg';
  }
  if (rawMime === 'image/apng' || rawMime === 'image/x-png') {
    return 'image/png';
  }
  if (rawMime === 'image/x-ms-bmp') {
    return 'image/bmp';
  }
  if (rawMime === 'image/svg') {
    return 'image/svg+xml';
  }
  if (rawMime === 'image/ico') {
    return 'image/x-icon';
  }
  if (rawMime === 'image/heic-sequence') {
    return 'image/heic';
  }
  if (rawMime === 'image/heif-sequence') {
    return 'image/heif';
  }
  if (isSupportedImageMimeType(rawMime)) {
    return rawMime;
  }

  const name = (candidate.name ?? '').trim().toLowerCase();
  if (/\.(jpe?g|jfif|pjpeg|pjp)$/i.test(name)) return 'image/jpeg';
  if (/\.(png|apng)$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.avif$/i.test(name)) return 'image/avif';
  if (/\.bmp$/i.test(name)) return 'image/bmp';
  if (/\.tiff?$/i.test(name)) return 'image/tiff';
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.ico$/i.test(name) || /\.cur$/i.test(name)) return 'image/x-icon';
  if (/\.heic$/i.test(name)) return 'image/heic';
  if (/\.heif$/i.test(name)) return 'image/heif';
  return null;
}

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

let cachedWebpSupport: boolean | null = null;

function detectWebpEncodingSupport(): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const dataUrl = canvas.toDataURL('image/webp', 0.8);
    cachedWebpSupport = dataUrl.startsWith('data:image/webp');
    return cachedWebpSupport;
  } catch {
    cachedWebpSupport = false;
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
  const rootOpenMatch = rawSvg.match(/<svg\b[^>]*>/i);
  if (!rootOpenMatch) {
    throw new Error('Not a valid SVG document.');
  }
  const hasRootDimensions = /\b(?:width|height)\s*=/i.test(rootOpenMatch[0]);
  const normalizedSvg = hasRootDimensions
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
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          drawToCanvas: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
          cleanup: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            width: bitmap.width,
            height: bitmap.height,
            drawToCanvas: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
            cleanup: () => bitmap.close(),
          };
        }
        bitmap.close();
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
        'This file format could not be decoded on your device browser. If it is a large camera RAW/HEIC file, convert or screenshot it and try again.'
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
  if (!dataUrl.startsWith(prefix) && activeMime !== 'image/png') {
    activeMime = 'image/png';
    dataUrl = canvas.toDataURL(activeMime);
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

async function tryDirectImagePassthrough(
  file: File,
  fingerprint: string,
  preset: ImageCompressionPreset
): Promise<CompressedImageResult | null> {
  if (file.size <= 0 || file.size > BLUEPRINT_LIMITS.mediaMaxBytes) {
    return null;
  }
  const resolvedMime = inferSupportedImageMimeType(file);
  if (!resolvedMime) {
    return null;
  }
  if (resolvedMime === 'image/svg+xml') {
    const rawSvg = await file.text().catch(() => '');
    if (
      !rawSvg ||
      /<script\b|<foreignObject\b|\bon[a-z]+\s*=|javascript:/i.test(rawSvg)
    ) {
      return null;
    }
  }
  const rawDataUrl = await readFileAsDataUrl(file).catch(() => '');
  const commaIndex = rawDataUrl.indexOf(',');
  if (commaIndex === -1) return null;
  const header = rawDataUrl.slice(0, commaIndex).toLowerCase();
  if (!header.includes(';base64')) return null;
  const base64Data = rawDataUrl.slice(commaIndex + 1).replace(/[\r\n\s]/g, '');
  if (
    base64Data.length < BLUEPRINT_LIMITS.mediaBase64MinChars ||
    base64Data.length > BLUEPRINT_LIMITS.mediaBase64MaxChars
  ) {
    return null;
  }
  const byteSize = estimateBase64DecodedBytes(base64Data);
  if (byteSize < 1 || byteSize > BLUEPRINT_LIMITS.mediaMaxBytes) {
    return null;
  }
  const defaultDim = preset === 'avatar' ? 480 : 1080;
  return {
    base64Data,
    dataUrl: buildMediaDataUrl(resolvedMime, base64Data),
    mimeType: resolvedMime,
    width: defaultDim,
    height: defaultDim,
    byteSize,
    originalBytes: file.size,
    fingerprint,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/**
 * Compresses any gallery/camera photograph on the client cleanly & rapidly:
 * - Accepts any image format (JPEG, PNG, WebP, GIF, AVIF, BMP, TIFF, SVG, ICO, HEIC/HEIF)
 * - Strips all EXIF/GPS/filename metadata by rasterizing onto a fresh 2D canvas
 * - Falls back safely to validated direct passthrough for animated GIFs or valid small files (<250 KB)
 * - Guarantees compliance with Firestore safety ceilings (<250 KB / <340k Base64 chars)
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
  const inferredMime = inferSupportedImageMimeType(file);
  if (inferredMime === 'image/gif' && file.size <= BLUEPRINT_LIMITS.mediaMaxBytes) {
    const gifPassthrough = await tryDirectImagePassthrough(file, fingerprint, preset);
    if (gifPassthrough) {
      return gifPassthrough;
    }
  }

  let decoded: DecodedImageSource;
  try {
    decoded = await decodeImageSource(file);
  } catch (decodeErr) {
    const passthrough = await tryDirectImagePassthrough(file, fingerprint, preset);
    if (passthrough) {
      return passthrough;
    }
    throw decodeErr;
  }
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

    const scaleSteps = [1, 0.72, 0.5, 0.34, 0.22, 0.14];
    const minQuality = 0.24;
    const maxQuality = 0.8;

    const fitsBudget = (encoded: { byteSize: number; base64Data: string }) =>
      encoded.byteSize <= targetByteCeiling &&
      encoded.byteSize <= BLUEPRINT_LIMITS.mediaMaxBytes &&
      encoded.base64Data.length <= BLUEPRINT_LIMITS.mediaBase64MaxChars;

    type BestAttempt = {
      base64Data: string;
      dataUrl: string;
      byteSize: number;
      mimeType: SupportedImageMimeType;
      width: number;
      height: number;
    };
    let bestAttempt: BestAttempt | null = null;

    const pickSmallerAttempt = (
      currentBest: BestAttempt | null,
      encoded: ReturnType<typeof encodeCanvasSync>,
      width: number,
      height: number
    ): BestAttempt => {
      if (!currentBest || encoded.byteSize < currentBest.byteSize) {
        return {
          ...encoded,
          width,
          height,
        };
      }
      return currentBest;
    };

    const toCompressedResult = (
      encoded: ReturnType<typeof encodeCanvasSync>,
      width: number,
      height: number
    ): CompressedImageResult => ({
      base64Data: encoded.base64Data,
      dataUrl: encoded.dataUrl,
      mimeType: encoded.mimeType,
      width,
      height,
      byteSize: encoded.byteSize,
      originalBytes: file.size,
      fingerprint,
    });

    for (let sIdx = 0; sIdx < scaleSteps.length; sIdx += 1) {
      if (sIdx > 0 && typeof window !== 'undefined') {
        await yieldToMainThread();
      }
      const scale = scaleSteps[sIdx];
      const targetW = Math.max(1, Math.round(currentDims.width * scale));
      const targetH = Math.max(1, Math.round(currentDims.height * scale));
      canvas.width = targetW;
      canvas.height = targetH;

      // Fast resampling + opaque backdrop for transparent PNGs/SVGs
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      decoded.drawToCanvas(ctx, targetW, targetH);

      const highEncoded = encodeCanvasSync(canvas, preferredMime, maxQuality);
      bestAttempt = pickSmallerAttempt(bestAttempt, highEncoded, targetW, targetH);
      if (fitsBudget(highEncoded)) {
        return toCompressedResult(highEncoded, targetW, targetH);
      }

      const lowEncoded = encodeCanvasSync(canvas, preferredMime, minQuality);
      bestAttempt = pickSmallerAttempt(bestAttempt, lowEncoded, targetW, targetH);
      if (!fitsBudget(lowEncoded)) {
        continue;
      }

      // Binary search for highest quality that satisfies target byte ceiling
      let bestPassing = lowEncoded;
      let lo = minQuality;
      let hi = maxQuality;
      for (let step = 0; step < 3; step += 1) {
        const mid = Number(((lo + hi) / 2).toFixed(2));
        if (mid <= lo || mid >= hi) break;
        const candidate = encodeCanvasSync(canvas, preferredMime, mid);
        bestAttempt = pickSmallerAttempt(bestAttempt, candidate, targetW, targetH);
        if (fitsBudget(candidate)) {
          bestPassing = candidate;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return toCompressedResult(bestPassing, targetW, targetH);
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

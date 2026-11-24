import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ImagePlus,
  Loader2,
  Megaphone,
  Palette,
  Pin,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  TEXT_POST_BACKGROUND_THEMES,
  getTextPostBackgroundTheme,
} from '../../config/anonymousBackgrounds';
import { auth } from '../../lib/firebase';
import {
  createOfficialUpdateWithMedia,
  updateOfficialUpdateWithMedia,
} from '../../services/adminUpdates';
import {
  fetchMediaImageDataUrl,
  generateFirestoreDocId,
  type UploadProgressState,
} from '../../services/mediaStorage';
import type { ComposerImageAttachment } from '../../services/socialPosts';
import {
  ALLOWED_ADMIN_UPDATE_CATEGORIES,
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  resolveAdminUpdateFormat,
  type AdminUpdate,
  type AdminUpdateFormat,
  type PublicProfileProjection,
  type TextPostBackgroundId,
  type UserRole,
} from '../../types/database';
import {
  formatFirestoreOrAppError,
  isUndergroundSupremeAdminUser,
} from '../../utils/authValidation';
import {
  compressImageFile,
  formatByteSize,
  validatePostImageCountAfterAdd,
} from '../../utils/imageCompression';
import {
  partitionDuplicateSelectedFiles,
  reorderArrayItem,
} from '../../utils/mediaCache';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { RoleBadge } from '../RoleBadge';
import { AvatarMedia } from '../media/FirestoreImage';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';

const CATEGORY_LABELS: Record<string, string> = {
  announcement: 'Announcement',
  academic: 'Academic',
  campus_life: 'Campus Life',
  security: 'Security Notice',
  urgent: 'Urgent',
};

export interface UpdateComposerModalProps {
  actorUid: string;
  actorRole: UserRole;
  actorName?: string;
  actorPhotoUrl?: string;
  actorPhotoImageId?: string;
  initialUpdate?: AdminUpdate | null;
  onSuccess: (
    update: AdminUpdate,
    author: PublicProfileProjection | null
  ) => void;
  onClose: () => void;
}

export const UpdateComposerModal: React.FC<UpdateComposerModalProps> = ({
  actorUid,
  actorRole,
  actorName,
  actorPhotoUrl,
  actorPhotoImageId,
  initialUpdate = null,
  onSuccess,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const replacingClientIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);

  const isEditing = Boolean(initialUpdate);
  const lockedFormat: AdminUpdateFormat | null = initialUpdate
    ? resolveAdminUpdateFormat(initialUpdate)
    : null;

  const isUndergroundActor = isUndergroundSupremeAdminUser(auth.currentUser);
  const effectiveAuthorMode = initialUpdate
    ? initialUpdate.authorMode
    : isUndergroundActor
    ? 'official_desk'
    : 'public_admin';

  const previewAuthorName =
    initialUpdate?.authorDisplayName ||
    (effectiveAuthorMode === 'official_desk'
      ? 'LASUED Intel Official'
      : actorName?.trim() || 'LASUED Intel Admin');
  const previewAuthorBadge: 'supreme_admin' | 'verified' =
    initialUpdate?.authorBadge ||
    (effectiveAuthorMode === 'official_desk' ? 'verified' : 'supreme_admin');

  const [format, setFormat] = useState<AdminUpdateFormat>(
    () => lockedFormat ?? 'photo'
  );
  const [category, setCategory] = useState<string>(
    initialUpdate?.category || ALLOWED_ADMIN_UPDATE_CATEGORIES[0]
  );
  const [title, setTitle] = useState<string>(initialUpdate?.title ?? '');
  const [body, setBody] = useState<string>(initialUpdate?.body ?? '');
  const [backgroundStyle, setBackgroundStyle] = useState<TextPostBackgroundId>(
    () =>
      initialUpdate?.backgroundStyle &&
      TEXT_POST_BACKGROUND_THEMES.some(
        (t) => t.id === initialUpdate.backgroundStyle
      )
        ? initialUpdate.backgroundStyle
        : TEXT_POST_BACKGROUND_THEMES[0].id
  );
  const [isPinned, setIsPinned] = useState<boolean>(
    Boolean(initialUpdate?.isPinned)
  );
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>(
    () =>
      (initialUpdate?.mediaItems ?? [])
        .slice(0, BLUEPRINT_LIMITS.mediaPostMaxCount)
        .map((meta) => ({
          clientId: meta.imageId,
          imageId: meta.imageId,
          caption: '',
          previewUrl: '',
          existingMeta: meta,
        }))
  );

  const [activeView, setActiveView] = useState<'compose' | 'preview'>('compose');
  const [compressingCount, setCompressingCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<UploadProgressState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Hydrate existing image previews when editing an existing photo update
  useEffect(() => {
    const missing = attachments.filter((a) => !a.previewUrl && a.existingMeta);
    if (missing.length === 0) return;
    let active = true;
    void Promise.all(
      missing.map(async (item) => {
        const url = await fetchMediaImageDataUrl(item.imageId).catch(
          () => null
        );
        return { imageId: item.imageId, url };
      })
    ).then((results) => {
      if (!active) return;
      const byId = new Map(
        results.filter((r) => r.url).map((r) => [r.imageId, r.url!])
      );
      if (byId.size === 0) return;
      setAttachments((prev) =>
        prev.map((item) =>
          !item.previewUrl && byId.has(item.imageId)
            ? { ...item, previewUrl: byId.get(item.imageId)! }
            : item
        )
      );
    });
    return () => {
      active = false;
    };
  }, [attachments]);

  const maxBodyLength =
    format === 'text'
      ? BLUEPRINT_LIMITS.textPostBodyMax
      : BLUEPRINT_LIMITS.photoPostCaptionMax;

  const activeTextTheme = getTextPostBackgroundTheme(backgroundStyle);

  const handleSelectPhotos = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0 || format !== 'photo') return;

    setErrorMessage(null);
    const existingFingerprints = new Set(
      attachments
        .map((att) => att.compressed?.fingerprint)
        .filter((fp): fp is string => Boolean(fp))
    );
    const { unique: uniqueFiles, duplicateCount: skippedCount } =
      partitionDuplicateSelectedFiles(files, existingFingerprints);

    if (uniqueFiles.length === 0) {
      setErrorMessage(
        skippedCount > 0
          ? 'Those photographs are already selected for this update.'
          : 'No valid photographs selected.'
      );
      return;
    }

    const countError = validatePostImageCountAfterAdd(
      attachments.length,
      uniqueFiles.length
    );
    if (countError) {
      setErrorMessage(countError);
      return;
    }

    setCompressingCount(uniqueFiles.length);
    try {
      const nextItems: ComposerImageAttachment[] = [];
      for (const file of uniqueFiles) {
        const compressed = await compressImageFile(file, 'post');
        const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
        nextItems.push({
          clientId: imageId,
          imageId,
          caption: '',
          compressed,
          previewUrl: compressed.dataUrl,
        });
      }
      setAttachments((prev) =>
        [...prev, ...nextItems].slice(0, BLUEPRINT_LIMITS.mediaPostMaxCount)
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not process selected photograph(s).'
      );
    } finally {
      setCompressingCount(0);
    }
  };

  const handleReplacePhoto = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const targetClientId = replacingClientIdRef.current;
    replacingClientIdRef.current = null;
    if (!file || !targetClientId || format !== 'photo') return;

    setErrorMessage(null);
    setCompressingCount(1);
    try {
      const compressed = await compressImageFile(file);
      const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
      setAttachments((prev) =>
        prev.map((att) =>
          att.clientId === targetClientId
            ? {
                clientId: imageId,
                imageId,
                caption: '',
                compressed,
                previewUrl: compressed.dataUrl,
                sourceSignature: `${file.name}:${file.size}:${file.lastModified}`,
              }
            : att
        )
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not replace the selected photograph.'
      );
    } finally {
      setCompressingCount(0);
    }
  };

  const handleRemovePhoto = (clientId: string) => {
    setAttachments((prev) => prev.filter((item) => item.clientId !== clientId));
  };

  const handleMovePhoto = (index: number, direction: -1 | 1) => {
    setAttachments((prev) => reorderArrayItem(prev, index, index + direction));
  };

  const previewGridItems: GridPhotoItem[] = attachments.map((att) => ({
    imageId: att.imageId,
    directSrc: att.previewUrl || undefined,
  }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting || compressingCount > 0) return;

    setErrorMessage(null);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMessage(
        'You are offline. Reconnect to publish this official update.'
      );
      return;
    }

    const cleanBody = body.trim();
    const cleanTitle = title.trim();

    if (cleanTitle.length > BLUEPRINT_LIMITS.postTitleMax) {
      setErrorMessage(
        `Headline must be ${BLUEPRINT_LIMITS.postTitleMax} characters or fewer.`
      );
      return;
    }

    if (format === 'photo') {
      if (attachments.length === 0) {
        setErrorMessage(
          'Photo Updates require at least 1 photograph (up to 4). Switch to Text Update if posting without photos.'
        );
        return;
      }
      if (cleanBody.length > BLUEPRINT_LIMITS.photoPostCaptionMax) {
        setErrorMessage(
          `Photo caption must be ${BLUEPRINT_LIMITS.photoPostCaptionMax} characters or fewer.`
        );
        return;
      }
    } else {
      if (!cleanBody) {
        setErrorMessage('Write the official update message before publishing.');
        return;
      }
      if (cleanBody.length > BLUEPRINT_LIMITS.textPostBodyMax) {
        setErrorMessage(
          `Text updates must be ${BLUEPRINT_LIMITS.textPostBodyMax} characters or fewer.`
        );
        return;
      }
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setUploadProgress({
      percent: 12,
      label: isEditing ? 'Validating update changes...' : 'Preparing update...',
    });

    try {
      if (isEditing && initialUpdate) {
        const updated = await updateOfficialUpdateWithMedia({
          update: initialUpdate,
          actorUid,
          actorRole,
          category,
          title: cleanTitle,
          body: cleanBody,
          backgroundStyle: format === 'text' ? backgroundStyle : undefined,
          attachments: format === 'photo' ? attachments : [],
          isPinned,
          onProgress: setUploadProgress,
        });
        onSuccess(updated, null);
      } else {
        const result = await createOfficialUpdateWithMedia({
          actorUid,
          actorRole,
          format,
          category,
          title: cleanTitle,
          body: cleanBody,
          backgroundStyle: format === 'text' ? backgroundStyle : undefined,
          attachments: format === 'photo' ? attachments : [],
          isPinned,
          onProgress: setUploadProgress,
        });
        onSuccess(result.update, result.author);
      }
    } catch (err) {
      setErrorMessage(
        formatFirestoreOrAppError(
          err,
          isEditing
            ? 'Could not save official update changes.'
            : 'Could not publish official update.'
        )
      );
      setUploadProgress(null);
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/65 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-composer-heading"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B1A2E] px-4 py-3.5 text-white sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1E88E5] text-white">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="update-composer-heading"
                className="truncate font-display text-sm font-bold sm:text-base"
              >
                {isEditing
                  ? 'Edit Official Update'
                  : 'Create Official Administrator Update'}
              </h2>
              <p className="truncate text-[11px] text-slate-300">
                {effectiveAuthorMode === 'official_desk'
                  ? 'Publishing anonymously as LASUED Intel Official'
                  : `Publishing as ${previewAuthorName}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close update composer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Compose / Live Preview Switcher */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-5">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setActiveView('compose')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeView === 'compose'
                  ? 'bg-[#0B1A2E] text-white'
                  : 'text-slate-600 hover:text-[#0B1A2E]'
              }`}
            >
              Compose
            </button>
            <button
              type="button"
              onClick={() => setActiveView('preview')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeView === 'preview'
                  ? 'bg-[#0B1A2E] text-white'
                  : 'text-slate-600 hover:text-[#0B1A2E]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Live Preview
            </button>
          </div>

          {effectiveAuthorMode === 'official_desk' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <ShieldCheck
                className="h-3.5 w-3.5 text-[#1E88E5]"
                aria-hidden="true"
              />
              Identity protected
            </span>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <div className="flex-1 space-y-4 p-4 sm:p-5">
            {activeView === 'compose' ? (
              <>
                {/* Separate Format Selector (locked while editing) */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[#0B1A2E]">
                    Update Format
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(lockedFormat && lockedFormat !== 'photo')}
                      onClick={() => {
                        if (lockedFormat) return;
                        setFormat('photo');
                        setErrorMessage(null);
                      }}
                      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        format === 'photo'
                          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#0B1A2E]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <ImagePlus
                        className="h-4 w-4 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      <span>Photo Update (1–4)</span>
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(lockedFormat && lockedFormat !== 'text')}
                      onClick={() => {
                        if (lockedFormat) return;
                        setFormat('text');
                        setErrorMessage(null);
                      }}
                      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        format === 'text'
                          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#0B1A2E]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <Palette
                        className="h-4 w-4 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      <span>Text-Only Card</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {format === 'photo'
                      ? 'Photo Updates display 1 shared caption above 1–4 compressed images.'
                      : 'Text-Only Updates display your message over a selectable high-contrast card (no photo attachments).'}
                  </p>
                </div>

                {/* Category + Pin Row */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="update-category"
                      className="mb-1 block text-xs font-semibold text-[#0B1A2E]"
                    >
                      Category
                    </label>
                    <select
                      id="update-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                    >
                      {ALLOWED_ADMIN_UPDATE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat] ?? cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <label className="flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-[#0B1A2E]">
                      <span className="inline-flex items-center gap-1.5">
                        <Pin
                          className={`h-3.5 w-3.5 ${
                            isPinned ? 'text-[#1E88E5]' : 'text-slate-400'
                          }`}
                          aria-hidden="true"
                        />
                        Pin to top of Updates
                      </span>
                      <input
                        type="checkbox"
                        checked={isPinned}
                        onChange={(e) => setIsPinned(e.target.checked)}
                        className="h-4 w-4 accent-[#1E88E5]"
                      />
                    </label>
                  </div>
                </div>

                {/* Optional Headline */}
                <div>
                  <label
                    htmlFor="update-title"
                    className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E]"
                  >
                    <span>Headline (optional)</span>
                    <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                      {title.length}/{BLUEPRINT_LIMITS.postTitleMax}
                    </span>
                  </label>
                  <input
                    id="update-title"
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.postTitleMax}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., First Semester Examination Timetable Release"
                    className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                  />
                </div>

                {/* Format-Specific Editor */}
                {format === 'photo' ? (
                  <>
                    <div>
                      <label
                        htmlFor="update-photo-caption"
                        className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E]"
                      >
                        <span>Shared Caption (shown above photos)</span>
                        <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                          {body.length}/{maxBodyLength}
                        </span>
                      </label>
                      <textarea
                        id="update-photo-caption"
                        rows={3}
                        maxLength={maxBodyLength}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Write a single shared caption for these photos..."
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-[#0B1A2E] outline-none focus:border-[#1E88E5]"
                      />
                    </div>

                    {/* Photo Picker + Responsive Management List */}
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-[#0B1A2E]">
                            Photographs ({attachments.length}/
                            {BLUEPRINT_LIMITS.mediaPostMaxCount})
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Select 1 to 4 photos. Automatically compressed with crisp detail.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={
                            isSubmitting ||
                            compressingCount > 0 ||
                            attachments.length >=
                              BLUEPRINT_LIMITS.mediaPostMaxCount
                          }
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1E88E5] disabled:opacity-50"
                        >
                          {compressingCount > 0 ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <ImagePlus
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {attachments.length === 0
                              ? 'Add Photos'
                              : 'Add More'}
                          </span>
                        </button>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => void handleSelectPhotos(e)}
                        className="hidden"
                      />
                      <input
                        ref={replaceFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleReplacePhoto(e)}
                        className="hidden"
                      />

                      {attachments.length > 0 && (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                            {attachments.map((att, index) => (
                              <div
                                key={att.clientId}
                                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                              >
                                <div className="relative aspect-square bg-[#0B1A2E]">
                                  {att.previewUrl ? (
                                    <img
                                      src={att.previewUrl}
                                      alt={`Selected update photograph ${index + 1}`}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-white/60">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    </div>
                                  )}
                                  <span className="absolute top-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    #{index + 1}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between gap-1 px-1.5 py-1.5">
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      disabled={index === 0}
                                      onClick={() => handleMovePhoto(index, -1)}
                                      aria-label={`Move photo ${index + 1} left`}
                                      className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                                    >
                                      <ArrowLeft className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={index === attachments.length - 1}
                                      onClick={() => handleMovePhoto(index, 1)}
                                      aria-label={`Move photo ${index + 1} right`}
                                      className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" />
                                    </button>
                                  </div>

                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        replacingClientIdRef.current =
                                          att.clientId;
                                        replaceFileInputRef.current?.click();
                                      }}
                                      aria-label={`Replace photo ${index + 1}`}
                                      title="Replace photo"
                                      className="flex h-7 w-7 items-center justify-center rounded text-[#1E88E5] hover:bg-blue-50"
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemovePhoto(att.clientId)
                                      }
                                      aria-label={`Remove photo ${index + 1}`}
                                      title="Remove photo"
                                      className="flex h-7 w-7 items-center justify-center rounded text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {att.compressed && (
                                  <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                                    {formatByteSize(att.compressed.byteSize)}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Format 2: Text-Only Update with Background Selector */}
                    <div>
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                        <Type
                          className="h-3.5 w-3.5 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        Card Background Colour / Gradient
                      </span>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                        {TEXT_POST_BACKGROUND_THEMES.map((theme) => {
                          const selected = backgroundStyle === theme.id;
                          return (
                            <button
                              key={theme.id}
                              type="button"
                              onClick={() => setBackgroundStyle(theme.id)}
                              title={theme.label}
                              aria-label={`Background: ${theme.label}`}
                              aria-pressed={selected}
                              style={{ background: theme.swatchCss }}
                              className={`flex h-10 items-center justify-center rounded-xl border-2 transition-transform ${
                                selected
                                  ? 'scale-105 border-[#1E88E5] ring-2 ring-[#1E88E5]/35'
                                  : 'border-white shadow-xs hover:scale-105'
                              }`}
                            >
                              {selected && (
                                <Check
                                  className="h-4 w-4 text-white drop-shadow"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="update-text-body"
                        className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E]"
                      >
                        <span>Official Message</span>
                        <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                          {body.length}/{maxBodyLength}
                        </span>
                      </label>
                      <div
                        className="rounded-2xl p-4 sm:p-5"
                        style={{ background: activeTextTheme.backgroundCss }}
                      >
                        <textarea
                          id="update-text-body"
                          rows={4}
                          maxLength={maxBodyLength}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder="Write your official campus announcement..."
                          className={`w-full resize-none bg-transparent text-center text-base font-semibold leading-relaxed outline-none placeholder:text-white/60 sm:text-lg ${activeTextTheme.textColorClass}`}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              /* Live Preview Card */
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
                <div className="flex items-center gap-3">
                  {effectiveAuthorMode === 'official_desk' ? (
                    <img
                      src="/pwa-192x192.png"
                      alt="LASUED Intel Official"
                      className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-[#0B1A2E] object-cover"
                    />
                  ) : (
                    <AvatarMedia
                      fullName={previewAuthorName}
                      photoImageId={actorPhotoImageId}
                      photoUrl={actorPhotoUrl}
                      sizeClass="h-10 w-10"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-[#0B1A2E]">
                        {previewAuthorName}
                      </span>
                      <RoleBadge badge={previewAuthorBadge} size="xs" />
                    </div>
                    <p className="text-xs text-slate-500">
                      {CATEGORY_LABELS[category] ?? category}
                      {isPinned ? ' · Pinned' : ''} · Preview
                    </p>
                  </div>
                </div>

                {format === 'photo' ? (
                  <div className="mt-3 space-y-3">
                    {(title.trim() || body.trim()) && (
                      <div className="space-y-1">
                        {title.trim() && (
                          <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                            {title.trim()}
                          </h3>
                        )}
                        {body.trim() && (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {body.trim()}
                          </p>
                        )}
                      </div>
                    )}
                    {previewGridItems.length > 0 ? (
                      <SquareImageGrid
                        items={previewGridItems}
                        postLabel={title.trim() || 'Official update'}
                        showPerPhotoCaptions={false}
                        onImageClick={(idx) => setLightboxIndex(idx)}
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                        Add 1–4 photos in Compose to preview the responsive grid.
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="mt-3.5 flex min-h-[168px] flex-col items-center justify-center rounded-xl p-6 text-center"
                    style={{ background: activeTextTheme.backgroundCss }}
                  >
                    {title.trim() && (
                      <h3
                        className={`mb-2 max-w-lg font-display text-base font-bold sm:text-lg ${activeTextTheme.textColorClass}`}
                      >
                        {title.trim()}
                      </h3>
                    )}
                    <p
                      className={`max-w-lg whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${activeTextTheme.textColorClass}`}
                    >
                      {body.trim() || 'Your official text update will appear here.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {uploadProgress && (
              <div className="space-y-1.5 rounded-xl border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0B1A2E]">
                  <span>{uploadProgress.label}</span>
                  <span className="tabular-nums">{uploadProgress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-[#1E88E5] transition-all duration-200"
                    style={{ width: `${uploadProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
              >
                {errorMessage}
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || compressingCount > 0}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1E88E5] disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {isSubmitting
                  ? isEditing
                    ? 'Saving...'
                    : 'Publishing...'
                  : isEditing
                  ? 'Save Changes'
                  : 'Publish Update'}
              </span>
            </button>
          </div>
        </form>
      </div>

      {lightboxIndex !== null && previewGridItems.length > 0 && (
        <FullScreenImageLightbox
          items={previewGridItems}
          initialIndex={lightboxIndex}
          postTitle={title.trim() || undefined}
          postCaption={body.trim() || undefined}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
};

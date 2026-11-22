import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Eye,
  ImagePlus,
  Loader2,
  Lock,
  Palette,
  PenLine,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  ANONYMOUS_BACKGROUND_THEMES,
  getAnonymousBackgroundTheme,
} from '../../config/anonymousBackgrounds';
import {
  fetchMediaImageDataUrl,
  generateFirestoreDocId,
  type UploadProgressState,
} from '../../services/mediaStorage';
import {
  createAnonymousPostWithMedia,
  createCommunityPostWithMedia,
  updateAnonymousPostWithMedia,
  updateCommunityPostWithMedia,
  type ComposerImageAttachment,
} from '../../services/socialPosts';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  type AnonymousBackgroundId,
  type AnonymousPost,
  type CommunityPost,
  type UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  compressImageFile,
  formatByteSize,
  validatePostImageCountAfterAdd,
} from '../../utils/imageCompression';
import type { GridPhotoItem } from '../../utils/mediaGrid';
import { FullScreenImageLightbox } from '../media/FullScreenImageLightbox';
import { SquareImageGrid } from '../media/SquareImageGrid';

const ORDINARY_CATEGORIES = [
  'Campus Update',
  'Academic Notice',
  'Student Welfare',
  'Faculty News',
  'Event Highlight',
  'Resource',
] as const;

const ANONYMOUS_CATEGORIES = [
  'Campus Life',
  'Academics & Exams',
  'Hostel & Housing',
  'Confessions',
  'Advice Needed',
  'Hot Take',
] as const;

export interface PostComposerProps {
  mode: 'ordinary' | 'anonymous';
  actorUid: string;
  actorRole: UserRole;
  actorName?: string;
  actorUsername?: string;
  initialPost?: CommunityPost | AnonymousPost | null;
  onSuccess: (post: CommunityPost | AnonymousPost) => void;
  onClose: () => void;
}

export const PostComposer: React.FC<PostComposerProps> = ({
  mode,
  actorUid,
  actorRole,
  actorName,
  actorUsername,
  initialPost = null,
  onSuccess,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isEditing = Boolean(initialPost);

  const defaultCategories =
    mode === 'ordinary' ? ORDINARY_CATEGORIES : ANONYMOUS_CATEGORIES;
  const maxBodyLength =
    mode === 'ordinary'
      ? BLUEPRINT_LIMITS.postBodyMax
      : BLUEPRINT_LIMITS.anonymousBodyMax;

  const [category, setCategory] = useState<string>(
    initialPost?.category || defaultCategories[0]
  );
  const [title, setTitle] = useState<string>(
    mode === 'ordinary' && initialPost && 'title' in initialPost
      ? initialPost.title ?? ''
      : ''
  );
  const [body, setBody] = useState<string>(initialPost?.body ?? '');
  const [isOfficial, setIsOfficial] = useState<boolean>(
    mode === 'ordinary' && initialPost && 'isOfficial' in initialPost
      ? Boolean(initialPost.isOfficial)
      : false
  );
  const [backgroundStyle, setBackgroundStyle] = useState<AnonymousBackgroundId>(
    mode === 'anonymous' &&
      initialPost &&
      'backgroundStyle' in initialPost &&
      initialPost.backgroundStyle
      ? initialPost.backgroundStyle
      : 'plain'
  );

  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>(
    () =>
      (initialPost?.mediaItems ?? [])
        .slice(0, BLUEPRINT_LIMITS.mediaPostMaxCount)
        .map((meta) => ({
          clientId: meta.imageId,
          imageId: meta.imageId,
          caption: meta.caption ?? '',
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

  useEffect(() => {
    const existingIds = (initialPost?.mediaItems ?? []).map((m) => m.imageId);
    if (existingIds.length === 0) return;

    let active = true;
    existingIds.forEach((imageId) => {
      fetchMediaImageDataUrl(imageId)
        .then((dataUrl) => {
          if (!active || !dataUrl) return;
          setAttachments((prev) =>
            prev.map((item) =>
              item.imageId === imageId && !item.previewUrl
                ? { ...item, previewUrl: dataUrl }
                : item
            )
          );
        })
        .catch(() => {
          // Handled safely by FirestoreImage fallback when displayed
        });
    });

    return () => {
      active = false;
    };
  }, [initialPost]);

  const canMarkOfficial =
    mode === 'ordinary' &&
    (actorRole === 'owner' || actorRole === 'supreme_admin');

  const handleSelectFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = event.target.files;
    event.target.value = '';
    if (!fileList || fileList.length === 0 || isSubmitting) return;

    const files = Array.from(fileList);
    setErrorMessage(null);

    const countError = validatePostImageCountAfterAdd(
      attachments.length,
      files.length
    );
    if (countError) {
      setErrorMessage(countError);
      return;
    }

    setCompressingCount((prev) => prev + files.length);
    try {
      const nextAttachments: ComposerImageAttachment[] = [];
      for (const file of files) {
        const compressed = await compressImageFile(file, 'post');
        const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
        nextAttachments.push({
          clientId: imageId,
          imageId,
          caption: '',
          previewUrl: compressed.dataUrl,
          compressed,
        });
      }

      setAttachments((prev) => {
        if (
          prev.length + nextAttachments.length >
          BLUEPRINT_LIMITS.mediaPostMaxCount
        ) {
          setErrorMessage(
            `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
          );
          return prev;
        }
        return [...prev, ...nextAttachments];
      });
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not process the selected photograph.'
        )
      );
    } finally {
      setCompressingCount((prev) => Math.max(0, prev - files.length));
    }
  };

  const handleRemoveAttachment = (clientId: string) => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setAttachments((prev) => prev.filter((item) => item.clientId !== clientId));
  };

  const handleCaptionChange = (clientId: string, nextCaption: string) => {
    setAttachments((prev) =>
      prev.map((item) =>
        item.clientId === clientId
          ? {
              ...item,
              caption: nextCaption.slice(0, BLUEPRINT_LIMITS.imageCaptionMax),
            }
          : item
      )
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || compressingCount > 0) return;

    setErrorMessage(null);

    if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
      setErrorMessage(
        `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
      );
      return;
    }

    if (body.trim().length === 0 && attachments.length === 0) {
      setErrorMessage(
        mode === 'anonymous'
          ? 'Write an anonymous message or attach at least one photograph.'
          : 'Write your campus update or attach at least one photograph.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'ordinary') {
        if (isEditing && initialPost && 'ownerUID' in initialPost) {
          const updated = await updateCommunityPostWithMedia({
            post: initialPost,
            actorUid,
            category,
            title,
            body,
            attachments,
            onProgress: setUploadProgress,
          });
          onSuccess(updated);
        } else {
          const created = await createCommunityPostWithMedia({
            ownerUID: actorUid,
            authorRole: actorRole,
            category,
            title,
            body,
            attachments,
            isOfficial,
            onProgress: setUploadProgress,
          });
          onSuccess(created);
        }
      } else {
        if (isEditing && initialPost && !('ownerUID' in initialPost)) {
          const updated = await updateAnonymousPostWithMedia({
            post: initialPost,
            category,
            body,
            backgroundStyle:
              attachments.length === 0 ? backgroundStyle : 'plain',
            attachments,
            onProgress: setUploadProgress,
          });
          onSuccess(updated);
        } else {
          const created = await createAnonymousPostWithMedia({
            authorUid: actorUid,
            authorRole: actorRole,
            category,
            body,
            backgroundStyle:
              attachments.length === 0 ? backgroundStyle : 'plain',
            attachments,
            onProgress: setUploadProgress,
          });
          onSuccess(created);
        }
      }
    } catch (error) {
      setUploadProgress(null);
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not save your post to Firebase. Please review your details and retry.'
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewGridItems: GridPhotoItem[] = attachments.map((item) => ({
    imageId: item.imageId,
    caption: item.caption.trim() || undefined,
    directSrc: item.previewUrl || undefined,
  }));

  const activeAnonTheme = getAnonymousBackgroundTheme(
    attachments.length === 0 ? backgroundStyle : 'plain'
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-composer-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/70 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      data-testid="post-composer-modal"
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 sm:py-4">
          <div className="min-w-0">
            <h2
              id="post-composer-title"
              className="font-display text-lg font-bold text-[#0B1A2E]"
            >
              {isEditing
                ? mode === 'anonymous'
                  ? 'Edit Anonymous Post'
                  : 'Edit Campus Update'
                : mode === 'anonymous'
                ? 'Post Anonymously'
                : 'Create Campus Update'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {mode === 'anonymous'
                ? 'Identity, original filenames, and camera EXIF metadata are stripped automatically.'
                : `Publishing as ${actorName || 'Member'}${
                    actorUsername ? ` (@${actorUsername})` : ''
                  }`}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close post composer"
            className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-[#0B1A2E] disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Compose / Preview Switcher */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2">
          <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
            <button
              type="button"
              onClick={() => setActiveView('compose')}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                activeView === 'compose'
                  ? 'bg-white text-[#0B1A2E] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A2E]'
              }`}
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              Compose
            </button>
            <button
              type="button"
              onClick={() => setActiveView('preview')}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                activeView === 'preview'
                  ? 'bg-white text-[#0B1A2E] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A2E]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Full Preview
            </button>
          </div>

          <span className="text-xs font-semibold text-slate-600 tabular-nums">
            {attachments.length} / {BLUEPRINT_LIMITS.mediaPostMaxCount} photos
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                {errorMessage}
              </div>
            )}

            {activeView === 'compose' ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="composer-category"
                      className="block text-xs font-semibold text-[#0B1A2E]"
                    >
                      Category
                    </label>
                    <select
                      id="composer-category"
                      value={category}
                      disabled={isSubmitting}
                      onChange={(e) => setCategory(e.target.value)}
                      className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                    >
                      {defaultCategories.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  {mode === 'ordinary' && (
                    <div>
                      <label
                        htmlFor="composer-title"
                        className="block text-xs font-semibold text-[#0B1A2E]"
                      >
                        Headline (optional)
                      </label>
                      <input
                        id="composer-title"
                        type="text"
                        maxLength={BLUEPRINT_LIMITS.postTitleMax}
                        disabled={isSubmitting}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Short update title"
                        className="mt-1 block min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
                      />
                    </div>
                  )}
                </div>

                {canMarkOfficial && !isEditing && (
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-[#0B1A2E]">
                    <input
                      type="checkbox"
                      checked={isOfficial}
                      onChange={(e) => setIsOfficial(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
                    />
                    Publish as Official Platform Update
                  </label>
                )}

                {/* General Post Caption FIRST so it is always visible above photos */}
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="composer-body"
                      className="block text-xs font-semibold text-[#0B1A2E]"
                    >
                      {attachments.length > 0
                        ? mode === 'anonymous'
                          ? 'Anonymous Caption (shown below your photos)'
                          : 'General Post Caption (shown below your photos)'
                        : mode === 'anonymous'
                        ? 'Anonymous Caption / Message'
                        : 'Update Caption / Text'}
                    </label>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {body.length} / {maxBodyLength}
                    </span>
                  </div>
                  <textarea
                    id="composer-body"
                    rows={3}
                    maxLength={maxBodyLength}
                    disabled={isSubmitting}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={
                      mode === 'anonymous'
                        ? 'Write your anonymous caption or campus message...'
                        : 'Write your update for the LASUED community...'
                    }
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                  />
                </div>

                {/* Anonymous Text-Only Background Style Selector (when 0 photos attached) */}
                {mode === 'anonymous' && attachments.length === 0 && (
                  <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                        <Palette
                          className="h-3.5 w-3.5 text-[#1E88E5]"
                          aria-hidden="true"
                        />
                        Text-Only Card Style
                      </span>
                      <span className="text-[11px] font-medium text-slate-500">
                        {activeAnonTheme.label}
                      </span>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label="Anonymous post background style"
                      className="flex flex-wrap items-center gap-2"
                    >
                      {ANONYMOUS_BACKGROUND_THEMES.map((theme) => {
                        const selected = backgroundStyle === theme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={theme.label}
                            title={theme.label}
                            onClick={() => setBackgroundStyle(theme.id)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform ${
                              selected
                                ? 'scale-110 border-[#1E88E5] ring-2 ring-[#1E88E5]/30'
                                : 'border-slate-300 hover:scale-105'
                            }`}
                            style={{ background: theme.swatchCss }}
                          >
                            {selected && (
                              <Check
                                className={`h-3.5 w-3.5 ${
                                  theme.isDark ? 'text-white' : 'text-[#0B1A2E]'
                                }`}
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {backgroundStyle !== 'plain' && (
                      <div
                        className="mt-2 flex min-h-[100px] items-center justify-center rounded-xl p-4 text-center shadow-xs"
                        style={{ background: activeAnonTheme.backgroundCss }}
                      >
                        <p
                          className={`max-w-md whitespace-pre-wrap text-sm font-semibold leading-relaxed sm:text-base ${activeAnonTheme.textColorClass}`}
                        >
                          {body.trim() ||
                            'Your styled anonymous text preview appears here...'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Multiple Image Attachments (Max 4) + Compact Live Grid Preview */}
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0B1A2E]">
                      Photographs (Max 4 · Compressed automatically)
                    </span>
                    <button
                      type="button"
                      disabled={
                        isSubmitting ||
                        compressingCount > 0 ||
                        attachments.length >= BLUEPRINT_LIMITS.mediaPostMaxCount
                      }
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {compressingCount > 0 ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {compressingCount > 0
                        ? 'Compressing...'
                        : attachments.length > 0
                        ? `Add Photo (${attachments.length}/4)`
                        : 'Select Photos'}
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={isSubmitting}
                      onChange={handleSelectFiles}
                      className="sr-only"
                      data-testid="post-image-file-input"
                    />
                  </div>

                  {attachments.length === 0 ? (
                    <button
                      type="button"
                      disabled={isSubmitting || compressingCount > 0}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center transition-colors hover:border-[#1E88E5] hover:bg-slate-50 disabled:opacity-50"
                    >
                      <ImagePlus
                        className="h-6 w-6 text-[#1E88E5]"
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-[#0B1A2E]">
                        Tap to choose up to 4 photographs from gallery or camera
                      </span>
                      <span className="text-[11px] text-slate-500">
                        You will see a small live grid preview right here before posting.
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {/* Compact Live 1/2/3/4 Grid Preview visible directly in Compose */}
                      <div
                        className="rounded-xl border border-slate-200 bg-white p-3"
                        data-testid="composer-inline-grid-preview"
                      >
                        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                          <span>
                            Live Grid Preview ({attachments.length}{' '}
                            {attachments.length === 1 ? 'photo' : 'photos'})
                          </span>
                          <span className="text-[#1E88E5]">
                            Tap any tile to zoom
                          </span>
                        </div>
                        <div className="mx-auto max-w-[260px]">
                          <SquareImageGrid
                            items={previewGridItems}
                            postLabel={
                              mode === 'anonymous'
                                ? 'Anonymous live grid preview'
                                : 'Post live grid preview'
                            }
                            onImageClick={(idx) => setLightboxIndex(idx)}
                          />
                        </div>
                      </div>

                      {/* Compact per-photo thumbnails & individual caption inputs */}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {attachments.map((att, idx) => (
                          <div
                            key={att.clientId}
                            className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-2"
                          >
                            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#0B1A2E]">
                              {att.previewUrl ? (
                                <img
                                  src={att.previewUrl}
                                  alt={`Selected photograph ${idx + 1}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full animate-pulse bg-[#132946]" />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveAttachment(att.clientId)
                                }
                                aria-label={`Remove photograph ${idx + 1}`}
                                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-700"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-[11px] font-semibold text-[#0B1A2E] tabular-nums">
                                Photo {idx + 1}
                                {att.compressed
                                  ? ` · ${formatByteSize(att.compressed.byteSize)}`
                                  : ''}
                              </p>
                              <input
                                type="text"
                                maxLength={BLUEPRINT_LIMITS.imageCaptionMax}
                                value={att.caption}
                                disabled={isSubmitting}
                                onChange={(e) =>
                                  handleCaptionChange(
                                    att.clientId,
                                    e.target.value
                                  )
                                }
                                placeholder={`Optional caption for photo ${idx + 1}...`}
                                className="min-h-[34px] w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-[#0B1A2E] focus:border-[#1E88E5]"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* FULL POST PREVIEW */
              <div
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                data-testid="post-live-preview"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-[#0B1A2E]">
                    {mode === 'anonymous'
                      ? 'Anonymous'
                      : actorName || 'Verified Contributor'}
                  </span>
                  <span>{category} · Preview</span>
                </div>

                {attachments.length > 0 ? (
                  <>
                    <SquareImageGrid
                      items={previewGridItems}
                      postLabel={
                        mode === 'anonymous'
                          ? 'Anonymous preview'
                          : 'Post preview'
                      }
                      onImageClick={(idx) => setLightboxIndex(idx)}
                    />
                    {mode === 'ordinary' && title.trim() && (
                      <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                        {title.trim()}
                      </h3>
                    )}
                    {body.trim() && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {body.trim()}
                      </p>
                    )}
                  </>
                ) : mode === 'anonymous' && backgroundStyle !== 'plain' ? (
                  <div
                    className="flex min-h-[160px] items-center justify-center rounded-xl p-6 text-center"
                    style={{ background: activeAnonTheme.backgroundCss }}
                  >
                    <p
                      className={`max-w-lg whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg ${activeAnonTheme.textColorClass}`}
                    >
                      {body.trim() || 'No text entered yet.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {mode === 'ordinary' && title.trim() && (
                      <h3 className="font-display text-base font-bold text-[#0B1A2E]">
                        {title.trim()}
                      </h3>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {body.trim() || 'No text entered yet.'}
                    </p>
                  </>
                )}
              </div>
            )}

            {uploadProgress && (
              <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between text-xs font-medium text-[#0B1A2E]">
                  <span>{uploadProgress.label}</span>
                  <span className="tabular-nums">{uploadProgress.percent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-[#1E88E5] transition-all duration-200"
                    style={{ width: `${uploadProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Always-Pinned Footer Actions OUTSIDE Scroll Container */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {mode === 'anonymous' && (
                <>
                  <Lock className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                  <span>Identity protected</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="inline-flex min-h-[42px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || compressingCount > 0}
                data-testid="composer-submit-button"
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-[#0B1A2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#132844] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                )}
                <span>
                  {isSubmitting
                    ? 'Saving...'
                    : isEditing
                    ? 'Save Changes'
                    : mode === 'anonymous'
                    ? 'Post Anonymously'
                    : 'Post Update'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {lightboxIndex !== null && (
        <FullScreenImageLightbox
          items={previewGridItems}
          initialIndex={lightboxIndex}
          postTitle={mode === 'ordinary' ? title.trim() || undefined : undefined}
          postCaption={body.trim() || undefined}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ImagePlus,
  Loader2,
  Lock,
  Palette,
  PenLine,
  RefreshCw,
  Send,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  ANONYMOUS_BACKGROUND_THEMES,
  TEXT_POST_BACKGROUND_THEMES,
  getAnonymousBackgroundTheme,
  getTextPostBackgroundTheme,
} from '../../config/anonymousBackgrounds';
import {
  fetchMediaImageDataUrl,
  generateFirestoreDocId,
  type UploadProgressState,
} from '../../services/mediaStorage';
import {
  clearPersistentDraft,
  loadPersistentDraft,
  savePersistentDraft,
} from '../../services/persistentCache';
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
  resolveAnonymousPostType,
  resolveOrdinaryPostType,
  type AnonymousBackgroundId,
  type AnonymousPost,
  type AnonymousPostType,
  type CommunityPost,
  type OrdinaryPostType,
  type TextPostBackgroundId,
  type UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  ALL_IMAGE_FILE_ACCEPT,
  compressImageFile,
  formatByteSize,
  validatePostImageCountAfterAdd,
} from '../../utils/imageCompression';
import {
  partitionDuplicateSelectedFiles,
  reorderArrayItem,
} from '../../utils/mediaCache';
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
  initialOrdinaryType?: OrdinaryPostType;
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
  initialOrdinaryType = 'text',
  actorUid,
  actorRole,
  actorName,
  actorUsername,
  initialPost = null,
  onSuccess,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const replacingClientIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const isEditing = Boolean(initialPost);
  const initialCommunityPost: CommunityPost | null =
    mode === 'ordinary' && initialPost && 'ownerUID' in initialPost
      ? (initialPost as CommunityPost)
      : null;
  const initialAnonPost: AnonymousPost | null =
    mode === 'anonymous' && initialPost && !('ownerUID' in initialPost)
      ? (initialPost as AnonymousPost)
      : null;

  const lockedOrdinaryType: OrdinaryPostType | null = initialCommunityPost
    ? resolveOrdinaryPostType(initialCommunityPost)
    : null;
  const lockedAnonType: AnonymousPostType | null = initialAnonPost
    ? resolveAnonymousPostType(initialAnonPost)
    : null;

  const [ordinaryPostType, setOrdinaryPostType] = useState<OrdinaryPostType>(
    () => lockedOrdinaryType ?? initialOrdinaryType
  );
  const [anonPostType, setAnonPostType] = useState<AnonymousPostType>(
    () => lockedAnonType ?? 'text'
  );

  const defaultCategories =
    mode === 'ordinary' ? ORDINARY_CATEGORIES : ANONYMOUS_CATEGORIES;

  const maxBodyLength =
    mode === 'ordinary'
      ? ordinaryPostType === 'text'
        ? BLUEPRINT_LIMITS.textPostBodyMax
        : BLUEPRINT_LIMITS.photoPostCaptionMax
      : anonPostType === 'text'
      ? BLUEPRINT_LIMITS.anonymousBodyMax
      : BLUEPRINT_LIMITS.photoPostCaptionMax;

  const [category, setCategory] = useState<string>(
    initialPost?.category || defaultCategories[0]
  );
  const [title, setTitle] = useState<string>(
    initialCommunityPost?.title ?? ''
  );
  const [body, setBody] = useState<string>(() => {
    const raw = initialPost?.body ?? '';
    if (
      mode === 'ordinary' &&
      (lockedOrdinaryType ?? initialOrdinaryType) === 'text'
    ) {
      return raw.slice(0, BLUEPRINT_LIMITS.textPostBodyMax);
    }
    return raw;
  });
  const [isOfficial, setIsOfficial] = useState<boolean>(
    mode === 'ordinary' && initialPost && 'isOfficial' in initialPost
      ? Boolean(initialPost.isOfficial)
      : false
  );
  const [textBackgroundStyle, setTextBackgroundStyle] =
    useState<TextPostBackgroundId>(() => {
      if (
        mode === 'ordinary' &&
        initialPost &&
        'backgroundStyle' in initialPost &&
        initialPost.backgroundStyle &&
        initialPost.backgroundStyle !== 'plain'
      ) {
        return initialPost.backgroundStyle as TextPostBackgroundId;
      }
      return TEXT_POST_BACKGROUND_THEMES[0].id;
    });
  const [anonBackgroundStyle, setAnonBackgroundStyle] =
    useState<AnonymousBackgroundId>(
      mode === 'anonymous' &&
        initialPost &&
        'backgroundStyle' in initialPost &&
        initialPost.backgroundStyle
        ? (initialPost.backgroundStyle as AnonymousBackgroundId)
        : 'plain'
    );

  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>(
    () =>
      (initialPost?.mediaItems ?? [])
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
  const [draftRestored, setDraftRestored] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const draftId =
    mode === 'ordinary' ? 'post_composer_ordinary' : 'post_composer_anonymous';
  const draftViewerKey = actorUid || 'guest';

  useEffect(() => {
    if (isEditing) return;
    let active = true;
    void loadPersistentDraft<{
      category?: string;
      title?: string;
      body?: string;
      isOfficial?: boolean;
      textBackgroundStyle?: TextPostBackgroundId;
      anonBackgroundStyle?: AnonymousBackgroundId;
    }>(draftViewerKey, draftId)
      .then((draft) => {
        if (!active || !draft) return;
        const hasText = Boolean(draft.body?.trim() || draft.title?.trim());
        if (!hasText) return;
        setBody((curr) => {
          if (curr.trim()) return curr;
          if (draft.category) setCategory(draft.category);
          if (draft.title) {
            setTitle((currTitle) => (currTitle.trim() ? currTitle : draft.title!));
          }
          if (typeof draft.isOfficial === 'boolean') {
            setIsOfficial(draft.isOfficial);
          }
          if (draft.textBackgroundStyle) {
            setTextBackgroundStyle(draft.textBackgroundStyle);
          }
          if (draft.anonBackgroundStyle) {
            setAnonBackgroundStyle(draft.anonBackgroundStyle);
          }
          setDraftRestored(true);
          return draft.body || '';
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isEditing, draftViewerKey, draftId]);

  useEffect(() => {
    if (isEditing) return;
    if (!body.trim() && !title.trim()) return;
    const timer = window.setTimeout(() => {
      void savePersistentDraft(draftViewerKey, draftId, {
        category,
        title,
        body,
        isOfficial,
        textBackgroundStyle,
        anonBackgroundStyle,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    isEditing,
    draftViewerKey,
    draftId,
    category,
    title,
    body,
    isOfficial,
    textBackgroundStyle,
    anonBackgroundStyle,
  ]);

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
    mode === 'ordinary' && actorRole === 'supreme_admin';

  const handleSwitchOrdinaryType = (nextType: OrdinaryPostType) => {
    if (isEditing || isSubmitting || nextType === ordinaryPostType) return;
    setErrorMessage(null);
    setOrdinaryPostType(nextType);
    if (nextType === 'text' && body.length > BLUEPRINT_LIMITS.textPostBodyMax) {
      setBody((prev) => prev.slice(0, BLUEPRINT_LIMITS.textPostBodyMax));
    }
  };

  const handleSwitchAnonType = (nextType: AnonymousPostType) => {
    if (isEditing || isSubmitting || nextType === anonPostType) return;
    setErrorMessage(null);
    setAnonPostType(nextType);
    if (
      nextType === 'photo' &&
      body.length > BLUEPRINT_LIMITS.photoPostCaptionMax
    ) {
      setBody((prev) => prev.slice(0, BLUEPRINT_LIMITS.photoPostCaptionMax));
    }
  };

  const handleSelectFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = event.target.files;
    event.target.value = '';
    if (!fileList || fileList.length === 0 || isSubmitting) return;
    if (mode === 'ordinary' && ordinaryPostType !== 'photo') return;
    if (mode === 'anonymous' && anonPostType !== 'photo') return;

    const files = Array.from(fileList);
    setErrorMessage(null);

    const existingFingerprints = new Set<string>(
      attachments
        .map((att) => att.compressed?.fingerprint)
        .filter((fp): fp is string => Boolean(fp))
    );
    const { unique: uniqueFiles, duplicateCount } =
      partitionDuplicateSelectedFiles(files, existingFingerprints);

    if (uniqueFiles.length === 0) {
      setErrorMessage(
        duplicateCount > 0
          ? 'Those photos are already selected in this post.'
          : null
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

    setCompressingCount((prev) => prev + uniqueFiles.length);
    try {
      const nextAttachments: ComposerImageAttachment[] = [];
      const failedNames: string[] = [];
      for (const file of uniqueFiles) {
        try {
          const compressed = await compressImageFile(file, 'post');
          const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
          nextAttachments.push({
            clientId: imageId,
            imageId,
            caption: '',
            previewUrl: compressed.dataUrl,
            compressed,
          });
        } catch (err) {
          failedNames.push(
            file.name ||
              formatFirestoreOrAppError(err, 'selected photo')
          );
        }
      }

      if (nextAttachments.length > 0) {
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
      }

      if (failedNames.length > 0 && nextAttachments.length === 0) {
        setErrorMessage(
          'Could not decode that image file. Try a standard photo, screenshot, or export from your gallery.'
        );
      } else if (failedNames.length > 0) {
        setErrorMessage(
          `Attached ${nextAttachments.length} photo(s); ${failedNames.length} unsupported or corrupted file(s) skipped.`
        );
      } else if (duplicateCount > 0) {
        setErrorMessage(
          `Skipped ${duplicateCount} duplicate photo${duplicateCount === 1 ? '' : 's'} already attached.`
        );
      }
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not process the selected photograph.'
        )
      );
    } finally {
      setCompressingCount((prev) => Math.max(0, prev - uniqueFiles.length));
    }
  };

  const handleRemoveAttachment = (clientId: string) => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setAttachments((prev) => prev.filter((item) => item.clientId !== clientId));
  };

  const handleMoveAttachment = (fromIndex: number, toIndex: number) => {
    if (isSubmitting) return;
    setAttachments((prev) => reorderArrayItem(prev, fromIndex, toIndex));
  };

  const handleTriggerReplaceAttachment = (clientId: string) => {
    if (isSubmitting || compressingCount > 0) return;
    replacingClientIdRef.current = clientId;
    replaceFileInputRef.current?.click();
  };

  const handleReplaceFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const targetClientId = replacingClientIdRef.current;
    replacingClientIdRef.current = null;
    if (!file || !targetClientId || isSubmitting) return;

    const otherFingerprints = new Set<string>(
      attachments
        .filter((att) => att.clientId !== targetClientId)
        .map((att) => att.compressed?.fingerprint)
        .filter((fp): fp is string => Boolean(fp))
    );
    const { duplicateCount } = partitionDuplicateSelectedFiles(
      [file],
      otherFingerprints
    );
    if (duplicateCount > 0) {
      setErrorMessage('That photo is already selected in another slot.');
      return;
    }

    setErrorMessage(null);
    setCompressingCount((prev) => prev + 1);
    try {
      const compressed = await compressImageFile(file, 'post');
      const newImageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
      setAttachments((prev) =>
        prev.map((item) =>
          item.clientId === targetClientId
            ? {
                clientId: newImageId,
                imageId: newImageId,
                caption: '',
                previewUrl: compressed.dataUrl,
                compressed,
              }
            : item
        )
      );
    } catch (error) {
      setErrorMessage(
        formatFirestoreOrAppError(
          error,
          'Could not process the replacement photograph.'
        )
      );
    } finally {
      setCompressingCount((prev) => Math.max(0, prev - 1));
    }
  };

  const handleDiscardDraft = () => {
    setCategory(defaultCategories[0]);
    setTitle('');
    setBody('');
    setIsOfficial(false);
    setTextBackgroundStyle(TEXT_POST_BACKGROUND_THEMES[0].id);
    setAnonBackgroundStyle('plain');
    setDraftRestored(false);
    setErrorMessage(null);
    void clearPersistentDraft(draftViewerKey, draftId);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLockRef.current || isSubmitting || compressingCount > 0) return;

    setErrorMessage(null);

    if (mode === 'ordinary') {
      if (ordinaryPostType === 'text') {
        const trimmedBody = body.trim();
        if (trimmedBody.length === 0) {
          setErrorMessage('Write a message for your text-only campus post.');
          return;
        }
        if (trimmedBody.length > BLUEPRINT_LIMITS.textPostBodyMax) {
          setErrorMessage(
            `Text-only posts must be ${BLUEPRINT_LIMITS.textPostBodyMax} characters or fewer.`
          );
          return;
        }
      } else {
        if (attachments.length < 1) {
          setErrorMessage(
            'Select between 1 and 4 photos for a photo post, or switch to Text-Only Post.'
          );
          return;
        }
        if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
          setErrorMessage(
            `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} photos are allowed per photo post.`
          );
          return;
        }
      }
    } else {
      if (anonPostType === 'text') {
        const trimmedBody = body.trim();
        if (trimmedBody.length === 0) {
          setErrorMessage('Write your anonymous message before posting.');
          return;
        }
        if (trimmedBody.length > BLUEPRINT_LIMITS.anonymousBodyMax) {
          setErrorMessage(
            `Anonymous text posts must be ${BLUEPRINT_LIMITS.anonymousBodyMax} characters or fewer.`
          );
          return;
        }
      } else {
        if (attachments.length < 1) {
          setErrorMessage(
            'Select between 1 and 4 photographs for an anonymous photo post, or switch to Text-Only Post.'
          );
          return;
        }
        if (attachments.length > BLUEPRINT_LIMITS.mediaPostMaxCount) {
          setErrorMessage(
            `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} images are allowed per post.`
          );
          return;
        }
        if (body.trim().length > BLUEPRINT_LIMITS.photoPostCaptionMax) {
          setErrorMessage(
            `Shared photo caption must be ${BLUEPRINT_LIMITS.photoPostCaptionMax} characters or fewer.`
          );
          return;
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMessage(
        'You are offline. Your post draft is saved safely — reconnect to publish.'
      );
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      if (mode === 'ordinary') {
        const isText = ordinaryPostType === 'text';
        const effectiveAttachments = isText ? [] : attachments;

        if (isEditing && initialCommunityPost) {
          const updated = await updateCommunityPostWithMedia({
            post: initialCommunityPost,
            actorUid,
            category,
            title,
            body,
            backgroundStyle: isText ? textBackgroundStyle : undefined,
            attachments: effectiveAttachments,
            onProgress: setUploadProgress,
          });
          onSuccess(updated);
        } else {
          const created = await createCommunityPostWithMedia({
            ownerUID: actorUid,
            authorRole: actorRole,
            postType: ordinaryPostType,
            category,
            title,
            body,
            backgroundStyle: isText ? textBackgroundStyle : undefined,
            attachments: effectiveAttachments,
            isOfficial,
            onProgress: setUploadProgress,
          });
          void clearPersistentDraft(draftViewerKey, draftId);
          onSuccess(created);
        }
      } else {
        const isAnonText = anonPostType === 'text';
        const effectiveAttachments = isAnonText ? [] : attachments;

        if (isEditing && initialAnonPost) {
          const updated = await updateAnonymousPostWithMedia({
            post: initialAnonPost,
            category,
            body,
            backgroundStyle: isAnonText ? anonBackgroundStyle : undefined,
            attachments: effectiveAttachments,
            onProgress: setUploadProgress,
          });
          onSuccess(updated);
        } else {
          const created = await createAnonymousPostWithMedia({
            authorUid: actorUid,
            authorRole: actorRole,
            postType: anonPostType,
            category,
            body,
            backgroundStyle: isAnonText ? anonBackgroundStyle : undefined,
            attachments: effectiveAttachments,
            onProgress: setUploadProgress,
          });
          void clearPersistentDraft(draftViewerKey, draftId);
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
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const previewGridItems: GridPhotoItem[] = attachments.map((item) => ({
    imageId: item.imageId,
    directSrc: item.previewUrl || undefined,
  }));

  const activeTextTheme = getTextPostBackgroundTheme(textBackgroundStyle);
  const activeAnonTheme = getAnonymousBackgroundTheme(
    anonPostType === 'text' ? anonBackgroundStyle : 'plain'
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
        <div aria-hidden="true" className="lasued-action-gradient h-1 w-full shrink-0" />
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-white via-sky-50/40 to-blue-50/50 px-5 py-3.5 sm:py-4">
          <div className="min-w-0">
            <h2
              id="post-composer-title"
              className="font-display text-lg font-bold text-[#0B1A2E]"
            >
              {isEditing
                ? mode === 'anonymous'
                  ? 'Edit Anonymous Post'
                  : ordinaryPostType === 'text'
                  ? 'Edit Text Post'
                  : 'Edit Photo Post'
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-2">
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
              Preview
            </button>
          </div>

          {mode === 'ordinary' ? (
            <span className="text-xs font-semibold text-slate-600 tabular-nums">
              {ordinaryPostType === 'text'
                ? 'Format: Text-Only Post'
                : `Photo Post · ${attachments.length} / ${BLUEPRINT_LIMITS.mediaPostMaxCount} photos`}
            </span>
          ) : (
            <span className="text-xs font-semibold text-slate-600 tabular-nums">
              {anonPostType === 'text'
                ? 'Format: Anonymous Text Post'
                : `Anonymous Photo Post · ${attachments.length} / ${BLUEPRINT_LIMITS.mediaPostMaxCount} photos`}
            </span>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <input
            ref={replaceFileInputRef}
            type="file"
            accept={ALL_IMAGE_FILE_ACCEPT}
            disabled={isSubmitting}
            onChange={handleReplaceFile}
            className="sr-only"
            data-testid="post-image-replace-input"
          />

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {draftRestored && !isEditing && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1E88E5]/25 bg-[#1E88E5]/5 px-3.5 py-2 text-xs text-[#0B1A2E]">
                <span>Saved draft restored from this device.</span>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="font-semibold text-[#1E88E5] hover:underline"
                >
                  Discard draft
                </button>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                {errorMessage}
              </div>
            )}

            {/* Two Strictly Separate Format Tabs (Both Ordinary & Anonymous Modes) */}
            {activeView === 'compose' && (
              <div className="space-y-1.5">
                {isEditing ? (
                  <p className="text-xs font-semibold text-slate-500">
                    Post format is locked to{' '}
                    <span className="text-[#0B1A2E]">
                      {(mode === 'ordinary'
                        ? ordinaryPostType
                        : anonPostType) === 'text'
                        ? 'Text-Only Post'
                        : 'Photo Post'}
                    </span>{' '}
                    while editing.
                  </p>
                ) : (
                  <div
                    role="tablist"
                    aria-label={
                      mode === 'ordinary'
                        ? 'Choose ordinary post format'
                        : 'Choose anonymous post format'
                    }
                    data-testid="composer-format-switcher"
                    className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={
                        (mode === 'ordinary'
                          ? ordinaryPostType
                          : anonPostType) === 'text'
                      }
                      onClick={() =>
                        mode === 'ordinary'
                          ? handleSwitchOrdinaryType('text')
                          : handleSwitchAnonType('text')
                      }
                      className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        (mode === 'ordinary'
                          ? ordinaryPostType
                          : anonPostType) === 'text'
                          ? 'bg-[#0B1A2E] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white hover:text-[#0B1A2E]'
                      }`}
                    >
                      <Type className="h-3.5 w-3.5" aria-hidden="true" />
                      Text-Only Post
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={
                        (mode === 'ordinary'
                          ? ordinaryPostType
                          : anonPostType) === 'photo'
                      }
                      onClick={() =>
                        mode === 'ordinary'
                          ? handleSwitchOrdinaryType('photo')
                          : handleSwitchAnonType('photo')
                      }
                      className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        (mode === 'ordinary'
                          ? ordinaryPostType
                          : anonPostType) === 'photo'
                          ? 'bg-[#0B1A2E] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white hover:text-[#0B1A2E]'
                      }`}
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Photo Post (1–4)
                    </button>
                  </div>
                )}
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

                {mode === 'ordinary' && ordinaryPostType === 'text' ? (
                  /* FORMAT A: TEXT-ONLY POST (Background Colour/Gradient + Message + Live Preview, Zero Photos) */
                  <>
                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="composer-body"
                          className="block text-xs font-semibold text-[#0B1A2E]"
                        >
                          Message
                        </label>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {body.length} / {BLUEPRINT_LIMITS.textPostBodyMax}
                        </span>
                      </div>
                      <textarea
                        id="composer-body"
                        rows={4}
                        maxLength={BLUEPRINT_LIMITS.textPostBodyMax}
                        disabled={isSubmitting}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Share a concise campus update on a coloured background..."
                        className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                      />
                    </div>

                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                          <Palette
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                          Background Colour or Gradient
                        </span>
                        <span className="text-[11px] font-medium text-slate-600">
                          {activeTextTheme.label}
                        </span>
                      </div>

                      <div
                        role="radiogroup"
                        aria-label="Text post background style"
                        className="flex flex-wrap items-center gap-2"
                      >
                        {TEXT_POST_BACKGROUND_THEMES.map((theme) => {
                          const selected = textBackgroundStyle === theme.id;
                          return (
                            <button
                              key={theme.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              aria-label={theme.label}
                              title={theme.label}
                              disabled={isSubmitting}
                              onClick={() => setTextBackgroundStyle(theme.id)}
                              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform ${
                                selected
                                  ? 'scale-110 border-[#1E88E5] ring-2 ring-[#1E88E5]/30'
                                  : 'border-slate-300 hover:scale-105'
                              }`}
                              style={{ background: theme.swatchCss }}
                            >
                              {selected && (
                                <Check
                                  className={`h-4 w-4 ${
                                    theme.isDark ? 'text-white' : 'text-[#0B1A2E]'
                                  }`}
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div
                        className="flex min-h-[140px] flex-col items-center justify-center rounded-xl p-5 text-center shadow-xs"
                        style={{ background: activeTextTheme.backgroundCss }}
                        data-testid="text-post-inline-preview"
                      >
                        {title.trim() && (
                          <p
                            className={`mb-1.5 max-w-lg font-display text-sm font-bold sm:text-base ${activeTextTheme.textColorClass}`}
                          >
                            {title.trim()}
                          </p>
                        )}
                        <p
                          className={`max-w-lg whitespace-pre-wrap text-sm font-semibold leading-relaxed sm:text-base ${activeTextTheme.textColorClass}`}
                        >
                          {body.trim() ||
                            'Your text-only campus post preview appears here...'}
                        </p>
                      </div>
                    </div>
                  </>
                ) : mode === 'ordinary' && ordinaryPostType === 'photo' ? (
                  /* FORMAT B: PHOTO POST (1 Shared Caption ABOVE 1-4 Photos, Zero Coloured Backgrounds, Zero Per-Photo Captions) */
                  <>
                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="composer-body"
                          className="block text-xs font-semibold text-[#0B1A2E]"
                        >
                          Shared Caption (displayed above your photos)
                        </label>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {body.length} / {BLUEPRINT_LIMITS.photoPostCaptionMax}
                        </span>
                      </div>
                      <textarea
                        id="composer-body"
                        rows={3}
                        maxLength={BLUEPRINT_LIMITS.photoPostCaptionMax}
                        disabled={isSubmitting}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Add one shared caption for all photos in this post (optional)..."
                        className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                      />
                    </div>

                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#0B1A2E]">
                          Photographs (1 to 4 required · Compressed automatically)
                        </span>
                        <button
                          type="button"
                          disabled={
                            isSubmitting ||
                            compressingCount > 0 ||
                            attachments.length >=
                              BLUEPRINT_LIMITS.mediaPostMaxCount
                          }
                          onClick={() => fileInputRef.current?.click()}
                          className="lasued-action-gradient inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
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
                          {compressingCount > 0
                            ? 'Compressing...'
                            : attachments.length > 0
                            ? `Add Photo (${attachments.length}/4)`
                            : 'Select Photos'}
                        </button>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ALL_IMAGE_FILE_ACCEPT}
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
                          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center transition-colors hover:border-[#1E88E5] hover:bg-slate-50 disabled:opacity-50"
                        >
                          <ImagePlus
                            className="h-6 w-6 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                          <span className="text-xs font-semibold text-[#0B1A2E]">
                            Tap to select 1 to 4 photos from your device gallery
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Photos display in balanced square grids with your shared caption above.
                          </span>
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <div
                            className="rounded-xl border border-slate-200 bg-white p-3"
                            data-testid="composer-inline-grid-preview"
                          >
                            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                              <span>
                                Grid Preview ({attachments.length}{' '}
                                {attachments.length === 1 ? 'photo' : 'photos'})
                              </span>
                              <span className="text-[#1E88E5]">
                                Tap any photo to inspect
                              </span>
                            </div>
                            <div className="mx-auto max-w-[300px]">
                              <SquareImageGrid
                                items={previewGridItems}
                                postLabel="Photo post preview"
                                showPerPhotoCaptions={false}
                                onImageClick={(idx) => setLightboxIndex(idx)}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {attachments.map((att, idx) => (
                              <div
                                key={att.clientId}
                                className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2"
                              >
                                <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#0B1A2E]">
                                  {att.previewUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => setLightboxIndex(idx)}
                                      aria-label={`Preview photograph ${idx + 1} full screen`}
                                      className="block h-full w-full cursor-zoom-in"
                                    >
                                      <img
                                        src={att.previewUrl}
                                        alt={`Selected photograph ${idx + 1}`}
                                        className="h-full w-full object-cover"
                                      />
                                    </button>
                                  ) : (
                                    <div className="h-full w-full animate-pulse bg-[#132946]" />
                                  )}
                                  <span className="pointer-events-none absolute top-1 left-1 rounded bg-[#0B1A2E]/80 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                                    #{idx + 1}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() =>
                                      handleRemoveAttachment(att.clientId)
                                    }
                                    aria-label={`Remove photograph ${idx + 1}`}
                                    className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-700"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                                <div className="flex items-center justify-between gap-1">
                                  <button
                                    type="button"
                                    disabled={isSubmitting || compressingCount > 0}
                                    onClick={() =>
                                      handleTriggerReplaceAttachment(att.clientId)
                                    }
                                    aria-label={`Replace photograph ${idx + 1}`}
                                    className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    <RefreshCw
                                      className="h-3 w-3 text-[#1E88E5]"
                                      aria-hidden="true"
                                    />
                                    Replace
                                  </button>
                                  {attachments.length > 1 ? (
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        disabled={isSubmitting || idx === 0}
                                        onClick={() =>
                                          handleMoveAttachment(idx, idx - 1)
                                        }
                                        aria-label={`Move photograph ${idx + 1} earlier`}
                                        className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                                      >
                                        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          isSubmitting ||
                                          idx === attachments.length - 1
                                        }
                                        onClick={() =>
                                          handleMoveAttachment(idx, idx + 1)
                                        }
                                        aria-label={`Move photograph ${idx + 1} later`}
                                        className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                                      >
                                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="truncate text-[11px] font-semibold text-slate-600 tabular-nums">
                                      {att.compressed
                                        ? formatByteSize(att.compressed.byteSize)
                                        : `#${idx + 1}`}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      </div>
                    </>
                  ) : mode === 'anonymous' && anonPostType === 'text' ? (
                    /* ANONYMOUS TEXT-ONLY POST (Background Colour/Gradient + Live Contrast Preview, Zero Photos) */
                    <>
                      <div>
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="composer-body"
                            className="block text-xs font-semibold text-[#0B1A2E]"
                          >
                            Anonymous Message
                          </label>
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {body.length} / {maxBodyLength}
                          </span>
                        </div>
                        <textarea
                          id="composer-body"
                          rows={4}
                          maxLength={maxBodyLength}
                          disabled={isSubmitting}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder="Share an anonymous thought, question, or campus story..."
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                        />
                      </div>

                      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E]">
                            <Palette
                              className="h-3.5 w-3.5 text-[#1E88E5]"
                              aria-hidden="true"
                            />
                            Background Colour or Gradient
                          </span>
                          <span className="text-[11px] font-medium text-slate-600">
                            {activeAnonTheme.label}
                          </span>
                        </div>

                        <div
                          role="radiogroup"
                          aria-label="Anonymous post background style"
                          className="flex flex-wrap items-center gap-2"
                        >
                          {ANONYMOUS_BACKGROUND_THEMES.map((theme) => {
                            const selected = anonBackgroundStyle === theme.id;
                            return (
                              <button
                                key={theme.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={theme.label}
                                title={theme.label}
                                disabled={isSubmitting}
                                onClick={() => setAnonBackgroundStyle(theme.id)}
                                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform ${
                                  selected
                                    ? 'scale-110 border-[#1E88E5] ring-2 ring-[#1E88E5]/30'
                                    : 'border-slate-300 hover:scale-105'
                                }`}
                                style={{ background: theme.swatchCss }}
                              >
                                {selected && (
                                  <Check
                                    className={`h-4 w-4 ${
                                      theme.isDark ? 'text-white' : 'text-[#0B1A2E]'
                                    }`}
                                    aria-hidden="true"
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {anonBackgroundStyle !== 'plain' ? (
                          <div
                            className="flex min-h-[136px] items-center justify-center rounded-xl p-5 text-center shadow-xs"
                            style={{ background: activeAnonTheme.backgroundCss }}
                            data-testid="anon-text-inline-preview"
                          >
                            <p
                              className={`max-w-lg whitespace-pre-wrap text-sm font-semibold leading-relaxed sm:text-base ${activeAnonTheme.textColorClass}`}
                            >
                              {body.trim() ||
                                'Your styled anonymous text preview appears here...'}
                            </p>
                          </div>
                        ) : (
                          <div
                            className="rounded-xl border border-slate-200 bg-white p-4"
                            data-testid="anon-text-inline-preview"
                          >
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                              {body.trim() ||
                                'Your clean white-card anonymous post preview appears here...'}
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* ANONYMOUS PHOTO POST (1 Shared Caption ABOVE 1-4 Photos, Zero Coloured Backgrounds, Zero Per-Photo Captions) */
                    <>
                      <div>
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="composer-body"
                            className="block text-xs font-semibold text-[#0B1A2E]"
                          >
                            Shared Caption (displayed above your photos)
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
                          placeholder="Add one shared caption above all photos in this anonymous post (optional)..."
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed text-[#0B1A2E] focus:border-[#1E88E5]"
                        />
                      </div>

                      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#0B1A2E]">
                            Photographs (1 to 4 required · EXIF &amp; filenames stripped)
                          </span>
                          <button
                            type="button"
                            disabled={
                              isSubmitting ||
                              compressingCount > 0 ||
                              attachments.length >=
                                BLUEPRINT_LIMITS.mediaPostMaxCount
                            }
                            onClick={() => fileInputRef.current?.click()}
                            className="lasued-action-gradient inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
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
                            {compressingCount > 0
                              ? 'Compressing...'
                              : attachments.length > 0
                              ? `Add Photo (${attachments.length}/4)`
                              : 'Select Photos'}
                          </button>

                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={ALL_IMAGE_FILE_ACCEPT}
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
                            className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center transition-colors hover:border-[#1E88E5] hover:bg-slate-50 disabled:opacity-50"
                          >
                            <ImagePlus
                              className="h-6 w-6 text-[#1E88E5]"
                              aria-hidden="true"
                            />
                            <span className="text-xs font-semibold text-[#0B1A2E]">
                              Tap to choose 1 to 4 photographs from gallery or camera
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Photos render in balanced square grids with your shared caption above.
                            </span>
                          </button>
                        ) : (
                          <div className="space-y-3">
                            <div
                              className="rounded-xl border border-slate-200 bg-white p-3"
                              data-testid="composer-inline-grid-preview"
                            >
                              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                                <span>
                                  Grid Preview ({attachments.length}{' '}
                                  {attachments.length === 1 ? 'photo' : 'photos'})
                                </span>
                                <span className="text-[#1E88E5]">
                                  Tap any photo to zoom
                                </span>
                              </div>
                              <div className="mx-auto max-w-[300px]">
                                <SquareImageGrid
                                  items={previewGridItems}
                                  postLabel="Anonymous photo post preview"
                                  showPerPhotoCaptions={false}
                                  onImageClick={(idx) => setLightboxIndex(idx)}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {attachments.map((att, idx) => (
                                <div
                                  key={att.clientId}
                                  className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2"
                                >
                                  <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#0B1A2E]">
                                    {att.previewUrl ? (
                                      <button
                                        type="button"
                                        onClick={() => setLightboxIndex(idx)}
                                        aria-label={`Preview anonymous photograph ${idx + 1} full screen`}
                                        className="block h-full w-full cursor-zoom-in"
                                      >
                                        <img
                                          src={att.previewUrl}
                                          alt={`Selected anonymous photograph ${idx + 1}`}
                                          className="h-full w-full object-cover"
                                        />
                                      </button>
                                    ) : (
                                      <div className="h-full w-full animate-pulse bg-[#132946]" />
                                    )}
                                    <span className="pointer-events-none absolute top-1 left-1 rounded bg-[#0B1A2E]/80 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                                      #{idx + 1}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() =>
                                        handleRemoveAttachment(att.clientId)
                                      }
                                      aria-label={`Remove photograph ${idx + 1}`}
                                      className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-700"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  </div>
                                  <div className="flex items-center justify-between gap-1">
                                    <button
                                      type="button"
                                      disabled={isSubmitting || compressingCount > 0}
                                      onClick={() =>
                                        handleTriggerReplaceAttachment(att.clientId)
                                      }
                                      aria-label={`Replace photograph ${idx + 1}`}
                                      className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-[#0B1A2E] hover:bg-slate-100 disabled:opacity-50"
                                    >
                                      <RefreshCw
                                        className="h-3 w-3 text-[#1E88E5]"
                                        aria-hidden="true"
                                      />
                                      Replace
                                    </button>
                                    {attachments.length > 1 ? (
                                      <div className="flex items-center gap-0.5">
                                        <button
                                          type="button"
                                          disabled={isSubmitting || idx === 0}
                                          onClick={() =>
                                            handleMoveAttachment(idx, idx - 1)
                                          }
                                          aria-label={`Move photograph ${idx + 1} earlier`}
                                          className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                                        >
                                          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={
                                            isSubmitting ||
                                            idx === attachments.length - 1
                                          }
                                          onClick={() =>
                                            handleMoveAttachment(idx, idx + 1)
                                          }
                                          aria-label={`Move photograph ${idx + 1} later`}
                                          className="flex h-7 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                                        >
                                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                        </button>
                                      </div>
                                    ) : (
                                      <p className="truncate text-[11px] font-semibold text-slate-600 tabular-nums">
                                        {att.compressed
                                          ? formatByteSize(att.compressed.byteSize)
                                          : `#${idx + 1}`}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
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

                {mode === 'ordinary' ? (
                  ordinaryPostType === 'text' ? (
                    <div
                      className="flex min-h-[180px] flex-col items-center justify-center rounded-xl p-6 text-center"
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
                        {body.trim() || 'No message entered yet.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
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
                      {attachments.length > 0 ? (
                        <SquareImageGrid
                          items={previewGridItems}
                          postLabel="Photo post preview"
                          showPerPhotoCaptions={false}
                          onImageClick={(idx) => setLightboxIndex(idx)}
                        />
                      ) : (
                        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                          Select 1 to 4 photos in Compose to preview the photo grid.
                        </p>
                      )}
                    </div>
                  )
                ) : anonPostType === 'photo' ? (
                  <div className="space-y-3">
                    {body.trim() && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {body.trim()}
                      </p>
                    )}
                    {attachments.length > 0 ? (
                      <SquareImageGrid
                        items={previewGridItems}
                        postLabel="Anonymous photo post preview"
                        showPerPhotoCaptions={false}
                        onImageClick={(idx) => setLightboxIndex(idx)}
                      />
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                        Select 1 to 4 photos in Compose to preview the photo grid.
                      </p>
                    )}
                  </div>
                ) : anonBackgroundStyle !== 'plain' ? (
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
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {body.trim() || 'No text entered yet.'}
                  </p>
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
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
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
                className="lasued-accent-gradient inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-3.5 w-3.5 text-sky-200" aria-hidden="true" />
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

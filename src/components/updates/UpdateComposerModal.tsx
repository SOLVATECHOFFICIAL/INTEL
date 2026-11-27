import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  ImagePlus,
  Loader2,
  Megaphone,
  Palette,
  Pin,
  Plus,
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
import { fetchOfficialPollById } from '../../services/officialPolls';
import type { ComposerImageAttachment } from '../../services/socialPosts';
import {
  ALLOWED_ADMIN_UPDATE_CATEGORIES,
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  resolveAdminUpdateFormat,
  type AdminUpdate,
  type AdminUpdateFormat,
  type CampusPoll,
  type PollResultsVisibility,
  type PollVoterScope,
  type PublicProfileProjection,
  type TextPostBackgroundId,
  type UserRole,
} from '../../types/database';
import {
  formatFirestoreOrAppError,
  isUndergroundSupremeAdminUser,
} from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
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
import {
  POLL_DURATION_PRESETS,
  clampPollMaxSelections,
  normalizeAndValidatePollDraft,
  type OfficialPollDraftInput,
} from '../../utils/polls';
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

function toLocalDateTimeInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface UpdateComposerModalProps {
  actorUid: string;
  actorRole: UserRole;
  actorName?: string;
  actorPhotoUrl?: string;
  actorPhotoImageId?: string;
  initialFormat?: AdminUpdateFormat;
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
  initialFormat = 'photo',
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
    () => lockedFormat ?? initialFormat
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

  // Official-Post-only Poll state
  const [existingPoll, setExistingPoll] = useState<CampusPoll | null>(null);
  const [loadedPollId, setLoadedPollId] = useState<string | null>(null);
  const loadingExistingPoll =
    Boolean(initialUpdate?.pollId) && loadedPollId !== initialUpdate?.pollId;
  const [attachPoll, setAttachPoll] = useState(Boolean(initialUpdate?.pollId));
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollDescription, setPollDescription] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollMaxSelections, setPollMaxSelections] = useState(2);
  const [pollAllowVoteChange, setPollAllowVoteChange] = useState(false);
  const [pollVoterScope, setPollVoterScope] =
    useState<PollVoterScope>('all_members');
  const [pollResultsVisibility, setPollResultsVisibility] =
    useState<PollResultsVisibility>('always');
  const [pollStatus, setPollStatus] = useState<'open' | 'closed'>('open');
  const [pollExpiresAtLocal, setPollExpiresAtLocal] = useState(() =>
    toLocalDateTimeInputValue(Date.now() + 3 * 24 * 60 * 60 * 1000)
  );

  useEffect(() => {
    const existingPollId = initialUpdate?.pollId;
    if (!existingPollId) {
      return;
    }
    let active = true;
    void fetchOfficialPollById(existingPollId)
      .then((poll) => {
        if (!active || !poll) return;
        setExistingPoll(poll);
        setAttachPoll(true);
        setPollQuestion(poll.question);
        setPollDescription(poll.description ?? '');
        setPollOptions(poll.options.length >= 2 ? poll.options : ['', '']);
        setPollAllowMultiple(poll.allowMultiple);
        setPollMaxSelections(Math.max(2, poll.maxSelections));
        setPollAllowVoteChange(poll.allowVoteChange);
        setPollVoterScope(poll.voterScope);
        setPollResultsVisibility(poll.resultsVisibility);
        setPollStatus(poll.status);
        const expMs = extractTimestampMs(poll.expiresAt);
        if (expMs) {
          setPollExpiresAtLocal(toLocalDateTimeInputValue(expMs));
        }
      })
      .finally(() => {
        if (active) setLoadedPollId(existingPollId);
      });
    return () => {
      active = false;
    };
  }, [initialUpdate?.pollId]);

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
      const failedCount = { value: 0 };
      const results = await Promise.allSettled(
        uniqueFiles.map((file) => compressImageFile(file, 'post'))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const compressed = result.value;
          const imageId = generateFirestoreDocId(COLLECTION_NAMES.mediaImages);
          nextItems.push({
            clientId: imageId,
            imageId,
            caption: '',
            compressed,
            previewUrl: compressed.dataUrl,
          });
        } else {
          failedCount.value += 1;
        }
      }
      if (nextItems.length > 0) {
        setAttachments((prev) =>
          [...prev, ...nextItems].slice(0, BLUEPRINT_LIMITS.mediaPostMaxCount)
        );
      }
      if (failedCount.value > 0 && nextItems.length === 0) {
        setErrorMessage(
          'Could not decode selected photograph(s). Try a standard photo or screenshot from your device.'
        );
      } else if (failedCount.value > 0) {
        setErrorMessage(
          `Attached ${nextItems.length} photo(s); ${failedCount.value} unsupported or corrupted file(s) skipped.`
        );
      }
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
      const compressed = await compressImageFile(file, 'post');
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

    let validatedPollDraft: OfficialPollDraftInput | null = null;
    if (attachPoll) {
      const parsedExpMs = new Date(pollExpiresAtLocal).getTime();
      const draft: OfficialPollDraftInput = {
        question: pollQuestion,
        description: pollDescription.trim() || undefined,
        options: pollOptions,
        allowMultiple: pollAllowMultiple,
        maxSelections: pollAllowMultiple ? pollMaxSelections : 1,
        allowVoteChange: pollAllowVoteChange,
        voterScope: pollVoterScope,
        resultsVisibility: pollResultsVisibility,
        expiresAtMs: parsedExpMs,
      };
      try {
        const existingExpMs = existingPoll
          ? extractTimestampMs(existingPoll.expiresAt)
          : null;
        const expiresChanged =
          !existingPoll ||
          existingExpMs === null ||
          Math.abs(parsedExpMs - existingExpMs) > 60_000;
        normalizeAndValidatePollDraft(draft, {
          requireFutureExpiry: expiresChanged,
        });
        validatedPollDraft = draft;
      } catch (pollErr) {
        setErrorMessage(
          pollErr instanceof Error
            ? pollErr.message
            : 'Invalid official poll settings.'
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
        const pollEdit = attachPoll && validatedPollDraft
          ? {
              mode: 'upsert' as const,
              existingPoll,
              draft: validatedPollDraft,
              status: pollStatus,
            }
          : existingPoll
          ? {
              mode: 'remove' as const,
              existingPollId: existingPoll.id,
            }
          : { mode: 'unchanged' as const };

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
          pollEdit,
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
          pollDraft: validatedPollDraft,
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A2E]/65 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-composer-heading"
    >
      <div className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Modal Header */}
        <div className="lasued-brand-gradient flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 text-white sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="lasued-action-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-xs">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="update-composer-heading"
                className="truncate font-display text-sm font-bold sm:text-base"
              >
                {isEditing ? 'Edit Official Update' : 'New Official Update'}
              </h2>
              <p className="truncate text-[11px] text-slate-300">
                {effectiveAuthorMode === 'official_desk'
                  ? 'Posting as LASUED Intel Official'
                  : `Posting as ${previewAuthorName}`}
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
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-5 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setActiveView('compose')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeView === 'compose'
                  ? 'bg-[#0B1A2E] text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setActiveView('preview')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeView === 'preview'
                  ? 'bg-[#0B1A2E] text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'text-slate-600 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Preview
            </button>
          </div>

          {effectiveAuthorMode === 'official_desk' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              <ShieldCheck
                className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400"
                aria-hidden="true"
              />
              Identity hidden
            </span>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {activeView === 'compose' ? (
              <>
                {/* Separate Format Selector (locked while editing) */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200">
                    Update Type
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
                          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#0B1A2E] dark:border-sky-400 dark:bg-sky-500/15 dark:text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <ImagePlus
                        className="h-4 w-4 text-[#1E88E5] dark:text-sky-400"
                        aria-hidden="true"
                      />
                      <span>Photos (1–4)</span>
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
                          ? 'border-[#1E88E5] bg-[#1E88E5]/10 text-[#0B1A2E] dark:border-sky-400 dark:bg-sky-500/15 dark:text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <Palette
                        className="h-4 w-4 text-[#1E88E5] dark:text-sky-400"
                        aria-hidden="true"
                      />
                      <span>Text Card</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {format === 'photo'
                      ? 'Add 1–4 photos with one shared caption.'
                      : 'Show your message on a coloured card (no photos).'}
                  </p>
                </div>

                {/* Category + Pin Row */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="update-category"
                      className="mb-1 block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                    >
                      Category
                    </label>
                    <select
                      id="update-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-sky-400"
                    >
                      {ALLOWED_ADMIN_UPDATE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat] ?? cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <label className="flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <span className="inline-flex items-center gap-1.5">
                        <Pin
                          className={`h-3.5 w-3.5 ${
                            isPinned ? 'text-[#1E88E5] dark:text-sky-400' : 'text-slate-400 dark:text-slate-500'
                          }`}
                          aria-hidden="true"
                        />
                        Pin to top
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
                    className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                  >
                    <span>Title (optional)</span>
                    <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-500">
                      {title.length}/{BLUEPRINT_LIMITS.postTitleMax}
                    </span>
                  </label>
                  <input
                    id="update-title"
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.postTitleMax}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., First Semester Exam Timetable"
                    className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] outline-none placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                  />
                </div>

                {/* Format-Specific Editor */}
                {format === 'photo' ? (
                  <>
                    <div>
                      <label
                        htmlFor="update-photo-caption"
                        className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                      >
                        <span>Caption</span>
                        <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-500">
                          {body.length}/{maxBodyLength}
                        </span>
                      </label>
                      <textarea
                        id="update-photo-caption"
                        rows={3}
                        maxLength={maxBodyLength}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Write a caption for these photos..."
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-[#0B1A2E] outline-none placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                      />
                    </div>

                    {/* Photo Picker + Responsive Management List */}
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-[#0B1A2E] dark:text-white">
                            Photos ({attachments.length}/
                            {BLUEPRINT_LIMITS.mediaPostMaxCount})
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Pick 1 to 4 photos. Optimized automatically.
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
                          className="lasued-action-gradient inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50"
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
                            {compressingCount > 0
                              ? 'Compressing...'
                              : attachments.length === 0
                              ? 'Add Photos'
                              : `Add More (${attachments.length}/4)`}
                          </span>
                        </button>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALL_IMAGE_FILE_ACCEPT}
                        multiple
                        onChange={(e) => void handleSelectPhotos(e)}
                        className="hidden"
                      />
                      <input
                        ref={replaceFileInputRef}
                        type="file"
                        accept={ALL_IMAGE_FILE_ACCEPT}
                        onChange={(e) => void handleReplacePhoto(e)}
                        className="hidden"
                      />

                      {attachments.length === 0 ? (
                        <button
                          type="button"
                          disabled={isSubmitting || compressingCount > 0}
                          onClick={() => fileInputRef.current?.click()}
                          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center transition-colors hover:border-[#1E88E5] hover:bg-sky-50/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-400 dark:hover:bg-sky-950/30"
                        >
                          <ImagePlus
                            className="h-6 w-6 text-[#1E88E5] dark:text-sky-400"
                            aria-hidden="true"
                          />
                          <span className="text-xs font-semibold text-[#0B1A2E] dark:text-white">
                            Tap to select 1 to 4 photos
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            JPEG, PNG, WebP, HEIC, GIF &amp; more supported.
                          </span>
                        </button>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                            {attachments.map((att, index) => (
                              <div
                                key={att.clientId}
                                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
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
                                      className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                      <ArrowLeft className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={index === attachments.length - 1}
                                      onClick={() => handleMovePhoto(index, 1)}
                                      aria-label={`Move photo ${index + 1} right`}
                                      className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
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
                                      className="flex h-7 w-7 items-center justify-center rounded text-[#1E88E5] hover:bg-blue-50 dark:text-sky-400 dark:hover:bg-sky-950/50"
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
                                      className="flex h-7 w-7 items-center justify-center rounded text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {att.compressed && (
                                  <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#0B1A2E] dark:text-slate-200">
                        <Type
                          className="h-3.5 w-3.5 text-[#1E88E5] dark:text-sky-400"
                          aria-hidden="true"
                        />
                        Card Colour
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
                                  ? 'scale-105 border-[#1E88E5] ring-2 ring-[#1E88E5]/35 dark:border-sky-400'
                                  : 'border-white shadow-xs hover:scale-105 dark:border-slate-800'
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
                        className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                      >
                        <span>Message</span>
                        <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-500">
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

                {/* Official-Post-Only Poll Builder */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B1A2E] text-white dark:bg-slate-800">
                        <BarChart3
                          className="h-4 w-4 text-[#1E88E5] dark:text-sky-400"
                          aria-hidden="true"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-[#0B1A2E] dark:text-white">
                          Add Poll (Optional)
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Let members vote right inside this update.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={attachPoll}
                      disabled={loadingExistingPoll || isSubmitting}
                      onClick={() => {
                        setAttachPoll((prev) => !prev);
                        setErrorMessage(null);
                      }}
                      data-testid="toggle-attach-official-poll"
                      className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                        attachPoll
                          ? 'border-[#1E88E5] bg-[#1E88E5] text-white'
                          : 'border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {attachPoll ? 'Included' : 'Add Poll'}
                    </button>
                  </div>

                  {loadingExistingPoll && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E88E5]" />
                      Loading poll...
                    </div>
                  )}

                  {attachPoll && !loadingExistingPoll && (
                    <div className="mt-3.5 space-y-3 border-t border-slate-200 pt-3.5 dark:border-slate-700">
                      <div>
                        <label
                          htmlFor="official-poll-question"
                          className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                        >
                          <span>Poll Question</span>
                          <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-500">
                            {pollQuestion.length}/{BLUEPRINT_LIMITS.pollQuestionMax}
                          </span>
                        </label>
                        <input
                          id="official-poll-question"
                          type="text"
                          maxLength={BLUEPRINT_LIMITS.pollQuestionMax}
                          value={pollQuestion}
                          onChange={(e) => setPollQuestion(e.target.value)}
                          placeholder="Ask a clear question..."
                          className="min-h-[40px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1A2E] outline-none placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="official-poll-description"
                          className="mb-1 flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                        >
                          <span>Note (Optional)</span>
                          <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-500">
                            {pollDescription.length}/{BLUEPRINT_LIMITS.pollDescriptionMax}
                          </span>
                        </label>
                        <textarea
                          id="official-poll-description"
                          rows={2}
                          maxLength={BLUEPRINT_LIMITS.pollDescriptionMax}
                          value={pollDescription}
                          onChange={(e) => setPollDescription(e.target.value)}
                          placeholder="Add short instructions or context..."
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#0B1A2E] outline-none placeholder:text-slate-400 focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#0B1A2E] dark:text-slate-200">
                            Options ({pollOptions.length}/{BLUEPRINT_LIMITS.pollOptionsMax})
                          </span>
                          {existingPoll && existingPoll.totalVotes > 0 ? (
                            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              Options locked after votes cast ({existingPoll.totalVotes})
                            </span>
                          ) : (
                            pollOptions.length < BLUEPRINT_LIMITS.pollOptionsMax && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPollOptions((prev) =>
                                    prev.length < BLUEPRINT_LIMITS.pollOptionsMax
                                      ? [...prev, '']
                                      : prev
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1A2E] hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Plus className="h-3 w-3 text-[#1E88E5] dark:text-sky-400" />
                                Add option
                              </button>
                            )
                          )}
                        </div>

                        <div className="space-y-2">
                          {pollOptions.map((opt, idx) => {
                            const optionsLocked = Boolean(
                              existingPoll && existingPoll.totalVotes > 0
                            );
                            return (
                              <div key={`poll-opt-input-${idx}`} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  disabled={optionsLocked}
                                  maxLength={BLUEPRINT_LIMITS.pollOptionMaxLength}
                                  value={opt}
                                  onChange={(e) =>
                                    setPollOptions((prev) =>
                                      prev.map((item, i) =>
                                        i === idx ? e.target.value : item
                                      )
                                    )
                                  }
                                  placeholder={`Option ${idx + 1}`}
                                  className="min-h-[38px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E] outline-none placeholder:text-slate-400 focus:border-[#1E88E5] disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                                />
                                {!optionsLocked &&
                                  pollOptions.length > BLUEPRINT_LIMITS.pollOptionsMin && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextOptions = pollOptions.filter(
                                          (_, i) => i !== idx
                                        );
                                        setPollOptions(nextOptions);
                                        setPollMaxSelections((current) =>
                                          clampPollMaxSelections(
                                            current,
                                            nextOptions.length
                                          )
                                        );
                                      }}
                                      aria-label={`Remove option ${idx + 1}`}
                                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-red-700 hover:bg-red-50 dark:border-slate-700 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="official-poll-expiry"
                            className="mb-1 block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                          >
                            Closes At
                          </label>
                          <input
                            id="official-poll-expiry"
                            type="datetime-local"
                            value={pollExpiresAtLocal}
                            onChange={(e) => setPollExpiresAtLocal(e.target.value)}
                            className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1A2E] outline-none focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400"
                          />
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {POLL_DURATION_PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() =>
                                  setPollExpiresAtLocal(
                                    toLocalDateTimeInputValue(
                                      Date.now() + preset.durationMs
                                    )
                                  )
                                }
                                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:border-[#1E88E5] hover:text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-white"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          <div>
                            <label
                              htmlFor="official-poll-voter-scope"
                              className="mb-1 block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                            >
                              Who Can Vote
                            </label>
                            <select
                              id="official-poll-voter-scope"
                              value={pollVoterScope}
                              onChange={(e) =>
                                setPollVoterScope(
                                  e.target.value as PollVoterScope
                                )
                              }
                              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400"
                            >
                              <option value="all_members">
                                All Signed-In Members
                              </option>
                              <option value="verified_and_above">
                                Verified, Moderator &amp; Admin Only
                              </option>
                            </select>
                          </div>

                          <div>
                            <label
                              htmlFor="official-poll-visibility"
                              className="mb-1 block text-xs font-semibold text-[#0B1A2E] dark:text-slate-200"
                            >
                              Results Visibility
                            </label>
                            <select
                              id="official-poll-visibility"
                              value={pollResultsVisibility}
                              onChange={(e) =>
                                setPollResultsVisibility(
                                  e.target.value as PollResultsVisibility
                                )
                              }
                              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#0B1A2E] outline-none focus:border-[#1E88E5] dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400"
                            >
                              <option value="always">Always Visible</option>
                              <option value="after_vote">
                                Visible After User Votes
                              </option>
                              <option value="after_close">
                                Visible After Poll Closes
                              </option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <span>Allow multiple choices</span>
                          <input
                            type="checkbox"
                            checked={pollAllowMultiple}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setPollAllowMultiple(checked);
                              if (checked && pollMaxSelections < 2) {
                                setPollMaxSelections(2);
                              }
                            }}
                            className="h-4 w-4 accent-[#1E88E5]"
                          />
                        </label>

                        <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <span>Allow vote changes</span>
                          <input
                            type="checkbox"
                            checked={pollAllowVoteChange}
                            onChange={(e) =>
                              setPollAllowVoteChange(e.target.checked)
                            }
                            className="h-4 w-4 accent-[#1E88E5]"
                          />
                        </label>
                      </div>

                      {pollAllowMultiple && (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                          <span className="font-semibold text-[#0B1A2E] dark:text-slate-200">
                            Max choices per person
                          </span>
                          <select
                            aria-label="Maximum selections per voter"
                            value={Math.min(
                              Math.max(2, pollMaxSelections),
                              Math.max(2, pollOptions.length)
                            )}
                            onChange={(e) =>
                              setPollMaxSelections(Number(e.target.value))
                            }
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          >
                            {Array.from(
                              {
                                length: Math.max(1, pollOptions.length - 1),
                              },
                              (_, i) => i + 2
                            ).map((num) => (
                              <option key={num} value={num}>
                                Up to {num} options
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {existingPoll && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                          <span className="font-semibold text-[#0B1A2E] dark:text-slate-200">
                            Poll Status
                          </span>
                          <div className="flex items-center gap-2">
                            <select
                              aria-label="Poll status"
                              value={pollStatus}
                              onChange={(e) =>
                                setPollStatus(
                                  e.target.value === 'closed' ? 'closed' : 'open'
                                )
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            >
                              <option value="open">Open</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Live Preview Card */
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center gap-3">
                  {effectiveAuthorMode === 'official_desk' ? (
                    <img
                      src="/pwa-192x192.png"
                      alt="LASUED Intel Official"
                      className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-[#0B1A2E] object-cover dark:border-slate-700"
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
                      <span className="text-sm font-bold text-[#0B1A2E] dark:text-white">
                        {previewAuthorName}
                      </span>
                      <RoleBadge badge={previewAuthorBadge} size="xs" />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
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
                          <h3 className="font-display text-base font-bold text-[#0B1A2E] dark:text-white">
                            {title.trim()}
                          </h3>
                        )}
                        {body.trim() && (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
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
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                        Add 1–4 photos in Write mode to preview them here.
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

                {attachPoll && (
                  <div className="mt-3.5 rounded-xl border border-[#1E88E5]/25 bg-slate-50/80 p-3.5 dark:border-sky-800/60 dark:bg-slate-900">
                    <p className="text-[11px] font-bold tracking-wide text-[#1E88E5] uppercase dark:text-sky-400">
                      Poll Preview
                    </p>
                    <p className="mt-0.5 font-display text-sm font-bold text-[#0B1A2E] overflow-wrap-anywhere dark:text-white">
                      {pollQuestion.trim() || 'Your poll question will appear here.'}
                    </p>
                    {pollDescription.trim() && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600 overflow-wrap-anywhere dark:text-slate-300">
                        {pollDescription.trim()}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {pollAllowMultiple
                        ? `Select up to ${Math.min(Math.max(2, pollMaxSelections), Math.max(2, pollOptions.filter((o) => o.trim()).length || pollOptions.length))} options`
                        : 'Select one option'}
                    </p>
                    <div className="mt-2.5 space-y-1.5">
                      {pollOptions
                        .map((o) => o.trim())
                        .filter(Boolean)
                        .map((opt, idx) => (
                          <div
                            key={`preview-opt-${idx}`}
                            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <span
                              aria-hidden="true"
                              className={`h-4 w-4 shrink-0 border border-slate-300 dark:border-slate-600 ${
                                pollAllowMultiple ? 'rounded' : 'rounded-full'
                              }`}
                            />
                            <span className="min-w-0 flex-1 whitespace-normal leading-snug overflow-wrap-anywhere">
                              {opt}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {uploadProgress && (
              <div className="space-y-1.5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-sky-900/60 dark:bg-sky-950/40">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0B1A2E] dark:text-sky-200">
                  <span>{uploadProgress.label}</span>
                  <span className="tabular-nums">{uploadProgress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-slate-800">
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
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                {errorMessage}
              </div>
            )}
          </div>

          {/* Always-Pinned Modal Footer outside scroll container */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="inline-flex min-h-[42px] items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || compressingCount > 0}
              data-testid="update-composer-submit-button"
              className="lasued-accent-gradient inline-flex min-h-[42px] items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5 text-sky-200" aria-hidden="true" />
              )}
              <span>
                {isSubmitting
                  ? isEditing
                    ? 'Saving...'
                    : 'Publishing...'
                  : compressingCount > 0
                  ? 'Compressing...'
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

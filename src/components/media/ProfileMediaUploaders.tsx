import React, { useRef, useState } from 'react';
import {
  Camera,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  removeProfileMediaImage,
  saveProfileMediaImage,
  type UploadProgressState,
} from '../../services/mediaStorage';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import {
  ALL_IMAGE_FILE_ACCEPT,
  compressImageFile,
  formatByteSize,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import { FirestoreImage } from './FirestoreImage';

interface ProfileMediaUploadersProps {
  uid: string;
  username?: string;
  fullName: string;
  currentPhotoImageId?: string;
  currentPhotoUrl?: string;
  currentCoverImageId?: string;
  currentCoverUrl?: string;
  isSuspended: boolean;
  onUpdated: () => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

export const ProfileMediaUploaders: React.FC<ProfileMediaUploadersProps> = ({
  uid,
  username,
  fullName,
  currentPhotoImageId,
  currentPhotoUrl,
  currentCoverImageId,
  currentCoverUrl,
  isSuspended,
  onUpdated,
  onStatus,
  onError,
}) => {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [pendingAvatar, setPendingAvatar] =
    useState<CompressedImageResult | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarProgress, setAvatarProgress] =
    useState<UploadProgressState | null>(null);

  const [pendingCover, setPendingCover] =
    useState<CompressedImageResult | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverProgress, setCoverProgress] =
    useState<UploadProgressState | null>(null);

  const hasSavedAvatar = Boolean(currentPhotoImageId || currentPhotoUrl);
  const hasSavedCover = Boolean(currentCoverImageId || currentCoverUrl);

  const handleSelectAvatar = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || avatarBusy || isSuspended) return;

    setAvatarBusy(true);
    setAvatarProgress({ percent: 15, label: 'Compressing profile photo...' });
    try {
      const compressed = await compressImageFile(file, 'avatar');
      setPendingAvatar(compressed);
      setAvatarProgress(null);
    } catch (error) {
      setAvatarProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not compress that profile photograph.'
        )
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleSaveAvatar = async () => {
    if (!pendingAvatar || avatarBusy || isSuspended) return;
    setAvatarBusy(true);
    try {
      await saveProfileMediaImage({
        uid,
        username,
        slot: 'avatar',
        compressed: pendingAvatar,
        previousImageId: currentPhotoImageId,
        onProgress: setAvatarProgress,
      });
      await onUpdated();
      setPendingAvatar(null);
      setAvatarProgress(null);
      onStatus('Profile picture compressed and saved.');
    } catch (error) {
      setAvatarProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Firebase could not save your profile picture. Please try again.'
        )
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (avatarBusy || isSuspended) return;
    if (pendingAvatar) {
      setPendingAvatar(null);
      return;
    }
    if (!hasSavedAvatar) return;

    setAvatarBusy(true);
    setAvatarProgress({ percent: 50, label: 'Removing profile picture...' });
    try {
      await removeProfileMediaImage({
        uid,
        username,
        slot: 'avatar',
        currentImageId: currentPhotoImageId,
      });
      await onUpdated();
      setAvatarProgress(null);
      onStatus('Profile picture removed.');
    } catch (error) {
      setAvatarProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not remove your profile picture right now.'
        )
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleSelectCover = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || coverBusy || isSuspended) return;

    setCoverBusy(true);
    setCoverProgress({ percent: 15, label: 'Compressing cover photo...' });
    try {
      const compressed = await compressImageFile(file, 'cover');
      setPendingCover(compressed);
      setCoverProgress(null);
    } catch (error) {
      setCoverProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not compress that cover photograph.'
        )
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const handleSaveCover = async () => {
    if (!pendingCover || coverBusy || isSuspended) return;
    setCoverBusy(true);
    try {
      await saveProfileMediaImage({
        uid,
        username,
        slot: 'cover',
        compressed: pendingCover,
        previousImageId: currentCoverImageId,
        onProgress: setCoverProgress,
      });
      await onUpdated();
      setPendingCover(null);
      setCoverProgress(null);
      onStatus('Cover photograph compressed and saved.');
    } catch (error) {
      setCoverProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Firebase could not save your cover photograph. Please try again.'
        )
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const handleRemoveCover = async () => {
    if (coverBusy || isSuspended) return;
    if (pendingCover) {
      setPendingCover(null);
      return;
    }
    if (!hasSavedCover) return;

    setCoverBusy(true);
    setCoverProgress({ percent: 50, label: 'Removing cover photo...' });
    try {
      await removeProfileMediaImage({
        uid,
        username,
        slot: 'cover',
        currentImageId: currentCoverImageId,
      });
      await onUpdated();
      setCoverProgress(null);
      onStatus('Cover photograph removed.');
    } catch (error) {
      setCoverProgress(null);
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not remove your cover photograph right now.'
        )
      );
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5">
      <div>
        <h3 className="font-display text-base font-bold text-[#0B1A2E]">
          Profile &amp; Cover Photographs
        </h3>
        <p className="mt-0.5 text-xs text-slate-600">
          Tap the plus button to choose directly from your phone gallery or
          camera. Photos are compressed automatically before saving.
        </p>
      </div>

      {/* PART 3: WIDE RECTANGULAR COVER PHOTOGRAPH */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#0B1A2E]">
            Cover Photograph
          </span>
          {pendingCover && (
            <span className="text-xs font-medium text-[#1E88E5] tabular-nums">
              Ready: {formatByteSize(pendingCover.byteSize)} · Previewing
            </span>
          )}
        </div>

        <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-[#0B1A2E] sm:h-48">
          {(pendingCover || hasSavedCover) && (
            <FirestoreImage
              directSrc={pendingCover?.dataUrl}
              imageId={pendingCover ? null : currentCoverImageId}
              fallbackUrl={pendingCover ? null : currentCoverUrl}
              alt={`${fullName}'s cover photograph`}
              eager
              className="h-full w-full object-cover"
              placeholderClassName="bg-[#0B1A2E]"
            />
          )}

          {/* Centered + button on placeholder (or accessible overlay trigger) */}
          <button
            type="button"
            disabled={coverBusy || isSuspended}
            onClick={() => coverInputRef.current?.click()}
            aria-label={
              pendingCover || hasSavedCover
                ? 'Change cover photograph'
                : 'Select cover photograph'
            }
            className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 transition-opacity ${
              pendingCover || hasSavedCover
                ? 'bg-[#0B1A2E]/35 opacity-0 hover:opacity-100 focus-visible:opacity-100'
                : 'bg-[#0B1A2E] text-white hover:bg-[#132946]'
            } disabled:cursor-not-allowed`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-xs">
              {coverBusy ? (
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-6 w-6" aria-hidden="true" />
              )}
            </span>
            <span className="text-xs font-semibold text-white">
              {pendingCover || hasSavedCover
                ? 'Change cover photo'
                : 'Add cover photo'}
            </span>
          </button>

          <input
            ref={coverInputRef}
            type="file"
            accept={ALL_IMAGE_FILE_ACCEPT}
            disabled={coverBusy || isSuspended}
            onChange={handleSelectCover}
            className="sr-only"
            data-testid="cover-file-input"
          />
        </div>

        {coverProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{coverProgress.label}</span>
              <span className="tabular-nums">{coverProgress.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-[#1E88E5] transition-all duration-200"
                style={{ width: `${coverProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={coverBusy || isSuspended}
            onClick={() => coverInputRef.current?.click()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
            {pendingCover || hasSavedCover ? 'Change Cover' : 'Select Cover'}
          </button>

          {pendingCover && (
            <button
              type="button"
              disabled={coverBusy || isSuspended}
              onClick={() => void handleSaveCover()}
              className="lasued-action-gradient inline-flex min-h-[42px] items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {coverBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Save Cover Photo
            </button>
          )}

          {(pendingCover || hasSavedCover) && (
            <button
              type="button"
              disabled={coverBusy || isSuspended}
              onClick={() => void handleRemoveCover()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {pendingCover ? 'Discard Preview' : 'Remove Cover'}
            </button>
          )}
        </div>
      </div>

      {/* PART 2: LARGE CIRCULAR PROFILE PICTURE */}
      <div className="border-t border-slate-200 pt-5">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full bg-[#0B1A2E] ring-4 ring-white shadow-sm sm:h-32 sm:w-32">
            {(pendingAvatar || hasSavedAvatar) && (
              <FirestoreImage
                directSrc={pendingAvatar?.dataUrl}
                imageId={pendingAvatar ? null : currentPhotoImageId}
                fallbackUrl={pendingAvatar ? null : currentPhotoUrl}
                alt={`${fullName}'s profile photograph`}
                eager
                className="h-full w-full object-cover"
                placeholderClassName="bg-[#0B1A2E]"
              />
            )}

            <button
              type="button"
              disabled={avatarBusy || isSuspended}
              onClick={() => avatarInputRef.current?.click()}
              aria-label={
                pendingAvatar || hasSavedAvatar
                  ? 'Change profile picture'
                  : 'Select profile picture'
              }
              className={`absolute inset-0 flex flex-col items-center justify-center rounded-full transition-opacity ${
                pendingAvatar || hasSavedAvatar
                  ? 'bg-[#0B1A2E]/45 opacity-0 hover:opacity-100 focus-visible:opacity-100'
                  : 'bg-[#0B1A2E] text-white hover:bg-[#132946]'
              } disabled:cursor-not-allowed`}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30">
                {avatarBusy ? (
                  <Loader2
                    className="h-6 w-6 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Plus className="h-6 w-6" aria-hidden="true" />
                )}
              </span>
            </button>

            <input
              ref={avatarInputRef}
              type="file"
              accept={ALL_IMAGE_FILE_ACCEPT}
              disabled={avatarBusy || isSuspended}
              onChange={handleSelectAvatar}
              className="sr-only"
              data-testid="avatar-file-input"
            />
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <p className="text-sm font-bold text-[#0B1A2E]">
                Profile Picture
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {pendingAvatar
                  ? `Preview ready (${formatByteSize(pendingAvatar.byteSize)}, ${pendingAvatar.width}×${pendingAvatar.height}). Save to apply.`
                  : 'Tap the circular frame or button below to pick a portrait from your phone gallery or camera.'}
              </p>
            </div>

            {avatarProgress && (
              <div className="max-w-xs space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>{avatarProgress.label}</span>
                  <span className="tabular-nums">{avatarProgress.percent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-[#1E88E5] transition-all duration-200"
                    style={{ width: `${avatarProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={avatarBusy || isSuspended}
                onClick={() => avatarInputRef.current?.click()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
              >
                <Camera className="h-3.5 w-3.5 text-[#1E88E5]" aria-hidden="true" />
                {pendingAvatar || hasSavedAvatar
                  ? 'Change Photo'
                  : 'Select Photo'}
              </button>

              {pendingAvatar && (
                <button
                  type="button"
                  disabled={avatarBusy || isSuspended}
                  onClick={() => void handleSaveAvatar()}
                  className="lasued-action-gradient inline-flex min-h-[42px] items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-60"
                >
                  {avatarBusy ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Save Profile Picture
                </button>
              )}

              {(pendingAvatar || hasSavedAvatar) && (
                <button
                  type="button"
                  disabled={avatarBusy || isSuspended}
                  onClick={() => void handleRemoveAvatar()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {pendingAvatar ? 'Discard Preview' : 'Remove Photo'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

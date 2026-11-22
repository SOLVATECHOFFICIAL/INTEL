import React, { useMemo, useRef, useState } from 'react';
import {
  Ban,
  Bell,
  Calendar,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  broadcastCampusEventNotification,
  createCampusEventRecord,
  deleteCampusEventRecord,
  markCampusEventCompletedRecord,
  toggleCampusEventPublishedRecord,
  updateCampusEventRecord,
} from '../../services/adminDashboard';
import {
  BLUEPRINT_LIMITS,
  type CampusEvent,
  type CampusEventStatus,
  type EventCategory,
  type PostMediaMeta,
  type UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import {
  canSendNewEventNotice,
  EVENT_CATEGORIES,
  filterAndSortEvents,
  formatEventDateTimeRange,
  getEventCategoryShortLabel,
  resolveEventLifecycle,
  type EventNotificationKind,
} from '../../utils/events';
import {
  compressImageFile,
  formatByteSize,
  type CompressedImageResult,
} from '../../utils/imageCompression';
import { FirestoreImage } from '../media/FirestoreImage';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminEventsTabProps {
  events: CampusEvent[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

type AdminEventFilterTab =
  | 'all'
  | 'published'
  | 'drafts'
  | 'completed'
  | 'cancelled';

function toDatetimeLocalValue(ms: number | null, fallbackOffsetDays = 7): string {
  const date = ms
    ? new Date(ms)
    : new Date(Date.now() + fallbackOffsetDays * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const AdminEventsTab: React.FC<AdminEventsTabProps> = ({
  events,
  loading,
  actorUid,
  actorRole,
  onSuccess,
  onError,
  onReload,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CampusEvent | null>(null);
  const [listFilter, setListFilter] = useState<AdminEventFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form fields
  const [category, setCategory] = useState<EventCategory>('seminar_workshop');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDateIso, setEventDateIso] = useState(() =>
    toDatetimeLocalValue(null, 7)
  );
  const [endDateIso, setEndDateIso] = useState('');
  const [timeLabel, setTimeLabel] = useState('');
  const [venue, setVenue] = useState('');
  const [organiser, setOrganiser] = useState('');
  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [registrationUrl, setRegistrationUrl] = useState('');
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [instructions, setInstructions] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [status, setStatus] = useState<CampusEventStatus>('upcoming');
  const [published, setPublished] = useState(true);

  // Media uploads
  const [retainedMediaItems, setRetainedMediaItems] = useState<PostMediaMeta[]>(
    []
  );
  const [newImages, setNewImages] = useState<CompressedImageResult[]>([]);
  const [compressingImages, setCompressingImages] = useState(false);

  // Optional notification broadcast on save
  const [notifyNewOnSave, setNotifyNewOnSave] = useState(false);
  const [notifyUpdateOnSave, setNotifyUpdateOnSave] = useState(false);
  const [updateNoticeNote, setUpdateNoticeNote] = useState('');

  // Inline notification sender drawer per event card
  const [alertTargetId, setAlertTargetId] = useState<string | null>(null);
  const [alertKind, setAlertKind] =
    useState<EventNotificationKind>('announcement');
  const [alertCustomMessage, setAlertCustomMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampusEvent | null>(null);
  const [nowMs] = useState(() => Date.now());

  const resetForm = () => {
    setEditing(null);
    setCategory('seminar_workshop');
    setTitle('');
    setDescription('');
    setEventDateIso(toDatetimeLocalValue(null, 7));
    setEndDateIso('');
    setTimeLabel('');
    setVenue('');
    setOrganiser('');
    setRegistrationRequired(false);
    setRegistrationUrl('');
    setOnlineMeetingUrl('');
    setContactInfo('');
    setInstructions('');
    setBannerUrl('');
    setStatus('upcoming');
    setPublished(true);
    setRetainedMediaItems([]);
    setNewImages([]);
    setNotifyNewOnSave(false);
    setNotifyUpdateOnSave(false);
    setUpdateNoticeNote('');
    setShowForm(false);
  };

  const startEdit = (evt: CampusEvent) => {
    setEditing(evt);
    setCategory(evt.category ?? 'other');
    setTitle(evt.title);
    setDescription(evt.description);
    setEventDateIso(toDatetimeLocalValue(extractTimestampMs(evt.eventDate)));
    const endMs = extractTimestampMs(evt.endDate);
    setEndDateIso(endMs ? toDatetimeLocalValue(endMs) : '');
    setTimeLabel(evt.timeLabel ?? '');
    setVenue(evt.venue);
    setOrganiser(evt.organiser);
    setRegistrationRequired(Boolean(evt.registrationRequired));
    setRegistrationUrl(evt.registrationUrl ?? '');
    setOnlineMeetingUrl(evt.onlineMeetingUrl ?? '');
    setContactInfo(evt.contactInfo ?? '');
    setInstructions(evt.instructions ?? '');
    setBannerUrl(evt.bannerUrl ?? '');
    setStatus(evt.status === 'past' ? 'completed' : evt.status);
    setPublished(evt.published !== false);
    setRetainedMediaItems(
      Array.isArray(evt.mediaItems) ? [...evt.mediaItems] : []
    );
    setNewImages([]);
    setNotifyNewOnSave(false);
    setNotifyUpdateOnSave(false);
    setUpdateNoticeNote('');
    setShowForm(true);
  };

  const totalImagesCount = retainedMediaItems.length + newImages.length;

  const handleSelectImages = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const remainingSlots =
      BLUEPRINT_LIMITS.mediaPostMaxCount - totalImagesCount;
    if (remainingSlots <= 0) {
      onError(
        `Maximum ${BLUEPRINT_LIMITS.mediaPostMaxCount} event images allowed.`
      );
      return;
    }

    const toProcess = files.slice(0, remainingSlots);
    setCompressingImages(true);
    try {
      const compressed: CompressedImageResult[] = [];
      for (const file of toProcess) {
        const res = await compressImageFile(file, 'post');
        compressed.push(res);
      }
      setNewImages((prev) => [...prev, ...compressed]);
    } catch (error) {
      onError(
        formatFirestoreOrAppError(
          error,
          'Could not process one or more selected images.'
        )
      );
    } finally {
      setCompressingImages(false);
    }
  };

  const canOfferNewNoticeInForm = useMemo(() => {
    if (!published || status === 'cancelled' || status === 'completed') {
      return false;
    }
    if (editing?.notifiedNewAt) return false;
    const startMs = Date.parse(eventDateIso);
    const endMs = endDateIso ? Date.parse(endDateIso) : undefined;
    if (!Number.isFinite(startMs)) return false;
    return canSendNewEventNotice(
      {
        published,
        status,
        eventDate: startMs,
        endDate: Number.isFinite(endMs) ? endMs : undefined,
        notifiedNewAt: editing?.notifiedNewAt,
      },
      nowMs
    );
  }, [published, status, editing?.notifiedNewAt, eventDateIso, endDateIso, nowMs]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || compressingImages) return;
    setSubmitting(true);
    try {
      const form = {
        category,
        title,
        description,
        eventDateIso,
        endDateIso: endDateIso.trim() || undefined,
        timeLabel,
        venue,
        organiser,
        registrationRequired,
        registrationUrl,
        onlineMeetingUrl,
        contactInfo,
        instructions,
        bannerUrl,
        status,
        published,
      };

      let savedEvent: CampusEvent;
      if (editing) {
        savedEvent = await updateCampusEventRecord({
          existing: editing,
          form,
          retainedMediaItems,
          newImages,
          actorUid,
          actorRole,
        });
      } else {
        savedEvent = await createCampusEventRecord({
          form,
          newImages,
          actorUid,
          actorRole,
        });
      }

      let notificationSummary = '';
      if (notifyNewOnSave && canSendNewEventNotice(savedEvent, Date.now())) {
        const noticeRes = await broadcastCampusEventNotification({
          event: savedEvent,
          kind: 'new',
          actorUid,
          actorRole,
        });
        notificationSummary = ` Sent alert to ${noticeRes.sentCount} members.`;
      } else if (
        editing &&
        notifyUpdateOnSave &&
        savedEvent.published !== false
      ) {
        const noticeRes = await broadcastCampusEventNotification({
          event: savedEvent,
          kind: savedEvent.status === 'cancelled' ? 'cancelled' : 'update',
          customMessage: updateNoticeNote.trim() || undefined,
          actorUid,
          actorRole,
        });
        notificationSummary = ` Sent update alert to ${noticeRes.sentCount} members.`;
      }

      onSuccess(
        editing
          ? `Updated event "${savedEvent.title}".${notificationSummary}`
          : `${
              published ? 'Published' : 'Saved draft'
            } event "${savedEvent.title}".${notificationSummary}`
      );
      resetForm();
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not save campus event.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePublished = async (evt: CampusEvent) => {
    if (busyId) return;
    const nextPublished = evt.published === false;
    setBusyId(evt.id);
    try {
      await toggleCampusEventPublishedRecord({
        event: evt,
        nextPublished,
        actorUid,
        actorRole,
      });
      onSuccess(
        nextPublished
          ? `Published "${evt.title}" to the public Events section.`
          : `Unpublished "${evt.title}" (moved to drafts).`
      );
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not update publishing status.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkCompleted = async (evt: CampusEvent) => {
    if (busyId) return;
    setBusyId(evt.id);
    try {
      await markCampusEventCompletedRecord({
        event: evt,
        actorUid,
        actorRole,
      });
      onSuccess(`Marked "${evt.title}" as completed.`);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not mark event as completed.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelEvent = async (evt: CampusEvent) => {
    if (busyId) return;
    setBusyId(evt.id);
    try {
      const startMs = extractTimestampMs(evt.eventDate) ?? Date.now();
      const endMs = extractTimestampMs(evt.endDate);
      await updateCampusEventRecord({
        existing: evt,
        form: {
          category: evt.category ?? 'other',
          title: evt.title,
          description: evt.description,
          eventDateIso: toDatetimeLocalValue(startMs),
          endDateIso: endMs ? toDatetimeLocalValue(endMs) : undefined,
          timeLabel: evt.timeLabel,
          venue: evt.venue,
          organiser: evt.organiser,
          registrationRequired: Boolean(evt.registrationRequired),
          registrationUrl: evt.registrationUrl,
          onlineMeetingUrl: evt.onlineMeetingUrl,
          contactInfo: evt.contactInfo,
          instructions: evt.instructions,
          bannerUrl: evt.bannerUrl,
          status: 'cancelled',
          published: evt.published !== false,
        },
        actorUid,
        actorRole,
      });
      onSuccess(`Marked "${evt.title}" as cancelled.`);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to cancel campus event.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSendManualAlert = async (evt: CampusEvent) => {
    if (busyId) return;
    setBusyId(evt.id);
    try {
      const res = await broadcastCampusEventNotification({
        event: evt,
        kind: alertKind,
        customMessage: alertCustomMessage.trim() || undefined,
        actorUid,
        actorRole,
      });
      onSuccess(
        `Sent ${alertKind} notification for "${evt.title}" to ${res.sentCount} active members.`
      );
      setAlertTargetId(null);
      setAlertCustomMessage('');
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not send event notification.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteCampusEventRecord({
        event: deleteTarget,
        actorUid,
        actorRole,
      });
      onSuccess(`Removed campus event "${deleteTarget.title}".`);
      setDeleteTarget(null);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to remove campus event.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const filteredEvents = useMemo(() => {
    const base = filterAndSortEvents(
      events,
      {
        query: searchQuery,
        includeUnpublished: true,
      },
      new Set(),
      nowMs
    );

    return base.filter((evt) => {
      const life = resolveEventLifecycle(evt, nowMs);
      if (listFilter === 'drafts') return !life.isPublished;
      if (listFilter === 'published') return life.isPublished;
      if (listFilter === 'completed') return life.state === 'completed';
      if (listFilter === 'cancelled') return life.state === 'cancelled';
      return true;
    });
  }, [events, searchQuery, listFilter, nowMs]);

  const counts = useMemo(() => {
    let drafts = 0;
    let pub = 0;
    let completed = 0;
    let cancelled = 0;
    for (const evt of events) {
      const life = resolveEventLifecycle(evt, nowMs);
      if (!life.isPublished) drafts += 1;
      else pub += 1;
      if (life.state === 'completed') completed += 1;
      if (life.state === 'cancelled') cancelled += 1;
    }
    return { total: events.length, drafts, published: pub, completed, cancelled };
  }, [events, nowMs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
            Campus Events Management ({events.length})
          </h2>
          <p className="text-xs text-slate-600">
            Create, edit, publish/unpublish drafts, upload event photos, mark
            completed, and send member notifications.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1A2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132844]"
        >
          <Plus className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
          {showForm ? 'Close Form' : 'Create Event'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5"
        >
          <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
            {editing ? `Edit Event: ${editing.title}` : 'New Campus Event'}
          </h3>

          {/* Category, Visibility & Status */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Event Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as EventCategory)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                {EVENT_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Visibility
              </label>
              <select
                value={published ? 'published' : 'draft'}
                onChange={(e) => setPublished(e.target.value === 'published')}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                <option value="published">Published (Visible to Members)</option>
                <option value="draft">Unpublished (Draft Only)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Event Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CampusEventStatus)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                <option value="upcoming">Auto (Upcoming / Ongoing / Completed)</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Event Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Faculty of Science Orientation & Tech Fair"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Organiser
              </label>
              <input
                type="text"
                required
                value={organiser}
                onChange={(e) => setOrganiser(e.target.value)}
                placeholder="e.g. LASUED Student Union / Department of Computer Science"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Start Date &amp; Time
              </label>
              <input
                type="datetime-local"
                required
                value={eventDateIso}
                onChange={(e) => setEventDateIso(e.target.value)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                End Date &amp; Time (optional)
              </label>
              <input
                type="datetime-local"
                value={endDateIso}
                onChange={(e) => setEndDateIso(e.target.value)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Custom Time Label (optional)
              </label>
              <input
                type="text"
                value={timeLabel}
                onChange={(e) => setTimeLabel(e.target.value)}
                placeholder="e.g. 10:00 AM – 2:00 PM"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Campus Venue / Location
              </label>
              <input
                type="text"
                required
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Senator Oluremi Tinubu Hall, Oto/Ijanikin Campus"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Contact Information (optional)
              </label>
              <input
                type="text"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="e.g. events@lasued.edu.ng or Student Affairs Room 4"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B1A2E]">
              Full Description
            </label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Schedule, guest speakers, topics, and key information for LASUED students..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E]"
            />
          </div>

          {/* Cover & Gallery Photos Upload */}
          <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[#0B1A2E]">
                  Event Cover &amp; Images ({totalImagesCount}/
                  {BLUEPRINT_LIMITS.mediaPostMaxCount})
                </p>
                <p className="text-[11px] text-slate-500">
                  The first image becomes the event cover photo. Upload up to 4
                  compressed images.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => void handleSelectImages(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={
                  compressingImages ||
                  totalImagesCount >= BLUEPRINT_LIMITS.mediaPostMaxCount
                }
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
              >
                {compressingImages ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ImagePlus
                    className="h-3.5 w-3.5 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                )}
                {compressingImages ? 'Compressing...' : 'Upload Image'}
              </button>
            </div>

            {(retainedMediaItems.length > 0 || newImages.length > 0) && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {retainedMediaItems.map((item, idx) => (
                  <div
                    key={item.imageId}
                    className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-[#0B1A2E]"
                  >
                    <FirestoreImage
                      imageId={item.imageId}
                      alt={`Existing event image ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRetainedMediaItems((prev) =>
                          prev.filter((m) => m.imageId !== item.imageId)
                        )
                      }
                      aria-label={`Remove existing image ${idx + 1}`}
                      className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-700"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {newImages.map((img, idx) => (
                  <div
                    key={`${img.width}-${img.byteSize}-${idx}`}
                    className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-[#0B1A2E]"
                  >
                    <img
                      src={img.dataUrl}
                      alt={`New event upload ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {formatByteSize(img.byteSize)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewImages((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      aria-label={`Remove new upload ${idx + 1}`}
                      className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-700"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                Or External Cover Image URL (optional fallback)
              </label>
              <input
                type="url"
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 block min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Official Registration URL (optional)
              </label>
              <input
                type="url"
                value={registrationUrl}
                onChange={(e) => setRegistrationUrl(e.target.value)}
                placeholder="https://... (leave empty if no link exists)"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Online Meeting Link (optional)
              </label>
              <input
                type="url"
                value={onlineMeetingUrl}
                onChange={(e) => setOnlineMeetingUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B1A2E]">
              Attendance Instructions / Requirements (optional)
            </label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Bring valid LASUED Student ID card for auditorium entry..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#0B1A2E]">
              <input
                type="checkbox"
                checked={registrationRequired}
                onChange={(e) => setRegistrationRequired(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
              />
              <span>Registration / RSVP is required for attendance</span>
            </label>

            {canOfferNewNoticeInForm && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={notifyNewOnSave}
                  onChange={(e) => setNotifyNewOnSave(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
                />
                <span>
                  Notify active members about this newly published event (sent
                  once per event)
                </span>
              </label>
            )}

            {editing && published && (
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={notifyUpdateOnSave}
                    onChange={(e) => setNotifyUpdateOnSave(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
                  />
                  <span>
                    Notify active members about updated schedule, venue, or
                    status
                  </span>
                </label>
                {notifyUpdateOnSave && (
                  <input
                    type="text"
                    maxLength={200}
                    value={updateNoticeNote}
                    onChange={(e) => setUpdateNoticeNote(e.target.value)}
                    placeholder="Optional short note (e.g. Venue moved to Main Auditorium)..."
                    className="min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-[#0B1A2E]"
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting || compressingImages}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              {editing
                ? 'Save Event Changes'
                : published
                  ? 'Publish Event'
                  : 'Save Draft'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={resetForm}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filter Tabs & Search */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: `All (${counts.total})` },
              { id: 'published', label: `Published (${counts.published})` },
              { id: 'drafts', label: `Drafts (${counts.drafts})` },
              { id: 'completed', label: `Completed (${counts.completed})` },
              { id: 'cancelled', label: `Cancelled (${counts.cancelled})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setListFilter(tab.id)}
              className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                listFilter === tab.id
                  ? 'bg-[#0B1A2E] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter admin events..."
            className="min-h-[36px] w-full rounded-lg border border-slate-300 bg-white pr-2.5 pl-8 text-xs text-[#0B1A2E]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading campus events...
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Calendar
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            {events.length === 0
              ? 'No campus events created yet'
              : 'No events match your current filter'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Create an event above to publish it or save it as a draft.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((evt) => {
            const lifecycle = resolveEventLifecycle(evt, nowMs);
            const isBusy = busyId === evt.id;
            const isPublished = evt.published !== false;
            const canNotifyNew = canSendNewEventNotice(evt, nowMs);
            const coverImageId = evt.mediaItems?.[0]?.imageId ?? null;

            return (
              <article
                key={evt.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    {coverImageId && (
                      <div className="hidden h-20 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-[#0B1A2E] sm:block">
                        <FirestoreImage
                          imageId={coverImageId}
                          alt={evt.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-semibold text-[#1E88E5]">
                          {getEventCategoryShortLabel(evt.category)}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`font-bold ${
                            !isPublished
                              ? 'text-amber-700'
                              : lifecycle.state === 'ongoing'
                                ? 'text-emerald-700'
                                : lifecycle.state === 'upcoming'
                                  ? 'text-[#1E88E5]'
                                  : lifecycle.state === 'cancelled'
                                    ? 'text-red-700'
                                    : 'text-slate-500'
                          }`}
                        >
                          {lifecycle.label}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-600 tabular-nums">
                          {formatEventDateTimeRange(evt)}
                        </span>
                        {Boolean(evt.notifiedNewAt) && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="text-[11px] font-medium text-emerald-700">
                              Alert sent
                            </span>
                          </>
                        )}
                      </div>

                      <h3 className="mt-1 font-display text-base font-bold text-[#0B1A2E]">
                        {evt.title}
                      </h3>
                      <p className="text-xs font-semibold text-slate-700">
                        {evt.organiser}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]" aria-hidden="true" />
                        <span>{evt.venue}</span>
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
                        {evt.description}
                      </p>

                      {evt.registrationUrl && (
                        <a
                          href={evt.registrationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
                        >
                          Official Registration Link
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => startEdit(evt)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleTogglePublished(evt)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isPublished ? (
                        <EyeOff className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                      )}
                      {isPublished ? 'Unpublish' : 'Publish'}
                    </button>

                    {isPublished &&
                      lifecycle.state !== 'completed' &&
                      lifecycle.state !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleMarkCompleted(evt)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Mark Completed
                        </button>
                      )}

                    {isPublished && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setAlertTargetId((curr) =>
                            curr === evt.id ? null : evt.id
                          );
                          setAlertKind(canNotifyNew ? 'new' : 'announcement');
                          setAlertCustomMessage('');
                        }}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#1E88E5] hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                        Notify
                      </button>
                    )}

                    {lifecycle.state !== 'cancelled' &&
                      lifecycle.state !== 'completed' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleCancelEvent(evt)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                          Cancel
                        </button>
                      )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setDeleteTarget(evt)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>

                {alertTargetId === evt.id && (
                  <div className="mt-3 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0B1A2E]">
                        Send Event Notification to Active Members
                      </span>
                      <button
                        type="button"
                        onClick={() => setAlertTargetId(null)}
                        className="text-[11px] font-semibold text-slate-500 hover:text-[#0B1A2E]"
                      >
                        Close
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <select
                        value={alertKind}
                        onChange={(e) =>
                          setAlertKind(e.target.value as EventNotificationKind)
                        }
                        className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E]"
                      >
                        {canNotifyNew && (
                          <option value="new">New Event Alert (Once)</option>
                        )}
                        <option value="update">
                          Schedule / Venue Change
                        </option>
                        <option value="cancelled">Event Cancellation</option>
                        <option value="announcement">
                          Organiser Announcement
                        </option>
                      </select>

                      <input
                        type="text"
                        maxLength={220}
                        value={alertCustomMessage}
                        onChange={(e) => setAlertCustomMessage(e.target.value)}
                        placeholder="Optional announcement note (e.g. Doors open at 9:30 AM)..."
                        className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1A2E] sm:col-span-2"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSendManualAlert(evt)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60"
                      >
                        {isBusy ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Send
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                        )}
                        Broadcast Notification
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="This permanently removes the event, its uploaded images, likes, and comments, and logs the removal."
        confirmLabel="Delete Event"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

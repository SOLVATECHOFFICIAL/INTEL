import React, { useState } from 'react';
import {
  Ban,
  Calendar,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  createCampusEventRecord,
  deleteCampusEventRecord,
  updateCampusEventRecord,
} from '../../services/adminDashboard';
import {
  categorizeEventByDate,
  type CampusEvent,
  type CampusEventStatus,
  type UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
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

function toDatetimeLocalValue(ms: number | null): string {
  const date = ms ? new Date(ms) : new Date(Date.now() + 7 * 86400000);
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
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CampusEvent | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDateIso, setEventDateIso] = useState(() =>
    toDatetimeLocalValue(null)
  );
  const [timeLabel, setTimeLabel] = useState('');
  const [venue, setVenue] = useState('');
  const [organiser, setOrganiser] = useState('');
  const [registrationUrl, setRegistrationUrl] = useState('');
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [status, setStatus] = useState<CampusEventStatus>('upcoming');

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampusEvent | null>(null);
  const [nowMs] = useState(() => Date.now());

  const resetForm = () => {
    setEditing(null);
    setTitle('');
    setDescription('');
    setEventDateIso(toDatetimeLocalValue(null));
    setTimeLabel('');
    setVenue('');
    setOrganiser('');
    setRegistrationUrl('');
    setOnlineMeetingUrl('');
    setInstructions('');
    setStatus('upcoming');
    setShowForm(false);
  };

  const startEdit = (evt: CampusEvent) => {
    setEditing(evt);
    setTitle(evt.title);
    setDescription(evt.description);
    setEventDateIso(toDatetimeLocalValue(extractTimestampMs(evt.eventDate)));
    setTimeLabel(evt.timeLabel ?? '');
    setVenue(evt.venue);
    setOrganiser(evt.organiser);
    setRegistrationUrl(evt.registrationUrl ?? '');
    setOnlineMeetingUrl(evt.onlineMeetingUrl ?? '');
    setInstructions(evt.instructions ?? '');
    setStatus(evt.status);
    setShowForm(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const form = {
        title,
        description,
        eventDateIso,
        timeLabel,
        venue,
        organiser,
        registrationUrl,
        onlineMeetingUrl,
        instructions,
        status,
      };
      if (editing) {
        await updateCampusEventRecord({
          existing: editing,
          form,
          actorUid,
          actorRole,
        });
        onSuccess(`Updated campus event "${title.trim()}".`);
      } else {
        await createCampusEventRecord({ form, actorUid, actorRole });
        onSuccess(`Published campus event "${title.trim()}".`);
      }
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

  const handleCancelEvent = async (evt: CampusEvent) => {
    if (busyId) return;
    setBusyId(evt.id);
    try {
      await updateCampusEventRecord({
        existing: evt,
        form: {
          title: evt.title,
          description: evt.description,
          eventDateIso: toDatetimeLocalValue(extractTimestampMs(evt.eventDate)),
          timeLabel: evt.timeLabel,
          venue: evt.venue,
          organiser: evt.organiser,
          registrationUrl: evt.registrationUrl,
          onlineMeetingUrl: evt.onlineMeetingUrl,
          instructions: evt.instructions,
          status: 'cancelled',
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
            Campus Events Calendar ({events.length})
          </h2>
          <p className="text-xs text-slate-600">
            Published events appear in the public Upcoming Events hub with
            automatic date classification.
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
          {showForm ? 'Close Form' : 'Publish Event'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
        >
          <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
            {editing ? `Edit Event: ${editing.title}` : 'New Campus Event'}
          </h3>

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
                placeholder="e.g. LASUED Student Union / Department"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Event Date &amp; Time
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
                Time Label (optional)
              </label>
              <input
                type="text"
                value={timeLabel}
                onChange={(e) => setTimeLabel(e.target.value)}
                placeholder="e.g. 10:00 AM – 2:00 PM"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CampusEventStatus)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

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
              Event Description
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Schedule, guest speakers, and key details for students..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Registration URL (optional)
              </label>
              <input
                type="url"
                value={registrationUrl}
                onChange={(e) => setRegistrationUrl(e.target.value)}
                placeholder="https://..."
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
              Attendance Instructions / Dress Code (optional)
            </label>
            <input
              type="text"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Bring valid LASUED ID card for entry..."
              className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1565C0] disabled:opacity-60"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              {editing ? 'Save Changes' : 'Publish Event'}
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

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading campus events...
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Calendar
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No campus events published yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Create an event above to list it in Upcoming Events.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((evt) => {
            const eventMs = extractTimestampMs(evt.eventDate) ?? nowMs;
            const effectiveStatus = categorizeEventByDate(
              eventMs,
              nowMs,
              evt.status
            );
            const isBusy = busyId === evt.id;

            return (
              <article
                key={evt.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 font-bold uppercase ${
                          effectiveStatus === 'upcoming'
                            ? 'bg-emerald-100 text-emerald-900'
                            : effectiveStatus === 'cancelled'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {effectiveStatus}
                      </span>
                      <span className="text-slate-600">
                        {new Date(eventMs).toLocaleDateString('en-NG', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {evt.timeLabel ? ` · ${evt.timeLabel}` : ''}
                      </span>
                    </div>

                    <h3 className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]">
                      {evt.title}
                    </h3>
                    <p className="text-xs font-semibold text-[#1E88E5]">
                      {evt.organiser}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {evt.venue}
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
                        Registration Link
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
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
                    {effectiveStatus !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleCancelEvent(evt)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        Cancel Event
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
              </article>
            );
          })}
        </div>
      )}

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="This permanently removes the event from the Upcoming Events calendar and logs the removal."
        confirmLabel="Delete Event"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

import React, { useState } from 'react';
import {
  Briefcase,
  Clock,
  Edit3,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  createOpportunityRecord,
  deleteOpportunityRecord,
  updateOpportunityRecord,
} from '../../services/adminDashboard';
import {
  resolveOpportunityEffectiveStatus,
  type Opportunity,
  type OpportunityCategory,
  type UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminOpportunitiesTabProps {
  opportunities: Opportunity[];
  loading: boolean;
  actorUid: string;
  actorRole: UserRole;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

const OPPORTUNITY_CATEGORIES: { value: OpportunityCategory; label: string }[] = [
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'internship', label: 'Internship' },
  { value: 'job', label: 'Job / Graduate Role' },
  { value: 'grant', label: 'Grant / Funding' },
  { value: 'competition', label: 'Competition' },
  { value: 'training', label: 'Training / Workshop' },
  { value: 'programme', label: 'Fellowship / Programme' },
];

function toDatetimeLocalValue(ms: number | null): string {
  const date = ms ? new Date(ms) : new Date(Date.now() + 14 * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const AdminOpportunitiesTab: React.FC<AdminOpportunitiesTabProps> = ({
  opportunities,
  loading,
  actorUid,
  actorRole,
  onSuccess,
  onError,
  onReload,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);

  const [category, setCategory] = useState<OpportunityCategory>('scholarship');
  const [title, setTitle] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [description, setDescription] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [requiredDocuments, setRequiredDocuments] = useState('');
  const [benefits, setBenefits] = useState('');
  const [applicationInstructions, setApplicationInstructions] = useState('');
  const [applicationUrl, setApplicationUrl] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [expiresAtIso, setExpiresAtIso] = useState(() =>
    toDatetimeLocalValue(null)
  );
  const [status, setStatus] = useState<'active' | 'expired'>('active');

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);

  const resetForm = () => {
    setEditing(null);
    setCategory('scholarship');
    setTitle('');
    setOrganisation('');
    setDescription('');
    setEligibility('');
    setRequiredDocuments('');
    setBenefits('');
    setApplicationInstructions('');
    setApplicationUrl('');
    setContactInfo('');
    setExpiresAtIso(toDatetimeLocalValue(null));
    setStatus('active');
    setShowForm(false);
  };

  const startEdit = (opp: Opportunity) => {
    setEditing(opp);
    setCategory(opp.category);
    setTitle(opp.title);
    setOrganisation(opp.organisation);
    setDescription(opp.description);
    setEligibility(opp.eligibility ?? '');
    setRequiredDocuments(opp.requiredDocuments ?? '');
    setBenefits(opp.benefits ?? '');
    setApplicationInstructions(opp.applicationInstructions ?? '');
    setApplicationUrl(opp.applicationUrl);
    setContactInfo(opp.contactInfo ?? '');
    setExpiresAtIso(toDatetimeLocalValue(extractTimestampMs(opp.expiresAt)));
    setStatus(opp.status);
    setShowForm(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const form = {
        category,
        title,
        organisation,
        description,
        eligibility,
        requiredDocuments,
        benefits,
        applicationInstructions,
        applicationUrl,
        contactInfo,
        expiresAtIso,
        status,
      };
      if (editing) {
        await updateOpportunityRecord({
          existing: editing,
          form,
          actorUid,
          actorRole,
        });
        onSuccess(`Updated opportunity "${title.trim()}".`);
      } else {
        await createOpportunityRecord({ form, actorUid, actorRole });
        onSuccess(`Published opportunity "${title.trim()}".`);
      }
      resetForm();
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not save opportunity record.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickExpire = async (opp: Opportunity) => {
    if (busyId) return;
    setBusyId(opp.id);
    try {
      await updateOpportunityRecord({
        existing: opp,
        form: {
          category: opp.category,
          title: opp.title,
          organisation: opp.organisation,
          description: opp.description,
          eligibility: opp.eligibility,
          requiredDocuments: opp.requiredDocuments,
          benefits: opp.benefits,
          applicationInstructions: opp.applicationInstructions,
          applicationUrl: opp.applicationUrl,
          contactInfo: opp.contactInfo,
          expiresAtIso: toDatetimeLocalValue(
            extractTimestampMs(opp.expiresAt)
          ),
          status: 'expired',
        },
        actorUid,
        actorRole,
      });
      onSuccess(`Marked "${opp.title}" as expired.`);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to expire opportunity.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteOpportunityRecord({
        opportunity: deleteTarget,
        actorUid,
        actorRole,
      });
      onSuccess(`Removed opportunity "${deleteTarget.title}".`);
      setDeleteTarget(null);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not delete opportunity.')
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
            Scholarships, Internships &amp; Campus Opportunities (
            {opportunities.length})
          </h2>
          <p className="text-xs text-slate-600">
            Published opportunities appear immediately in the public
            Opportunities section and contextual search.
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
          {showForm ? 'Close Form' : 'Publish Opportunity'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
        >
          <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
            {editing ? `Edit Opportunity: ${editing.title}` : 'New Opportunity'}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Category
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as OpportunityCategory)
                }
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                {OPPORTUNITY_CATEGORIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Deadline
              </label>
              <input
                type="datetime-local"
                required
                value={expiresAtIso}
                onChange={(e) => setExpiresAtIso(e.target.value)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Status
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'active' | 'expired')
                }
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                <option value="active">Active</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Opportunity Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lagos State Undergraduate Bursary 2026"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Organisation / Sponsor
              </label>
              <input
                type="text"
                required
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="e.g. Lagos State Scholarship Board"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B1A2E]">
              Overview &amp; Description
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summarize what the opportunity offers and who should apply..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Eligibility Criteria (optional)
              </label>
              <textarea
                rows={2}
                value={eligibility}
                onChange={(e) => setEligibility(e.target.value)}
                placeholder="CGPA requirements, level, faculty..."
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Required Documents (optional)
              </label>
              <textarea
                rows={2}
                value={requiredDocuments}
                onChange={(e) => setRequiredDocuments(e.target.value)}
                placeholder="Student ID, transcript, CV, admission letter..."
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Benefits / Stipend (optional)
              </label>
              <input
                type="text"
                value={benefits}
                onChange={(e) => setBenefits(e.target.value)}
                placeholder="e.g. Tuition grant + mentorship"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Contact Info (optional)
              </label>
              <input
                type="text"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="Support email or inquiry desk"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Application URL (https://...)
              </label>
              <input
                type="url"
                value={applicationUrl}
                onChange={(e) => setApplicationUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Application Instructions (optional)
              </label>
              <input
                type="text"
                value={applicationInstructions}
                onChange={(e) => setApplicationInstructions(e.target.value)}
                placeholder="Step-by-step submission instructions..."
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
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
              {editing ? 'Save Changes' : 'Publish Opportunity'}
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
          Loading opportunities...
        </div>
      ) : opportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Briefcase
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No opportunities published yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Click &ldquo;Publish Opportunity&rdquo; above to add real verified
            scholarships, internships, or grants.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {opportunities.map((opp) => {
            const expMs = extractTimestampMs(opp.expiresAt);
            const effectiveStatus = resolveOpportunityEffectiveStatus(
              opp,
              expMs
            );
            const isBusy = busyId === opp.id;

            return (
              <article
                key={opp.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold uppercase text-slate-700">
                        {opp.category}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 font-bold uppercase ${
                          effectiveStatus === 'active'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {effectiveStatus}
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        Deadline:{' '}
                        {expMs
                          ? new Date(expMs).toLocaleDateString('en-NG', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : 'Not set'}
                      </span>
                    </div>

                    <h3 className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]">
                      {opp.title}
                    </h3>
                    <p className="text-xs font-semibold text-[#1E88E5]">
                      {opp.organisation}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      {opp.description}
                    </p>

                    {opp.applicationUrl && (
                      <a
                        href={opp.applicationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline"
                      >
                        Application Portal
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => startEdit(opp)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    {effectiveStatus === 'active' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleQuickExpire(opp)}
                        className="inline-flex min-h-[36px] items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                      >
                        Mark Expired
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setDeleteTarget(opp)}
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
        description="This permanently removes the opportunity from LASUED Intel and logs the deletion in the audit trail."
        confirmLabel="Delete Opportunity"
        tone="danger"
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};

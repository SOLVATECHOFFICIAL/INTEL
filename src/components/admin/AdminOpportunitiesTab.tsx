import React, { useMemo, useState } from 'react';
import {
  Bell,
  Briefcase,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  EyeOff,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  broadcastOpportunityNotification,
  createOpportunityRecord,
  deleteOpportunityRecord,
  toggleOpportunityStatusRecord,
  toggleOpportunityVerifiedRecord,
  updateOpportunityRecord,
} from '../../services/adminDashboard';
import type {
  Opportunity,
  OpportunityCategory,
  OpportunityStatus,
  UserRole,
} from '../../types/database';
import { formatFirestoreOrAppError } from '../../utils/authValidation';
import { extractTimestampMs } from '../../utils/contextualSearch';
import {
  canSendDeadlineUpdateNotice,
  canSendNewOpportunityNotice,
  formatOpportunityDate,
  formatOpportunityDeadlineSummary,
  getOpportunityCategoryLabel,
  getSafeApplicationUrl,
  OPPORTUNITY_CATEGORIES,
  resolveOpportunityLifecycle,
} from '../../utils/opportunities';
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

type AdminFilterTab = 'all' | 'active' | 'unpublished' | 'closed';

function toDatetimeLocalValue(ms: number | null, fallbackOffsetDays = 14): string {
  const date = ms
    ? new Date(ms)
    : new Date(Date.now() + fallbackOffsetDays * 86400000);
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
  const [filterTab, setFilterTab] = useState<AdminFilterTab>('all');

  const [category, setCategory] = useState<OpportunityCategory>('scholarship');
  const [title, setTitle] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [description, setDescription] = useState('');
  const [whoCanApply, setWhoCanApply] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [requiredDocuments, setRequiredDocuments] = useState('');
  const [benefits, setBenefits] = useState('');
  const [applicationInstructions, setApplicationInstructions] = useState('');
  const [applicationUrl, setApplicationUrl] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [opensAtIso, setOpensAtIso] = useState('');
  const [expiresAtIso, setExpiresAtIso] = useState(() =>
    toDatetimeLocalValue(null)
  );
  const [status, setStatus] = useState<OpportunityStatus>('active');
  const [isVerified, setIsVerified] = useState(true);
  const [notifyNewOnSave, setNotifyNewOnSave] = useState(false);
  const [notifyDeadlineOnSave, setNotifyDeadlineOnSave] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);
  const [nowMs] = useState(() => Date.now());

  const resetForm = () => {
    setEditing(null);
    setCategory('scholarship');
    setTitle('');
    setOrganisation('');
    setDescription('');
    setWhoCanApply('');
    setEligibility('');
    setRequiredDocuments('');
    setBenefits('');
    setApplicationInstructions('');
    setApplicationUrl('');
    setContactInfo('');
    setOpensAtIso('');
    setExpiresAtIso(toDatetimeLocalValue(null));
    setStatus('active');
    setIsVerified(true);
    setNotifyNewOnSave(false);
    setNotifyDeadlineOnSave(false);
    setShowForm(false);
  };

  const startEdit = (opp: Opportunity) => {
    setEditing(opp);
    setCategory(opp.category);
    setTitle(opp.title);
    setOrganisation(opp.organisation);
    setDescription(opp.description);
    setWhoCanApply(opp.whoCanApply ?? '');
    setEligibility(opp.eligibility ?? '');
    setRequiredDocuments(opp.requiredDocuments ?? '');
    setBenefits(opp.benefits ?? '');
    setApplicationInstructions(opp.applicationInstructions ?? '');
    setApplicationUrl(opp.applicationUrl);
    setContactInfo(opp.contactInfo ?? '');
    const opensMs = extractTimestampMs(opp.opensAt);
    setOpensAtIso(opensMs ? toDatetimeLocalValue(opensMs) : '');
    setExpiresAtIso(toDatetimeLocalValue(extractTimestampMs(opp.expiresAt)));
    setStatus(opp.status);
    setIsVerified(Boolean(opp.isVerified));
    setNotifyNewOnSave(false);
    setNotifyDeadlineOnSave(false);
    setShowForm(true);
  };

  const counts = useMemo(() => {
    let activeCount = 0;
    let draftCount = 0;
    let closedCount = 0;
    for (const opp of opportunities) {
      const life = resolveOpportunityLifecycle(opp);
      if (life.state === 'unpublished') draftCount += 1;
      else if (life.state === 'closed') closedCount += 1;
      else activeCount += 1;
    }
    return { activeCount, draftCount, closedCount };
  }, [opportunities]);

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((opp) => {
      const life = resolveOpportunityLifecycle(opp);
      if (filterTab === 'unpublished') return life.state === 'unpublished';
      if (filterTab === 'closed') return life.state === 'closed';
      if (filterTab === 'active') {
        return life.state !== 'unpublished' && life.state !== 'closed';
      }
      return true;
    });
  }, [opportunities, filterTab]);

  const parsedFormDeadlineMs = Date.parse(expiresAtIso);
  const canSendNewInForm =
    status === 'active' &&
    Number.isFinite(parsedFormDeadlineMs) &&
    parsedFormDeadlineMs > nowMs &&
    !editing?.notifiedNewAt;

  const canSendDeadlineInForm =
    Boolean(editing) &&
    status === 'active' &&
    Boolean(editing?.notifiedNewAt) &&
    Number.isFinite(parsedFormDeadlineMs) &&
    parsedFormDeadlineMs > nowMs &&
    canSendDeadlineUpdateNotice(editing!, parsedFormDeadlineMs, nowMs);

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
        whoCanApply,
        eligibility,
        requiredDocuments,
        benefits,
        applicationInstructions,
        applicationUrl,
        contactInfo,
        opensAtIso: opensAtIso.trim() || undefined,
        expiresAtIso,
        isVerified,
        status,
      };

      let savedRecord: Opportunity;
      if (editing) {
        savedRecord = await updateOpportunityRecord({
          existing: editing,
          form,
          actorUid,
          actorRole,
        });
      } else {
        savedRecord = await createOpportunityRecord({
          form,
          actorUid,
          actorRole,
        });
      }

      let notificationNote = '';
      if (notifyNewOnSave && canSendNewOpportunityNotice(savedRecord)) {
        const res = await broadcastOpportunityNotification({
          opportunity: savedRecord,
          kind: 'new',
          actorUid,
          actorRole,
        });
        notificationNote = ` Notified ${res.sentCount} active members.`;
      } else if (
        notifyDeadlineOnSave &&
        canSendDeadlineUpdateNotice(savedRecord, parsedFormDeadlineMs)
      ) {
        const res = await broadcastOpportunityNotification({
          opportunity: savedRecord,
          kind: 'deadline',
          actorUid,
          actorRole,
        });
        notificationNote = ` Sent deadline update to ${res.sentCount} members.`;
      }

      onSuccess(
        `${editing ? 'Updated' : 'Saved'} opportunity "${title.trim()}".${notificationNote}`
      );
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

  const handleToggleStatus = async (
    opp: Opportunity,
    nextStatus: OpportunityStatus,
    successText: string
  ) => {
    if (busyId) return;
    setBusyId(opp.id);
    try {
      await toggleOpportunityStatusRecord({
        opportunity: opp,
        nextStatus,
        actorUid,
        actorRole,
      });
      onSuccess(successText);
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to update opportunity status.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleVerified = async (opp: Opportunity) => {
    if (busyId) return;
    setBusyId(opp.id);
    try {
      const nextVerified = !opp.isVerified;
      await toggleOpportunityVerifiedRecord({
        opportunity: opp,
        nextVerified,
        actorUid,
        actorRole,
      });
      onSuccess(
        nextVerified
          ? `Marked "${opp.title}" as verified.`
          : `Removed verified mark from "${opp.title}".`
      );
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Unable to update verification status.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSendNotice = async (
    opp: Opportunity,
    kind: 'new' | 'deadline'
  ) => {
    if (busyId) return;
    setBusyId(opp.id);
    try {
      const res = await broadcastOpportunityNotification({
        opportunity: opp,
        kind,
        actorUid,
        actorRole,
      });
      onSuccess(
        kind === 'new'
          ? `Sent new-opportunity notice for "${opp.title}" to ${res.sentCount} members.`
          : `Sent deadline update notice for "${opp.title}" to ${res.sentCount} members.`
      );
      onReload();
    } catch (error) {
      onError(
        formatFirestoreOrAppError(error, 'Could not broadcast notification.')
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
            Manage Opportunities ({opportunities.length})
          </h2>
          <p className="text-xs text-slate-600">
            Publish scholarships, grants, internships, trainings, and career
            notices, manage drafts, verify listings, and send deduplicated
            member alerts.
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
          {showForm ? 'Close Form' : 'New Opportunity'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
        >
          <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
            {editing ? `Edit Opportunity: ${editing.title}` : 'Create Opportunity'}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Publishing Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OpportunityStatus)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              >
                <option value="active">Published (Active)</option>
                <option value="unpublished">Unpublished (Draft)</option>
                <option value="expired">Closed / Expired</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Opening Date (optional)
              </label>
              <input
                type="datetime-local"
                value={opensAtIso}
                onChange={(e) => setOpensAtIso(e.target.value)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Application Deadline
              </label>
              <input
                type="datetime-local"
                required
                value={expiresAtIso}
                onChange={(e) => setExpiresAtIso(e.target.value)}
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
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
                Organisation / Institution
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
              Full Description
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain what the opportunity covers, schedule details, and overview for LASUED students..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-[#0B1A2E]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Who Can Apply (optional)
              </label>
              <textarea
                rows={2}
                value={whoCanApply}
                onChange={(e) => setWhoCanApply(e.target.value)}
                placeholder="e.g. Full-time 200L–400L undergraduates in Science & Education"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Eligibility Requirements (optional)
              </label>
              <textarea
                rows={2}
                value={eligibility}
                onChange={(e) => setEligibility(e.target.value)}
                placeholder="Minimum CGPA, enrolment status, age, or state requirements..."
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Benefits (optional)
              </label>
              <textarea
                rows={2}
                value={benefits}
                onChange={(e) => setBenefits(e.target.value)}
                placeholder="e.g. Tuition grant, monthly stipend, certificate, or mentorship"
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
                placeholder="Student ID, official transcript, CV, admission letter..."
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#0B1A2E]">
                Application Link (optional https://...)
              </label>
              <input
                type="url"
                value={applicationUrl}
                onChange={(e) => setApplicationUrl(e.target.value)}
                placeholder="https://... (leave blank if application is by email or office)"
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
                placeholder="Inquiry email, office room, or phone line"
                className="mt-1 block min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0B1A2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0B1A2E]">
              Application Instructions (optional)
            </label>
            <textarea
              rows={2}
              value={applicationInstructions}
              onChange={(e) => setApplicationInstructions(e.target.value)}
              placeholder="Step-by-step submission instructions..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1A2E]"
            />
          </div>

          {/* Verification & Deduplicated Notification Toggles */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#0B1A2E]">
              <input
                type="checkbox"
                checked={isVerified}
                onChange={(e) => setIsVerified(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
              />
              <span>
                Mark as Verified Opportunity (only check when the source has
                been officially confirmed)
              </span>
            </label>

            {canSendNewInForm ? (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={notifyNewOnSave}
                  onChange={(e) => setNotifyNewOnSave(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
                />
                <span>
                  Notify active members about this new opportunity (one-time
                  alert per opportunity)
                </span>
              </label>
            ) : editing?.notifiedNewAt ? (
              <p className="text-[11px] text-slate-500">
                Initial new-opportunity alert already sent on{' '}
                {formatOpportunityDate(editing.notifiedNewAt)}.
              </p>
            ) : null}

            {canSendDeadlineInForm && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={notifyDeadlineOnSave}
                  onChange={(e) => setNotifyDeadlineOnSave(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#1E88E5]"
                />
                <span>
                  Notify active members about the updated closing deadline
                </span>
              </label>
            )}
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
              {editing ? 'Save Changes' : 'Save Opportunity'}
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

      {/* Admin Status Filter Tabs */}
      <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
        {(
          [
            { id: 'all', label: `All (${opportunities.length})` },
            { id: 'active', label: `Published (${counts.activeCount})` },
            { id: 'unpublished', label: `Drafts (${counts.draftCount})` },
            { id: 'closed', label: `Closed (${counts.closedCount})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterTab(tab.id)}
            className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
              filterTab === tab.id
                ? 'bg-white text-[#0B1A2E] shadow-xs'
                : 'text-slate-600 hover:text-[#0B1A2E]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading opportunities...
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <Briefcase
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No opportunities in this view
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Click &ldquo;New Opportunity&rdquo; above to add scholarships,
            grants, internships, trainings, or conferences.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOpportunities.map((opp) => {
            const lifecycle = resolveOpportunityLifecycle(opp, nowMs);
            const expMs = lifecycle.expiresAtMs ?? 0;
            const isOverdueActive =
              opp.status === 'active' && lifecycle.isPastDeadline;
            const canSendNew = canSendNewOpportunityNotice(opp, nowMs);
            const canSendDeadline =
              Boolean(opp.notifiedNewAt) &&
              canSendDeadlineUpdateNotice(opp, expMs, nowMs);
            const safeUrl = getSafeApplicationUrl(opp.applicationUrl);
            const isBusy = busyId === opp.id;

            return (
              <article
                key={opp.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[#1E88E5]">
                        {getOpportunityCategoryLabel(opp.category)}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span
                        className={`font-bold ${
                          lifecycle.state === 'unpublished'
                            ? 'text-slate-600'
                            : lifecycle.state === 'closing_soon'
                              ? 'text-amber-700'
                              : lifecycle.state === 'closed'
                                ? 'text-slate-500'
                                : 'text-emerald-700'
                        }`}
                      >
                        {lifecycle.label}
                      </span>
                      {opp.isVerified === true && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-[#0B1A2E]">
                            <ShieldCheck
                              className="h-3.5 w-3.5 text-[#1E88E5]"
                              aria-hidden="true"
                            />
                            Verified
                          </span>
                        </>
                      )}
                      {isOverdueActive && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-semibold text-amber-700">
                            Deadline passed (shown as Closed)
                          </span>
                        </>
                      )}
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

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Deadline: {formatOpportunityDate(opp.expiresAt)} (
                        {formatOpportunityDeadlineSummary(lifecycle)})
                      </span>
                      {Boolean(opp.notifiedNewAt) && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Members alerted
                        </span>
                      )}
                      {safeUrl && (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#1E88E5] hover:underline"
                        >
                          Application Link
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => startEdit(opp)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleToggleVerified(opp)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-60"
                    >
                      <ShieldCheck
                        className={`h-3.5 w-3.5 ${
                          opp.isVerified ? 'text-[#1E88E5]' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      {opp.isVerified ? 'Unverify' : 'Verify'}
                    </button>

                    {opp.status === 'unpublished' ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handleToggleStatus(
                            opp,
                            'active',
                            `Published "${opp.title}".`
                          )
                        }
                        className="inline-flex min-h-[34px] items-center rounded-lg bg-[#0B1A2E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#132844] disabled:opacity-60"
                      >
                        Publish
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handleToggleStatus(
                            opp,
                            'unpublished',
                            `Moved "${opp.title}" to drafts (unpublished).`
                          )
                        }
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        Unpublish
                      </button>
                    )}

                    {opp.status === 'active' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handleToggleStatus(
                            opp,
                            'expired',
                            `Marked "${opp.title}" as closed.`
                          )
                        }
                        className="inline-flex min-h-[34px] items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                      >
                        Mark Closed
                      </button>
                    )}

                    {canSendNew && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSendNotice(opp, 'new')}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#1E88E5]/40 bg-[#1E88E5]/10 px-2.5 py-1 text-xs font-semibold text-[#1E88E5] hover:bg-[#1E88E5]/20 disabled:opacity-60"
                      >
                        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                        Send Notice
                      </button>
                    )}

                    {canSendDeadline && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSendNotice(opp, 'deadline')}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#1E88E5]/40 bg-[#1E88E5]/10 px-2.5 py-1 text-xs font-semibold text-[#1E88E5] hover:bg-[#1E88E5]/20 disabled:opacity-60"
                      >
                        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                        Notify Deadline
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setDeleteTarget(opp)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
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

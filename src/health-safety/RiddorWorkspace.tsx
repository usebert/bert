import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../permissions";
import { canInvestigateIncidents } from "../permissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  fetchRiddorList,
  HEALTH_SAFETY_OFFLINE_WRITE_MESSAGE,
  readCachedRiddorList,
  updateRiddorRecord,
} from "../services/healthSafetyService";
import type { RiddorRecord, RiddorSubmissionStatus } from "../types/healthSafety";
import {
  buildRiddorListItems,
  filterRiddorItems,
  filterRiddorItemsForTab,
  RIDDOR_TAB_LABELS,
  riddorDecisionLabel,
  riddorDecisionVariant,
  riddorSubmissionLabel,
  riddorSubmissionVariant,
  sortRiddorItems,
  type RiddorFilterState,
  type RiddorWorkspaceTab,
} from "./adapters/riddorListAdapter";

export type RiddorWorkspaceProps = {
  role: Role;
  companyFolderId: string;
  offlineMode?: boolean;
  initialRiddorId?: string;
  onBack?: () => void;
};

const TABS: RiddorWorkspaceTab[] = [
  "all",
  "decision_required",
  "information_required",
  "likely_reportable",
  "not_reportable",
  "confirmed_reportable",
  "open_submissions",
];

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500";

function formatDate(dateKey?: string) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function RiddorWorkspace({
  role,
  companyFolderId,
  offlineMode = false,
  initialRiddorId,
  onBack,
}: RiddorWorkspaceProps) {
  const folderId = String(companyFolderId || "").trim();
  const canManage = canInvestigateIncidents(role);
  const isWriteBlocked = offlineMode || (typeof navigator !== "undefined" && navigator.onLine === false);

  const [records, setRecords] = useState<RiddorRecord[]>(() => readCachedRiddorList(folderId)?.items || []);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [activeTab, setActiveTab] = useState<RiddorWorkspaceTab>("decision_required");
  const [filters, setFilters] = useState<RiddorFilterState>({ query: "", submissionStatus: "" });
  const [selectedId, setSelectedId] = useState(initialRiddorId || "");
  const [saving, setSaving] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<RiddorSubmissionStatus>("not_started");
  const [submissionReference, setSubmissionReference] = useState("");
  const [authorityNotificationMethod, setAuthorityNotificationMethod] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");

  const loadRecords = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!folderId) return;
      const hadCache = records.length > 0;
      if (!hadCache) setLoading(true);
      setLoadError("");
      try {
        const result = await fetchRiddorList(folderId, { refresh: options.refresh });
        setRecords(result.items || []);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load RIDDOR records.");
      } finally {
        setLoading(false);
      }
    },
    [folderId, records.length],
  );

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (initialRiddorId) {
      setSelectedId(initialRiddorId);
    }
  }, [initialRiddorId]);

  const selected = records.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    if (!selected) return;
    setSubmissionStatus(selected.submissionStatus);
    setSubmissionReference(selected.submissionReference);
    setAuthorityNotificationMethod(selected.authorityNotificationMethod);
    setFollowUpRequired(selected.followUpRequired);
    setFollowUpDate(selected.followUpDate);
  }, [selected]);

  const listItems = useMemo(() => {
    const items = buildRiddorListItems(records);
    const tabbed = filterRiddorItemsForTab(items, activeTab);
    const filtered = filterRiddorItems(tabbed, filters);
    return sortRiddorItems(filtered);
  }, [records, activeTab, filters]);

  const tabCounts = useMemo(() => {
    const items = buildRiddorListItems(records);
    return Object.fromEntries(
      TABS.map((tab) => [tab, filterRiddorItemsForTab(items, tab).length]),
    ) as Record<RiddorWorkspaceTab, number>;
  }, [records]);

  const saveSubmissionDetails = async () => {
    if (!selected) return;
    if (isWriteBlocked) {
      setActionError(HEALTH_SAFETY_OFFLINE_WRITE_MESSAGE);
      return;
    }
    setSaving(true);
    setActionError("");
    setActionNotice("");
    try {
      await updateRiddorRecord(folderId, selected.id, {
        submissionStatus,
        submissionReference: submissionReference.trim(),
        authorityNotificationMethod: authorityNotificationMethod.trim(),
        followUpRequired,
        followUpDate,
        submittedAt: submissionStatus === "submitted" ? new Date().toISOString() : selected.submittedAt,
      });
      setActionNotice("RIDDOR submission details updated.");
      await loadRecords({ refresh: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update RIDDOR record.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Health & Safety"
        title="RIDDOR workspace"
        description="Track reportable incident decisions and HSE submission status."
        secondaryActions={
          onBack ? (
            <Button type="button" variant="secondary" onClick={onBack}>
              Back
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <Section>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
            <button type="button" onClick={() => void loadRecords({ refresh: true })} className="ml-3 font-semibold underline">
              Retry
            </button>
          </div>
        </Section>
      ) : null}
      {actionError ? (
        <Section>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{actionError}</p>
        </Section>
      ) : null}
      {actionNotice ? (
        <Section>
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{actionNotice}</p>
        </Section>
      ) : null}

      <Section>
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <Button
              key={tab}
              type="button"
              variant={activeTab === tab ? "primary" : "secondary"}
              className="min-h-[2.75rem]"
              onClick={() => setActiveTab(tab)}
            >
              {RIDDOR_TAB_LABELS[tab]} ({tabCounts[tab] || 0})
            </Button>
          ))}
        </div>
      </Section>

      <Section title="RIDDOR register">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="riddor-search">
              Search
            </label>
            <input
              id="riddor-search"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Incident ID, reference, outcome"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="riddor-submission-status">
              Submission status
            </label>
            <select
              id="riddor-submission-status"
              value={filters.submissionStatus}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  submissionStatus: event.target.value as RiddorFilterState["submissionStatus"],
                }))
              }
              className={inputClass}
            >
              <option value="">All submission statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_preparation">In preparation</option>
              <option value="submitted">Submitted</option>
              <option value="follow_up_required">Follow-up required</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Incident</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Decision date</th>
                <th className="px-4 py-3">Submission</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Loading RIDDOR records…
                  </td>
                </tr>
              ) : listItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState
                      title="No RIDDOR records match these filters"
                      description="RIDDOR assessments are created from incident investigations."
                    />
                  </td>
                </tr>
              ) : (
                listItems.map((item) => (
                  <tr key={item.id} className={selectedId === item.id ? "bg-sky-50/60" : undefined}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.incidentId || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={riddorDecisionVariant(item.decisionStatus)}>
                        {riddorDecisionLabel(item.decisionStatus)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.decisionDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={riddorSubmissionVariant(item.submissionStatus)}>
                        {riddorSubmissionLabel(item.submissionStatus)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.followUpDate)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {selected ? (
        <Section title={`RIDDOR detail — ${selected.incidentId || selected.id}`}>
          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge variant={riddorDecisionVariant(selected.decisionStatus)}>
                    {riddorDecisionLabel(selected.decisionStatus)}
                  </StatusBadge>
                  <span className="text-sm text-slate-600">{formatDate(selected.decisionDate)}</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reportable outcome</p>
                <p className="mt-1 text-sm text-slate-800">{selected.reportableOutcome || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting reason</p>
                <p className="mt-1 text-sm text-slate-800">{selected.supportingReason || "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Criteria recorded</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {selected.fatality ? <li>Fatality</li> : null}
                  {selected.specifiedInjury ? <li>Specified injury</li> : null}
                  {selected.overSevenDayInjury ? <li>Over seven day injury</li> : null}
                  {selected.dangerousOccurrence ? <li>Dangerous occurrence</li> : null}
                  {selected.occupationalDisease ? <li>Occupational disease</li> : null}
                  {selected.gasIncident ? <li>Gas incident</li> : null}
                  {selected.memberOfPublicHospitalTreatment ? <li>Member of public hospital treatment</li> : null}
                  {!selected.fatality &&
                  !selected.specifiedInjury &&
                  !selected.overSevenDayInjury &&
                  !selected.dangerousOccurrence &&
                  !selected.occupationalDisease &&
                  !selected.gasIncident &&
                  !selected.memberOfPublicHospitalTreatment ? (
                    <li>No reportable criteria selected</li>
                  ) : null}
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">HSE submission</p>
              {canManage ? (
                <>
                  <div>
                    <label className={labelClass} htmlFor="riddor-submission-status-edit">
                      Submission status
                    </label>
                    <select
                      id="riddor-submission-status-edit"
                      value={submissionStatus}
                      onChange={(event) => setSubmissionStatus(event.target.value as RiddorSubmissionStatus)}
                      className={inputClass}
                      disabled={saving}
                    >
                      <option value="not_started">Not started</option>
                      <option value="in_preparation">In preparation</option>
                      <option value="submitted">Submitted</option>
                      <option value="follow_up_required">Follow-up required</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="riddor-submission-reference">
                      Submission reference
                    </label>
                    <input
                      id="riddor-submission-reference"
                      value={submissionReference}
                      onChange={(event) => setSubmissionReference(event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="riddor-notification-method">
                      Authority notification method
                    </label>
                    <input
                      id="riddor-notification-method"
                      value={authorityNotificationMethod}
                      onChange={(event) => setAuthorityNotificationMethod(event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={followUpRequired}
                      onChange={(event) => setFollowUpRequired(event.target.checked)}
                      disabled={saving}
                    />
                    Follow-up required
                  </label>
                  <div>
                    <label className={labelClass} htmlFor="riddor-follow-up-date">
                      Follow-up date
                    </label>
                    <input
                      id="riddor-follow-up-date"
                      type="date"
                      value={followUpDate}
                      onChange={(event) => setFollowUpDate(event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </div>
                  <Button type="button" variant="primary" disabled={saving} onClick={() => void saveSubmissionDetails()}>
                    {saving ? "Saving…" : "Save submission details"}
                  </Button>
                </>
              ) : (
                <div className="space-y-2 text-sm text-slate-700">
                  <p>
                    Status:{" "}
                    <StatusBadge variant={riddorSubmissionVariant(selected.submissionStatus)}>
                      {riddorSubmissionLabel(selected.submissionStatus)}
                    </StatusBadge>
                  </p>
                  <p>Reference: {selected.submissionReference || "—"}</p>
                  <p>Method: {selected.authorityNotificationMethod || "—"}</p>
                  <p>Follow-up: {selected.followUpRequired ? formatDate(selected.followUpDate) : "Not required"}</p>
                </div>
              )}
            </div>
          </div>
        </Section>
      ) : null}
    </PageContainer>
  );
}

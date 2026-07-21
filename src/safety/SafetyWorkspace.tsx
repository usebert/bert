import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IncidentReassignModal } from "../components/incidents/IncidentReassignModal";
import { IncidentAssigneeSelect } from "../components/incidents/IncidentAssigneeSelect";
import { canCompleteAuditAsAuditor, canInvestigateIncidents, canReassignIncident } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import type {
  IncidentCorrectiveAction,
  IncidentEvidenceItem,
  IncidentEvidenceUploadFile,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from "../types/incidentsScreenProps";
import { readFileAsDataUrl } from "../services/incidentsService";
import {
  formatIncidentAssignee,
  isEligibleIncidentReassignTarget,
  recentAssignmentHistory,
} from "../utils/incidentAssignment";
import { formatUkTime, getUkTodayKey } from "../utils/ukDateTime";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";
import { canArchiveRecordFromClient } from "../utils/archivePermissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import {
  buildSafetyListItems,
  buildSafetySummaryMetrics,
  filterItemsForTab,
  filterSafetyItems,
  sortSafetyItems,
  visibleTabsForRole,
} from "./adapters/incidentListAdapter";
import { SafetyFilters } from "./components/SafetyFilters";
import { SafetyList } from "./components/SafetyList";
import { SafetySummaryCards } from "./components/SafetySummaryCards";
import type { SafetyFilterState, SafetyWorkspaceProps, SafetyWorkspaceTab } from "./types";

const TAB_LABELS: Record<SafetyWorkspaceTab, string> = {
  report: "Report",
  incidents: "Incidents",
  "near-misses": "Near Misses",
  investigations: "Investigations",
  closed: "Closed",
};

export function SafetyWorkspace({
  currentUser,
  incidents,
  incidentActions,
  reassignTargets,
  reassignTargetsLoading = false,
  onSubmitIncident,
  onUpdateIncident,
  onReassignIncident,
  onAddIncidentAction,
  onUpdateIncidentAction,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  onIncidentArchived,
  onArchiveError,
  onArchiveSuccess,
  offlineMode = false,
}: SafetyWorkspaceProps) {
  const { t } = useTranslation();
  const canArchiveIncident = canArchiveRecordFromClient(currentUser.role, "incident");
  const fieldAuditor = canCompleteAuditAsAuditor(currentUser.role);
  const canManageIncidents = canInvestigateIncidents(currentUser.role);
  const theme = getRoleTheme(currentUser.role);
  const tabs = visibleTabsForRole(canManageIncidents, fieldAuditor);
  const [activeTab, setActiveTab] = useState<SafetyWorkspaceTab>(fieldAuditor ? "report" : "incidents");
  const [safetyFilters, setSafetyFilters] = useState<SafetyFilterState>({
    query: "",
    status: "",
    severity: "",
    site: "",
    area: "",
    fromDate: "",
    toDate: "",
    investigator: "",
    actionsOutstanding: false,
  });

  useEffect(() => {
    if (fieldAuditor && activeTab !== "report") {
      setActiveTab("report");
    }
  }, [fieldAuditor, activeTab]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignModalIncidentId, setReassignModalIncidentId] = useState("");
  const [prefilledReassignEmail, setPrefilledReassignEmail] = useState("");
  const [assigneePendingEmails, setAssigneePendingEmails] = useState<Record<string, string>>({});
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [reassignError, setReassignError] = useState("");
  const [pendingInvestigationScrollId, setPendingInvestigationScrollId] = useState("");
  const investigationWorkflowRef = useRef<HTMLElement | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState("");
  const [evidenceUploadData, setEvidenceUploadData] = useState<
    Record<string, { dataUrl: string; name: string; mimeType: string; size: number }>
  >({});

  const [form, setForm] = useState({
    incidentType: "Near Miss" as IncidentType,
    severity: "Minor" as IncidentSeverity,
    incidentDate: getUkTodayKey(),
    incidentTime: formatUkTime(Date.now()).slice(0, 5),
    reporterName: currentUser.name,
    reporterEmail: `${currentUser.username}@usebert.co.uk`,
    department: "",
    location: "",
    description: "",
    immediateAction: "",
    injured: false,
    injuryDetails: "",
    contributingFactors: "",
    witnesses: "",
    evidenceUrls: [] as IncidentEvidenceItem[],
  });

  const departments = useMemo(
    () => Array.from(new Set(incidents.map((item) => item.department).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [incidents],
  );

  const summaryMetrics = useMemo(
    () => buildSafetySummaryMetrics(incidents, incidentActions),
    [incidents, incidentActions],
  );

  const safetyListItems = useMemo(() => {
    const items = buildSafetyListItems(incidents, incidentActions);
    const tabbed = filterItemsForTab(items, activeTab);
    const filtered = filterSafetyItems(tabbed, safetyFilters);
    return sortSafetyItems(filtered, activeTab);
  }, [incidents, incidentActions, activeTab, safetyFilters]);

  const showRegisterTab = activeTab !== "report" && canManageIncidents;

  const selectedIncident = incidents.find((item) => item.id === selectedIncidentId) || null;
  const selectedActions = selectedIncident ? incidentActions.filter((item) => item.incidentId === selectedIncident.id) : [];
  const eligibleReassignTargets = useMemo(
    () => reassignTargets.filter((target) => isEligibleIncidentReassignTarget(target)),
    [reassignTargets],
  );
  const canReassignSelectedIncident = selectedIncident
    ? canReassignIncident(currentUser, selectedIncident)
    : false;
  const reassignModalIncident =
    incidents.find((item) => item.id === reassignModalIncidentId) || selectedIncident;
  const assignmentHistory = selectedIncident ? recentAssignmentHistory(selectedIncident.assignmentHistory) : [];

  const clearAssigneePending = (incidentId: string) => {
    setAssigneePendingEmails((current) => {
      if (!current[incidentId]) {
        return current;
      }
      const next = { ...current };
      delete next[incidentId];
      return next;
    });
  };

  const closeReassignModal = () => {
    if (reassignSubmitting) {
      return;
    }
    if (reassignModalIncidentId) {
      clearAssigneePending(reassignModalIncidentId);
    }
    setReassignOpen(false);
    setReassignModalIncidentId("");
    setPrefilledReassignEmail("");
    setReassignError("");
  };

  const openReassignForIncident = (incidentId: string, toEmail: string) => {
    setReassignModalIncidentId(incidentId);
    setPrefilledReassignEmail(toEmail);
    setAssigneePendingEmails((current) => ({ ...current, [incidentId]: toEmail }));
    setReassignError("");
    setReassignOpen(true);
  };

  const openInvestigationWorkflow = useCallback(
    (incidentId: string, options?: { startInvestigation?: boolean }) => {
      setSelectedIncidentId(incidentId);
      if (options?.startInvestigation) {
        onUpdateIncident(incidentId, { status: "Under Investigation" }, { statusNote: "Investigation started" });
      }
      setPendingInvestigationScrollId(incidentId);
    },
    [onUpdateIncident],
  );

  useEffect(() => {
    if (!pendingInvestigationScrollId || selectedIncidentId !== pendingInvestigationScrollId) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const scrollToWorkflow = () => {
      if (cancelled) {
        return;
      }
      const element =
        document.getElementById(`investigation-workflow-${pendingInvestigationScrollId}`) ||
        investigationWorkflowRef.current;
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        setPendingInvestigationScrollId("");
        return;
      }
      attempts += 1;
      if (attempts < 8) {
        requestAnimationFrame(scrollToWorkflow);
      } else {
        setPendingInvestigationScrollId("");
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToWorkflow);
    });

    return () => {
      cancelled = true;
    };
  }, [pendingInvestigationScrollId, selectedIncidentId]);

  const onAddEvidence = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = `incident-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setEvidenceUploadData((current) => ({
          ...current,
          [id]: {
            dataUrl,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          },
        }));
        console.info("[incidents]", {
          phase: "client_evidence_selected",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataUrlLength: dataUrl.length,
          evidenceId: id,
        });
        setForm((current) => ({
          ...current,
          evidenceUrls: [
            ...current.evidenceUrls,
            {
              id,
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              previewUrl: URL.createObjectURL(file),
              addedAt: new Date().toISOString(),
            },
          ],
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read the selected file.";
        setFormError(message);
      }
    }
  };

  const validateForm = () => {
    if (!form.reporterName.trim()) return "Your name is required.";
    if (!form.department.trim()) return "Department / area is required.";
    if (!form.location.trim()) return "Exact location is required.";
    if (!form.description.trim()) return "Please describe what happened.";
    if (form.injured && !form.injuryDetails.trim()) return "Injury details are required when an injury is reported.";
    return "";
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSubmitting(true);
    setSubmitPhase("Preparing...");
    try {
      const evidenceUploadFiles: IncidentEvidenceUploadFile[] = form.evidenceUrls
        .map((item) => {
          const upload = evidenceUploadData[item.id];
          if (!upload?.dataUrl?.startsWith("data:")) {
            return null;
          }
          return {
            id: item.id,
            name: upload.name,
            mimeType: upload.mimeType,
            size: upload.size,
            dataUrl: upload.dataUrl,
            addedAt: item.addedAt,
          };
        })
        .filter((item): item is IncidentEvidenceUploadFile => Boolean(item));
      console.info("[incidents]", {
        phase: "client_submit_start",
        attachedCount: form.evidenceUrls.length,
        uploadPayloadCount: evidenceUploadFiles.length,
        dataUrlLengths: evidenceUploadFiles.map((file) => file.dataUrl.length),
      });
      const created = await onSubmitIncident({ ...form, evidenceUploadFiles }, {
        onPhase: (phase) => setSubmitPhase(phase),
      });
      const notificationFailed = created.notificationStatus.startsWith("Failed:");
      setSuccessMessage(
        notificationFailed
          ? `Report saved as ${created.incidentId}. Email notification could not be sent — managers can still review it in the register.`
          : `Submitted successfully: ${created.incidentId}`,
      );
      if (canManageIncidents) {
        setActiveTab("incidents");
        setSelectedIncidentId(created.id);
      }
      setForm((current) => ({
        ...current,
        department: "",
        location: "",
        description: "",
        immediateAction: "",
        injured: false,
        injuryDetails: "",
        contributingFactors: "",
        witnesses: "",
        evidenceUrls: [],
      }));
      setEvidenceUploadData({});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit report. Please try again.";
      setFormError(message);
    } finally {
      setIsSubmitting(false);
      setSubmitPhase("");
    }
  };

  const fieldInputClass = fieldAuditor
    ? "min-h-[3rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
    : "h-11 rounded-xl border px-3";
  const fieldTextareaClass = fieldAuditor
    ? "min-h-[6rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white md:col-span-2"
    : "md:col-span-2 min-h-24 rounded-xl border px-3 py-2";

  return (
    <PageContainer>
      <PageHeader
        eyebrow={fieldAuditor ? t("incidents.submitSection") : t("incidents.nearMiss")}
        title={fieldAuditor ? t("incidents.title") : t("incidents.module")}
        description={
          fieldAuditor
            ? "Fill in what happened, where, and any immediate action taken. Add photos or files if you have them."
            : "Unified safety workspace for incidents, near misses, investigations, and corrective actions."
        }
        secondaryActions={
          !fieldAuditor ? (
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <Button
                  key={tab}
                  type="button"
                  variant={activeTab === tab ? "primary" : "secondary"}
                  className="min-h-[2.75rem]"
                  onClick={() => setActiveTab(tab)}
                >
                  {TAB_LABELS[tab]}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      {!fieldAuditor && canManageIncidents && activeTab !== "report" ? (
        <Section>
          <SafetySummaryCards metrics={summaryMetrics} />
        </Section>
      ) : null}

      {offlineMode ? (
        <Section>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            You are offline. Saved submissions will be queued for sync.
          </p>
        </Section>
      ) : null}

      {!fieldAuditor ? (
        <p className="text-xs text-slate-500">
          QR reporting link:{" "}
          <span className="font-semibold text-slate-700">{`${window.location.origin}/?screen=incidents`}</span>
        </p>
      ) : null}

      {fieldAuditor ? (
        <Section>
          <SectionIntro text={SECTION_INTROS.auditorSubmit} className="mt-0" role="Auditor" />
        </Section>
      ) : null}

      {successMessage && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
          {successMessage}
        </section>
      )}

      {formError && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900" role="alert">
          {formError}
        </section>
      )}

      {activeTab === "report" && (
        <section
          className={[
            fieldAuditor
              ? "rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm"
              : "rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]",
          ].join(" ")}
        >
          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <select value={form.incidentType} onChange={(event) => setForm((current) => ({ ...current, incidentType: event.target.value as IncidentType }))} className={fieldInputClass}><option>Accident</option><option>Near Miss</option><option>Dangerous Occurrence</option><option>Property Damage</option><option>Environmental</option></select>
            <select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as IncidentSeverity }))} className={fieldInputClass}><option value="Minor">{t("incidents.minor")}</option><option value="Medical Treatment">Medical Treatment</option><option value="Lost Time Injury">Lost Time Injury</option><option value="Major Incident">Major Incident</option><option value="Fatality">{t("incidents.fatality")}</option></select>
            <input type="date" value={form.incidentDate} onChange={(event) => setForm((current) => ({ ...current, incidentDate: event.target.value }))} className={fieldInputClass} />
            <input type="time" value={form.incidentTime} onChange={(event) => setForm((current) => ({ ...current, incidentTime: event.target.value }))} className={fieldInputClass} />
            <input value={form.reporterName} onChange={(event) => setForm((current) => ({ ...current, reporterName: event.target.value }))} placeholder="Your name (required)" required className={fieldInputClass} />
            <input value={form.reporterEmail} onChange={(event) => setForm((current) => ({ ...current, reporterEmail: event.target.value }))} placeholder="Your email" className={fieldInputClass} />
            <input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} placeholder="Department / area (required)" required className={fieldInputClass} />
            <input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Exact location (required)" required className={fieldInputClass} />
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What happened? (required)" required className={fieldTextareaClass} />
            <textarea value={form.immediateAction} onChange={(event) => setForm((current) => ({ ...current, immediateAction: event.target.value }))} placeholder="Immediate action taken" className={fieldTextareaClass} />
            <label className="inline-flex min-h-[2.75rem] items-center gap-2 text-base md:col-span-2">
              <input type="checkbox" checked={form.injured} onChange={(event) => setForm((current) => ({ ...current, injured: event.target.checked }))} className="h-5 w-5" />
              Was anyone injured?
            </label>
            {form.injured && <textarea value={form.injuryDetails} onChange={(event) => setForm((current) => ({ ...current, injuryDetails: event.target.value }))} placeholder="Injury details" className={fieldTextareaClass} />}
            {!fieldAuditor && (
              <>
                <textarea value={form.contributingFactors} onChange={(event) => setForm((current) => ({ ...current, contributingFactors: event.target.value }))} placeholder="Contributing factors" className={fieldTextareaClass} />
                <textarea value={form.witnesses} onChange={(event) => setForm((current) => ({ ...current, witnesses: event.target.value }))} placeholder="Witnesses" className={fieldTextareaClass} />
              </>
            )}
            {fieldAuditor && (
              <textarea value={form.witnesses} onChange={(event) => setForm((current) => ({ ...current, witnesses: event.target.value }))} placeholder="Witnesses (optional)" className={fieldTextareaClass} />
            )}
            <div className="md:col-span-2 rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-4 py-4">
              <p className="text-sm font-medium text-slate-700">Photos or files (optional)</p>
              <input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => onAddEvidence(event.target.files)} className="mt-3 w-full text-base" />
              {form.evidenceUrls.length > 0 && <p className="mt-2 text-sm text-slate-600">{form.evidenceUrls.length} file(s) attached</p>}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className={[
                "md:col-span-2 min-h-[3rem] rounded-2xl font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {isSubmitting ? (submitPhase || t("login.sending")) : t("incidents.submitReport")}
            </button>
          </form>
        </section>
      )}

      {showRegisterTab && (
        <Section title="Safety register">
          <SafetyFilters
            filters={safetyFilters}
            departments={departments}
            onChange={(patch) => setSafetyFilters((current) => ({ ...current, ...patch }))}
          />
          <div className="mt-4">
            {safetyListItems.length === 0 ? (
              <EmptyState
                title={incidents.length === 0 ? "No incidents recorded" : "No incidents or near misses match these filters."}
                description={
                  incidents.length === 0
                    ? "Use the Report tab to log the first incident."
                    : "Try clearing filters or switching tabs."
                }
              />
            ) : (
              <SafetyList
                items={safetyListItems}
                onSelect={(id) => setSelectedIncidentId(id)}
                onInvestigate={(id, startInvestigation) =>
                  openInvestigationWorkflow(id, { startInvestigation })
                }
                showInvestigate={canInvestigateIncidents(currentUser.role)}
              />
            )}
          </div>
        </Section>
      )}

      {selectedIncident && (canManageIncidents || canReassignSelectedIncident) && (
        <section
          ref={investigationWorkflowRef}
          id={`investigation-workflow-${selectedIncident.id}`}
          className="scroll-mt-24 rounded-[1.75rem] border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {canManageIncidents ? "Investigation workflow" : "Incident assignment"}
              </p>
              <h3 className="text-xl font-semibold text-slate-900">{selectedIncident.incidentId}</h3>
              <p className="text-sm text-slate-600">{selectedIncident.description}</p>
            </div>
            {canManageIncidents ? (
              <select value={selectedIncident.status} onChange={(event) => onUpdateIncident(selectedIncident.id, { status: event.target.value as IncidentStatus }, { statusNote: "Status updated from register" })} className="h-10 rounded-lg border px-2">
                <option>Open</option><option>Under Investigation</option><option>Closed</option>
              </select>
            ) : null}
            {canManageIncidents && canArchiveIncident && archiveCompanyFolderId && onIncidentArchived ? (
              <ArchiveRecordButton
                recordType="incident"
                recordId={selectedIncident.incidentId}
                companyFolderId={archiveCompanyFolderId}
                masterSheetId={archiveMasterSheetId}
                offlineMode={archiveOffline}
                canArchive={canArchiveIncident}
                label="Archive incident"
                onArchived={() => onIncidentArchived(selectedIncident.id)}
                onError={onArchiveError}
                onSuccess={onArchiveSuccess}
              />
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Current handler</p>
                  <div className="mt-1">
                    <IncidentAssigneeSelect
                      incident={selectedIncident}
                      targets={eligibleReassignTargets}
                      targetsLoading={reassignTargetsLoading}
                      canEdit={canReassignSelectedIncident}
                      pendingEmail={assigneePendingEmails[selectedIncident.id]}
                      onSelectPerson={(email) => openReassignForIncident(selectedIncident.id, email)}
                      className="max-w-full text-sm"
                    />
                  </div>
                  {selectedIncident.assignedAt ? (
                    <p className="mt-1 text-xs text-slate-500">Assigned {selectedIncident.assignedAt}</p>
                  ) : null}
                </div>
              </div>
              {assignmentHistory.length > 0 ? (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Assignment history</p>
                  {assignmentHistory.map((entry) => (
                    <div key={`${entry.at}-${entry.toEmail}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      <p>
                        <strong>{entry.fromName || entry.fromEmail || "Unassigned"}</strong>
                        {" → "}
                        <strong>{entry.toName || entry.toEmail}</strong>
                      </p>
                      <p className="mt-1 text-slate-500">
                        By {entry.byName || entry.byEmail} · {entry.at}
                        {entry.reason ? ` · ${entry.reason}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            {canManageIncidents ? (
              <>
            <textarea value={selectedIncident.investigationNotes} onChange={(event) => onUpdateIncident(selectedIncident.id, { investigationNotes: event.target.value })} placeholder="Investigation notes" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.rootCause} onChange={(event) => onUpdateIncident(selectedIncident.id, { rootCause: event.target.value })} placeholder="Root cause analysis" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.correctiveActions} onChange={(event) => onUpdateIncident(selectedIncident.id, { correctiveActions: event.target.value })} placeholder="Corrective actions summary" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.preventiveActions} onChange={(event) => onUpdateIncident(selectedIncident.id, { preventiveActions: event.target.value })} placeholder="Preventive actions summary" className="min-h-24 rounded-xl border px-3 py-2" />
            <input value={selectedIncident.actionOwner} onChange={(event) => onUpdateIncident(selectedIncident.id, { actionOwner: event.target.value })} placeholder="Action owner" className="h-10 rounded-lg border px-3" />
            <input type="date" value={selectedIncident.dueDate} onChange={(event) => onUpdateIncident(selectedIncident.id, { dueDate: event.target.value })} className="h-10 rounded-lg border px-3" />
            <input type="date" value={selectedIncident.completionDate} onChange={(event) => onUpdateIncident(selectedIncident.id, { completionDate: event.target.value })} className="h-10 rounded-lg border px-3" />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIncident.riddorRequired} onChange={(event) => onUpdateIncident(selectedIncident.id, { riddorRequired: event.target.checked })} /> RIDDOR required</label>
              </>
            ) : null}
          </div>

          {canManageIncidents ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Corrective action tracking</p>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <input value={actionDescription} onChange={(event) => setActionDescription(event.target.value)} placeholder="Action description" className="h-10 rounded-lg border px-2 md:col-span-2" />
              <input value={actionOwner} onChange={(event) => setActionOwner(event.target.value)} placeholder="Owner" className="h-10 rounded-lg border px-2" />
              <input type="date" value={actionDueDate} onChange={(event) => setActionDueDate(event.target.value)} className="h-10 rounded-lg border px-2" />
            </div>
            <button type="button" onClick={() => { onAddIncidentAction(selectedIncident.id, { description: actionDescription, owner: actionOwner, dueDate: actionDueDate }); setActionDescription(""); setActionOwner(""); setActionDueDate(""); }} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Add corrective action</button>
            <div className="mt-2 space-y-2">
              {selectedActions.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <p className="min-w-[14rem] flex-1">{item.description}</p>
                  <p className="text-slate-500">{item.owner}</p>
                  <p className="text-slate-500">{item.dueDate || "-"}</p>
                  <select value={item.status} onChange={(event) => onUpdateIncidentAction(item.id, { status: event.target.value as IncidentCorrectiveAction["status"] })} className="h-8 rounded border px-2 text-xs">
                    <option>Open</option><option>In Progress</option><option>Complete</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
          ) : null}
          {canManageIncidents && selectedIncident.status !== "Closed" && (
            <button type="button" onClick={() => onUpdateIncident(selectedIncident.id, { status: "Closed", closedAt: new Date().toISOString(), closedBy: currentUser.name, completionDate: selectedIncident.completionDate || getUkTodayKey() }, { statusNote: "Incident closed" })} className={["mt-3 h-10 rounded-lg px-4 text-sm font-semibold text-white", theme.primaryButton, theme.primaryButtonHover].join(" ")}>{t("incidents.closeIncident")}</button>
          )}
        </section>
      )}

      <IncidentReassignModal
        open={reassignOpen && Boolean(reassignModalIncident)}
        incidentLabel={reassignModalIncident?.incidentId || "Incident"}
        currentAssignee={reassignModalIncident ? formatIncidentAssignee(reassignModalIncident) : ""}
        targets={eligibleReassignTargets}
        targetsLoading={reassignTargetsLoading}
        initialSelectedEmail={prefilledReassignEmail}
        submitting={reassignSubmitting}
        error={reassignError}
        onClose={closeReassignModal}
        onConfirm={async (input) => {
          if (!reassignModalIncident) {
            return;
          }
          const incidentId = reassignModalIncident.id;
          setReassignSubmitting(true);
          setReassignError("");
          try {
            await onReassignIncident(incidentId, input);
            clearAssigneePending(incidentId);
            setReassignOpen(false);
            setReassignModalIncidentId("");
            setPrefilledReassignEmail("");
          } catch (error) {
            clearAssigneePending(incidentId);
            setReassignError(error instanceof Error ? error.message : "Could not reassign this incident.");
          } finally {
            setReassignSubmitting(false);
          }
        }}
      />
    </PageContainer>
  );
}

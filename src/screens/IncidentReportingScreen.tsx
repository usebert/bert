import { FormEvent, useEffect, useMemo, useState } from "react";
import { MiniMetric } from "../components/dashboard/DashboardPrimitives";
import { canCompleteAuditAsAuditor, canInvestigateIncidents } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { darkPanelBody, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import type {
  IncidentCorrectiveAction,
  IncidentEvidenceItem,
  IncidentReportingScreenProps,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from "../types/incidentsScreenProps";

export function IncidentReportingScreen({
  currentUser,
  incidents,
  incidentActions,
  onSubmitIncident,
  onUpdateIncident,
  onAddIncidentAction,
  onUpdateIncidentAction,
}: IncidentReportingScreenProps) {
  const fieldAuditor = canCompleteAuditAsAuditor(currentUser.role);
  const canManageIncidents = canInvestigateIncidents(currentUser.role);
  const theme = getRoleTheme(currentUser.role);
  const [view, setView] = useState<"report" | "register" | "dashboard">("report");

  useEffect(() => {
    if (fieldAuditor && view !== "report") {
      setView("report");
    }
  }, [fieldAuditor, view]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "All">("All");
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "All">("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "All">("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [form, setForm] = useState({
    incidentType: "Near Miss" as IncidentType,
    severity: "Minor" as IncidentSeverity,
    incidentDate: new Date().toISOString().slice(0, 10),
    incidentTime: new Date().toTimeString().slice(0, 5),
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

  const filteredIncidents = useMemo(
    () =>
      incidents.filter((item) => {
        if (statusFilter !== "All" && item.status !== statusFilter) return false;
        if (severityFilter !== "All" && item.severity !== severityFilter) return false;
        if (departmentFilter !== "All" && item.department !== departmentFilter) return false;
        if (typeFilter !== "All" && item.incidentType !== typeFilter) return false;
        if (fromDate && item.incidentDate < fromDate) return false;
        if (toDate && item.incidentDate > toDate) return false;
        return true;
      }),
    [incidents, statusFilter, severityFilter, departmentFilter, typeFilter, fromDate, toDate],
  );

  const selectedIncident = filteredIncidents.find((item) => item.id === selectedIncidentId) || incidents.find((item) => item.id === selectedIncidentId) || null;
  const selectedActions = selectedIncident ? incidentActions.filter((item) => item.incidentId === selectedIncident.id) : [];
  const openActionsCount = incidentActions.filter((item) => item.status !== "Complete").length;
  const underInvestigation = incidents.filter((item) => item.status === "Under Investigation").length;
  const highSeverityIncidents = incidents.filter((item) => item.priority === "High").length;
  const nearMisses = incidents.filter((item) => item.incidentType === "Near Miss").length;
  const overdueActions = incidentActions.filter((item) => item.status !== "Complete" && item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10)).length;

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>();
    incidents.forEach((item) => {
      const key = item.incidentDate.slice(0, 7);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [incidents]);

  const onAddEvidence = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files).map((file) => ({
      id: `incident-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      previewUrl: URL.createObjectURL(file),
      addedAt: new Date().toISOString(),
    }));
    setForm((current) => ({ ...current, evidenceUrls: [...current.evidenceUrls, ...next] }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await onSubmitIncident(form);
    setSuccessMessage(`Submitted successfully: ${created.incidentId}`);
    if (canManageIncidents) {
      setView("register");
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
  };

  const fieldInputClass = fieldAuditor
    ? "min-h-[3rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
    : "h-11 rounded-xl border px-3";
  const fieldTextareaClass = fieldAuditor
    ? "min-h-[6rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white md:col-span-2"
    : "md:col-span-2 min-h-24 rounded-xl border px-3 py-2";

  return (
    <div className="space-y-4">
      {fieldAuditor ? (
        <section className="rounded-2xl border border-violet-200/80 bg-violet-50/60 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-700">Submit</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Report an incident or near miss</h2>
          <SectionIntro text={SECTION_INTROS.auditorSubmit} className="mt-2" role="Auditor" />
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Fill in what happened, where, and any immediate action taken. Add photos or files if you have them.
          </p>
        </section>
      ) : (
        <section className={darkPanelShell}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={darkPanelEyebrow}>Accident / Near miss</p>
              <h2 className={darkPanelTitleLg}>Incident reporting module</h2>
              <p className={["mt-2", darkPanelBody].join(" ")}>Mobile-first reporting plus register, investigation workflow, corrective actions, and dashboard.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setView("report")} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${view === "report" ? theme.tabActiveOnDark : theme.tabInactiveOnDark}`}>Report form</button>
              <button type="button" onClick={() => setView("register")} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${view === "register" ? theme.tabActiveOnDark : theme.tabInactiveOnDark}`}>Incident register</button>
              <button type="button" onClick={() => setView("dashboard")} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${view === "dashboard" ? theme.tabActiveOnDark : theme.tabInactiveOnDark}`}>Dashboard</button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">QR reporting link: <span className="font-semibold text-slate-200">{`${window.location.origin}/?screen=incidents`}</span></p>
        </section>
      )}

      {successMessage && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
          {successMessage}
        </section>
      )}

      {view === "report" && (
        <section
          className={[
            fieldAuditor
              ? "rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm"
              : "rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]",
          ].join(" ")}
        >
          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <select value={form.incidentType} onChange={(event) => setForm((current) => ({ ...current, incidentType: event.target.value as IncidentType }))} className={fieldInputClass}><option>Accident</option><option>Near Miss</option><option>Dangerous Occurrence</option><option>Property Damage</option><option>Environmental</option></select>
            <select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as IncidentSeverity }))} className={fieldInputClass}><option>Minor</option><option>Medical Treatment</option><option>Lost Time Injury</option><option>Major Incident</option><option>Fatality</option></select>
            <input type="date" value={form.incidentDate} onChange={(event) => setForm((current) => ({ ...current, incidentDate: event.target.value }))} className={fieldInputClass} />
            <input type="time" value={form.incidentTime} onChange={(event) => setForm((current) => ({ ...current, incidentTime: event.target.value }))} className={fieldInputClass} />
            <input value={form.reporterName} onChange={(event) => setForm((current) => ({ ...current, reporterName: event.target.value }))} placeholder="Your name" className={fieldInputClass} />
            <input value={form.reporterEmail} onChange={(event) => setForm((current) => ({ ...current, reporterEmail: event.target.value }))} placeholder="Your email" className={fieldInputClass} />
            <input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} placeholder="Department / area" className={fieldInputClass} />
            <input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Exact location" className={fieldInputClass} />
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What happened?" className={fieldTextareaClass} />
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
              className={[
                "md:col-span-2 min-h-[3rem] rounded-2xl font-semibold text-white transition active:scale-[0.98]",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              Submit report
            </button>
          </form>
        </section>
      )}

      {view === "register" && canManageIncidents && (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
          <div className="grid gap-2 md:grid-cols-6">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as IncidentStatus | "All")} className="h-10 rounded-lg border px-2"><option value="All">All status</option><option>Open</option><option>Under Investigation</option><option>Closed</option></select>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as IncidentSeverity | "All")} className="h-10 rounded-lg border px-2"><option value="All">All severity</option><option>Minor</option><option>Medical Treatment</option><option>Lost Time Injury</option><option>Major Incident</option><option>Fatality</option></select>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-10 rounded-lg border px-2"><option value="All">All departments</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as IncidentType | "All")} className="h-10 rounded-lg border px-2"><option value="All">All types</option><option>Accident</option><option>Near Miss</option><option>Dangerous Occurrence</option><option>Property Damage</option><option>Environmental</option></select>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-lg border px-2" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-lg border px-2" />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.14em] text-slate-500"><th className="px-2 py-2">Incident</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Severity</th><th className="px-2 py-2">Reporter</th><th className="px-2 py-2">Department</th><th className="px-2 py-2">Location</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Assigned</th><th className="px-2 py-2">Due</th><th className="px-2 py-2">Evidence</th><th className="px-2 py-2">Action</th></tr></thead>
              <tbody>
                {filteredIncidents.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="border-t border-slate-200 px-4 py-8 text-center">
                      <p className="text-sm font-semibold text-slate-900">
                        {incidents.length === 0 ? "No incidents recorded" : "No incidents match these filters"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {incidents.length === 0
                          ? "Use Report form to log the first incident; it will show in this register."
                          : "Try clearing dates or setting filters back to All."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredIncidents.map((item) => (
                    <tr key={item.id} onClick={() => setSelectedIncidentId(item.id)} className="cursor-pointer border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-semibold">{item.incidentId}</td><td className="px-2 py-2">{item.incidentDate} {item.incidentTime}</td><td className="px-2 py-2">{item.incidentType}</td><td className="px-2 py-2">{item.severity}</td><td className="px-2 py-2">{item.reporterName}</td><td className="px-2 py-2">{item.department}</td><td className="px-2 py-2">{item.location}</td><td className="px-2 py-2">{item.status}</td><td className="px-2 py-2">{item.assignedTo || "-"}</td><td className="px-2 py-2">{item.dueDate || "-"}</td><td className="px-2 py-2">{item.evidenceUrls.length > 0 ? "Yes" : "No"}</td>
                      <td className="px-2 py-2">
                        {canInvestigateIncidents(currentUser.role) && item.status !== "Closed" && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedIncidentId(item.id);
                              if (item.status === "Open") {
                                onUpdateIncident(item.id, { status: "Under Investigation" }, { statusNote: "Investigation started" });
                              }
                            }}
                            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                          >
                            {item.status === "Open" ? "Start investigation" : "Continue"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "dashboard" && canManageIncidents && (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
            <MiniMetric label="Total incidents" value={String(incidents.length)} />
            <MiniMetric label="Open incidents" value={String(incidents.filter((item) => item.status === "Open").length)} />
            <MiniMetric label="Under investigation" value={String(underInvestigation)} />
            <MiniMetric label="Closed incidents" value={String(incidents.filter((item) => item.status === "Closed").length)} />
            <MiniMetric label="Near misses" value={String(nearMisses)} />
            <MiniMetric label="High severity" value={String(highSeverityIncidents)} />
            <MiniMetric label="Overdue actions" value={String(overdueActions)} />
            <MiniMetric label="Open actions" value={String(openActionsCount)} />
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
            Monthly trend:{" "}
            {monthlyTrend.length === 0
              ? "No incidents recorded yet — the chart fills in after the first report is saved."
              : monthlyTrend.map(([month, count]) => `${month}: ${count}`).join(" | ")}
          </div>
        </section>
      )}

      {selectedIncident && canManageIncidents && (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Investigation workflow</p>
              <h3 className="text-xl font-semibold text-slate-900">{selectedIncident.incidentId}</h3>
              <p className="text-sm text-slate-600">{selectedIncident.description}</p>
            </div>
            <select value={selectedIncident.status} onChange={(event) => onUpdateIncident(selectedIncident.id, { status: event.target.value as IncidentStatus }, { statusNote: "Status updated from register" })} className="h-10 rounded-lg border px-2">
              <option>Open</option><option>Under Investigation</option><option>Closed</option>
            </select>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <textarea value={selectedIncident.investigationNotes} onChange={(event) => onUpdateIncident(selectedIncident.id, { investigationNotes: event.target.value })} placeholder="Investigation notes" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.rootCause} onChange={(event) => onUpdateIncident(selectedIncident.id, { rootCause: event.target.value })} placeholder="Root cause analysis" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.correctiveActions} onChange={(event) => onUpdateIncident(selectedIncident.id, { correctiveActions: event.target.value })} placeholder="Corrective actions summary" className="min-h-24 rounded-xl border px-3 py-2" />
            <textarea value={selectedIncident.preventiveActions} onChange={(event) => onUpdateIncident(selectedIncident.id, { preventiveActions: event.target.value })} placeholder="Preventive actions summary" className="min-h-24 rounded-xl border px-3 py-2" />
            <input value={selectedIncident.assignedTo} onChange={(event) => onUpdateIncident(selectedIncident.id, { assignedTo: event.target.value })} placeholder="Assigned to" className="h-10 rounded-lg border px-3" />
            <input value={selectedIncident.actionOwner} onChange={(event) => onUpdateIncident(selectedIncident.id, { actionOwner: event.target.value })} placeholder="Action owner" className="h-10 rounded-lg border px-3" />
            <input type="date" value={selectedIncident.dueDate} onChange={(event) => onUpdateIncident(selectedIncident.id, { dueDate: event.target.value })} className="h-10 rounded-lg border px-3" />
            <input type="date" value={selectedIncident.completionDate} onChange={(event) => onUpdateIncident(selectedIncident.id, { completionDate: event.target.value })} className="h-10 rounded-lg border px-3" />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIncident.riddorRequired} onChange={(event) => onUpdateIncident(selectedIncident.id, { riddorRequired: event.target.checked })} /> RIDDOR required</label>
          </div>

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
          {selectedIncident.status !== "Closed" && (
            <button type="button" onClick={() => onUpdateIncident(selectedIncident.id, { status: "Closed", closedAt: new Date().toISOString(), closedBy: currentUser.name, completionDate: selectedIncident.completionDate || new Date().toISOString().slice(0, 10) }, { statusNote: "Incident closed" })} className={["mt-3 h-10 rounded-lg px-4 text-sm font-semibold text-white", theme.primaryButton, theme.primaryButtonHover].join(" ")}>Close incident</button>
          )}
        </section>
      )}
    </div>
  );
}

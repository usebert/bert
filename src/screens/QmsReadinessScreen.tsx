import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTION_INTROS } from "../config/sectionIntros";
import { QmsReadinessSummaryWidget } from "../components/qms/QmsReadinessSummaryWidget";
import type { AuditFindingRecord } from "../types/complianceLoop";
import type { NavItemId } from "../types/navigation";
import type { NonConformanceRecord } from "../types/nonConformanceScreenProps";
import type { ActionItem, HistoryEntry } from "../types/reportsScreenProps";
import type { IncidentRecord } from "../types/incidentsScreenProps";
import type { QMSDocument, QMSRisk, QMSTrainingRecord, QmsReadinessSummary } from "../types/qms";
import type {
  HazardReport,
  SafetyObjective,
  SafetyObservation,
  SafetyRiskAssessment,
} from "../types/safety";
import { computeSafetyRiskScore, newQmsId } from "../utils/qmsReadiness";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { DASHBOARD_CARD, PageHeader } from "../components/dashboard/RoleDashboardPrimitives";

export type QmsReadinessAccessLevel = "full" | "operational";

export type QmsReadinessScreenProps = {
  accessLevel: QmsReadinessAccessLevel;
  summary: QmsReadinessSummary;
  documents: QMSDocument[];
  training: QMSTrainingRecord[];
  risks: QMSRisk[];
  nonConformances: NonConformanceRecord[];
  actions: ActionItem[];
  auditFindings: AuditFindingRecord[];
  history: HistoryEntry[];
  openReportsCount: number;
  onNavigate: (screen: NavItemId) => void;
  incidents: IncidentRecord[];
  hazards: HazardReport[];
  safetyRiskAssessments: SafetyRiskAssessment[];
  safetyObservations: SafetyObservation[];
  safetyObjectives: SafetyObjective[];
  onSaveDocuments: (next: QMSDocument[]) => void;
  onSaveTraining: (next: QMSTrainingRecord[]) => void;
  onSaveRisks: (next: QMSRisk[]) => void;
  onSaveHazards: (next: HazardReport[]) => void;
  onSaveSafetyRiskAssessments: (next: SafetyRiskAssessment[]) => void;
  onSaveSafetyObservations: (next: SafetyObservation[]) => void;
  onSaveSafetyObjectives: (next: SafetyObjective[]) => void;
};

type HubSection =
  | "hub"
  | "documents"
  | "training"
  | "risks"
  | "hazards"
  | "safetyRisks"
  | "observations"
  | "objectives"
  | "managementReview";

const panelClass = DASHBOARD_CARD;

function HubCard({
  title,
  description,
  metric,
  onClick,
}: {
  title: string;
  description: string;
  metric?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {metric ? <p className="mt-2 text-xs font-semibold text-amber-700">{metric}</p> : null}
    </button>
  );
}

export function QmsReadinessScreen({
  accessLevel,
  summary,
  documents,
  training,
  risks,
  nonConformances,
  actions,
  auditFindings,
  history,
  openReportsCount,
  onNavigate,
  incidents,
  hazards,
  safetyRiskAssessments,
  safetyObservations,
  safetyObjectives,
  onSaveDocuments,
  onSaveTraining,
  onSaveRisks,
  onSaveHazards,
  onSaveSafetyRiskAssessments,
  onSaveSafetyObservations,
  onSaveSafetyObjectives,
}: QmsReadinessScreenProps) {
  const [section, setSection] = useState<HubSection>("hub");
  const hubGridRef = useRef<HTMLDivElement>(null);
  const pendingHubScrollRef = useRef(false);

  const scrollToHub = useCallback(() => {
    hubGridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const openHub = useCallback(() => {
    if (section !== "hub") {
      pendingHubScrollRef.current = true;
      setSection("hub");
      return;
    }
    scrollToHub();
  }, [section, scrollToHub]);

  useEffect(() => {
    if (section !== "hub" || !pendingHubScrollRef.current) return;
    pendingHubScrollRef.current = false;
    scrollToHub();
  }, [section, scrollToHub]);

  const openNcrCount = useMemo(
    () => nonConformances.filter((item) => item.status !== "Completed").length,
    [nonConformances],
  );
  const openActionCount = useMemo(
    () => actions.filter((item) => item.status !== "Closed").length,
    [actions],
  );

  const hubCards = useMemo(() => {
    const operational = [
      {
        id: "ncr" as const,
        title: "Quality issues",
        description: "Track non-conformances and serious quality problems.",
        metric: openNcrCount > 0 ? `${openNcrCount} open` : undefined,
        onClick: () => onNavigate("nonConformance"),
      },
      {
        id: "actions" as const,
        title: "Corrective actions",
        description: "Assign ownership, add evidence, and verify closure.",
        metric: summary.overdueHsActions > 0 ? `${summary.overdueHsActions} overdue` : undefined,
        onClick: () => onNavigate("actions"),
      },
      {
        id: "hazards-op" as const,
        title: "Safety hazards",
        description: "Record hazards and follow-up actions.",
        metric: summary.openHazards > 0 ? `${summary.openHazards} open` : undefined,
        onClick: () => onNavigate("incidents"),
      },
      {
        id: "incidents-op" as const,
        title: "Incidents & near misses",
        description: "Capture reports, investigations, and corrective actions.",
        metric:
          summary.openIncidentsAndNearMisses > 0 ? `${summary.openIncidentsAndNearMisses} open` : undefined,
        onClick: () => onNavigate("incidents"),
      },
    ];
    if (accessLevel === "operational") {
      return [
        ...operational,
        {
          id: "reports" as const,
          title: "Reports & evidence",
          description: "Review completed checks and shared report packs.",
          metric: openReportsCount > 0 ? `${openReportsCount} open reports` : undefined,
          onClick: () => onNavigate("reports"),
        },
        {
          id: "checks" as const,
          title: "Forms & checks",
          description: "Operational checks that feed your quality and safety records.",
          metric: undefined,
          onClick: () => onNavigate("audits"),
        },
      ];
    }
    return [
      {
        id: "documents" as const,
        title: "Document control",
        description: "Controlled documents, versions, owners, and review dates.",
        metric: summary.documentsNeedingReview > 0 ? `${summary.documentsNeedingReview} need review` : undefined,
        onClick: () => setSection("documents"),
      },
      {
        id: "training" as const,
        title: "Training records",
        description: "Training status, expiry dates, and evidence.",
        metric: summary.trainingExpiringSoon > 0 ? `${summary.trainingExpiringSoon} expiring soon` : undefined,
        onClick: () => setSection("training"),
      },
      ...operational,
      {
        id: "risks" as const,
        title: "Risks",
        description: "Review quality and safety risks before they become problems.",
        metric: summary.risksNeedingReview > 0 ? `${summary.risksNeedingReview} need review` : undefined,
        onClick: () => setSection("risks"),
      },
      {
        id: "hazards" as const,
        title: "Safety hazards",
        description: "Record hazards and follow-up actions.",
        metric: summary.openHazards > 0 ? `${summary.openHazards} open` : undefined,
        onClick: () => setSection("hazards"),
      },
      {
        id: "incidents" as const,
        title: "Incidents & near misses",
        description: "Capture reports, investigations, and corrective actions.",
        metric:
          summary.openIncidentsAndNearMisses > 0 ? `${summary.openIncidentsAndNearMisses} open` : undefined,
        onClick: () => onNavigate("incidents"),
      },
      {
        id: "safetyRisks" as const,
        title: "Safety risks",
        description: "Activity-based assessments with controls and review dates.",
        metric:
          summary.riskAssessmentsDueReview > 0 ? `${summary.riskAssessmentsDueReview} need review` : undefined,
        onClick: () => setSection("safetyRisks"),
      },
      {
        id: "emergency" as const,
        title: "Emergency preparedness",
        description: "Fire exits, spill kits, and drills — use your existing check templates.",
        metric: undefined,
        onClick: () => onNavigate("audits"),
      },
      {
        id: "observations" as const,
        title: "Safety observations",
        description: "Positive or improvement observations from the floor.",
        metric: undefined,
        onClick: () => setSection("observations"),
      },
      {
        id: "objectives" as const,
        title: "Safety objectives",
        description: "Targets, owners, and progress for health and safety goals.",
        metric: summary.safetyObjectivesAtRisk > 0 ? `${summary.safetyObjectivesAtRisk} need attention` : undefined,
        onClick: () => setSection("objectives"),
      },
      {
        id: "review" as const,
        title: "Review pack",
        description: "Prepare a management review from real records.",
        metric: summary.managementReviewDetail,
        onClick: () => setSection("managementReview"),
      },
    ];
  }, [accessLevel, onNavigate, openNcrCount, openReportsCount, summary]);

  return (
    <div className="space-y-6">
      {section === "hub" ? (
        <PageHeader
          role={accessLevel === "full" ? "Admin" : "Manager"}
          eyebrow="Quality & safety"
          title={accessLevel === "full" ? "Quality & Safety Hub" : "Quality & safety operations"}
          subtitle={SECTION_INTROS.qmsReadiness}
        />
      ) : null}

      {section === "hub" ? (
        <QmsReadinessSummaryWidget
          summary={summary}
          onNavigate={onNavigate}
          onOpenReviewPack={accessLevel === "full" ? () => setSection("managementReview") : undefined}
        />
      ) : (
        <QmsReadinessSummaryWidget summary={summary} compact onNavigate={onNavigate} onOpenHub={openHub} />
      )}

      {accessLevel === "full" && section === "hub" ? (
        <details className={panelClass}>
          <summary className="cursor-pointer text-xs font-black text-slate-500">About certification & folders</summary>
          <p className="mt-2 text-sm text-slate-600">
            BERT helps you organise evidence for quality and safety audits. Formal certification is arranged outside the app.
            Records live in your company workspace folders on Drive.
          </p>
        </details>
      ) : null}

      {section !== "hub" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openHub}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to hub
          </button>
        </div>
      ) : null}

      {section === "hub" ? (
        <div ref={hubGridRef} className="grid scroll-mt-4 gap-4 sm:grid-cols-2">
          {hubCards.map((card) => (
            <HubCard key={card.id} title={card.title} description={card.description} metric={card.metric} onClick={card.onClick} />
          ))}
        </div>
      ) : null}

      {section === "documents" && accessLevel === "full" ? (
        <DocumentRegister documents={documents} onSave={onSaveDocuments} />
      ) : null}
      {section === "training" && accessLevel === "full" ? (
        <TrainingRegister training={training} onSave={onSaveTraining} />
      ) : null}
      {section === "risks" && accessLevel === "full" ? <RiskRegister risks={risks} onSave={onSaveRisks} /> : null}
      {section === "hazards" && accessLevel === "full" ? (
        <HazardRegister hazards={hazards} onSave={onSaveHazards} />
      ) : null}
      {section === "safetyRisks" && accessLevel === "full" ? (
        <SafetyRiskAssessmentRegister assessments={safetyRiskAssessments} onSave={onSaveSafetyRiskAssessments} />
      ) : null}
      {section === "observations" && accessLevel === "full" ? (
        <SafetyObservationRegister observations={safetyObservations} onSave={onSaveSafetyObservations} />
      ) : null}
      {section === "objectives" && accessLevel === "full" ? (
        <SafetyObjectiveRegister objectives={safetyObjectives} onSave={onSaveSafetyObjectives} />
      ) : null}
      {section === "managementReview" && accessLevel === "full" ? (
        <ManagementReviewPack
          summary={summary}
          documents={documents}
          training={training}
          risks={risks}
          nonConformances={nonConformances}
          actions={actions}
          auditFindings={auditFindings}
          history={history}
          incidents={incidents}
          hazards={hazards}
          safetyRiskAssessments={safetyRiskAssessments}
          safetyObjectives={safetyObjectives}
          openActionCount={openActionCount}
          openNcrCount={openNcrCount}
        />
      ) : null}
    </div>
  );
}

function DocumentRegister({ documents, onSave }: { documents: QMSDocument[]; onSave: (next: QMSDocument[]) => void }) {
  const [draft, setDraft] = useState({
    title: "",
    type: "Procedure",
    version: "1.0",
    owner: "",
    status: "Active" as QMSDocument["status"],
    reviewDate: "",
    fileLink: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const now = new Date().toISOString();
    onSave([
      ...documents,
      {
        id: newQmsId("doc"),
        title: draft.title.trim(),
        type: draft.type.trim() || "Document",
        version: draft.version.trim() || "1.0",
        owner: draft.owner.trim(),
        status: draft.status,
        reviewDate: draft.reviewDate,
        fileLink: draft.fileLink.trim(),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setDraft({ title: "", type: "Procedure", version: "1.0", owner: "", status: "Active", reviewDate: "", fileLink: "" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Document control register</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Type" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Version" value={draft.version} onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={draft.reviewDate} onChange={(e) => setDraft((d) => ({ ...d, reviewDate: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="File link (URL or Drive)" value={draft.fileLink} onChange={(e) => setDraft((d) => ({ ...d, fileLink: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add document
        </button>
      </form>
      {documents.length === 0 ? (
        <EmptyPanel title="No documents yet" text="Add controlled documents here with review dates and links." />
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{doc.title}</p>
              <p className="text-xs text-slate-600">
                {doc.type} · v{doc.version} · {doc.owner || "No owner"} · {doc.status}
              </p>
              <p className="text-xs text-slate-500">Review: {doc.reviewDate || "Not set"}</p>
              {doc.fileLink ? (
                <a href={doc.fileLink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700">
                  Open file
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrainingRegister({ training, onSave }: { training: QMSTrainingRecord[]; onSave: (next: QMSTrainingRecord[]) => void }) {
  const [draft, setDraft] = useState({
    person: "",
    trainingName: "",
    status: "Planned" as QMSTrainingRecord["status"],
    expiry: "",
    evidence: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.person.trim() || !draft.trainingName.trim()) return;
    const now = new Date().toISOString();
    onSave([
      ...training,
      {
        id: newQmsId("train"),
        person: draft.person.trim(),
        trainingName: draft.trainingName.trim(),
        status: draft.status,
        expiry: draft.expiry,
        evidence: draft.evidence.trim(),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setDraft({ person: "", trainingName: "", status: "Planned", expiry: "", evidence: "" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Training records</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Person" value={draft.person} onChange={(e) => setDraft((d) => ({ ...d, person: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Training name" value={draft.trainingName} onChange={(e) => setDraft((d) => ({ ...d, trainingName: e.target.value }))} required />
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={draft.expiry} onChange={(e) => setDraft((d) => ({ ...d, expiry: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Evidence link" value={draft.evidence} onChange={(e) => setDraft((d) => ({ ...d, evidence: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add training record
        </button>
      </form>
      {training.length === 0 ? (
        <EmptyPanel title="No training records" text="Track competence, expiry dates, and evidence here." />
      ) : (
        <ul className="space-y-2">
          {training.map((row) => (
            <li key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{row.person}</p>
              <p className="text-xs text-slate-600">
                {row.trainingName} · {row.status}
              </p>
              <p className="text-xs text-slate-500">Expiry: {row.expiry || "Not set"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RiskRegister({ risks, onSave }: { risks: QMSRisk[]; onSave: (next: QMSRisk[]) => void }) {
  const [draft, setDraft] = useState({
    title: "",
    category: "Quality",
    likelihood: "Medium" as QMSRisk["likelihood"],
    impact: "Medium" as QMSRisk["impact"],
    owner: "",
    reviewDate: "",
    notes: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const now = new Date().toISOString();
    onSave([
      ...risks,
      {
        id: newQmsId("risk"),
        title: draft.title.trim(),
        category: draft.category.trim() || "Other",
        likelihood: draft.likelihood,
        impact: draft.impact,
        status: "Open",
        owner: draft.owner.trim(),
        reviewDate: draft.reviewDate,
        notes: draft.notes.trim(),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setDraft({ title: "", category: "Quality", likelihood: "Medium", impact: "Medium", owner: "", reviewDate: "", notes: "" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Risk and opportunity register</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Category" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={draft.reviewDate} onChange={(e) => setDraft((d) => ({ ...d, reviewDate: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add risk
        </button>
      </form>
      {risks.length === 0 ? (
        <EmptyPanel title="No risks recorded" text="Capture risks and opportunities with owners and review dates." />
      ) : (
        <ul className="space-y-2">
          {risks.map((risk) => (
            <li key={risk.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{risk.title}</p>
              <p className="text-xs text-slate-600">
                {risk.category} · {risk.likelihood}/{risk.impact} · {risk.status}
              </p>
              <p className="text-xs text-slate-500">Review: {risk.reviewDate || "Not set"} · {risk.owner || "No owner"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HazardRegister({ hazards, onSave }: { hazards: HazardReport[]; onSave: (next: HazardReport[]) => void }) {
  const [draft, setDraft] = useState({
    areaId: "",
    description: "",
    severity: "Medium" as HazardReport["severity"],
    immediateAction: "",
    owner: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.description.trim()) return;
    const now = new Date().toISOString();
    onSave([
      ...hazards,
      {
        hazardId: newQmsId("haz"),
        areaId: draft.areaId.trim(),
        description: draft.description.trim(),
        severity: draft.severity,
        immediateAction: draft.immediateAction.trim(),
        owner: draft.owner.trim(),
        status: "Open",
        evidenceIds: [],
        createdAt: now,
        closedAt: "",
      },
    ]);
    setDraft({ areaId: "", description: "", severity: "Medium", immediateAction: "", owner: "" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Hazard reports</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Area / location ID" value={draft.areaId} onChange={(e) => setDraft((d) => ({ ...d, areaId: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Description" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Immediate action" value={draft.immediateAction} onChange={(e) => setDraft((d) => ({ ...d, immediateAction: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add hazard report
        </button>
      </form>
      {hazards.length === 0 ? (
        <EmptyPanel title="No hazard reports" text="Log hazards with severity, owner, and immediate action." />
      ) : (
        <ul className="space-y-2">
          {hazards.map((hazard) => (
            <li key={hazard.hazardId} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{hazard.description}</p>
              <p className="text-xs text-slate-600">
                {hazard.severity} · {hazard.status} · {hazard.owner || "No owner"}
              </p>
              <p className="text-xs text-slate-500">Area: {hazard.areaId || "Not set"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SafetyRiskAssessmentRegister({
  assessments,
  onSave,
}: {
  assessments: SafetyRiskAssessment[];
  onSave: (next: SafetyRiskAssessment[]) => void;
}) {
  const [draft, setDraft] = useState({
    areaId: "",
    activity: "",
    hazards: "",
    existingControls: "",
    likelihood: 3 as SafetyRiskAssessment["likelihood"],
    severity: 3 as SafetyRiskAssessment["severity"],
    furtherControls: "",
    owner: "",
    reviewDate: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.activity.trim()) return;
    const now = new Date().toISOString();
    const riskScore = computeSafetyRiskScore(draft.likelihood, draft.severity);
    onSave([
      ...assessments,
      {
        riskAssessmentId: newQmsId("sra"),
        areaId: draft.areaId.trim(),
        activity: draft.activity.trim(),
        hazards: draft.hazards.trim(),
        existingControls: draft.existingControls.trim(),
        likelihood: draft.likelihood,
        severity: draft.severity,
        riskScore,
        furtherControls: draft.furtherControls.trim(),
        owner: draft.owner.trim(),
        reviewDate: draft.reviewDate,
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setDraft({
      areaId: "",
      activity: "",
      hazards: "",
      existingControls: "",
      likelihood: 3,
      severity: 3,
      furtherControls: "",
      owner: "",
      reviewDate: "",
    });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Risk assessments</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Area ID" value={draft.areaId} onChange={(e) => setDraft((d) => ({ ...d, areaId: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Activity" value={draft.activity} onChange={(e) => setDraft((d) => ({ ...d, activity: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Hazards" value={draft.hazards} onChange={(e) => setDraft((d) => ({ ...d, hazards: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Existing controls" value={draft.existingControls} onChange={(e) => setDraft((d) => ({ ...d, existingControls: e.target.value }))} />
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={draft.reviewDate} onChange={(e) => setDraft((d) => ({ ...d, reviewDate: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add risk assessment
        </button>
      </form>
      {assessments.length === 0 ? (
        <EmptyPanel title="No risk assessments" text="Capture activity hazards, controls, and review dates." />
      ) : (
        <ul className="space-y-2">
          {assessments.map((row) => (
            <li key={row.riskAssessmentId} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{row.activity}</p>
              <p className="text-xs text-slate-600">
                Score {row.riskScore} · {row.status} · {row.owner || "No owner"}
              </p>
              <p className="text-xs text-slate-500">Review: {row.reviewDate || "Not set"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SafetyObservationRegister({
  observations,
  onSave,
}: {
  observations: SafetyObservation[];
  onSave: (next: SafetyObservation[]) => void;
}) {
  const [draft, setDraft] = useState({
    areaId: "",
    reportedBy: "",
    observation: "",
    suggestion: "",
    actionId: "",
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.observation.trim()) return;
    onSave([
      ...observations,
      {
        observationId: newQmsId("obs"),
        areaId: draft.areaId.trim(),
        reportedBy: draft.reportedBy.trim(),
        observation: draft.observation.trim(),
        suggestion: draft.suggestion.trim(),
        status: "Open",
        actionId: draft.actionId.trim(),
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft({ areaId: "", reportedBy: "", observation: "", suggestion: "", actionId: "" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Safety observations</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Area ID" value={draft.areaId} onChange={(e) => setDraft((d) => ({ ...d, areaId: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Reported by" value={draft.reportedBy} onChange={(e) => setDraft((d) => ({ ...d, reportedBy: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Observation" value={draft.observation} onChange={(e) => setDraft((d) => ({ ...d, observation: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Suggestion" value={draft.suggestion} onChange={(e) => setDraft((d) => ({ ...d, suggestion: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Linked action ID (optional)" value={draft.actionId} onChange={(e) => setDraft((d) => ({ ...d, actionId: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add observation
        </button>
      </form>
      {observations.length === 0 ? (
        <EmptyPanel title="No observations" text="Capture floor observations and link to corrective actions when needed." />
      ) : (
        <ul className="space-y-2">
          {observations.map((row) => (
            <li key={row.observationId} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{row.observation}</p>
              <p className="text-xs text-slate-600">
                {row.reportedBy || "Anonymous"} · {row.status}
              </p>
              {row.actionId ? <p className="text-xs text-slate-500">Action: {row.actionId}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SafetyObjectiveRegister({
  objectives,
  onSave,
}: {
  objectives: SafetyObjective[];
  onSave: (next: SafetyObjective[]) => void;
}) {
  const [draft, setDraft] = useState({
    objective: "",
    target: "",
    owner: "",
    currentValue: "",
    dueDate: "",
    status: "On track" as SafetyObjective["status"],
  });

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.objective.trim()) return;
    const now = new Date().toISOString();
    onSave([
      ...objectives,
      {
        objectiveId: newQmsId("hso"),
        objective: draft.objective.trim(),
        target: draft.target.trim(),
        owner: draft.owner.trim(),
        currentValue: draft.currentValue.trim(),
        dueDate: draft.dueDate,
        status: draft.status,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setDraft({ objective: "", target: "", owner: "", currentValue: "", dueDate: "", status: "On track" });
  }

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Safety objectives</h3>
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-2">
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" placeholder="Objective" value={draft.objective} onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))} required />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Target" value={draft.target} onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Current value" value={draft.currentValue} onChange={(e) => setDraft((d) => ({ ...d, currentValue: e.target.value }))} />
        <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
          Add objective
        </button>
      </form>
      {objectives.length === 0 ? (
        <EmptyPanel title="No safety objectives" text="Set targets and track progress for health and safety goals." />
      ) : (
        <ul className="space-y-2">
          {objectives.map((row) => (
            <li key={row.objectiveId} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-900">{row.objective}</p>
              <p className="text-xs text-slate-600">
                Target {row.target} · Current {row.currentValue || "—"} · {row.status}
              </p>
              <p className="text-xs text-slate-500">Due: {row.dueDate || "Not set"} · {row.owner || "No owner"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ManagementReviewPack({
  summary,
  documents,
  training,
  risks,
  nonConformances,
  actions,
  auditFindings,
  history,
  incidents,
  hazards,
  safetyRiskAssessments,
  safetyObjectives,
  openActionCount,
  openNcrCount,
}: {
  summary: QmsReadinessSummary;
  documents: QMSDocument[];
  training: QMSTrainingRecord[];
  risks: QMSRisk[];
  nonConformances: NonConformanceRecord[];
  actions: ActionItem[];
  auditFindings: AuditFindingRecord[];
  history: HistoryEntry[];
  incidents: IncidentRecord[];
  hazards: HazardReport[];
  safetyRiskAssessments: SafetyRiskAssessment[];
  safetyObjectives: SafetyObjective[];
  openActionCount: number;
  openNcrCount: number;
}) {
  const docsDue = documents.filter((d) => d.status !== "Archived").slice(0, 5);
  const trainingDue = training.slice(0, 5);
  const openNcrs = nonConformances.filter((n) => n.status !== "Completed").slice(0, 5);
  const openActions = actions.filter((a) => a.status !== "Closed").slice(0, 5);
  const openIncidents = incidents.filter((i) => i.status !== "Closed").slice(0, 5);
  const openHazards = hazards.filter((h) => h.status !== "Closed").slice(0, 5);
  const repeatFindingTitles = auditFindings
    .map((f) => f.questionText || "")
    .filter(Boolean)
    .reduce<Record<string, number>>((acc, title) => {
      acc[title] = (acc[title] || 0) + 1;
      return acc;
    }, {});
  const repeatIssues = Object.entries(repeatFindingTitles)
    .filter(([, count]) => count > 1)
    .map(([title, count]) => `${title} (×${count})`)
    .slice(0, 5);

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Review pack (preview)</h3>
      <p className="text-sm text-slate-600">
        Built from live workspace data — quality and safety checks, findings, actions, and registers. Status:{" "}
        <span className="font-semibold capitalize">{summary.managementReviewStatus}</span>. {summary.managementReviewDetail}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewBlock title="Checks completed" lines={[`${history.length} in workspace history`, `${auditFindings.length} findings on record`]} />
        <PreviewBlock title="Corrective actions" lines={[`${openActionCount} open`, `${summary.overdueCorrectiveActions} overdue (quality)`]} />
        <PreviewBlock title="Quality issues" lines={[`${openNcrCount} open`]} />
        <PreviewBlock
          title="Incidents & near misses"
          lines={openIncidents.map((i) => `${i.incidentId}: ${i.incidentType} (${i.status})`)}
          empty="No open incidents."
        />
        <PreviewBlock
          title="Hazard reports"
          lines={openHazards.map((h) => `${h.description} (${h.severity})`)}
          empty="No open hazards."
        />
        <PreviewBlock title="Documents" lines={docsDue.map((d) => `${d.title} (review ${d.reviewDate || "—"})`)} empty="No documents in register." />
        <PreviewBlock title="Training" lines={trainingDue.map((t) => `${t.person}: ${t.trainingName}`)} empty="No training records." />
        <PreviewBlock title="Quality risks" lines={risks.filter((r) => r.status !== "Closed").map((r) => r.title)} empty="No open quality risks." />
        <PreviewBlock
          title="Safety risk reviews"
          lines={safetyRiskAssessments
            .filter((r) => r.status !== "Closed")
            .slice(0, 5)
            .map((r) => `${r.activity} (review ${r.reviewDate || "—"})`)}
          empty="No active safety risk assessments."
        />
        <PreviewBlock
          title="Safety objectives"
          lines={safetyObjectives.slice(0, 5).map((o) => `${o.objective}: ${o.currentValue || "—"} / ${o.target}`)}
          empty="No H&S objectives."
        />
        <PreviewBlock title="Overdue (combined)" lines={[`${summary.overdueHsActions} actions need attention`]} />
        <PreviewBlock title="Repeat issues" lines={repeatIssues} empty="No repeat findings detected." />
        <PreviewBlock title="Evidence" lines={[`${history.length} completed checks in history`, "Use Reports for shared evidence packs"]} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open actions (sample)</p>
        <ul className="mt-2 space-y-1">
          {openActions.length === 0 ? (
            <li className="text-sm text-slate-500">No open actions.</li>
          ) : (
            openActions.map((action) => (
              <li key={action.id} className="text-sm text-slate-700">
                {action.auditName}: {action.questionText} ({action.status})
              </li>
            ))
          )}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open quality issues (sample)</p>
        <ul className="mt-2 space-y-1">
          {openNcrs.length === 0 ? (
            <li className="text-sm text-slate-500">No open quality issues.</li>
          ) : (
            openNcrs.map((ncr) => (
              <li key={ncr.id} className="text-sm text-slate-700">
                {ncr.reference}: {ncr.auditQuestion} ({ncr.status})
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}

function PreviewBlock({ title, lines, empty }: { title: string; lines: string[]; empty?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-900">{title}</p>
      <ul className="mt-2 space-y-1">
        {lines.length === 0 ? (
          <li className="text-xs text-slate-500">{empty ?? "None."}</li>
        ) : (
          lines.map((line, index) => (
            <li key={`${title}-${index}`} className="text-xs text-slate-600">
              {line}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

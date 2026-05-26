import { FormEvent, useMemo, useState } from "react";
import { SECTION_INTROS } from "../config/sectionIntros";
import { QmsReadinessSummaryWidget } from "../components/qms/QmsReadinessSummaryWidget";
import type { AuditFindingRecord } from "../types/complianceLoop";
import type { NavItemId } from "../types/navigation";
import type { NonConformanceRecord } from "../types/nonConformanceScreenProps";
import type { ActionItem, HistoryEntry } from "../types/reportsScreenProps";
import type { QMSDocument, QMSRisk, QMSTrainingRecord, QmsReadinessSummary } from "../types/qms";
import { newQmsId } from "../utils/qmsReadiness";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";

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
  onSaveDocuments: (next: QMSDocument[]) => void;
  onSaveTraining: (next: QMSTrainingRecord[]) => void;
  onSaveRisks: (next: QMSRisk[]) => void;
};

type HubSection =
  | "hub"
  | "documents"
  | "training"
  | "risks"
  | "managementReview";

const panelClass = "rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm";

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
      className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400"
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
  onSaveDocuments,
  onSaveTraining,
  onSaveRisks,
}: QmsReadinessScreenProps) {
  const [section, setSection] = useState<HubSection>("hub");

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
        title: "Non-conformances",
        description: "Investigate and close issues raised from checks.",
        metric: openNcrCount > 0 ? `${openNcrCount} open` : undefined,
        onClick: () => onNavigate("nonConformance"),
      },
      {
        id: "actions" as const,
        title: "Corrective actions",
        description: "Assign ownership, add evidence, and verify closure.",
        metric: summary.overdueCorrectiveActions > 0 ? `${summary.overdueCorrectiveActions} overdue` : undefined,
        onClick: () => onNavigate("actions"),
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
          description: "Operational checks that feed your quality records.",
          metric: undefined,
          onClick: () => onNavigate("audits"),
        },
      ];
    }
    return [
      {
        id: "documents" as const,
        title: "Document control",
        description: "Simple register for controlled documents and review dates.",
        metric: summary.documentsNeedingReview > 0 ? `${summary.documentsNeedingReview} need review` : undefined,
        onClick: () => setSection("documents"),
      },
      {
        id: "training" as const,
        title: "Training records",
        description: "People, training status, expiry, and evidence links.",
        metric: summary.trainingExpiringSoon > 0 ? `${summary.trainingExpiringSoon} expiring soon` : undefined,
        onClick: () => setSection("training"),
      },
      ...operational,
      {
        id: "risks" as const,
        title: "Risks and opportunities",
        description: "Lightweight risk register with review dates.",
        metric: summary.risksNeedingReview > 0 ? `${summary.risksNeedingReview} need review` : undefined,
        onClick: () => setSection("risks"),
      },
      {
        id: "review" as const,
        title: "Management review pack",
        description: "Preview readiness data before your review meeting.",
        metric: summary.managementReviewDetail,
        onClick: () => setSection("managementReview"),
      },
    ];
  }, [accessLevel, onNavigate, openNcrCount, openReportsCount, summary]);

  return (
    <div className="space-y-4">
      <section className={panelClass}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">QMS Readiness</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          {accessLevel === "full" ? "Keep quality records under control" : "Quality operations"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{SECTION_INTROS.qmsReadiness}</p>
        <p className="mt-2 text-xs text-slate-500">
          Supports ISO 9001 readiness. BERT does not certify you — it helps you stay ready.
        </p>
      </section>

      <QmsReadinessSummaryWidget summary={summary} onOpenHub={() => setSection("hub")} onNavigate={onNavigate} />

      {section !== "hub" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSection("hub")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to hub
          </button>
        </div>
      ) : null}

      {section === "hub" ? (
        <div className="grid gap-3 sm:grid-cols-2">
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

function ManagementReviewPack({
  summary,
  documents,
  training,
  risks,
  nonConformances,
  actions,
  auditFindings,
  history,
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
  openActionCount: number;
  openNcrCount: number;
}) {
  const docsDue = documents.filter((d) => d.status !== "Archived").slice(0, 5);
  const trainingDue = training.slice(0, 5);
  const openNcrs = nonConformances.filter((n) => n.status !== "Completed").slice(0, 5);
  const openActions = actions.filter((a) => a.status !== "Closed").slice(0, 5);

  return (
    <section className={`${panelClass} space-y-4`}>
      <h3 className="text-sm font-semibold text-slate-900">Management review pack (preview)</h3>
      <p className="text-sm text-slate-600">
        Built from live workspace data — checks, findings, actions, and registers. Status:{" "}
        <span className="font-semibold capitalize">{summary.managementReviewStatus}</span>. {summary.managementReviewDetail}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewBlock title="Checks completed" lines={[`${history.length} in workspace history`, `${auditFindings.length} findings on record`]} />
        <PreviewBlock title="Corrective actions" lines={[`${openActionCount} open`, `${summary.overdueCorrectiveActions} overdue`]} />
        <PreviewBlock title="Non-conformances" lines={[`${openNcrCount} open`]} />
        <PreviewBlock title="Documents" lines={docsDue.map((d) => `${d.title} (review ${d.reviewDate || "—"})`)} empty="No documents in register." />
        <PreviewBlock title="Training" lines={trainingDue.map((t) => `${t.person}: ${t.trainingName}`)} empty="No training records." />
        <PreviewBlock title="Risks" lines={risks.filter((r) => r.status !== "Closed").map((r) => r.title)} empty="No open risks." />
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
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open NCRs (sample)</p>
        <ul className="mt-2 space-y-1">
          {openNcrs.length === 0 ? (
            <li className="text-sm text-slate-500">No open non-conformances.</li>
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

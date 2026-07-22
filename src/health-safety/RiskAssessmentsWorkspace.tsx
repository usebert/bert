import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../permissions";
import {
  canApproveRiskAssessments,
  canArchiveRiskAssessments,
  canCreateRiskAssessments,
  canReviewRiskAssessments,
  canSubmitRiskAssessments,
} from "../permissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import { StatusBadge } from "../components/ui/StatusBadge";
import { fetchCompanyStructure, type StructureEntity } from "../services/companyStructureService";
import {
  approveRiskAssessment,
  archiveRiskAssessment,
  calculateClientRiskScore,
  createRiskAssessment,
  createRiskHazard,
  createRiskLink,
  fetchRiskAssessmentDetail,
  fetchRiskAssessmentList,
  getClientRiskBand,
  readCachedRiskAssessmentList,
  rejectRiskAssessment,
  restoreRiskAssessment,
  reviewRiskAssessment,
  RISK_ASSESSMENT_LOAD_USER_MESSAGE,
  RISK_ASSESSMENT_OFFLINE_WRITE_MESSAGE,
  submitRiskAssessment,
  updateRiskAssessment,
  updateRiskHazard,
} from "../services/riskAssessmentService";
import type { RiskAssessmentListTab, RiskAssessmentRecord, RiskHazardInput, RiskHazardRecord } from "../types/riskAssessment";
import {
  buildRiskAssessmentListItems,
  buildRiskAssessmentSummary,
  filterRiskAssessmentItems,
  filterRiskAssessmentItemsForTab,
  riskAssessmentStatusVariant,
  sortRiskAssessmentItems,
  type RiskAssessmentFilterState,
} from "./adapters/riskAssessmentListAdapter";
import {
  HAZARD_LIBRARY,
  LIKELIHOOD_OPTIONS,
  PEOPLE_AT_RISK_OPTIONS,
  RISK_ASSESSMENT_TYPES,
  SEVERITY_OPTIONS,
  WIZARD_STEPS,
} from "./constants/riskAssessmentConstants";
import { RiskAssessmentPrintView } from "./RiskAssessmentPrintView";

export type RiskAssessmentsWorkspaceProps = {
  role: Role;
  companyFolderId: string;
  masterSheetId?: string;
  offlineMode?: boolean;
  initialRiskAssessmentId?: string;
  onBack?: () => void;
};

type WorkspaceView = "list" | "detail" | "wizard";

const TAB_LABELS: Record<RiskAssessmentListTab, string> = {
  active: "Active",
  drafts: "Drafts",
  awaiting_approval: "Awaiting Approval",
  review_due: "Review Due",
  overdue: "Overdue",
  archived: "Archived",
};

function formatDateKey(dateKey?: string) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function RiskScoreBadge({ score }: { score: number }) {
  const band = getClientRiskBand(score);
  return (
    <StatusBadge variant={band.level === "neutral" ? "neutral" : band.level}>
      {score > 0 ? `${score} ${band.label}` : "Not assessed"}
    </StatusBadge>
  );
}

export function RiskAssessmentsWorkspace({
  role,
  companyFolderId,
  masterSheetId,
  offlineMode = false,
  initialRiskAssessmentId,
  onBack,
}: RiskAssessmentsWorkspaceProps) {
  const folderId = String(companyFolderId || "").trim();
  const isWriteBlocked = offlineMode || (typeof navigator !== "undefined" && navigator.onLine === false);
  const [records, setRecords] = useState<RiskAssessmentRecord[]>(() => readCachedRiskAssessmentList(folderId)?.items || []);
  const [loading, setLoading] = useState(!records.length);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [activeTab, setActiveTab] = useState<RiskAssessmentListTab>("active");
  const [filters, setFilters] = useState<RiskAssessmentFilterState>({
    query: "",
    status: "",
    site: "",
    area: "",
    assessmentType: "",
    owner: "",
    reviewDueOnly: false,
    overdueOnly: false,
    includeArchived: false,
  });
  const [view, setView] = useState<WorkspaceView>(initialRiskAssessmentId ? "detail" : "list");
  const [selectedId, setSelectedId] = useState(initialRiskAssessmentId || "");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchRiskAssessmentDetail>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardId, setWizardId] = useState("");
  const [sites, setSites] = useState<StructureEntity[]>([]);
  const [areas, setAreas] = useState<StructureEntity[]>([]);
  const [showPrint, setShowPrint] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    assessmentType: "General",
    activity: "",
    department: "",
    siteId: "",
    areaId: "",
    ownerName: "",
    assessorName: "",
    assessmentDate: "",
    reviewDate: "",
    peopleAtRisk: [] as string[],
    peopleAtRiskOther: "",
    existingGeneralControls: "",
    emergencyArrangements: "",
    ppeSummary: "",
  });
  const [draftHazards, setDraftHazards] = useState<RiskHazardRecord[]>([]);
  const [hazardDraft, setHazardDraft] = useState<RiskHazardInput>({
    hazardType: HAZARD_LIBRARY[0],
    hazardTitle: "",
    initialLikelihood: 3,
    initialSeverity: 3,
    residualLikelihood: 2,
    residualSeverity: 2,
    actionRequired: false,
  });
  const [linkDraft, setLinkDraft] = useState({ linkedRecordType: "coshh", linkedRecordId: "", linkedRecordTitle: "" });

  const loadList = useCallback(
    async (refresh = false) => {
      if (!folderId) return;
      if (!records.length) setLoading(true);
      setLoadError("");
      try {
        const result = await fetchRiskAssessmentList(folderId, { refresh, includeArchived: true });
        setRecords(result.items || []);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : RISK_ASSESSMENT_LOAD_USER_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [folderId, records.length],
  );

  const loadDetail = useCallback(
    async (riskAssessmentId: string, refresh = false) => {
      if (!folderId || !riskAssessmentId) return;
      setDetailLoading(true);
      setActionError("");
      try {
        const result = await fetchRiskAssessmentDetail(folderId, riskAssessmentId, { refresh });
        setDetail(result);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : RISK_ASSESSMENT_LOAD_USER_MESSAGE);
      } finally {
        setDetailLoading(false);
      }
    },
    [folderId],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!folderId) return;
    void fetchCompanyStructure(folderId, masterSheetId)
      .then((payload) => {
        setSites((payload.sites || []).filter((site) => site.status !== "inactive"));
        setAreas((payload.areas || []).filter((area) => area.status !== "inactive"));
      })
      .catch(() => undefined);
  }, [folderId, masterSheetId]);

  useEffect(() => {
    if (selectedId && view === "detail") void loadDetail(selectedId, true);
  }, [selectedId, view, loadDetail]);

  const listItems = useMemo(() => {
    const items = buildRiskAssessmentListItems(records);
    return sortRiskAssessmentItems(filterRiskAssessmentItems(filterRiskAssessmentItemsForTab(items, activeTab), filters));
  }, [records, activeTab, filters]);

  const summary = useMemo(() => buildRiskAssessmentSummary(records), [records]);

  const guardWrite = () => {
    if (isWriteBlocked) {
      setActionError(RISK_ASSESSMENT_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  };

  const openCreate = () => {
    setWizardId("");
    setWizardStep(0);
    setForm({
      title: "",
      description: "",
      assessmentType: "General",
      activity: "",
      department: "",
      siteId: "",
      areaId: "",
      ownerName: "",
      assessorName: "",
      assessmentDate: "",
      reviewDate: "",
      peopleAtRisk: [],
      peopleAtRiskOther: "",
      existingGeneralControls: "",
      emergencyArrangements: "",
      ppeSummary: "",
    });
    setDraftHazards([]);
    setView("wizard");
  };

  const openDetail = (id: string) => {
    setSelectedId(id);
    setView("detail");
  };

  const saveWizardDraft = async (): Promise<string> => {
    if (!guardWrite()) return "";
    setActionError("");
    const payload = {
      ...form,
      peopleAtRisk: [...form.peopleAtRisk, form.peopleAtRiskOther].filter(Boolean).join(", "),
    };
    try {
      if (wizardId) {
        await updateRiskAssessment(folderId, wizardId, payload);
        return wizardId;
      }
      const created = await createRiskAssessment(folderId, payload);
      const id = created.item?.id || "";
      if (id) setWizardId(id);
      setActionNotice("Draft saved.");
      await loadList(true);
      return id;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save draft.");
      return "";
    }
  };

  const addHazardToDraft = async () => {
    if (!guardWrite()) return;
    const id = wizardId || (await saveWizardDraft());
    if (!id) return;
    try {
      const result = await createRiskHazard(folderId, id, hazardDraft);
      setDraftHazards((current) => [...current, result.item]);
      setHazardDraft({
        hazardType: HAZARD_LIBRARY[0],
        hazardTitle: "",
        initialLikelihood: 3,
        initialSeverity: 3,
        residualLikelihood: 2,
        residualSeverity: 2,
        actionRequired: false,
      });
      setActionNotice("Hazard added.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not add hazard.");
    }
  };

  const submitWizard = async () => {
    if (!guardWrite() || !wizardId) return;
    if (!window.confirm("Submit this risk assessment for approval?")) return;
    try {
      await submitRiskAssessment(folderId, wizardId);
      setActionNotice("Submitted for approval.");
      setView("list");
      await loadList(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not submit assessment.");
    }
  };

  const handleApprove = async () => {
    if (!guardWrite() || !selectedId || !detail?.item) return;
    if (detail.item.highestResidualRiskScore >= 10 && !window.confirm("High or very high residual risks remain. Approve anyway?")) return;
    try {
      await approveRiskAssessment(folderId, selectedId, { activateNow: true });
      setActionNotice("Assessment approved and activated.");
      await loadDetail(selectedId, true);
      await loadList(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not approve assessment.");
    }
  };

  const handleReject = async () => {
    if (!guardWrite() || !selectedId || !rejectReason.trim()) return;
    try {
      await rejectRiskAssessment(folderId, selectedId, { rejectionReason: rejectReason.trim() });
      setRejectReason("");
      setActionNotice("Assessment rejected.");
      await loadDetail(selectedId, true);
      await loadList(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject assessment.");
    }
  };

  const handleReviewNoChange = async () => {
    if (!guardWrite() || !selectedId || !detail?.item) return;
    try {
      await reviewRiskAssessment(folderId, selectedId, {
        outcome: "no_change",
        reviewType: "scheduled",
        summary: "No changes required at review.",
        nextReviewDate: detail.item.reviewDate,
      });
      setActionNotice("Review recorded.");
      await loadDetail(selectedId, true);
      await loadList(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not record review.");
    }
  };

  const addLink = async () => {
    if (!guardWrite() || !wizardId || !linkDraft.linkedRecordId.trim()) return;
    try {
      await createRiskLink(folderId, wizardId, linkDraft);
      setLinkDraft({ linkedRecordType: "coshh", linkedRecordId: "", linkedRecordTitle: "" });
      setActionNotice("Link added.");
      await loadDetail(wizardId, true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not add link.");
    }
  };

  if (showPrint && detail?.item) {
    return (
      <RiskAssessmentPrintView
        assessment={detail.item}
        hazards={detail.hazards || []}
        links={detail.links || []}
        reviews={detail.reviews || []}
        onClose={() => setShowPrint(false)}
      />
    );
  }

  if (view === "wizard") {
    const initialScore = calculateClientRiskScore(hazardDraft.initialLikelihood || 0, hazardDraft.initialSeverity || 0);
    const residualScore = calculateClientRiskScore(hazardDraft.residualLikelihood || 0, hazardDraft.residualSeverity || 0);
    return (
      <PageContainer>
        <PageHeader
          eyebrow="HEALTH & SAFETY"
          title="New risk assessment"
          description={`Step ${wizardStep + 1} of ${WIZARD_STEPS.length}: ${WIZARD_STEPS[wizardStep]}`}
          secondaryActions={
            <>
              <Button type="button" variant="secondary" onClick={() => setView("list")}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={() => void saveWizardDraft()}>
                Save draft
              </Button>
            </>
          }
        />
        {actionError ? <p className="mb-3 text-sm text-red-700" role="alert">{actionError}</p> : null}
        {actionNotice ? <p className="mb-3 text-sm text-emerald-700" aria-live="polite">{actionNotice}</p> : null}
        <div className="mb-4 flex flex-wrap gap-2">
          {WIZARD_STEPS.map((step, index) => (
            <button
              key={step}
              type="button"
              onClick={() => setWizardStep(index)}
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                wizardStep === index ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              {index + 1}. {step}
            </button>
          ))}
        </div>
        <Section>
          {wizardStep === 0 ? (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(event: FormEvent) => event.preventDefault()}>
              <label className="block md:col-span-2">
                <span className="text-sm font-medium">Title</span>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-medium">Description</span>
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Assessment type</span>
                <select className="mt-1 w-full rounded-lg border px-3 py-2" value={form.assessmentType} onChange={(e) => setForm({ ...form, assessmentType: e.target.value })}>
                  {RISK_ASSESSMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Activity</span>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Site</span>
                <select className="mt-1 w-full rounded-lg border px-3 py-2" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                  <option value="">Select site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>{site.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Area</span>
                <select className="mt-1 w-full rounded-lg border px-3 py-2" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                  <option value="">Select area</option>
                  {areas.filter((area) => !form.siteId || area.siteId === form.siteId).map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Owner</span>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Assessor</span>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.assessorName} onChange={(e) => setForm({ ...form, assessorName: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Assessment date</span>
                <input type="date" className="mt-1 w-full rounded-lg border px-3 py-2" value={form.assessmentDate} onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Review date</span>
                <input type="date" className="mt-1 w-full rounded-lg border px-3 py-2" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
              </label>
            </form>
          ) : null}
          {wizardStep === 1 ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Select everyone who may be harmed by this activity.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PEOPLE_AT_RISK_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <input
                      type="checkbox"
                      checked={form.peopleAtRisk.includes(option)}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          peopleAtRisk: event.target.checked
                            ? [...current.peopleAtRisk, option]
                            : current.peopleAtRisk.filter((entry) => entry !== option),
                        }));
                      }}
                    />
                    <span className="text-sm">{option}</span>
                  </label>
                ))}
              </div>
              <label className="block">
                <span className="text-sm font-medium">Other clarification</span>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.peopleAtRiskOther} onChange={(e) => setForm({ ...form, peopleAtRiskOther: e.target.value })} />
              </label>
            </div>
          ) : null}
          {(wizardStep === 2 || wizardStep === 3 || wizardStep === 4) ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Hazard</span>
                  <select className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.hazardType} onChange={(e) => setHazardDraft({ ...hazardDraft, hazardType: e.target.value })}>
                    {HAZARD_LIBRARY.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Hazard title</span>
                  <input className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.hazardTitle} onChange={(e) => setHazardDraft({ ...hazardDraft, hazardTitle: e.target.value })} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium">Who might be harmed</span>
                  <input className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.whoMightBeHarmed} onChange={(e) => setHazardDraft({ ...hazardDraft, whoMightBeHarmed: e.target.value })} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium">How harm could occur</span>
                  <textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={2} value={hazardDraft.howMightTheyBeHarmed} onChange={(e) => setHazardDraft({ ...hazardDraft, howMightTheyBeHarmed: e.target.value })} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium">Existing controls</span>
                  <textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={2} value={hazardDraft.existingControls} onChange={(e) => setHazardDraft({ ...hazardDraft, existingControls: e.target.value })} />
                </label>
                {wizardStep >= 3 ? (
                  <label className="block md:col-span-2">
                    <span className="text-sm font-medium">Additional controls</span>
                    <textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={2} value={hazardDraft.additionalControls} onChange={(e) => setHazardDraft({ ...hazardDraft, additionalControls: e.target.value })} />
                  </label>
                ) : null}
                <label className="block">
                  <span className="text-sm font-medium">Initial likelihood</span>
                  <select className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.initialLikelihood} onChange={(e) => setHazardDraft({ ...hazardDraft, initialLikelihood: Number(e.target.value) })}>
                    {LIKELIHOOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Initial severity</span>
                  <select className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.initialSeverity} onChange={(e) => setHazardDraft({ ...hazardDraft, initialSeverity: Number(e.target.value) })}>
                    {SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {wizardStep >= 4 ? (
                  <>
                    <label className="block">
                      <span className="text-sm font-medium">Residual likelihood</span>
                      <select className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.residualLikelihood} onChange={(e) => setHazardDraft({ ...hazardDraft, residualLikelihood: Number(e.target.value) })}>
                        {LIKELIHOOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Residual severity</span>
                      <select className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.residualSeverity} onChange={(e) => setHazardDraft({ ...hazardDraft, residualSeverity: Number(e.target.value) })}>
                        {SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <div className="md:col-span-2 flex flex-wrap gap-3">
                      <RiskScoreBadge score={initialScore} />
                      <RiskScoreBadge score={residualScore} />
                    </div>
                  </>
                ) : null}
                {wizardStep >= 3 ? (
                  <>
                    <label className="flex items-center gap-2 md:col-span-2">
                      <input type="checkbox" checked={Boolean(hazardDraft.actionRequired)} onChange={(e) => setHazardDraft({ ...hazardDraft, actionRequired: e.target.checked })} />
                      <span className="text-sm">Create linked action for this control</span>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Control owner</span>
                      <input className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.controlOwnerName} onChange={(e) => setHazardDraft({ ...hazardDraft, controlOwnerName: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Control due date</span>
                      <input type="date" className="mt-1 w-full rounded-lg border px-3 py-2" value={hazardDraft.controlDueDate} onChange={(e) => setHazardDraft({ ...hazardDraft, controlDueDate: e.target.value })} />
                    </label>
                  </>
                ) : null}
              </div>
              <Button type="button" onClick={() => void addHazardToDraft()}>Add hazard</Button>
              <div className="space-y-2">
                {draftHazards.map((hazard) => (
                  <div key={hazard.id} className="rounded-xl border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{hazard.hazardTitle || hazard.hazardType}</p>
                      <div className="flex gap-2">
                        <RiskScoreBadge score={hazard.initialRiskScore} />
                        <RiskScoreBadge score={hazard.residualRiskScore} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {wizardStep === 5 ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <select className="rounded-lg border px-3 py-2" value={linkDraft.linkedRecordType} onChange={(e) => setLinkDraft({ ...linkDraft, linkedRecordType: e.target.value })}>
                  <option value="coshh">COSHH</option>
                  <option value="equipment">Equipment</option>
                  <option value="incident">Incident</option>
                  <option value="document">Document</option>
                  <option value="action">Action</option>
                  <option value="audit">Audit</option>
                </select>
                <input className="rounded-lg border px-3 py-2" placeholder="Record ID" value={linkDraft.linkedRecordId} onChange={(e) => setLinkDraft({ ...linkDraft, linkedRecordId: e.target.value })} />
                <input className="rounded-lg border px-3 py-2" placeholder="Record title" value={linkDraft.linkedRecordTitle} onChange={(e) => setLinkDraft({ ...linkDraft, linkedRecordTitle: e.target.value })} />
              </div>
              <Button type="button" variant="secondary" onClick={() => void addLink()}>Add link</Button>
            </div>
          ) : null}
          {wizardStep === 6 ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p><strong>{form.title}</strong> · {form.assessmentType}</p>
              <p>Review date: {formatDateKey(form.reviewDate)}</p>
              <p>{draftHazards.length} hazard(s) recorded.</p>
              {draftHazards.some((hazard) => hazard.residualRiskScore >= 10) ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  Warning: one or more hazards remain High or Very High after controls.
                </p>
              ) : null}
            </div>
          ) : null}
        </Section>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={wizardStep === 0} onClick={() => setWizardStep((step) => Math.max(0, step - 1))}>
            Back
          </Button>
          {wizardStep < WIZARD_STEPS.length - 1 ? (
            <Button type="button" onClick={() => setWizardStep((step) => Math.min(WIZARD_STEPS.length - 1, step + 1))}>
              Next
            </Button>
          ) : (
            <Button type="button" onClick={() => void submitWizard()} disabled={!canSubmitRiskAssessments(role)}>
              Submit for approval
            </Button>
          )}
        </div>
      </PageContainer>
    );
  }

  if (view === "detail" && detail?.item) {
    const item = detail.item;
    return (
      <PageContainer>
        <PageHeader
          eyebrow="HEALTH & SAFETY"
          title={item.title}
          description={`${item.assessmentNumber} · Version ${item.version} · ${item.status}`}
          secondaryActions={
            <>
              <Button type="button" variant="secondary" onClick={() => setView("list")}>Back to list</Button>
              <Button type="button" variant="secondary" onClick={() => setShowPrint(true)}>Print</Button>
              {item.status === "Submitted" && canApproveRiskAssessments(role) ? (
                <Button type="button" onClick={() => void handleApprove()}>Approve</Button>
              ) : null}
              {item.status === "Submitted" && canApproveRiskAssessments(role) ? (
                <Button type="button" variant="secondary" onClick={() => void handleReject()}>Reject</Button>
              ) : null}
              {canReviewRiskAssessments(role) && ["Active", "Review Due", "Overdue"].includes(item.status) ? (
                <Button type="button" variant="secondary" onClick={() => void handleReviewNoChange()}>Record review</Button>
              ) : null}
            </>
          }
        />
        {actionError ? <p className="mb-3 text-sm text-red-700" role="alert">{actionError}</p> : null}
        {item.status === "Submitted" && canApproveRiskAssessments(role) ? (
          <label className="mb-4 block">
            <span className="text-sm font-medium">Rejection reason</span>
            <input className="mt-1 w-full rounded-lg border px-3 py-2" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </label>
        ) : null}
        <Section title="Summary">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-xs text-slate-500">Highest residual risk</p><RiskScoreBadge score={item.highestResidualRiskScore} /></div>
            <div><p className="text-xs text-slate-500">Review date</p><p className="font-semibold">{formatDateKey(item.reviewDate)}</p></div>
            <div><p className="text-xs text-slate-500">Owner</p><p className="font-semibold">{item.ownerName || "—"}</p></div>
            <div><p className="text-xs text-slate-500">Assessor</p><p className="font-semibold">{item.assessorName || "—"}</p></div>
          </div>
        </Section>
        <Section title="Hazards">
          {(detail.hazards || []).length === 0 ? (
            <EmptyState title="No hazards recorded" description="Add hazards while editing the assessment." />
          ) : (
            <div className="space-y-2">
              {(detail.hazards || []).map((hazard) => (
                <article key={hazard.id} className="rounded-xl border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{hazard.hazardTitle || hazard.hazardType}</p>
                      <p className="text-sm text-slate-600">{hazard.additionalControls || hazard.existingControls}</p>
                    </div>
                    <div className="flex gap-2">
                      <RiskScoreBadge score={hazard.initialRiskScore} />
                      <RiskScoreBadge score={hazard.residualRiskScore} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>
        <Section title="Linked records">
          {(detail.links || []).length === 0 ? (
            <p className="text-sm text-slate-500">No linked records.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(detail.links || []).map((link) => (
                <span key={link.id} className="rounded-full border px-3 py-1 text-sm">
                  {link.linkedRecordType}: {link.linkedRecordTitle || link.linkedRecordId}
                </span>
              ))}
            </div>
          )}
        </Section>
        <Section title="Review history">
          {(detail.reviews || []).length === 0 ? (
            <p className="text-sm text-slate-500">No reviews recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {(detail.reviews || []).map((review) => (
                <li key={review.id} className="rounded-xl border px-4 py-3 text-sm">
                  <p className="font-semibold">{review.reviewType.replace(/_/g, " ")} · {review.outcome.replace(/_/g, " ")}</p>
                  <p className="text-slate-600">{review.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="HEALTH & SAFETY"
        title="Risk Assessments"
        description="Manage risk assessments, hazards, controls and reviews."
        primaryAction={
          canCreateRiskAssessments(role) ? (
            <Button type="button" onClick={openCreate}>Create assessment</Button>
          ) : undefined
        }
        secondaryActions={
          onBack ? (
            <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
          ) : undefined
        }
      />
      {loadError ? <p className="mb-3 text-sm text-red-700" role="alert">{loadError}</p> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Active", value: summary.active },
          { label: "Drafts", value: summary.drafts },
          { label: "Awaiting approval", value: summary.awaitingApproval },
          { label: "Overdue", value: summary.overdue },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as RiskAssessmentListTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "rounded-full px-3 py-1.5 text-sm font-semibold",
              activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
            ].join(" ")}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <input className="rounded-lg border px-3 py-2" placeholder="Search assessments" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
        <select className="rounded-lg border px-3 py-2" value={filters.assessmentType} onChange={(e) => setFilters({ ...filters, assessmentType: e.target.value })}>
          <option value="">All types</option>
          {RISK_ASSESSMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input className="rounded-lg border px-3 py-2" placeholder="Filter by owner" value={filters.owner} onChange={(e) => setFilters({ ...filters, owner: e.target.value })} />
      </div>
      <Section>
        {loading && listItems.length === 0 ? (
          <p className="text-sm text-slate-500">Loading risk assessments…</p>
        ) : listItems.length === 0 ? (
          <EmptyState title="No risk assessments yet" description="Create a draft assessment to begin recording hazards and controls." />
        ) : (
          <div className="space-y-2">
            {listItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openDetail(item.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="text-sm text-slate-500">
                    {item.assessmentNumber} · {item.assessmentType} · v{item.version}
                    {item.siteId ? ` · ${item.siteId}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RiskScoreBadge score={item.highestResidualRiskScore} />
                  <StatusBadge variant={riskAssessmentStatusVariant(item.status)} dot={false}>{item.status}</StatusBadge>
                  <span className="text-xs text-slate-500">Review {formatDateKey(item.reviewDate)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </PageContainer>
  );
}

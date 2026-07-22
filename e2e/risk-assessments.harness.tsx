import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RiskAssessmentsWorkspace } from "../src/health-safety/RiskAssessmentsWorkspace";
import "../src/index.css";

type HarnessApi = {
  lastAction?: string;
  reset: () => void;
};

type HazardRecord = {
  id: string;
  riskAssessmentId: string;
  companyFolderId: string;
  hazardType: string;
  hazardTitle: string;
  hazardDescription: string;
  whoMightBeHarmed: string;
  howMightTheyBeHarmed: string;
  existingControls: string;
  initialLikelihood: number;
  initialSeverity: number;
  initialRiskScore: number;
  additionalControls: string;
  residualLikelihood: number;
  residualSeverity: number;
  residualRiskScore: number;
  controlOwnerUserId: string;
  controlOwnerName: string;
  controlDueDate: string;
  actionRequired: boolean;
  linkedActionId: string;
  sortOrder: number;
  status: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string;
  archivedBy: string;
};

declare global {
  interface Window {
    __riskAssessmentsHarness?: HarnessApi;
    fetch: typeof fetch;
  }
}

const companyFolderId = "company-test";
const assessments = [
  {
    id: "ra-1",
    companyFolderId,
    assessmentNumber: "RA-0001",
    title: "Warehouse manual handling",
    description: "Routine lifting operations",
    assessmentType: "Manual Handling",
    activity: "Unloading deliveries",
    department: "Warehouse",
    siteId: "site-1",
    areaId: "area-1",
    ownerUserId: "",
    ownerName: "Sam Manager",
    assessorUserId: "",
    assessorName: "Alex Admin",
    assessmentDate: "2026-07-01",
    reviewDate: "2027-07-01",
    nextReviewReason: "",
    status: "Active",
    version: "1.0",
    previousVersionId: "",
    initialOverallRiskScore: 16,
    residualOverallRiskScore: 9,
    highestInitialRiskScore: 16,
    highestResidualRiskScore: 9,
    peopleAtRisk: "Employees",
    existingGeneralControls: "",
    emergencyArrangements: "",
    ppeSummary: "",
    approvalRequired: true,
    submittedAt: "",
    submittedBy: "",
    approvedAt: "2026-07-02",
    approvedBy: "pat.admin@example.com",
    rejectedAt: "",
    rejectedBy: "",
    rejectionReason: "",
    activatedAt: "2026-07-02",
    supersededAt: "",
    archivedAt: "",
    archivedBy: "",
    createdAt: "2026-07-01T10:00:00.000Z",
    createdBy: "alex.admin@example.com",
    updatedAt: "2026-07-02T10:00:00.000Z",
    updatedBy: "pat.admin@example.com",
    hazardCount: 1,
    highResidualCount: 0,
    veryHighResidualCount: 0,
  },
  {
    id: "ra-2",
    companyFolderId,
    assessmentNumber: "RA-0002",
    title: "Loading bay traffic",
    description: "",
    assessmentType: "Activity",
    activity: "Vehicle movements",
    department: "",
    siteId: "site-1",
    areaId: "",
    ownerUserId: "",
    ownerName: "Sam Manager",
    assessorUserId: "",
    assessorName: "Alex Admin",
    assessmentDate: "2026-07-10",
    reviewDate: "",
    nextReviewReason: "",
    status: "Draft",
    version: "1.0",
    previousVersionId: "",
    initialOverallRiskScore: 0,
    residualOverallRiskScore: 0,
    highestInitialRiskScore: 0,
    highestResidualRiskScore: 0,
    peopleAtRisk: "",
    existingGeneralControls: "",
    emergencyArrangements: "",
    ppeSummary: "",
    approvalRequired: true,
    submittedAt: "",
    submittedBy: "",
    approvedAt: "",
    approvedBy: "",
    rejectedAt: "",
    rejectedBy: "",
    rejectionReason: "",
    activatedAt: "",
    supersededAt: "",
    archivedAt: "",
    archivedBy: "",
    createdAt: "2026-07-10T10:00:00.000Z",
    createdBy: "alex.admin@example.com",
    updatedAt: "2026-07-10T10:00:00.000Z",
    updatedBy: "alex.admin@example.com",
    hazardCount: 0,
    highResidualCount: 0,
    veryHighResidualCount: 0,
  },
];

const hazards: HazardRecord[] = [
  {
    id: "rah-1",
    riskAssessmentId: "ra-1",
    companyFolderId,
    hazardType: "Manual handling",
    hazardTitle: "Manual handling",
    hazardDescription: "",
    whoMightBeHarmed: "Employees",
    howMightTheyBeHarmed: "Back injury",
    existingControls: "Training",
    initialLikelihood: 4,
    initialSeverity: 4,
    initialRiskScore: 16,
    additionalControls: "Mechanical aids",
    residualLikelihood: 3,
    residualSeverity: 3,
    residualRiskScore: 9,
    controlOwnerUserId: "",
    controlOwnerName: "Sam Manager",
    controlDueDate: "2026-08-01",
    actionRequired: false,
    linkedActionId: "",
    sortOrder: 1,
    status: "active",
    createdAt: "2026-07-01T10:00:00.000Z",
    createdBy: "alex.admin@example.com",
    updatedAt: "2026-07-01T10:00:00.000Z",
    updatedBy: "alex.admin@example.com",
    archivedAt: "",
    archivedBy: "",
  },
];

type DraftStore = {
  assessmentId: string;
  item: Record<string, unknown>;
  hazards: HazardRecord[];
};

let draftStore: DraftStore | null = null;

function mapDraftHazards(body: { hazards?: Array<Record<string, unknown>> }, assessmentId: string) {
  return (body.hazards || []).map((hazard, index) => ({
    id: String(hazard.id || `rah-mock-${index + 1}`),
    riskAssessmentId: assessmentId,
    companyFolderId,
    hazardType: String(hazard.hazardType || "General"),
    hazardTitle: String(hazard.hazardTitle || hazard.hazardType || "Hazard"),
    hazardDescription: String(hazard.hazardDescription || ""),
    whoMightBeHarmed: String(hazard.whoMightBeHarmed || ""),
    howMightTheyBeHarmed: String(hazard.howMightTheyBeHarmed || ""),
    existingControls: String(hazard.existingControls || ""),
    initialLikelihood: Number(hazard.initialLikelihood) || 0,
    initialSeverity: Number(hazard.initialSeverity) || 0,
    initialRiskScore: (Number(hazard.initialLikelihood) || 0) * (Number(hazard.initialSeverity) || 0),
    additionalControls: String(hazard.additionalControls || ""),
    residualLikelihood: Number(hazard.residualLikelihood) || 0,
    residualSeverity: Number(hazard.residualSeverity) || 0,
    residualRiskScore: (Number(hazard.residualLikelihood) || 0) * (Number(hazard.residualSeverity) || 0),
    controlOwnerUserId: "",
    controlOwnerName: String(hazard.controlOwnerName || ""),
    controlDueDate: String(hazard.controlDueDate || ""),
    actionRequired: Boolean(hazard.actionRequired),
    linkedActionId: "",
    sortOrder: index + 1,
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: "alex.admin@example.com",
    updatedAt: new Date().toISOString(),
    updatedBy: "alex.admin@example.com",
    archivedAt: "",
    archivedBy: "",
  }));
}

const harnessState: HarnessApi = {
  reset() {
    harnessState.lastAction = undefined;
    draftStore = null;
    window.dispatchEvent(new Event("risk-assessments-harness-change"));
  },
};

window.__riskAssessmentsHarness = harnessState;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = String(init?.method || "GET").toUpperCase();

  if (url.includes(`/api/companies/${companyFolderId}/risk-assessments/draft`) && method === "POST") {
    const body = JSON.parse(String(init?.body || "{}"));
    const assessmentId = `ra-draft-${Date.now()}`;
    const mappedHazards = mapDraftHazards(body, assessmentId);
    draftStore = {
      assessmentId,
      item: {
        id: assessmentId,
        companyFolderId,
        assessmentNumber: "RA-0099",
        title: String(body.title || "Untitled risk assessment"),
        assessmentType: String(body.assessmentType || "General"),
        assessmentDate: String(body.assessmentDate || ""),
        reviewDate: String(body.reviewDate || ""),
        status: "Draft",
        version: "1.0",
        highestResidualRiskScore: 0,
        highestInitialRiskScore: 0,
      },
      hazards: mappedHazards,
    };
    return new Response(
      JSON.stringify({ ok: true, item: draftStore.item, hazards: mappedHazards, links: [], reviews: [], savedAt: new Date().toISOString() }),
      { status: 200 },
    );
  }

  if (url.includes("/save-draft") && method === "POST") {
    const body = JSON.parse(String(init?.body || "{}"));
    const assessmentId = url.split("/risk-assessments/")[1]?.split("/")[0] || draftStore?.assessmentId || "ra-draft";
    const mappedHazards = mapDraftHazards(body, assessmentId);
    draftStore = {
      assessmentId,
      item: {
        ...(draftStore?.item || {}),
        id: assessmentId,
        title: String(body.title || draftStore?.item?.title || "Untitled risk assessment"),
      },
      hazards: mappedHazards,
    };
    return new Response(
      JSON.stringify({ ok: true, item: draftStore.item, hazards: mappedHazards, links: [], reviews: [], savedAt: new Date().toISOString() }),
      { status: 200 },
    );
  }

  if (method === "GET" && url.includes(`/api/companies/${companyFolderId}/risk-assessments/ra-1`)) {
    return new Response(
      JSON.stringify({ ok: true, item: assessments[0], hazards, links: [], reviews: [] }),
      { status: 200 },
    );
  }

  if (method === "GET" && url.includes(`/api/companies/${companyFolderId}/risk-assessments`) && !url.includes("/ra-")) {
    return new Response(JSON.stringify({ ok: true, items: assessments }), { status: 200 });
  }

  if (url.includes(`/api/companies/${companyFolderId}/structure`)) {
    return new Response(
      JSON.stringify({
        ok: true,
        sites: [{ id: "site-1", name: "Main site", code: "MAIN", status: "active" }],
        areas: [{ id: "area-1", name: "Warehouse", siteId: "site-1", status: "active" }],
      }),
      { status: 200 },
    );
  }

  return nativeFetch(input, init);
};

function HarnessApp() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((value) => value + 1);
    window.addEventListener("risk-assessments-harness-change", rerender);
    return () => window.removeEventListener("risk-assessments-harness-change", rerender);
  }, []);

  return (
    <div data-testid="risk-assessments-harness">
      <RiskAssessmentsWorkspace role="Admin" companyFolderId={companyFolderId} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);

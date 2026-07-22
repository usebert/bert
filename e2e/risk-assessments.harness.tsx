import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RiskAssessmentsWorkspace } from "../src/health-safety/RiskAssessmentsWorkspace";
import "../src/index.css";

type HarnessApi = {
  lastAction?: string;
  reset: () => void;
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

const hazards = [
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

const harnessState: HarnessApi = {
  reset() {
    harnessState.lastAction = undefined;
    window.dispatchEvent(new Event("risk-assessments-harness-change"));
  },
};

window.__riskAssessmentsHarness = harnessState;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes(`/api/companies/${companyFolderId}/risk-assessments`) && !url.includes("/ra-")) {
    return new Response(JSON.stringify({ ok: true, items: assessments }), { status: 200 });
  }
  if (url.includes(`/api/companies/${companyFolderId}/risk-assessments/ra-1`)) {
    return new Response(
      JSON.stringify({ ok: true, item: assessments[0], hazards, links: [], reviews: [] }),
      { status: 200 },
    );
  }
  if (url.includes(`/api/companies/${companyFolderId}/structure/`)) {
    if (url.includes("/sites")) {
      return new Response(JSON.stringify({ ok: true, sites: [{ id: "site-1", name: "Main site", code: "MAIN", status: "active" }] }), { status: 200 });
    }
    if (url.includes("/areas")) {
      return new Response(JSON.stringify({ ok: true, areas: [{ id: "area-1", name: "Warehouse", siteId: "site-1", status: "active" }] }), { status: 200 });
    }
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

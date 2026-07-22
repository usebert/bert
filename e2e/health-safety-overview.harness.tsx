import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HealthSafetyOverviewScreen } from "../src/screens/HealthSafetyOverviewScreen";
import type { HealthSafetyOverviewResponse } from "../src/services/healthSafetyService";
import "../src/index.css";

type HarnessApi = {
  mode: "attention" | "empty";
  refreshCount: number;
  lastNavigate?: { screen: string; params?: Record<string, string> };
  setMode: (mode: "attention" | "empty") => void;
  reset: () => void;
};

declare global {
  interface Window {
    __healthSafetyOverviewHarness?: HarnessApi;
    fetch: typeof fetch;
  }
}

const attentionPayload: HealthSafetyOverviewResponse = {
  ok: true,
  updatedAt: new Date().toISOString(),
  statusSummary: {
    level: "attention",
    urgentCount: 1,
    attentionCount: 2,
    explanation: "There are 2 open incidents, but no high-risk incidents or overdue equipment inspections.",
    updatedAt: new Date().toISOString(),
  },
  metrics: {
    openIncidents: 2,
    highRiskIncidents: 0,
    incidentsAwaitingInvestigation: 1,
    riddorDecisionsRequired: 1,
    openRiddorReports: 1,
    riddorFollowUpsDue: 0,
    riddorReportableActionsDue: 0,
    coshhReviewsOverdue: 0,
    coshhReviewsDueSoon: 0,
    chemicalsMissingSds: 0,
    coshhAssessmentsDue: 0,
    equipmentInspectionsOverdue: 0,
    equipmentInspectionsDueSoon: 0,
    equipmentOutOfService: 0,
    overdueHealthSafetyActions: 0,
    highPriorityOverdueActions: 0,
  },
  attentionItems: [
    {
      id: "attention-riddor-decision-rid-1",
      type: "riddor_decision",
      title: "RIDDOR decision required (INC-001)",
      reason: "A RIDDOR decision is required for this incident.",
      priority: 3,
      severity: "urgent",
      siteId: "",
      siteName: "",
      areaId: "",
      areaName: "",
      dueDate: "2026-07-01",
      route: "healthSafetyRiddor",
      recordId: "rid-1",
      actionLabel: "Complete RIDDOR decision",
    },
    {
      id: "attention-equipment-due-soon-eq-1",
      type: "equipment_due_soon",
      title: "Hoist inspection due soon",
      reason: "Equipment examination is due within the next 30 days.",
      priority: 8,
      severity: "attention",
      siteId: "site-1",
      siteName: "Main site",
      areaId: "",
      areaName: "",
      dueDate: "2026-08-01",
      route: "loler",
      recordId: "eq-1",
      actionLabel: "Open equipment",
    },
  ],
  recentActivity: [
    {
      id: "activity-incident-created-inc-1",
      type: "incident_created",
      summary: "Incident reported: Near Miss",
      actorName: "Alex Admin",
      occurredAt: new Date(Date.now() - 3600000).toISOString(),
      siteName: "Main site",
      areaName: "Yard",
      route: "incidents",
      recordId: "inc-1",
    },
  ],
  summary: {
    openIncidents: 2,
    highRiskIncidents: 0,
    riddorDecisionsRequired: 1,
    openRiddorReports: 1,
    coshhAssessmentsOverdue: 0,
    chemicalsMissingSds: 0,
    equipmentInspectionsOverdue: 0,
    openHealthSafetyActions: 0,
  },
  attention: [],
};

const emptyPayload: HealthSafetyOverviewResponse = {
  ok: true,
  updatedAt: new Date().toISOString(),
  statusSummary: {
    level: "good",
    urgentCount: 0,
    attentionCount: 0,
    explanation: "No open Health & Safety issues are recorded in BERT right now.",
    updatedAt: new Date().toISOString(),
  },
  metrics: {
    openIncidents: 0,
    highRiskIncidents: 0,
    incidentsAwaitingInvestigation: 0,
    riddorDecisionsRequired: 0,
    openRiddorReports: 0,
    riddorFollowUpsDue: 0,
    riddorReportableActionsDue: 0,
    coshhReviewsOverdue: 0,
    coshhReviewsDueSoon: 0,
    chemicalsMissingSds: 0,
    coshhAssessmentsDue: 0,
    equipmentInspectionsOverdue: 0,
    equipmentInspectionsDueSoon: 0,
    equipmentOutOfService: 0,
    overdueHealthSafetyActions: 0,
    highPriorityOverdueActions: 0,
  },
  attentionItems: [],
  recentActivity: [],
  summary: {
    openIncidents: 0,
    highRiskIncidents: 0,
    riddorDecisionsRequired: 0,
    openRiddorReports: 0,
    coshhAssessmentsOverdue: 0,
    chemicalsMissingSds: 0,
    equipmentInspectionsOverdue: 0,
    openHealthSafetyActions: 0,
  },
  attention: [],
};

const harnessState: HarnessApi = {
  mode: "attention",
  refreshCount: 0,
  setMode(mode) {
    harnessState.mode = mode;
    window.dispatchEvent(new Event("health-safety-overview-harness-change"));
  },
  reset() {
    harnessState.mode = "attention";
    harnessState.refreshCount = 0;
    harnessState.lastNavigate = undefined;
    window.dispatchEvent(new Event("health-safety-overview-harness-change"));
  },
};

window.__healthSafetyOverviewHarness = harnessState;

window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/health-safety/overview")) {
    harnessState.refreshCount += 1;
    const payload = harnessState.mode === "empty" ? emptyPayload : attentionPayload;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: false }), { status: 404 });
};

function HarnessApp() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((value) => value + 1);
    window.addEventListener("health-safety-overview-harness-change", rerender);
    return () => window.removeEventListener("health-safety-overview-harness-change", rerender);
  }, []);

  return (
    <div data-testid="health-safety-overview-harness">
      <HealthSafetyOverviewScreen
        role="Admin"
        companyFolderId="company-1"
        onNavigate={(screen, params) => {
          harnessState.lastNavigate = { screen, params };
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);

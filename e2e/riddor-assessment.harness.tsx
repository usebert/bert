import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RiddorAssessmentPanel } from "../src/health-safety/components/RiddorAssessmentPanel";
import "../src/index.css";

type HarnessApi = {
  completed: boolean;
  reset: () => void;
};

declare global {
  interface Window {
    __riddorHarness?: HarnessApi;
    fetch: typeof fetch;
  }
}

const harnessState: HarnessApi = {
  completed: false,
  reset() {
    harnessState.completed = false;
  },
};

window.__riddorHarness = harnessState;

window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/riddor-assessment")) {
    return new Response(
      JSON.stringify({
        ok: true,
        item: { id: "rid-test", incidentId: "inc-1", decisionStatus: "likely_reportable" },
        evaluation: { likelyReportable: true, decisionStatus: "likely_reportable" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ ok: false }), { status: 404 });
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="mx-auto max-w-2xl p-4" data-testid="riddor-harness">
      <RiddorAssessmentPanel
        companyFolderId="company-1"
        incidentId="inc-1"
        onCompleted={() => {
          harnessState.completed = true;
        }}
      />
    </div>
  </StrictMode>,
);

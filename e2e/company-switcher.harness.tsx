import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { CompanyContextButton } from "../src/components/app-shell/CompanyContextButton";
import "../src/index.css";

type CompanySwitcherHarnessApi = {
  selectedId: string;
  selectCalls: string[];
  reset: () => void;
};

declare global {
  interface Window {
    __companySwitcherHarness?: CompanySwitcherHarnessApi;
  }
}

const harnessState: CompanySwitcherHarnessApi = {
  selectedId: "company-a",
  selectCalls: [],
  reset() {
    harnessState.selectedId = "company-a";
    harnessState.selectCalls = [];
  },
};

window.__companySwitcherHarness = harnessState;

function HarnessApp() {
  const [selectedId, setSelectedId] = useState(harnessState.selectedId);

  return (
    <div className="qms-app-shell relative isolate flex min-h-screen flex-col overflow-hidden border border-slate-200 bg-white">
      <header className="qms-app-header relative z-10 border-b border-slate-200 bg-white/90 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-semibold text-slate-900">Workspace shell header</h1>
          <CompanyContextButton
            companyName="Dovecote Manufacturing Ltd"
            showSwitcher
            options={[
              { id: "company-a", name: "Dovecote Manufacturing Ltd" },
              { id: "company-b", name: "Midlands Precast Ltd" },
              { id: "company-c", name: "Northern Aggregates and Concrete Services Group" },
            ]}
            selectedId={selectedId}
            onSelect={(companyId) => {
              harnessState.selectCalls.push(companyId);
              harnessState.selectedId = companyId;
              setSelectedId(companyId);
            }}
          />
        </div>
      </header>
      <main className="relative z-10 flex-1 overflow-hidden p-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">Page content that previously clipped the dropdown.</p>
        </section>
      </main>
      <div className="fixed bottom-4 left-4 sm:hidden">
        <CompanyContextButton
          companyName="Single workspace"
          showSwitcher={false}
          options={[{ id: "company-a", name: "Single workspace" }]}
          selectedId="company-a"
          onSelect={() => undefined}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getFriendlyPresentedNav, groupPresentedNav } from "../src/config/navPresentation";
import "../src/index.css";

type HealthSafetyNavHarnessApi = {
  groups: Array<{ label: string; itemIds: string[] }>;
  reset: () => void;
};

declare global {
  interface Window {
    __healthSafetyNavHarness?: HealthSafetyNavHarnessApi;
  }
}

function buildGroups(role: "Admin") {
  const items = getFriendlyPresentedNav(role);
  return groupPresentedNav(role, items).map((group) => ({
    label: group.label,
    itemIds: group.items.map((item) => item.id),
  }));
}

const harnessState: HealthSafetyNavHarnessApi = {
  groups: buildGroups("Admin"),
  reset() {
    harnessState.groups = buildGroups("Admin");
  },
};

window.__healthSafetyNavHarness = harnessState;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="p-4" data-testid="health-safety-nav-harness">
      {harnessState.groups.map((group) => (
        <section key={group.label} data-testid={`nav-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`}>
          <h2 className="text-lg font-bold">{group.label}</h2>
          <ul>
            {group.itemIds.map((id) => (
              <li key={id} data-testid={`nav-item-${id}`}>
                {id}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </StrictMode>,
);

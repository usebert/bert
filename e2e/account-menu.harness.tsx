import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountMenu } from "../src/components/app-shell/AccountMenu";
import "../src/index.css";

type AccountMenuHarnessApi = {
  logoutInvoked: boolean;
  reset: () => void;
};

declare global {
  interface Window {
    __accountMenuHarness?: AccountMenuHarnessApi;
  }
}

const harnessState: AccountMenuHarnessApi = {
  logoutInvoked: false,
  reset() {
    harnessState.logoutInvoked = false;
  },
};

window.__accountMenuHarness = harnessState;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex min-h-screen items-start justify-end bg-slate-100 p-4">
      <AccountMenu
        displayName="Test User"
        email="test.user@example.com"
        role="Admin"
        companyName="Acme Manufacturing Ltd"
        initials="TU"
        showCompanySwitcher
        onOpenAccount={() => undefined}
        onOpenCompanySwitcher={() => undefined}
        onHelp={() => undefined}
        onSignOut={() => {
          harnessState.logoutInvoked = true;
        }}
      />
    </div>
  </StrictMode>,
);

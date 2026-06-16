import type { NavItemId } from "../types/navigation";
import type { User } from "../types/dashboardScreenProps";
import { SECTION_INTROS } from "../config/sectionIntros";
import { getRoleDisplayName } from "../permissions";
import { SectionIntro } from "../components/SectionIntro";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";
import { isCapacitorNativeApp } from "../utils/debugUiVisibility";

type AdvancedNavItem = {
  id: NavItemId;
  label: string;
  description: string;
};

const ADVANCED_ITEMS: AdvancedNavItem[] = [
  { id: "audits", label: "Audits", description: "Audit centre and traffic board" },
  { id: "actions", label: "Actions", description: "Corrective actions and follow-up" },
  { id: "reports", label: "Reports", description: "Reports and exports" },
  { id: "schedules", label: "Schedules", description: "Audit schedules" },
  { id: "sync", label: "Sync Centre", description: "Queued submissions and sync status" },
  { id: "documentTraining", label: "Upload & training", description: "Document distribution and acknowledgments" },
  { id: "emailReminders", label: "Email reminders", description: "Personal reminder emails" },
];

type Props = {
  currentUser: User;
  accountNameInput: string;
  themeMode: "light" | "dark";
  onOpenScreen: (screen: NavItemId) => void;
  onOpenAccount: () => void;
  slatePrimaryCtaInteract: string;
};

export function PilotSettingsScreen({
  currentUser,
  accountNameInput,
  themeMode,
  onOpenScreen,
  onOpenAccount,
  slatePrimaryCtaInteract,
}: Props) {
  return (
    <div className="space-y-4">
      <section className={[darkPanelShellCompact, themeMode === "dark" ? "!bg-slate-900" : ""].join(" ")}>
        <p className={darkPanelEyebrow}>
          {currentUser.role === "Admin" ? "Tablet / Kiosk" : "Settings"}
        </p>
        <h2 className={darkPanelTitleSm}>
          {currentUser.role === "Admin" ? "Tablet / Kiosk" : "Account & advanced tools"}
        </h2>
        {currentUser.role === "Admin" ? (
          <SectionIntro text={SECTION_INTROS.tabletKiosk} className="mt-2" tone="onDark" />
        ) : (
          <p className={["mt-1", darkPanelDescription].join(" ")}>
            Signed in as {accountNameInput || currentUser.name} ({getRoleDisplayName(currentUser.role)}).
          </p>
        )}
      </section>

      {currentUser.role === "Admin" && !isCapacitorNativeApp() ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
          <p className="font-semibold text-slate-900">Tablet / Kiosk on pilot devices</p>
          <p className="mt-2">
            Kiosk mode is enabled on the BERT Android APK by the platform owner (Master). Contact your platform owner to
            turn kiosk on or adjust tablets.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            The production API must list{" "}
            <span className="font-mono text-slate-700">http://localhost</span>,{" "}
            <span className="font-mono text-slate-700">capacitor://localhost</span>, and your hosted SPA origins in{" "}
            <span className="font-mono text-slate-700">BERT_ALLOWED_ORIGINS</span> so tablets can call{" "}
            <span className="font-mono text-slate-700">https://api.usebert.co.uk</span>.
          </p>
          <p className="mt-2 text-xs leading-5 text-amber-900 rounded-2xl border border-amber-100 bg-amber-50/80 px-3 py-2">
            For true OS lockdown use Android Screen Pinning, Enterprise / MDM kiosk, or Device Owner provisioning — BERT
            app kiosk alone cannot block Home, Recents, or Settings on unmanaged tablets.
          </p>
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Your account</p>
        <p className="mt-1 text-sm text-slate-600">Update your display name, photo, and appearance.</p>
        <button
          type="button"
          onClick={onOpenAccount}
          className={`mt-3 h-11 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
        >
          Open account settings
        </button>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Advanced (day-to-day operations)</p>
        <p className="mt-1 text-sm text-slate-600">Use these after company workspaces are live.</p>
        <ul className="mt-3 space-y-2">
          {ADVANCED_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenScreen(item.id)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-200 hover:bg-white"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
                </span>
                <span className="text-slate-400">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

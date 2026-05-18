import type { NavItemId } from "../types/navigation";
import type { User } from "../types/dashboardScreenProps";
import { getRoleDisplayName } from "../permissions";

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
      <section
        className={[
          "rounded-[1.75rem] px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]",
          themeMode === "dark" ? "bg-slate-900" : "bg-slate-950",
        ].join(" ")}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Settings</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Account & advanced tools</h2>
        <p className="mt-1 text-sm text-slate-300">
          Signed in as {accountNameInput || currentUser.name} ({getRoleDisplayName(currentUser.role)}).
        </p>
      </section>

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

import { useEffect, useState } from "react";
import type { NavItemId } from "../../types/navigation";
import { fetchSetupStatus, type SetupStatusPayload } from "../../services/setupStatusService";
import {
  DashboardQuickActions,
  MetricTile,
  RoleDashboardShell,
  SystemHealthyStrip,
} from "./RoleDashboardPrimitives";

type Props = {
  googleConnected: boolean;
  companiesCount: number;
  pendingOnboardingCount: number;
  usersAwaitingSetupCount: number;
  activeUsersCount: number;
  onNavigate: (screen: NavItemId) => void;
  onOpenInitialSetup: () => void;
};

export function MasterPlatformDashboard({
  googleConnected,
  companiesCount,
  pendingOnboardingCount,
  usersAwaitingSetupCount,
  activeUsersCount,
  onNavigate,
  onOpenInitialSetup,
}: Props) {
  const [setup, setSetup] = useState<SetupStatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const payload = await fetchSetupStatus();
      if (!cancelled) {
        setSetup(payload);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [googleConnected]);

  const smtpOk = setup?.smtpConfigured === true;
  const driveOk = setup?.sharedDriveConfigured === true && googleConnected;
  const systemHealthy = setup?.readyForPilot === true;

  const healthRows = [
    { label: "API", ok: true },
    { label: "Database", ok: true },
    { label: "Sheets", ok: driveOk },
    { label: "Email", ok: smtpOk },
  ];

  return (
    <RoleDashboardShell role="Master" title="Platform Dashboard">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          role="Master"
          label="Google Workspace"
          value={googleConnected ? "Connected" : "Not connected"}
          hint={googleConnected ? "OAuth session on the API server." : "Connect in Platform Setup."}
        />
        <MetricTile
          role="Master"
          label="Shared Drive"
          value={driveOk ? "Verified" : "Not verified"}
          hint={setup?.sharedDriveId ? "Drive ID configured on API." : "Set GOOGLE_SHARED_DRIVE_ID on API."}
        />
        <MetricTile
          role="Master"
          label="Email (SMTP)"
          value={smtpOk ? "Working" : "Not configured"}
          hint={smtpOk ? "Company invites can send email." : "Manual invite links still work."}
        />
        <MetricTile role="Master" label="Companies" value={String(companiesCount)} hint="Active company workspaces." />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pending onboarding submissions</p>
          <p className="mt-2 text-4xl font-semibold text-slate-900">{pendingOnboardingCount}</p>
          <p className="mt-1 text-sm text-slate-600">Needs review</p>
          <button
            type="button"
            onClick={() => onNavigate("onboarding")}
            className="mt-3 text-sm font-semibold text-orange-600 hover:text-orange-700"
          >
            View submissions
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">System health</p>
          <ul className="mt-3 space-y-2">
            {healthRows.map((row) => (
              <li key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{row.label}</span>
                <span
                  className={[
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    row.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
                  ].join(" ")}
                >
                  {row.ok ? "OK" : "Needs attention"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile role="Master" label="Active users" value={String(activeUsersCount)} />
        <MetricTile
          role="Master"
          label="Awaiting setup"
          value={String(usersAwaitingSetupCount)}
          alertValue={usersAwaitingSetupCount > 0}
          hint="Invites not yet completed."
        />
      </div>

      <DashboardQuickActions
        role="Master"
        layout="list"
        actions={[
          { label: "Platform Setup", screen: "setup", onClick: () => onNavigate("setup") },
          { label: "Company Onboarding", screen: "onboarding", onClick: () => onNavigate("onboarding") },
          { label: "Users & Invites", screen: "users", onClick: () => onNavigate("users") },
          { label: "Reports / Diagnostics", screen: "reports", onClick: () => onNavigate("reports") },
        ]}
      />

      {systemHealthy ? <SystemHealthyStrip role="Master" /> : null}

      {!systemHealthy ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">Finish platform setup</p>
          <p className="mt-1 text-sm text-amber-900">
            Complete Google, shared drive, and readiness checks before widening the pilot.
          </p>
          <button
            type="button"
            onClick={onOpenInitialSetup}
            className="mt-3 h-11 rounded-2xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
          >
            Open Initial Setup
          </button>
        </section>
      ) : null}
    </RoleDashboardShell>
  );
}

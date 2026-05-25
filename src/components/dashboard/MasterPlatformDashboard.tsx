import { useEffect, useState } from "react";
import type { NavItemId } from "../../types/navigation";
import { fetchSetupStatus, type SetupStatusPayload } from "../../services/setupStatusService";
import { PilotHealthPanel } from "../pilot/PilotHealthPanel";
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

function PlatformStatusIcon({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function PlatformStatusCard({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <PlatformStatusIcon ok={ok} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          <span
            className={[
              "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
              ok ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/15" : "bg-amber-100 text-amber-900",
            ].join(" ")}
          >
            {ok ? "Healthy" : "Action needed"}
          </span>
          {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}

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
  const companiesActive = companiesCount > 0;

  return (
    <RoleDashboardShell role="Master" title="Platform Dashboard">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PlatformStatusCard
          label="Google Workspace"
          value={googleConnected ? "Connected" : "Not connected"}
          ok={googleConnected}
          hint={googleConnected ? "OAuth session on the API server." : "Connect in Platform Setup."}
        />
        <PlatformStatusCard
          label="Shared Drive"
          value={driveOk ? "Verified" : "Not verified"}
          ok={driveOk}
          hint={setup?.sharedDriveId ? "Drive ID configured on API." : "Set GOOGLE_SHARED_DRIVE_ID on API."}
        />
        <PlatformStatusCard
          label="Email (SMTP)"
          value={smtpOk ? "Working" : "Not configured"}
          ok={smtpOk}
          hint={smtpOk ? "Company invites can send email." : "Manual invite links still work."}
        />
        <PlatformStatusCard
          label="Companies"
          value={companiesActive ? "Active" : "None yet"}
          ok={companiesActive}
          hint={`${companiesCount} company workspace${companiesCount === 1 ? "" : "s"} visible on Drive.`}
        />
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

        <PilotHealthPanel role="Master" compact />
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

import { useEffect, useState } from "react";
import type { NavItemId } from "../../types/navigation";
import { SECTION_INTROS } from "../../config/sectionIntros";
import { fetchSetupStatus, type SetupStatusPayload } from "../../services/setupStatusService";
import { DashboardQuickActions, RoleDashboardShell, StatusTile } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";

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

  return (
    <RoleDashboardShell
      eyebrow="Platform control centre"
      title="BERT platform overview"
      intro={SECTION_INTROS.platformSetup}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusTile
          label="Google Workspace"
          value={googleConnected ? "Connected" : "Not connected"}
          ok={googleConnected}
          hint={googleConnected ? "OAuth session on the API server." : "Connect in Platform Setup."}
        />
        <StatusTile
          label="Shared Drive"
          value={driveOk ? "Verified" : "Not verified"}
          ok={driveOk}
          hint={setup?.sharedDriveId ? "Drive ID configured on API." : "Set GOOGLE_SHARED_DRIVE_ID on API."}
        />
        <StatusTile
          label="Invite email (SMTP)"
          value={smtpOk ? "Working" : "Not configured"}
          ok={smtpOk}
          hint={smtpOk ? "Company invites can send email." : "Manual invite links still work."}
        />
        <StatusTile label="Companies" value={String(companiesCount)} hint="Linked company workspaces." />
        <StatusTile
          label="Onboarding submissions"
          value={String(pendingOnboardingCount)}
          hint="Responses waiting in Company Onboarding."
        />
        <StatusTile
          label="System health"
          value={systemHealthy ? "Ready for pilot" : "Needs setup"}
          ok={systemHealthy}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">People on the platform</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <StatusTile label="Active users" value={String(activeUsersCount)} />
          <StatusTile
            label="Awaiting setup"
            value={String(usersAwaitingSetupCount)}
            ok={usersAwaitingSetupCount === 0 ? true : false}
            hint="Invites not yet completed."
          />
        </div>
        {activeUsersCount === 0 && usersAwaitingSetupCount === 0 ? (
          <div className="mt-3">
            <EmptyPanel
              title="No users yet"
              text="Send company onboarding or user invites once Google and shared drive are ready."
            />
          </div>
        ) : null}
      </section>

      <DashboardQuickActions
        actions={[
          { label: "Platform Setup", screen: "setup", onClick: () => onNavigate("setup") },
          { label: "Company Onboarding", screen: "onboarding", onClick: () => onNavigate("onboarding") },
          { label: "Users & Invites", screen: "users", onClick: () => onNavigate("users") },
          { label: "Reports / Diagnostics", screen: "reports", onClick: () => onNavigate("reports") },
        ]}
      />

      {!systemHealthy ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">Finish platform setup</p>
          <p className="mt-1 text-sm text-amber-900">Complete Google, shared drive, and readiness checks before widening the pilot.</p>
          <button
            type="button"
            onClick={onOpenInitialSetup}
            className="mt-3 h-11 rounded-2xl bg-[#ea580c] px-4 text-sm font-semibold text-white"
          >
            Open Initial Setup
          </button>
        </section>
      ) : null}
    </RoleDashboardShell>
  );
}

import { useEffect, useMemo, useState } from "react";
import { fetchSetupStatus } from "../../services/setupStatusService";
import { fetchPilotPlatformStatus } from "../../services/pilotStatusService";
import { evaluatePilotReadiness } from "../../utils/pilotReadiness";
import { slatePrimaryCtaInteract } from "../../styles/interactions";

type Props = {
  /** Master-only: opens protected /setup/initial area */
  onOpenInitialSetup?: () => void;
  slatePrimaryCtaInteractClass?: string;
};

export function PilotReadinessCard({
  onOpenInitialSetup,
  slatePrimaryCtaInteractClass = slatePrimaryCtaInteract,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [readyForPilot, setReadyForPilot] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const setup = await fetchSetupStatus();
      if (setup?.readyForPilot === true || setup?.readyForPilot === false) {
        if (!cancelled) {
          setReadyForPilot(setup.readyForPilot);
          setLoading(false);
        }
        return;
      }
      const status = await fetchPilotPlatformStatus();
      if (cancelled) {
        return;
      }
      const summary = evaluatePilotReadiness({
        apiOnline: status.health?.ok === true,
        ready: status.readiness?.ready === true,
        sessionStoreWritable: status.readiness?.checks?.sessionStoreWritable === true,
        googleConfigured: status.readiness?.googleConfigured === true || status.google?.configured === true,
        googleConnected: status.google?.connected === true,
        sharedDriveConfigured: status.health?.sharedDriveConfigured === true || Boolean(status.google?.sharedDriveId),
        smtpOk: status.smtp?.ok === true,
        appApiConfigured: status.appApiConfigured,
      });
      setReadyForPilot(summary.pilotReady);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tone = useMemo(() => {
    if (loading || readyForPilot === null) {
      return "border-slate-200 bg-white";
    }
    return readyForPilot
      ? "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white"
      : "border-amber-200 bg-gradient-to-b from-amber-50 to-white";
  }, [loading, readyForPilot]);

  const headline = loading
    ? "Checking setup status…"
    : readyForPilot
      ? "BERT is ready for pilot"
      : "System setup needs attention";

  return (
    <section className={`rounded-[1.75rem] border p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">What to do now</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{headline}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {loading
              ? "Loading status from the server."
              : readyForPilot
                ? "You can invite companies and users from the menu."
                : "Finish initial setup before widening the pilot."}
          </p>
        </div>
        {onOpenInitialSetup && !loading && readyForPilot === false ? (
          <button
            type="button"
            onClick={onOpenInitialSetup}
            className={`h-11 shrink-0 rounded-2xl bg-[#ea580c] px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteractClass}`}
          >
            Open Initial Setup
          </button>
        ) : null}
      </div>
    </section>
  );
}

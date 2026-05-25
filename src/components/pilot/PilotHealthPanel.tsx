import { useEffect, useState } from "react";
import { fetchPilotPlatformStatus } from "../../services/pilotStatusService";
import type { Role } from "../../permissions";

type HealthRow = {
  label: string;
  ok: boolean;
  detail: string;
};

type Props = {
  role?: Role;
  className?: string;
  compact?: boolean;
};

export function PilotHealthPanel({ role: _role = "Master", className = "", compact = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [allOk, setAllOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const status = await fetchPilotPlatformStatus();
      if (cancelled) {
        return;
      }
      const apiOk = status.health?.ok === true && status.appApiConfigured;
      const ready = status.readiness?.ready === true;
      const sessionOk = status.readiness?.checks?.sessionStoreWritable === true;
      const googleConfigured =
        status.readiness?.googleConfigured === true || status.google?.configured === true;
      const googleConnected = status.google?.connected === true;
      const driveOk =
        status.health?.sharedDriveConfigured === true || Boolean(status.google?.sharedDriveId);
      const smtpOk = status.smtp?.ok === true;

      const nextRows: HealthRow[] = [
        {
          label: "API liveness",
          ok: apiOk,
          detail: apiOk ? "GET /api/health responded OK." : "API unreachable or misconfigured (check VITE_API_BASE_URL).",
        },
        {
          label: "Readiness",
          ok: ready && sessionOk,
          detail: ready
            ? "Session store writable and production env rules satisfied."
            : "GET /api/readiness not ready — check SESSION_SECRET and BERT_ALLOWED_ORIGINS on API.",
        },
        {
          label: "Google OAuth",
          ok: googleConfigured && googleConnected,
          detail: googleConnected
            ? "Workspace session connected on API."
            : googleConfigured
              ? "Env configured; connect Google in Platform Setup."
              : "Google env vars missing on API.",
        },
        {
          label: "Shared Drive",
          ok: driveOk,
          detail: driveOk ? "GOOGLE_SHARED_DRIVE_ID present on API." : "Set GOOGLE_SHARED_DRIVE_ID on API and redeploy.",
        },
        {
          label: "Invite email (SMTP)",
          ok: smtpOk,
          detail: smtpOk ? "Server can send invite and onboarding email." : "Manual invite links still work without SMTP.",
        },
      ];
      setRows(nextRows);
      setAllOk(nextRows.every((row) => row.ok));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className={[
        "rounded-2xl border border-slate-200/90 bg-white shadow-sm",
        compact ? "p-3" : "p-4",
        className,
      ].join(" ")}
      aria-label="Pilot health"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pilot health</p>
          {!compact ? (
            <p className="mt-0.5 text-sm text-slate-600">Live probes from /api/health, /api/readiness, Google, and SMTP.</p>
          ) : null}
        </div>
        {!loading ? (
          <span
            className={[
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              allOk ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
            ].join(" ")}
          >
            {allOk ? "All OK" : "Needs attention"}
          </span>
        ) : null}
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading status from API…</p>
      ) : (
        <ul className={["space-y-2", compact ? "mt-2" : "mt-3"].join(" ")}>
          {rows.map((row) => (
            <li key={row.label} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-slate-800">{row.label}</span>
                {!compact ? <p className="mt-0.5 text-xs text-slate-500">{row.detail}</p> : null}
              </div>
              <span
                className={[
                  "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  row.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
                ].join(" ")}
              >
                {row.ok ? "OK" : "Check"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!loading && allOk ? (
        <p className={["text-xs font-medium text-emerald-800", compact ? "mt-2" : "mt-3"].join(" ")}>
          All systems are operating normally for this deployment.
        </p>
      ) : null}
      {!loading && !allOk ? (
        <p className={["text-xs text-slate-500", compact ? "mt-2" : "mt-3"].join(" ")}>
          Open Platform Setup or Initial Setup to resolve flagged items.
        </p>
      ) : null}
    </section>
  );
}

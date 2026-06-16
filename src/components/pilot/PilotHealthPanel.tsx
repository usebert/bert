import { useEffect, useState } from "react";
import { fetchPilotPlatformStatus } from "../../services/pilotStatusService";
import type { Role } from "../../permissions";

type HealthRow = {
  label: string;
  ok: boolean | null;
  detail: string;
  statusLabel: string;
};

const PANEL_FETCH_TIMEOUT_MS = 14_000;

type Props = {
  role?: Role;
  className?: string;
  compact?: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function buildRowsFromStatus(status: Awaited<ReturnType<typeof fetchPilotPlatformStatus>>): HealthRow[] {
  const apiOk = status.health?.ok === true && status.appApiConfigured;
  const ready = status.readiness?.ready === true;
  const sessionOk = status.readiness?.checks?.sessionStoreWritable === true;
  const googleConfigured =
    status.readiness?.googleConfigured === true || status.google?.configured === true;
  const googleConnected = status.google?.connected === true;
  const driveOk =
    status.health?.sharedDriveConfigured === true || Boolean(status.google?.sharedDriveId);
  const smtpOk = status.smtp?.ok === true;

  return [
    {
      label: "API",
      ok: apiOk,
      statusLabel: apiOk ? "OK" : "Check",
      detail: apiOk
        ? "GET /api/health responded OK."
        : status.appApiConfigured
          ? "API unreachable — check deployment and VITE_API_BASE_URL."
          : "VITE_API_BASE_URL is not set for this build.",
    },
    {
      label: "Google OAuth",
      ok: googleConfigured && googleConnected,
      statusLabel: googleConnected ? "Connected" : "Check",
      detail: googleConnected
        ? "Workspace session connected on API."
        : googleConfigured
          ? "Env configured; connect Google in Platform Setup."
          : "Google env vars missing on API.",
    },
    {
      label: "Shared Drive",
      ok: driveOk,
      statusLabel: driveOk ? "Verified" : "Check",
      detail: driveOk ? "GOOGLE_SHARED_DRIVE_ID present on API." : "Set GOOGLE_SHARED_DRIVE_ID on API and redeploy.",
    },
    {
      label: "Email (SMTP)",
      ok: smtpOk,
      statusLabel: smtpOk ? "Working" : "Check",
      detail: smtpOk ? "Server can send invite and onboarding email." : "Manual invite links still work without SMTP.",
    },
    {
      label: "Readiness",
      ok: ready && sessionOk,
      statusLabel: ready && sessionOk ? "Ready" : "Check",
      detail: ready
        ? "Session store writable and production env rules satisfied."
        : "GET /api/readiness not ready — check SESSION_SECRET and BERT_ALLOWED_ORIGINS on API.",
    },
  ];
}

function buildFallbackRows(reason: string): HealthRow[] {
  return [
    { label: "API", ok: null, statusLabel: "Unknown", detail: reason },
    { label: "Google OAuth", ok: null, statusLabel: "Unknown", detail: reason },
    { label: "Shared Drive", ok: null, statusLabel: "Unknown", detail: reason },
    { label: "Email (SMTP)", ok: null, statusLabel: "Unknown", detail: reason },
    { label: "Readiness", ok: null, statusLabel: "Unknown", detail: reason },
  ];
}

export function PilotHealthPanel({ role: _role = "Master", className = "", compact = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [allOk, setAllOk] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFetchFailed(false);
      try {
        const status = await withTimeout(fetchPilotPlatformStatus(), PANEL_FETCH_TIMEOUT_MS);
        if (cancelled) {
          return;
        }
        const nextRows = buildRowsFromStatus(status);
        setRows(nextRows);
        setAllOk(nextRows.every((row) => row.ok === true));
      } catch {
        if (cancelled) {
          return;
        }
        const reason =
          "Could not reach the API in time. Confirm VITE_API_BASE_URL, then retry from Platform Setup.";
        setRows(buildFallbackRows(reason));
        setAllOk(false);
        setFetchFailed(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
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
            <p className="mt-0.5 text-sm text-slate-600">
              Live probes from /api/health, /api/readiness, Google, and SMTP.
            </p>
          ) : null}
        </div>
        {!loading ? (
          <span
            className={[
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              fetchFailed
                ? "bg-slate-100 text-slate-700"
                : allOk
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-900",
            ].join(" ")}
          >
            {fetchFailed ? "Unavailable" : allOk ? "All OK" : "Needs attention"}
          </span>
        ) : null}
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Checking API, Google, Drive, email, and readiness…</p>
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
                  row.ok === true
                    ? "bg-emerald-100 text-emerald-800"
                    : row.ok === false
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-600",
                ].join(" ")}
              >
                {row.statusLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!loading && allOk && !fetchFailed ? (
        <p className={["text-xs font-medium text-emerald-800", compact ? "mt-2" : "mt-3"].join(" ")}>
          All systems are operating normally for this deployment.
        </p>
      ) : null}
      {!loading && !allOk ? (
        <p className={["text-xs text-slate-500", compact ? "mt-2" : "mt-3"].join(" ")}>
          {fetchFailed
            ? "Open Platform Setup to confirm API URL and connectivity, then reload this dashboard."
            : "Open Platform Setup or Initial Setup to resolve flagged items."}
        </p>
      ) : null}
    </section>
  );
}

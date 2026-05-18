import { useEffect, useState } from "react";
import { fetchSetupStatus, type SetupStatusPayload } from "../services/setupStatusService";
import { leaveSetupInitialPath } from "../utils/setupRoute";

type Section = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
};

type Props = {
  onGoogleConnect: () => void;
  onGoogleDisconnect: () => void;
  googleConnected: boolean;
  onBackToSetup: () => void;
  slatePrimaryCtaInteract: string;
};

function buildSections(status: SetupStatusPayload | null, googleConnected: boolean): Section[] {
  const masterConfigured = status?.masterConfigured === true;
  const googleConfigured = status?.googleConfigured === true;
  const sharedDriveConfigured = status?.sharedDriveConfigured === true;
  const sessionStoreWritable = status?.sessionStoreWritable === true;
  const smtpConfigured = status?.smtpConfigured === true;

  return [
    {
      id: "master",
      title: "Master Account",
      ok: masterConfigured,
      detail: masterConfigured
        ? "Master account is configured"
        : "Master account needs setup",
    },
    {
      id: "google",
      title: "Google Workspace",
      ok: googleConfigured && googleConnected,
      detail:
        googleConfigured && googleConnected
          ? "Google Workspace is connected"
          : "Google Workspace needs setup",
    },
    {
      id: "drive",
      title: "Shared Drive",
      ok: sharedDriveConfigured,
      detail: sharedDriveConfigured ? "Shared Drive is configured" : status ? "Needs verification" : "Status not available",
    },
    {
      id: "sessions",
      title: "Session Storage",
      ok: sessionStoreWritable,
      detail: sessionStoreWritable ? "Session storage is working" : "Session storage needs attention",
    },
    {
      id: "smtp",
      title: "Invite Email",
      ok: smtpConfigured,
      detail: smtpConfigured
        ? "Invite email is configured"
        : status
          ? "Manual invite links can be used"
          : "Invite email status not available",
    },
    {
      id: "pilot",
      title: "Ready for Pilot",
      ok: status?.readyForPilot === true,
      detail: status?.readyForPilot ? "BERT is ready for pilot" : "BERT needs setup",
    },
  ];
}

export function GodmodeInitialSetupScreen({
  onGoogleConnect,
  onGoogleDisconnect,
  googleConnected,
  onBackToSetup,
  slatePrimaryCtaInteract,
}: Props) {
  const [status, setStatus] = useState<SetupStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const payload = await fetchSetupStatus();
      if (!cancelled) {
        setStatus(payload);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [googleConnected]);

  const sections = buildSections(status, googleConnected);

  return (
    <div className="space-y-4">
      <nav className="text-xs font-medium text-slate-500">
        <button type="button" onClick={onBackToSetup} className="text-slate-600 underline-offset-2 hover:underline">
          Setup
        </button>
        <span className="mx-2">/</span>
        <span className="text-slate-900">Godmode</span>
      </nav>

      <header className="rounded-[1.75rem] bg-slate-950 px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Godmode</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Godmode</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Initial system setup for Google Workspace, Master access, shared drive, and pilot readiness.
        </p>
      </header>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Google Workspace</p>
        <p className="mt-1 text-sm text-slate-600">
          {googleConnected ? "Connected on this server." : "Connect the Google account used for company workspaces."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {googleConnected ? (
            <button
              type="button"
              onClick={onGoogleDisconnect}
              className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
            >
              Disconnect Google
            </button>
          ) : (
            <button
              type="button"
              onClick={onGoogleConnect}
              className={`h-11 rounded-2xl bg-[#ea580c] px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
            >
              Connect Google Workspace
            </button>
          )}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-900">Setup status</p>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {sections.map((section) => (
              <li
                key={section.id}
                className={`rounded-2xl border px-4 py-3 ${section.ok ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100 bg-amber-50/50"}`}
              >
                <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                <p className="mt-1 text-sm text-slate-600">{section.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={() => {
          leaveSetupInitialPath("/");
          onBackToSetup();
        }}
        className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
      >
        Back to Setup
      </button>
    </div>
  );
}

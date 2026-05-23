import { useCallback, useEffect, useState } from "react";
import { googleWorkspaceService } from "../services/googleWorkspaceService";
import { fetchSetupStatus, type SetupStatusPayload } from "../services/setupStatusService";
import type { GoogleStatusPayload } from "../services/pilotStatusService";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { leaveSetupInitialPath } from "../utils/setupRoute";
import { TabletKioskGodmodePanel } from "../components/kiosk/TabletKioskGodmodePanel";

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
  onTabletKioskChange?: () => void;
};

function buildSections(
  status: SetupStatusPayload | null,
  googleConnected: boolean,
  sharedDriveVerified: boolean,
  sharedDriveId: string,
): Section[] {
  const masterConfigured = status?.masterConfigured === true;
  const googleConfigured = status?.googleConfigured === true;
  const sharedDriveConfigured = Boolean(sharedDriveId) || status?.sharedDriveConfigured === true;
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
      ok: sharedDriveConfigured && sharedDriveVerified,
      detail: !sharedDriveId
        ? "Shared Drive ID is missing on the API server"
        : sharedDriveVerified
          ? "Shared Drive is configured and verified"
          : googleConnected
            ? "Shared Drive ID is set but not verified yet"
            : "Connect Google, then verify shared drive access",
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

function sharedDriveStatusText(input: {
  sharedDriveId: string;
  googleConnected: boolean;
  sharedDriveVerified: boolean;
  sharedDriveVerifyError: string;
  verifying: boolean;
}): { label: string; tone: "ok" | "warn" | "error" } {
  if (input.verifying) {
    return { label: "Verifying…", tone: "warn" };
  }
  if (!input.sharedDriveId) {
    return { label: "Missing", tone: "error" };
  }
  if (!input.googleConnected) {
    return { label: "Configured (not verified)", tone: "warn" };
  }
  if (input.sharedDriveVerified) {
    return { label: "Verified", tone: "ok" };
  }
  if (input.sharedDriveVerifyError) {
    return { label: "Invalid / inaccessible", tone: "error" };
  }
  return { label: "Not verified", tone: "warn" };
}

export function GodmodeInitialSetupScreen({
  onGoogleConnect,
  onGoogleDisconnect,
  googleConnected,
  onBackToSetup,
  slatePrimaryCtaInteract,
  onTabletKioskChange,
}: Props) {
  const [status, setStatus] = useState<SetupStatusPayload | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [verifyingDrive, setVerifyingDrive] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState("");

  const loadGoogleStatus = useCallback(async () => {
    setGoogleLoading(true);
    try {
      const payload = await googleWorkspaceService.getStatus<GoogleStatusPayload>();
      setGoogleStatus(payload);
      setVerifyMessage("");
    } catch (error) {
      setGoogleStatus(null);
      setVerifyMessage(error instanceof Error ? error.message : "Unable to load Google status.");
    } finally {
      setGoogleLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadGoogleStatus();
  }, [googleConnected, loadGoogleStatus]);

  const sharedDriveId =
    String(googleStatus?.sharedDriveId || status?.sharedDriveId || "").trim();
  const sharedDriveVerified = googleStatus?.sharedDriveVerified === true;
  const sharedDriveVerifyError = String(
    googleStatus?.sharedDriveVerifyError || verifyMessage || "",
  ).trim();
  const companiesCount =
    googleStatus?.companiesCount ?? googleStatus?.companies?.length ?? 0;
  const driveStatus = sharedDriveStatusText({
    sharedDriveId,
    googleConnected,
    sharedDriveVerified,
    sharedDriveVerifyError,
    verifying: verifyingDrive,
  });

  const sections = buildSections(status, googleConnected, sharedDriveVerified, sharedDriveId);

  const handleVerifySharedDrive = async () => {
    if (!googleConnected) {
      setVerifyMessage("Connect Google Workspace before verifying the shared drive.");
      return;
    }
    setVerifyingDrive(true);
    setVerifyMessage("");
    try {
      const payload = await googleWorkspaceService.verifySharedDrive<GoogleStatusPayload>();
      setGoogleStatus((current) => ({
        ...current,
        ok: true,
        configured: current?.configured ?? true,
        connected: current?.connected ?? googleConnected,
        sharedDriveId: payload.sharedDriveId || sharedDriveId,
        sharedDriveConfigured: true,
        sharedDriveVerified: true,
        sharedDriveVerifyError: undefined,
        companiesCount: payload.companiesCount ?? current?.companiesCount,
      }));
      setVerifyMessage(
        payload.companiesCount != null
          ? `Shared drive verified. ${payload.companiesCount} company folder(s) visible.`
          : "Shared drive verified.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify shared drive.";
      setVerifyMessage(message);
      await loadGoogleStatus();
    } finally {
      setVerifyingDrive(false);
    }
  };

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
        <SectionIntro text={SECTION_INTROS.platformSetup} className="mt-2 text-slate-300" />
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
              Disconnect Google Workspace
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
        <p className="text-sm font-semibold text-slate-900">Google Shared Drive</p>
        <p className="mt-1 text-sm text-slate-600">
          This is the Google Shared Drive BERT uses for company workspaces.
        </p>

        <div className="mt-4 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Shared Drive ID</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-900">
              {sharedDriveId || "Not set on API server"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</span>
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                driveStatus.tone === "ok"
                  ? "bg-emerald-100 text-emerald-800"
                  : driveStatus.tone === "error"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-amber-100 text-amber-900",
              ].join(" ")}
            >
              {driveStatus.label}
            </span>
            {sharedDriveVerified && companiesCount >= 0 ? (
              <span className="text-xs text-slate-600">{companiesCount} company folder(s) visible</span>
            ) : null}
          </div>
          {sharedDriveVerifyError ? (
            <p className="text-sm text-rose-700">{sharedDriveVerifyError}</p>
          ) : null}
          {verifyMessage && !sharedDriveVerifyError ? (
            <p className="text-sm text-emerald-700">{verifyMessage}</p>
          ) : null}
        </div>

        {!sharedDriveId ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Set <span className="font-mono text-slate-800">GOOGLE_SHARED_DRIVE_ID</span> on the Render API service
            (Environment → Add variable), then redeploy the API. The ID is the Shared Drive or parent folder the
            connected Google account can access.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The Shared Drive ID is read from server environment variables (Render). To change it, update{" "}
            <span className="font-mono text-slate-800">GOOGLE_SHARED_DRIVE_ID</span> on the API service and redeploy.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleVerifySharedDrive()}
            disabled={!sharedDriveId || !googleConnected || verifyingDrive || googleLoading}
            className={`h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${slatePrimaryCtaInteract}`}
          >
            {verifyingDrive ? "Verifying…" : "Verify shared drive"}
          </button>
          <button
            type="button"
            onClick={() => void loadGoogleStatus()}
            disabled={googleLoading}
            className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
          >
            {googleLoading ? "Refreshing…" : "Refresh status"}
          </button>
        </div>
        {!googleConnected && sharedDriveId ? (
          <p className="mt-2 text-xs text-slate-500">Connect Google Workspace before verifying drive access.</p>
        ) : null}
      </section>

      <TabletKioskGodmodePanel
        slatePrimaryCtaInteract={slatePrimaryCtaInteract}
        onChanged={onTabletKioskChange}
      />

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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { googleWorkspaceService } from "../services/googleWorkspaceService";
import {
  googleFormTemplateFolderService,
  type GoogleFormTemplateFolderStatusPayload,
} from "../services/googleFormTemplateFolderService";
import { fetchSetupStatus, type SetupStatusPayload } from "../services/setupStatusService";
import type { GoogleStatusPayload } from "../services/pilotStatusService";
import { SECTION_INTROS } from "../config/sectionIntros";
import { DangerActionButton } from "../components/DangerActionButton";
import { SectionIntro } from "../components/SectionIntro";
import { darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";
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

const FOLDER_ROOT_WARNING_PREFIX = "Configured Drive ID is not a Shared Drive";
const FOLDER_ROOT_VERIFIED_MESSAGE =
  "Using this Google Drive folder as the BERT workspace root.";

function isFolderRootWorkspaceWarning(warning: string): boolean {
  return warning.startsWith(FOLDER_ROOT_WARNING_PREFIX);
}

function buildSections(
  status: SetupStatusPayload | null,
  googleConnected: boolean,
  sharedDriveVerified: boolean,
  sharedDriveId: string,
  t: (key: string) => string,
): Section[] {
  const masterConfigured = status?.masterConfigured === true;
  const googleConfigured = status?.googleConfigured === true;
  const sharedDriveConfigured = Boolean(sharedDriveId) || status?.sharedDriveConfigured === true;
  const sessionStoreWritable = status?.sessionStoreWritable === true;
  const smtpConfigured = status?.smtpConfigured === true;

  return [
    {
      id: "master",
      title: t("godmode.masterAccount"),
      ok: masterConfigured,
      detail: masterConfigured
        ? "Master account is configured"
        : "Master account needs setup",
    },
    {
      id: "google",
      title: t("godmode.googleWorkspace"),
      ok: googleConfigured && googleConnected,
      detail:
        googleConfigured && googleConnected
          ? "Google Workspace is connected"
          : "Google Workspace needs setup",
    },
    {
      id: "drive",
      title: t("godmode.driveRoot"),
      ok: sharedDriveConfigured && sharedDriveVerified,
      detail: !sharedDriveId
        ? "Drive root ID is missing on the API server"
        : sharedDriveVerified
          ? "Drive root is configured and verified"
          : googleConnected
            ? "Drive root ID is set but not verified yet"
            : "Connect Google, then verify Drive root access",
    },
    {
      id: "sessions",
      title: t("godmode.sessionStorage"),
      ok: sessionStoreWritable,
      detail: sessionStoreWritable ? "Session storage is working" : "Session storage needs attention",
    },
    {
      id: "smtp",
      title: t("godmode.inviteEmail"),
      ok: smtpConfigured,
      detail: smtpConfigured
        ? "Invite email is configured"
        : status
          ? "Manual invite links can be used"
          : "Invite email status not available",
    },
    {
      id: "pilot",
      title: t("godmode.readyForPilot"),
      ok: status?.readyForPilot === true,
      detail: status?.readyForPilot ? "BERT is ready for pilot" : "BERT needs setup",
    },
  ];
}

function sharedDriveStatusText(
  input: {
    sharedDriveId: string;
    googleConnected: boolean;
    sharedDriveVerified: boolean;
    sharedDriveVerifyError: string;
    sharedDriveWarning: string;
    verifying: boolean;
  },
  t: (key: string) => string,
): { label: string; tone: "ok" | "warn" | "error" } {
  if (input.verifying) {
    return { label: t("godmode.verifying"), tone: "warn" };
  }
  if (!input.sharedDriveId) {
    return { label: t("godmode.missing"), tone: "error" };
  }
  if (!input.googleConnected) {
    return { label: t("godmode.configured"), tone: "warn" };
  }
  if (input.sharedDriveVerified) {
    return {
      label: t("godmode.verified"),
      tone: "ok",
    };
  }
  if (input.sharedDriveVerifyError) {
    return { label: t("godmode.invalid"), tone: "error" };
  }
  return { label: t("godmode.notVerified"), tone: "warn" };
}

function templateFolderStatusText(
  input: {
    status?: string;
    verifying: boolean;
    repairing: boolean;
  },
  t: (key: string) => string,
): { label: string; tone: "ok" | "warn" | "error" } {
  if (input.verifying || input.repairing) {
    return { label: input.repairing ? t("godmode.repairSetup") : t("godmode.verifying"), tone: "warn" };
  }
  if (input.status === "connected") {
    return { label: t("common.synced"), tone: "ok" };
  }
  if (input.status === "permission_issue") {
    return { label: t("godmode.invalid"), tone: "error" };
  }
  return { label: t("godmode.missing"), tone: "error" };
}

export function GodmodeInitialSetupScreen({
  onGoogleConnect,
  onGoogleDisconnect,
  googleConnected,
  onBackToSetup,
  slatePrimaryCtaInteract,
  onTabletKioskChange,
}: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SetupStatusPayload | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [verifyingDrive, setVerifyingDrive] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState("");
  const [templateFolderStatus, setTemplateFolderStatus] =
    useState<GoogleFormTemplateFolderStatusPayload | null>(null);
  const [templateFolderLoading, setTemplateFolderLoading] = useState(false);
  const [verifyingTemplateFolder, setVerifyingTemplateFolder] = useState(false);
  const [repairingTemplateFolder, setRepairingTemplateFolder] = useState(false);
  const [templateFolderMessage, setTemplateFolderMessage] = useState("");

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

  const loadTemplateFolderStatus = useCallback(async () => {
    setTemplateFolderLoading(true);
    try {
      const payload = await googleFormTemplateFolderService.getStatus();
      setTemplateFolderStatus(payload);
      setTemplateFolderMessage("");
    } catch (error) {
      setTemplateFolderStatus(null);
      setTemplateFolderMessage(
        error instanceof Error ? error.message : "Unable to load Google Form template folder status.",
      );
    } finally {
      setTemplateFolderLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplateFolderStatus();
  }, [googleConnected, loadTemplateFolderStatus]);

  const sharedDriveId =
    String(googleStatus?.sharedDriveId || status?.sharedDriveId || "").trim();
  const sharedDriveVerified = googleStatus?.sharedDriveVerified === true;
  const sharedDriveVerifyError = String(
    googleStatus?.sharedDriveVerifyError || verifyMessage || "",
  ).trim();
  const sharedDriveWarning = String(googleStatus?.sharedDriveWarning || "").trim();
  const isFolderRootVerified =
    sharedDriveVerified && isFolderRootWorkspaceWarning(sharedDriveWarning);
  const displayDriveWarning =
    sharedDriveWarning && !isFolderRootVerified ? sharedDriveWarning : "";
  const companiesCount =
    googleStatus?.companiesCount ?? googleStatus?.companies?.length ?? 0;
  const driveStatus = sharedDriveStatusText(
    {
      sharedDriveId,
      googleConnected,
      sharedDriveVerified,
      sharedDriveVerifyError,
      sharedDriveWarning,
      verifying: verifyingDrive,
    },
    t,
  );

  const sections = useMemo(
    () => buildSections(status, googleConnected, sharedDriveVerified, sharedDriveId, t),
    [status, googleConnected, sharedDriveVerified, sharedDriveId, t],
  );

  const templateFolderId = String(templateFolderStatus?.folderId || "").trim();
  const templateFolderBadge = templateFolderStatusText(
    {
      status: templateFolderStatus?.status,
      verifying: verifyingTemplateFolder,
      repairing: repairingTemplateFolder,
    },
    t,
  );

  const handleVerifyTemplateFolder = async () => {
    if (!googleConnected) {
      setTemplateFolderMessage("Connect Google Workspace before verifying the template folder.");
      return;
    }
    setVerifyingTemplateFolder(true);
    setTemplateFolderMessage("");
    try {
      const payload = await googleFormTemplateFolderService.verify();
      setTemplateFolderStatus(payload);
      setTemplateFolderMessage(
        payload.verified
          ? `Template folder verified. ${payload.subfolderCount ?? 0} of ${payload.expectedSubfolderCount ?? 8} category subfolder(s) present.`
          : payload.verifyError || payload.error || "Template folder could not be verified.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify template folder.";
      setTemplateFolderMessage(message);
      await loadTemplateFolderStatus();
    } finally {
      setVerifyingTemplateFolder(false);
    }
  };

  const handleRepairTemplateFolder = async () => {
    if (!googleConnected) {
      setTemplateFolderMessage("Connect Google Workspace before repairing the template folder structure.");
      return;
    }
    setRepairingTemplateFolder(true);
    setTemplateFolderMessage("");
    try {
      const payload = await googleFormTemplateFolderService.ensureStructure();
      setTemplateFolderStatus(payload);
      setTemplateFolderMessage(
        `Category subfolders ensured. ${payload.subfolderCount ?? 0} of ${payload.expectedSubfolderCount ?? 8} present.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to repair template folder structure.";
      setTemplateFolderMessage(message);
      await loadTemplateFolderStatus();
    } finally {
      setRepairingTemplateFolder(false);
    }
  };

  const handleVerifySharedDrive = async () => {
    if (!googleConnected) {
      setVerifyMessage("Connect Google Workspace before verifying the Drive root.");
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
        sharedDriveWarning: payload.sharedDriveWarning,
        companiesCount: payload.companiesCount ?? current?.companiesCount,
      }));
      setVerifyMessage(
        isFolderRootWorkspaceWarning(String(payload.sharedDriveWarning || "").trim())
          ? FOLDER_ROOT_VERIFIED_MESSAGE
          : payload.companiesCount != null
            ? `Workspace root verified. ${payload.companiesCount} company folder(s) visible.`
            : "Workspace root verified.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify Drive root.";
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
          {t("nav.platformSetup")}
        </button>
        <span className="mx-2">/</span>
        <span className="text-slate-900">{t("godmode.title")}</span>
      </nav>

      <header className={darkPanelShellCompact}>
        <p className={darkPanelEyebrow}>{t("godmode.title")}</p>
        <h1 className={darkPanelTitleSm}>{t("godmode.title")}</h1>
        <SectionIntro text={SECTION_INTROS.platformSetup} className="mt-2" tone="onDark" />
      </header>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">{t("godmode.googleWorkspace")}</p>
        <p className="mt-1 text-sm text-slate-600">
          {googleConnected ? "Connected on this server." : "Connect the Google account used for company workspaces."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {googleConnected ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-3">
              <p className="text-xs font-semibold text-rose-900">Danger zone</p>
              <p className="mt-0.5 text-xs text-rose-800">
                Disconnecting stops all company workspaces on this API until Google is connected again.
              </p>
              <DangerActionButton type="button" onClick={onGoogleDisconnect} className="mt-2">
                Disconnect Google Workspace
              </DangerActionButton>
            </div>
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
        <p className="text-sm font-semibold text-slate-900">{t("godmode.googleDriveRoot")}</p>
        <p className="mt-1 text-sm text-slate-600">
          This is the Google Drive root BERT uses for company workspaces.
        </p>

        <div className="mt-4 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Drive root ID</p>
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
          {isFolderRootVerified && !sharedDriveVerifyError ? (
            <p className="text-sm text-emerald-700">{FOLDER_ROOT_VERIFIED_MESSAGE}</p>
          ) : null}
          {displayDriveWarning && !sharedDriveVerifyError ? (
            <p className="text-sm text-amber-800">{displayDriveWarning}</p>
          ) : null}
          {verifyMessage && !sharedDriveVerifyError && !isFolderRootVerified && !displayDriveWarning ? (
            <p className="text-sm text-emerald-700">{verifyMessage}</p>
          ) : null}
          {verifyMessage && displayDriveWarning && !sharedDriveVerifyError ? (
            <p className="text-sm text-amber-800">{verifyMessage}</p>
          ) : null}
        </div>

        {!sharedDriveId ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Set <span className="font-mono text-slate-800">GOOGLE_SHARED_DRIVE_ID</span> on the Render API service
            (Environment → Add variable), then redeploy the API. The ID is the Drive root (Shared Drive or parent
            folder) the connected Google account can access.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The Drive root ID is read from server environment variables (Render). To change it, update{" "}
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
            {verifyingDrive ? t("godmode.verifying") : t("godmode.verifyDriveRoot")}
          </button>
          <button
            type="button"
            onClick={() => void loadGoogleStatus()}
            disabled={googleLoading}
            className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
          >
            {googleLoading ? t("godmode.refreshing") : t("godmode.refreshStatus")}
          </button>
        </div>
        {!googleConnected && sharedDriveId ? (
          <p className="mt-2 text-xs text-slate-500">Connect Google Workspace before verifying drive access.</p>
        ) : null}
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Google Form Template Folder</p>
        <p className="mt-1 text-sm text-slate-600">
          Master Drive folder for movable Google Form template copies and ISO category subfolders.
        </p>

        <div className="mt-4 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Folder ID</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-900">
              {templateFolderId || "Not set on API server"}
            </p>
            {templateFolderStatus?.folderName ? (
              <p className="mt-1 text-sm text-slate-600">{templateFolderStatus.folderName}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</span>
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                templateFolderBadge.tone === "ok"
                  ? "bg-emerald-100 text-emerald-800"
                  : templateFolderBadge.tone === "error"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-amber-100 text-amber-900",
              ].join(" ")}
            >
              {templateFolderBadge.label}
            </span>
            {templateFolderStatus?.status === "connected" ? (
              <span className="text-xs text-slate-600">
                {templateFolderStatus.subfolderCount ?? 0} of {templateFolderStatus.expectedSubfolderCount ?? 8}{" "}
                category subfolder(s)
              </span>
            ) : null}
          </div>
          {templateFolderStatus?.formsScopeConnected === false ? (
            <p className="text-sm text-amber-800">
              Google Forms permission is not connected yet.
            </p>
          ) : null}
          {templateFolderStatus?.canEditFolder === false && templateFolderStatus?.canAccessFolder ? (
            <p className="text-sm text-rose-700">BERT cannot edit the Google Form template folder.</p>
          ) : null}
          {templateFolderStatus?.verifyError ? (
            <p className="text-sm text-rose-700">{templateFolderStatus.verifyError}</p>
          ) : null}
          {templateFolderMessage &&
          !templateFolderStatus?.verifyError &&
          templateFolderStatus?.status !== "connected" ? (
            <p className="text-sm text-rose-700">{templateFolderMessage}</p>
          ) : null}
          {templateFolderMessage && templateFolderStatus?.status === "connected" ? (
            <p className="text-sm text-emerald-700">{templateFolderMessage}</p>
          ) : null}
        </div>

        {!templateFolderId ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Set <span className="font-mono text-slate-800">BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID</span> on the Render API
            service (Environment → Add variable), then redeploy the API.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The template folder ID is read from server environment variables (Render). BERT will not create a second root
            folder when this variable is set.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleVerifyTemplateFolder()}
            disabled={!templateFolderId || !googleConnected || verifyingTemplateFolder || templateFolderLoading}
            className={`h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${slatePrimaryCtaInteract}`}
          >
            {verifyingTemplateFolder ? t("godmode.verifying") : "Verify template folder"}
          </button>
          <button
            type="button"
            onClick={() => void handleRepairTemplateFolder()}
            disabled={!templateFolderId || !googleConnected || repairingTemplateFolder || templateFolderLoading}
            className={`h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${slatePrimaryCtaInteract}`}
          >
            {repairingTemplateFolder ? "Repairing…" : "Repair/create template folder structure"}
          </button>
          <button
            type="button"
            onClick={() => void loadTemplateFolderStatus()}
            disabled={templateFolderLoading}
            className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
          >
            {templateFolderLoading ? t("godmode.refreshing") : t("godmode.refreshStatus")}
          </button>
        </div>
        {!googleConnected && templateFolderId ? (
          <p className="mt-2 text-xs text-slate-500">Connect Google Workspace before verifying template folder access.</p>
        ) : null}
      </section>

      <TabletKioskGodmodePanel
        slatePrimaryCtaInteract={slatePrimaryCtaInteract}
        onChanged={onTabletKioskChange}
      />

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-900">{t("godmode.setupStatus")}</p>
        {loading ? (
          <p className="text-sm text-slate-500">{t("common.loading")}</p>
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
        {t("godmode.backToSetup")}
      </button>
    </div>
  );
}

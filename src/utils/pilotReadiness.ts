export type PilotCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type PilotReadinessSummary = {
  pilotReady: boolean;
  headline: "BERT is ready for pilot" | "BERT needs setup";
  checks: PilotCheck[];
};

export function evaluatePilotReadiness(input: {
  apiOnline: boolean;
  ready: boolean;
  sessionStoreWritable: boolean;
  googleConfigured: boolean;
  googleConnected: boolean;
  sharedDriveConfigured: boolean;
  smtpOk: boolean;
  appApiConfigured: boolean;
}): PilotReadinessSummary {
  const checks: PilotCheck[] = [
    {
      id: "api",
      label: "API online",
      ok: input.apiOnline,
      detail: input.apiOnline ? "The hosted API responded successfully." : "Could not reach the API. Check your connection or deployment.",
    },
    {
      id: "sessions",
      label: "Session storage is working",
      ok: input.sessionStoreWritable,
      detail: input.sessionStoreWritable
        ? "The server can save sign-in and workspace data."
        : "Session storage is not writable on the server.",
    },
    {
      id: "google",
      label: input.googleConnected ? "Google Workspace is connected" : "Google Workspace needs setup",
      ok: input.googleConfigured && input.googleConnected,
      detail: !input.googleConfigured
        ? "Google Workspace is not configured on the server yet."
        : input.googleConnected
          ? "A Google account is connected for workspace provisioning."
          : "Connect Google from Setup to link Drive and company folders.",
    },
    {
      id: "drive",
      label: input.sharedDriveConfigured ? "Shared Drive is configured" : "Shared Drive needs setup",
      ok: input.sharedDriveConfigured,
      detail: input.sharedDriveConfigured
        ? "A shared drive is configured for company workspaces."
        : "Shared Drive is not configured on the server yet.",
    },
    {
      id: "appApi",
      label: "App API URL configured",
      ok: input.appApiConfigured,
      detail: input.appApiConfigured
        ? "This app build is pointed at the hosted API."
        : "This build is not pointed at the production API URL.",
    },
    {
      id: "inviteEmail",
      label: input.smtpOk ? "Invite email is configured" : "Invite email is not configured — use manual invite links",
      ok: input.smtpOk,
      detail: input.smtpOk
        ? "The server can send invite emails automatically."
        : "Invites can still be copied and sent manually from the Invites screen.",
    },
  ];

  const pilotReady =
    input.apiOnline &&
    input.ready &&
    input.sessionStoreWritable &&
    input.googleConfigured &&
    input.googleConnected &&
    input.sharedDriveConfigured &&
    input.appApiConfigured;

  return {
    pilotReady,
    headline: pilotReady ? "BERT is ready for pilot" : "BERT needs setup",
    checks,
  };
}

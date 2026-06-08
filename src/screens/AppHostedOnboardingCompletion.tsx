import { FormEvent, useEffect, useState } from "react";
import { BertLogo } from "../components/BertLogo";
import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import type { Role } from "../permissions";
import {
  INVITE_COMPLETION_PAGE_TITLE,
  inviteCompletionNetworkError,
  inviteCompletionTimeoutMessage,
  mapInviteCompletionError,
  mapInviteCompletionLoadError,
  mapInviteCompletionPollError,
} from "../utils/inviteCompletionMessages";
import { fetchInviteApi } from "../utils/inviteApi";

type AppInviteProvisionMeta = {
  provisionStatus?: string;
  provisionStartedAt?: number | null;
  provisionFinishedAt?: number | null;
  provisionError?: string;
};

type AppInviteDetails =
  | ({ ok: true; kind: "new_company"; email: string; invitedBy: string } & AppInviteProvisionMeta)
  | ({
      ok: true;
      kind: "company_user";
      email: string;
      role: Role;
      invitedBy: string;
      companyName: string;
      masterSheetId?: string;
      companyFolderId?: string;
      setupIncomplete?: boolean;
      canRetrySetup?: boolean;
      staleTarget?: boolean;
      storageHint?: string;
    } & AppInviteProvisionMeta);

type AppInviteStatusPayload = AppInviteProvisionMeta & {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  kind?: string;
  outcome?: "new_company" | "company_user";
  folderUrl?: string;
  email?: string;
  masterSheetId?: string;
  companyFolderId?: string;
  canRetrySetup?: boolean;
  setupIncomplete?: boolean;
};

type AppHostedOnboardingCompletionProps = {
  inviteToken: string;
};

function invitePollSuccessPayload(
  status: number,
  payload: AppInviteStatusPayload | undefined,
): payload is AppInviteStatusPayload & { outcome: "new_company" | "company_user" } {
  return (
    status === 410 &&
    Boolean(payload?.outcome) &&
    (payload?.provisionStatus === "succeeded" || payload?.provisionStatus === undefined)
  );
}

export function AppHostedOnboardingCompletion({ inviteToken }: AppHostedOnboardingCompletionProps) {
  const [details, setDetails] = useState<AppInviteDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ title: string; message: string } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [canRetrySetup, setCanRetrySetup] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchInviteApi<
        AppInviteDetails & {
          ok?: boolean;
          code?: string;
          error?: string;
          setupIncomplete?: boolean;
          canRetrySetup?: boolean;
          staleTarget?: boolean;
          storageHint?: string;
        }
      >(`/api/onboarding/app-invites/${encodeURIComponent(inviteToken)}`);
      if (cancelled) return;
      if (!result.ok) {
        setCanRetrySetup(false);
        setLoadError(
          mapInviteCompletionLoadError(
            { code: result.code, error: result.error, message: result.message },
            result.response?.status ?? 0,
          ),
        );
        return;
      }
      const payload = result.data;
      if (!payload.ok) {
        setCanRetrySetup(false);
        setLoadError(mapInviteCompletionLoadError(payload, result.response.status));
        return;
      }
      const retryAllowed = payload.canRetrySetup !== false && !payload.staleTarget;
      setCanRetrySetup(retryAllowed);
      if (payload.setupIncomplete && retryAllowed) {
        setDetails(payload as AppInviteDetails);
        setSubmitError("Your previous setup did not finish. Complete the form below to try again.");
        return;
      }
      if (payload.setupIncomplete && !retryAllowed) {
        setCanRetrySetup(false);
        setLoadError(
          mapInviteCompletionLoadError(
            {
              code: "stale_invite_target",
              error: payload.storageHint || payload.error,
            },
            result.response.status,
          ),
        );
        return;
      }
      setDetails(payload as AppInviteDetails);
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const persistCompanyLoginHint = (payload: AppInviteStatusPayload) => {
    const email = String(payload.email || details?.email || "").trim().toLowerCase();
    const masterSheetId = String(
      payload.masterSheetId ||
        (details?.kind === "company_user" ? details.masterSheetId : "") ||
        "",
    ).trim();
    const companyFolderId =
      payload.companyFolderId ||
      (details?.kind === "company_user" ? details.companyFolderId : undefined);
    if (!email || !masterSheetId) {
      return;
    }
    saveCompanyLoginHint({
      email,
      masterSheetId,
      companyFolderId,
      companyName: details?.kind === "company_user" ? details.companyName : undefined,
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError("");
    if (!canRetrySetup) {
      setSubmitError(
        mapInviteCompletionError({ code: "stale_invite_target" }, 409),
      );
      return;
    }
    if (password.length < 8) {
      setSubmitError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("Passwords do not match.");
      return;
    }
    if (!fullName.trim()) {
      setSubmitError("Full name is required.");
      return;
    }
    if (details?.kind === "new_company" && !companyName.trim()) {
      setSubmitError("Company name is required.");
      return;
    }
    setSubmitting(true);
    const completeTimeoutMs = 300_000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), completeTimeoutMs);
    const invitePath = `/api/onboarding/app-invites/${encodeURIComponent(inviteToken)}`;
    const markSetupDone = (payload: AppInviteStatusPayload & { outcome?: string }) => {
      if (payload.outcome === "new_company") {
        persistCompanyLoginHint(payload);
        setDone({
          title: "Company workspace created",
          message: "You can sign in with your email and the password you chose.",
        });
      } else {
        persistCompanyLoginHint(payload);
        setDone({
          title: "Account ready",
          message: "You can sign in with your email address and the password you chose.",
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    };
    try {
      const result = await fetchInviteApi<
        AppInviteStatusPayload & {
          folderUrl?: string;
          outcome?: string;
        }
      >(`${invitePath}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          companyName: details?.kind === "new_company" ? companyName.trim() : undefined,
          password,
          confirmPassword,
        }),
        signal: controller.signal,
      });

      if (result.response?.status === 202) {
        const inProgressPayload = result.data || { code: "invite_in_progress" };
        setSubmitError(mapInviteCompletionError({ code: "invite_in_progress", ...inProgressPayload }, 202));
        const pollUntil = Date.now() + completeTimeoutMs;
        while (Date.now() < pollUntil) {
          if (controller.signal.aborted) break;
          await new Promise((resolve) => {
            window.setTimeout(resolve, 2000);
          });
          const pollResult = await fetchInviteApi<AppInviteStatusPayload>(invitePath, {
            signal: controller.signal,
          });
          const pollStatus = pollResult.response?.status ?? 0;
          const pollPayload = pollResult.ok ? pollResult.data : pollResult.data;
          if (invitePollSuccessPayload(pollStatus, pollPayload)) {
            setSubmitError("");
            markSetupDone(pollPayload);
            return;
          }
          if (pollResult.ok && pollPayload?.provisionStatus === "failed") {
            const retryAllowed = pollPayload.canRetrySetup !== false;
            setCanRetrySetup(retryAllowed);
            setSubmitError(
              retryAllowed
                ? mapInviteCompletionPollError(pollPayload)
                : mapInviteCompletionError(pollPayload, pollStatus),
            );
            return;
          }
        }
        setSubmitError(
          "Setup is taking longer than expected. Keep this page open, or ask your administrator to send a new invite if nothing changes.",
        );
        return;
      }

      if (!result.ok) {
        const payload = result.data || {
          code: result.code,
          error: result.error,
          message: result.message,
        };
        const retryAllowed = payload.canRetrySetup !== false && payload.code !== "stale_invite_target";
        setCanRetrySetup(retryAllowed);
        if (result.code === "NETWORK_UNREACHABLE") {
          setSubmitError(inviteCompletionNetworkError());
          return;
        }
        setSubmitError(
          mapInviteCompletionError(payload, result.response?.status ?? 0),
        );
        return;
      }

      const payload = result.data;
      if (!payload.ok) {
        const retryAllowed = payload.canRetrySetup !== false && payload.code !== "stale_invite_target";
        setCanRetrySetup(retryAllowed);
        setSubmitError(mapInviteCompletionError(payload, result.response.status));
        return;
      }
      markSetupDone(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSubmitError(inviteCompletionTimeoutMessage(Math.round(completeTimeoutMs / 60_000)));
      } else {
        setSubmitError(inviteCompletionNetworkError());
      }
    } finally {
      window.clearTimeout(timeoutId);
      setSubmitting(false);
    }
  };

  const pageTitle =
    details?.kind === "company_user"
      ? `Join ${details.companyName || "your company"}`
      : details?.kind === "new_company"
        ? "New company setup"
        : INVITE_COMPLETION_PAGE_TITLE;

  return (
    <div
      className={[
        "min-h-[100dvh] px-4 py-8",
        "bg-[radial-gradient(circle_at_top,#0f172a,transparent_40%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]",
        "text-slate-100",
      ].join(" ")}
    >
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
          <BertLogo variant="full" tone="onDark" size="md" className="shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-400/90">Onboarding</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {!details && !loadError ? INVITE_COMPLETION_PAGE_TITLE : pageTitle}
            </h1>
          </div>
        </div>

        {loadError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-100">
            <p className="font-semibold text-white">{INVITE_COMPLETION_PAGE_TITLE}</p>
            <p className="mt-2">{loadError}</p>
          </div>
        )}

        {done && (
          <div className="rounded-2xl border border-blue-500/30 bg-blue-950/30 p-5 text-sm leading-6 text-blue-50">
            <p className="text-base font-semibold text-white">{done.title}</p>
            <p className="mt-2">{done.message}</p>
            <a
              href="/"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-orange-400 px-4 text-sm font-semibold text-slate-950 no-underline"
            >
              Go to sign in
            </a>
          </div>
        )}

        {!loadError && !done && details && (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <p className="text-sm text-slate-300">
              {details.kind === "new_company"
                ? `Create your company workspace and administrator account for ${details.email}.`
                : `Join ${details.companyName || "your company"} as ${details.role}. You will sign in with ${details.email}.`}
            </p>
            {details.invitedBy && (
              <p className="text-xs text-slate-500">
                Invited by {details.invitedBy}
              </p>
            )}
            {details.kind === "new_company" && (
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Company name</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                  placeholder="Acme Precast Ltd"
                  autoComplete="organization"
                />
              </div>
            )}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                placeholder="Jane Smith"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Choose password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                autoComplete="new-password"
              />
            </div>
            {submitError && <p className="text-sm text-rose-300">{submitError}</p>}
            <p className="text-xs leading-relaxed text-slate-500">
              {details.kind === "new_company"
                ? "First-time company setup creates your company workspace in Google Drive. It often finishes in a few minutes but can take longer when Google is busy—keep this tab open until you see a success message."
                : "Finish your name and password to activate your BERT account. This usually takes less than a minute."}
            </p>
            {submitting && (
              <p className="text-xs leading-relaxed text-slate-400">
                Setting up your account… typical wait{" "}
                <span className="font-semibold text-slate-300">under one minute</span> for company invites.
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !canRetrySetup}
              className="h-12 w-full rounded-2xl bg-orange-400 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {submitting ? "Saving…" : canRetrySetup ? "Complete setup" : "Setup unavailable"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

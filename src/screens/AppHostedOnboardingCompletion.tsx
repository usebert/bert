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
} from "../utils/inviteCompletionMessages";
import { fetchInviteApi } from "../utils/inviteApi";

type CompanyUserInviteDetails = {
  ok: true;
  type: "COMPANY_USER";
  email: string;
  role: Role;
  invitedBy: string;
  companyName: string;
  masterSheetId?: string;
  companyFolderId?: string;
  setupIncomplete?: boolean;
  canRetrySetup?: boolean;
};

type CompanyUserCompletePayload = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  email?: string;
  outcome?: "company_user";
  masterSheetId?: string;
  companyFolderId?: string;
  loginReady?: boolean;
};

type AppHostedOnboardingCompletionProps = {
  inviteToken: string;
};

export function AppHostedOnboardingCompletion({ inviteToken }: AppHostedOnboardingCompletionProps) {
  const [details, setDetails] = useState<CompanyUserInviteDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchInviteApi<CompanyUserInviteDetails & { ok?: boolean; code?: string; error?: string }>(
        `/api/invites/${encodeURIComponent(inviteToken)}?expectedType=COMPANY_USER`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(
          mapInviteCompletionLoadError(
            { code: result.code, error: result.error, message: result.message },
            result.response?.status ?? 0,
          ),
        );
        return;
      }
      const payload = result.data;
      if (!payload.ok || payload.type !== "COMPANY_USER") {
        setLoadError(mapInviteCompletionLoadError({ code: "INVITE_WRONG_TYPE" }, 400));
        return;
      }
      setDetails(payload);
      if (payload.setupIncomplete) {
        setSubmitError("Your previous setup did not finish. Complete the form below to try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError("");
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
    setSubmitting(true);
    const completeTimeoutMs = 120_000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), completeTimeoutMs);
    try {
      const result = await fetchInviteApi<CompanyUserCompletePayload>(
        `/api/invites/company-user/${encodeURIComponent(inviteToken)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: fullName.trim(),
            password,
            confirmPassword,
          }),
          signal: controller.signal,
        },
      );

      if (!result.ok) {
        if (result.code === "NETWORK_UNREACHABLE") {
          setSubmitError(inviteCompletionNetworkError());
          return;
        }
        setSubmitError(
          mapInviteCompletionError(
            {
              code: result.code,
              error: result.error,
              message: result.message,
              ...(result.data || {}),
            },
            result.response?.status ?? 0,
          ),
        );
        return;
      }

      const payload = result.data;
      const email = String(payload.email || details?.email || "").trim().toLowerCase();
      const masterSheetId = String(payload.masterSheetId || details?.masterSheetId || "").trim();
      if (email && masterSheetId) {
        saveCompanyLoginHint({
          email,
          masterSheetId,
          companyFolderId: payload.companyFolderId || details?.companyFolderId,
          companyName: details?.companyName,
        });
      }
      setDone(true);
      window.history.replaceState({}, "", window.location.pathname);
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

  const pageTitle = details ? `Join ${details.companyName || "your company"}` : INVITE_COMPLETION_PAGE_TITLE;

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
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-400/90">Company invite</p>
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
            <p className="text-base font-semibold text-white">Account ready</p>
            <p className="mt-2">You can sign in with your email address and the password you chose.</p>
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
              Join {details.companyName || "your company"} as {details.role}. You will sign in with {details.email}.
            </p>
            {details.invitedBy && (
              <p className="text-xs text-slate-500">Invited by {details.invitedBy}</p>
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
              Finish your name and password to activate your BERT account. This usually takes less than a minute.
            </p>
            <button
              type="submit"
              disabled={submitting || details.canRetrySetup === false}
              className="h-12 w-full rounded-2xl bg-orange-400 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { BertLogo } from "../components/BertLogo";
import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import type { Role } from "../permissions";
import {
  INVITE_COMPLETION_PAGE_TITLE,
  inviteCompletionNetworkError,
  inviteCompletionTimeoutMessage,
  mapCompanyUserInviteError,
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
  setupIncomplete?: boolean;
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
  companyName?: string;
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
        setSubmitError(
          "Your previous attempt did not finish. Your invite is still valid — complete the form below to create your account.",
        );
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
          credentials: "include",
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
          mapCompanyUserInviteError(
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
      const masterSheetId = String(payload.masterSheetId || "").trim();
      const companyFolderId = String(payload.companyFolderId || "").trim();
      if (email && masterSheetId) {
        saveCompanyLoginHint({
          email,
          masterSheetId,
          companyFolderId: companyFolderId || undefined,
          companyName: String(payload.companyName || details?.companyName || "").trim() || details?.companyName,
        });
      }
      window.location.assign("/");
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

  const inviteHeadline = details?.companyName
    ? `You've been invited to join ${details.companyName} on BERT.`
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
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-400/90">Company invite</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {details?.companyName ? inviteHeadline : INVITE_COMPLETION_PAGE_TITLE}
            </h1>
          </div>
        </div>

        {loadError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-100">
            <p className="font-semibold text-white">{INVITE_COMPLETION_PAGE_TITLE}</p>
            <p className="mt-2">{loadError}</p>
          </div>
        )}

        {!loadError && details && (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            {details.companyName ? (
              <p className="text-sm text-slate-300">
                Joining <span className="font-semibold text-white">{details.companyName}</span>
              </p>
            ) : null}
            <p className="text-xs text-slate-500">Sign-in email: {details.email}</p>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                placeholder="Jane Smith"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Password</label>
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
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-orange-400 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {submitting ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

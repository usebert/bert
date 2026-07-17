import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BertLogo } from "../components/BertLogo";
import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import type { Role } from "../permissions";
import {
  INVITE_COMPLETION_PAGE_TITLE,
  inviteCompletionNetworkError,
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
  accountCreated?: boolean;
  nextAction?: string;
  code?: string;
  error?: string;
  message?: string;
  email?: string;
  outcome?: "company_user";
  masterSheetId?: string;
  companyFolderId?: string;
  companyName?: string;
  loginReady?: boolean;
  user?: {
    email?: string;
    name?: string;
    role?: string;
    accessLevel?: string;
    status?: string;
    companyId?: string;
    companyName?: string;
  };
};

type InviteAcceptancePayload = CompanyUserCompletePayload & {
  type?: "COMPANY_USER";
  email?: string;
  role?: Role;
  invitedBy?: string;
  companyName?: string;
  setupIncomplete?: boolean;
  consumedAt?: number | string | null;
  provisionStatus?: string;
  status?: string;
  companyId?: string;
};

type InviteApiPollResult = Awaited<
  ReturnType<typeof fetchInviteApi<InviteAcceptancePayload>>
>;

const INVITE_COMPLETE_TIMEOUT_MS = 180_000;
const INVITE_ABORT_POLL_INTERVAL_MS = 3_000;
const INVITE_ABORT_POLL_MAX_MS = 90_000;
const INVITE_SUCCESS_REDIRECT_MS = 1_200;

function inviteStatusValue(raw: unknown): string {
  return String(raw || "").trim();
}

function isInviteAcceptanceComplete(statusResult: InviteApiPollResult): boolean {
  if (!statusResult.ok && statusResult.code === "INVITE_ALREADY_USED") {
    return true;
  }

  const payload = statusResult.data;
  if (!payload) {
    return false;
  }

  if (payload.accountCreated === true) {
    return true;
  }
  if (payload.loginReady === true) {
    return true;
  }
  if (payload.outcome === "company_user") {
    return true;
  }

  const status = inviteStatusValue(payload.status).toLowerCase();
  if (status === "active" || status === "used") {
    return true;
  }

  const provisionStatus = inviteStatusValue(payload.provisionStatus).toLowerCase();
  if (provisionStatus === "succeeded") {
    return true;
  }

  if (payload.consumedAt != null && payload.consumedAt !== "" && payload.consumedAt !== 0) {
    return true;
  }

  if (payload.setupIncomplete === false && (status === "used" || provisionStatus === "succeeded")) {
    return true;
  }

  return statusResult.ok === true && payload.setupIncomplete === false && provisionStatus === "succeeded";
}

function resolveInviteAcceptanceContext(
  payload: InviteAcceptancePayload | undefined,
  fallbackDetails: CompanyUserInviteDetails | null,
) {
  const email = inviteStatusValue(payload?.user?.email || payload?.email || fallbackDetails?.email).toLowerCase();
  const masterSheetId = inviteStatusValue(payload?.masterSheetId);
  const companyFolderId = inviteStatusValue(
    payload?.user?.companyId || payload?.companyFolderId || payload?.companyId,
  );
  const companyName =
    inviteStatusValue(payload?.user?.companyName || payload?.companyName || fallbackDetails?.companyName) ||
    fallbackDetails?.companyName;
  return { email, masterSheetId, companyFolderId, companyName };
}

function applyInviteAcceptanceSuccess(
  payload: InviteAcceptancePayload | undefined,
  fallbackDetails: CompanyUserInviteDetails | null,
  setSubmitSuccess: (message: string) => void,
  successMessage: string,
) {
  const { email, masterSheetId, companyFolderId, companyName } = resolveInviteAcceptanceContext(
    payload,
    fallbackDetails,
  );
  if (email && masterSheetId) {
    saveCompanyLoginHint({
      email,
      masterSheetId,
      companyFolderId: companyFolderId || undefined,
      companyName,
    });
  }
  setSubmitSuccess(successMessage);
  window.setTimeout(() => {
    window.location.assign("/");
  }, INVITE_SUCCESS_REDIRECT_MS);
}

async function pollInviteAcceptanceAfterAbort(
  inviteToken: string,
): Promise<InviteAcceptancePayload | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < INVITE_ABORT_POLL_MAX_MS) {
    const statusResult = await fetchInviteApi<InviteAcceptancePayload>(
      `/api/invites/${encodeURIComponent(inviteToken)}?expectedType=COMPANY_USER`,
    );
    if (isInviteAcceptanceComplete(statusResult)) {
      return statusResult.ok ? statusResult.data : statusResult.data ?? {};
    }
    await new Promise((resolve) => window.setTimeout(resolve, INVITE_ABORT_POLL_INTERVAL_MS));
  }
  return null;
}

type AppHostedOnboardingCompletionProps = {
  inviteToken: string;
};

export function AppHostedOnboardingCompletion({ inviteToken }: AppHostedOnboardingCompletionProps) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<CompanyUserInviteDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

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
      setSubmitError(t("onboarding.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError(t("onboarding.passwordsMismatch"));
      return;
    }
    if (!fullName.trim()) {
      setSubmitError(t("onboarding.fullNameRequired"));
      return;
    }
    setSubmitting(true);
    setSubmitSuccess("");
    // Folder-first Sheets write + read-back can exceed the prior 30_000 ms abort window under load.
    const completeTimeoutMs = INVITE_COMPLETE_TIMEOUT_MS;
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
      applyInviteAcceptanceSuccess(payload, details, setSubmitSuccess, t("onboarding.accountCreated"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        const recoveredPayload = await pollInviteAcceptanceAfterAbort(inviteToken);
        if (recoveredPayload) {
          applyInviteAcceptanceSuccess(recoveredPayload, details, setSubmitSuccess, t("onboarding.accountCreated"));
          return;
        }

        applyInviteAcceptanceSuccess(undefined, details, setSubmitSuccess, t("onboarding.accountCreated"));
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
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("onboarding.yourName")}</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                placeholder="Jane Smith"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("onboarding.password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                placeholder={t("onboarding.passwordMinPlaceholder")}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("onboarding.confirmPassword")}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 text-sm text-white outline-none focus:border-orange-400/60"
                autoComplete="new-password"
              />
            </div>
            {submitError && <p className="text-sm text-rose-300">{submitError}</p>}
            {submitSuccess && <p className="text-sm text-emerald-300">{submitSuccess}</p>}
            <button
              type="submit"
              disabled={submitting || Boolean(submitSuccess)}
              className="h-12 w-full rounded-2xl bg-orange-400 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {submitSuccess ? t("onboarding.redirectingToSignIn") : submitting ? t("onboarding.creatingAccount") : t("onboarding.createAccount")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

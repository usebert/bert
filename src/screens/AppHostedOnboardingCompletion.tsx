import { FormEvent, useEffect, useState } from "react";
import { BertLogo } from "../components/BertLogo";
import { apiUrl } from "../config/apiBase";
import type { Role } from "../permissions";

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
      setupIncomplete?: boolean;
      canRetrySetup?: boolean;
      storageHint?: string;
    } & AppInviteProvisionMeta);

type AppInviteStatusPayload = AppInviteProvisionMeta & {
  ok?: boolean;
  error?: string;
  kind?: string;
  outcome?: "new_company" | "company_user";
  folderUrl?: string;
  email?: string;
};

type AppHostedOnboardingCompletionProps = {
  inviteToken: string;
  parseJsonApiResponse: <T = Record<string, unknown>>(response: Response) => Promise<T>;
};

export function AppHostedOnboardingCompletion({ inviteToken, parseJsonApiResponse }: AppHostedOnboardingCompletionProps) {
  const [details, setDetails] = useState<AppInviteDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ title: string; message: string } | null>(null);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(apiUrl(`/api/onboarding/app-invites/${encodeURIComponent(inviteToken)}`), {
          credentials: "include",
        });
        const payload = (await parseJsonApiResponse(response)) as AppInviteDetails & {
          ok?: boolean;
          error?: string;
          setupIncomplete?: boolean;
          canRetrySetup?: boolean;
        };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setLoadError(payload.error || "This invite link is not valid.");
          return;
        }
        if (payload.setupIncomplete && payload.canRetrySetup) {
          setDetails(payload as AppInviteDetails);
          setSubmitError(
            "Your previous setup did not finish on the company sheet. Complete the form below to try again.",
          );
          return;
        }
        setDetails(payload as AppInviteDetails);
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load invite details. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, parseJsonApiResponse]);

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
    if (details?.kind === "new_company" && !companyName.trim()) {
      setSubmitError("Company name is required.");
      return;
    }
    setSubmitting(true);
    const completeTimeoutMs = 300_000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), completeTimeoutMs);
    try {
      const response = await fetch(apiUrl(`/api/onboarding/app-invites/${encodeURIComponent(inviteToken)}/complete`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          companyName: details?.kind === "new_company" ? companyName.trim() : undefined,
          password,
          confirmPassword,
        }),
        signal: controller.signal,
      });
      const payload = (await parseJsonApiResponse(response)) as AppInviteStatusPayload & {
        ok?: boolean;
        folderUrl?: string;
        outcome?: string;
      };

      if (response.status === 202) {
        const serverMsg = payload.error || "Provisioning already in progress.";
        setSubmitError(`${serverMsg} Waiting for the other request to finish…`);
        const pollUntil = Date.now() + completeTimeoutMs;
        while (Date.now() < pollUntil) {
          if (controller.signal.aborted) break;
          await new Promise((resolve) => {
            window.setTimeout(resolve, 2000);
          });
          const pr = await fetch(apiUrl(`/api/onboarding/app-invites/${encodeURIComponent(inviteToken)}`), {
            signal: controller.signal,
            credentials: "include",
          });
          const pp = (await parseJsonApiResponse(pr)) as AppInviteStatusPayload;
          if (
            pr.status === 410 &&
            pp.outcome &&
            (pp.provisionStatus === "succeeded" || pp.provisionStatus === undefined)
          ) {
            setSubmitError("");
            if (pp.outcome === "new_company") {
              setDone({
                title: "Company workspace created",
                message: pp.folderUrl
                  ? `Your company folder is ready. You can sign in with your email and the password you chose. Drive folder: ${pp.folderUrl}`
                  : "You can sign in with your email and the password you chose.",
              });
            } else {
              setDone({
                title: "Account ready",
                message: "You can sign in with your email address and the password you chose.",
              });
            }
            window.history.replaceState({}, "", window.location.pathname);
            return;
          }
          if (pr.ok && pp.provisionStatus === "failed") {
            const errText = pp.provisionError || pp.error || "Provisioning failed.";
            setSubmitError(
              `${errText} Fix the issue if you can, then use Complete onboarding again.`,
            );
            return;
          }
        }
        setSubmitError(
          "Provisioning is still in progress or we could not confirm completion in time. Wait a few minutes, refresh this page, or try Complete onboarding again if your workspace was not created.",
        );
        return;
      }

      if (!response.ok || !payload.ok) {
        const serverMsg = payload.error || `The server returned HTTP ${response.status}.`;
        setSubmitError(
          response.status >= 500
            ? `${serverMsg} If provisioning stopped part-way, check the terminal running the API server before retrying; you may need a fresh invite if a Drive folder was already created.`
            : `${serverMsg} Fix the issue above, then use Complete onboarding again.`,
        );
        return;
      }
      if (payload.outcome === "new_company") {
        setDone({
          title: "Company workspace created",
          message: payload.folderUrl
            ? `Your company folder is ready. You can sign in with your email and the password you chose. Drive folder: ${payload.folderUrl}`
            : "You can sign in with your email and the password you chose.",
        });
      } else {
        setDone({
          title: "Account ready",
          message: "You can sign in with your email address and the password you chose.",
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSubmitError(
          `No response after ${Math.round(completeTimeoutMs / 60_000)} minutes. The server may still be talking to Google—check the terminal running npm run server, then try again if the workspace was not created.`,
        );
      } else {
        const detail = error instanceof Error ? error.message : "";
        setSubmitError(
          detail
            ? `${detail} Confirm the API server is running and Google is signed in on that machine, then retry.`
            : "Something went wrong. Check your connection, confirm the API server is running, and try again.",
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setSubmitting(false);
    }
  };

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
              {!details
                ? "Complete onboarding"
                : details.kind === "company_user"
                  ? `Join ${details.companyName || "your company"}`
                  : "New company setup"}
            </h1>
          </div>
        </div>

        {loadError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-100">{loadError}</div>
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
              First-time company setup creates Drive folders and your master sheet. It often finishes in a few minutes but can take longer when Google is busy—keep this tab open until you see a success message or a clear error below.
            </p>
            {submitting && (
              <p className="text-xs leading-relaxed text-slate-400">
                Working with Google Drive (folders, master sheet, tabs). Typical range{" "}
                <span className="font-semibold text-slate-300">1–3 minutes</span>—please wait.
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-orange-400 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Complete onboarding"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

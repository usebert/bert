import { FormEvent, useEffect, useState } from "react";
import { BertLogo } from "../components/BertLogo";
import { apiUrl } from "../config/apiBase";
import { saveCompanyLoginHint } from "../lib/companyLoginHint";

type MainNeedId = "audits" | "actions" | "incidents" | "evidence" | "reports" | "scheduling";

type InviteDetails = {
  ok: true;
  invite: {
    status: string;
    statusLabel: string;
    contactEmail: string;
    adminEmailDefault: string;
    provisionalCompanyName: string;
    provisionStatus?: string;
    provisionError?: string;
    canRetrySetup?: boolean;
    mainNeedOptions: MainNeedId[];
  };
};

type CompanyOnboardingFormScreenProps = {
  inviteToken: string;
  parseJsonApiResponse: <T = Record<string, unknown>>(response: Response) => Promise<T>;
  onComplete?: () => void;
};

const MAIN_NEED_LABELS: Record<MainNeedId, string> = {
  audits: "Site audits & checklists",
  actions: "Corrective actions",
  incidents: "Incidents & near misses",
  evidence: "Evidence & documents",
  reports: "Management reports",
  scheduling: "Audit scheduling",
};

export function CompanyOnboardingFormScreen({
  inviteToken,
  parseJsonApiResponse,
  onComplete,
}: CompanyOnboardingFormScreenProps) {
  const [loadError, setLoadError] = useState("");
  const [details, setDetails] = useState<InviteDetails["invite"] | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [industry, setIndustry] = useState("");
  const [sitesCount, setSitesCount] = useState("");
  const [usersCount, setUsersCount] = useState("");
  const [mainNeeds, setMainNeeds] = useState<MainNeedId[]>([]);
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);

  const tokenPath = encodeURIComponent(inviteToken);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(apiUrl(`/api/onboarding/company-onboarding/invite/${tokenPath}`), {
          credentials: "include",
        });
        const payload = (await parseJsonApiResponse(response)) as InviteDetails & {
          ok?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !payload.ok || !payload.invite) {
          setLoadError(payload.error || "This onboarding link is not valid.");
          return;
        }
        setDetails(payload.invite);
        setCompanyName(payload.invite.provisionalCompanyName || "");
        setAdminEmail(payload.invite.adminEmailDefault || payload.invite.contactEmail || "");
        await fetch(apiUrl(`/api/onboarding/company-onboarding/invite/${tokenPath}/start`), {
          method: "POST",
          credentials: "include",
        });
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load onboarding. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, parseJsonApiResponse, tokenPath]);

  const toggleNeed = (id: MainNeedId) => {
    setMainNeeds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

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
    if (!companyName.trim() || !adminFullName.trim()) {
      setSubmitError("Company name and administrator name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(apiUrl(`/api/onboarding/company-onboarding/invite/${tokenPath}/complete`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          website: website.trim(),
          phone: phone.trim(),
          address: address.trim(),
          industry: industry.trim(),
          sitesCount,
          usersCount,
          mainNeeds,
          adminFullName: adminFullName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          password,
          confirmPassword,
        }),
      });
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        error?: string;
        sessionStarted?: boolean;
        masterSheetId?: string;
        companyFolderId?: string;
      };
      if (response.status === 202) {
        setSubmitError("Setup is in progress. Keep this page open for a minute, then try again.");
        return;
      }
      if (!response.ok || !payload.ok) {
        setSubmitError(
          payload.error ||
            "We could not finish setup. Please try again or contact BERT support if the problem continues.",
        );
        return;
      }
      if (payload.masterSheetId) {
        saveCompanyLoginHint({
          email: adminEmail.trim().toLowerCase(),
          masterSheetId: payload.masterSheetId,
          companyFolderId: payload.companyFolderId,
          companyName: companyName.trim(),
        });
      }
      setDone(true);
      window.history.replaceState({}, "", window.location.pathname);
      if (payload.sessionStarted && onComplete) {
        window.setTimeout(() => onComplete(), 800);
      }
    } catch {
      setSubmitError("Network error while submitting. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100">
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <BertLogo variant="full" tone="onDark" size="md" className="mx-auto" />
          <h1 className="mt-6 text-2xl font-semibold text-white">Your company is live</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            BERT has provisioned your workspace. Sign in with the email and password you chose to open your dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,#0f172a,transparent_40%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <BertLogo variant="full" tone="onDark" size="md" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-blue-400/90">Company onboarding</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Complete your BERT company setup</h1>
        <p className="mt-2 text-sm text-slate-300">
          Tell us about your organisation and create the first administrator account. This secure link is single-use.
        </p>

        {loadError ? (
          <p className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">{loadError}</p>
        ) : null}

        {details && !loadError ? (
          <form onSubmit={handleSubmit} className="mt-8 space-y-8">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Company</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">Company name</span>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Website</span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Phone</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">Address</span>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Industry</span>
                  <input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Sites (approx.)</span>
                  <input
                    value={sitesCount}
                    onChange={(e) => setSitesCount(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Users (approx.)</span>
                  <input
                    value={usersCount}
                    onChange={(e) => setUsersCount(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
              </div>
              <fieldset className="mt-4">
                <legend className="text-xs font-semibold text-slate-300">Main needs</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(details.mainNeedOptions || []).map((id) => (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={mainNeeds.includes(id)}
                        onChange={() => toggleNeed(id)}
                        className="rounded border-white/20"
                      />
                      <span className="text-sm text-slate-200">{MAIN_NEED_LABELS[id] || id}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">First administrator</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">Full name</span>
                  <input
                    value={adminFullName}
                    onChange={(e) => setAdminFullName(e.target.value)}
                    required
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">Email</span>
                  <input
                    type="email"
                    value={adminEmail}
                    readOnly
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">Confirm password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
              </div>
            </section>

            {submitError ? (
              <p className="rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100" role="alert">
                {submitError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-2xl bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
            >
              {submitting ? "Setting up your company…" : "Submit and go live"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

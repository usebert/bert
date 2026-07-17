import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BertLogo } from "../components/BertLogo";
import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import { fetchInviteApi } from "../utils/inviteApi";
import { mapCompanyOnboardingInviteError } from "../utils/inviteCompletionMessages";

type MainNeedId =
  | "iso_9001"
  | "iso_14001"
  | "iso_45001"
  | "health_safety"
  | "risk"
  | "coshh"
  | "audits"
  | "digital_checks"
  | "other";

type InviteDetails = {
  ok: true;
  type: "COMPANY_ONBOARDING";
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
  onComplete?: () => void;
};

const MAIN_NEED_LABELS: Record<MainNeedId, string> = {
  iso_9001: "ISO 9001",
  iso_14001: "ISO 14001",
  iso_45001: "ISO 45001",
  health_safety: "Health & Safety",
  risk: "Risk management",
  coshh: "COSHH",
  audits: "Audits",
  digital_checks: "Digital checks",
  other: "Other",
};

export function CompanyOnboardingFormScreen({
  inviteToken,
  onComplete,
}: CompanyOnboardingFormScreenProps) {
  const { t } = useTranslation();
  const [loadError, setLoadError] = useState("");
  const [details, setDetails] = useState<InviteDetails["invite"] | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [town, setTown] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [sitesCount, setSitesCount] = useState("");
  const [usersCount, setUsersCount] = useState("");
  const [mainNeeds, setMainNeeds] = useState<MainNeedId[]>([]);
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
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
      const result = await fetchInviteApi<InviteDetails>(
        `/api/invites/${tokenPath}?expectedType=COMPANY_ONBOARDING`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(
          mapCompanyOnboardingInviteError(
            { error: result.error, message: result.message, code: result.code },
            result.code,
            result.response?.status ?? 0,
          ),
        );
        return;
      }
      const payload = result.data;
      if (!payload.invite || payload.type !== "COMPANY_ONBOARDING") {
        setLoadError(mapCompanyOnboardingInviteError({ code: "INVITE_WRONG_TYPE" }, "INVITE_WRONG_TYPE", 400));
        return;
      }
      setDetails(payload.invite);
      setCompanyName(payload.invite.provisionalCompanyName || "");
      setAdminEmail(payload.invite.adminEmailDefault || payload.invite.contactEmail || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, tokenPath]);

  const toggleNeed = (id: MainNeedId) => {
    setMainNeeds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

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
    if (!companyName.trim() || !adminFirstName.trim() || !adminLastName.trim()) {
      setSubmitError(t("onboarding.adminNamesRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await fetchInviteApi<{
        ok?: boolean;
        error?: string;
        code?: string;
        sessionStarted?: boolean;
        masterSheetId?: string;
        companyFolderId?: string;
      }>(`/api/onboarding/company/${tokenPath}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          website: website.trim(),
          phone: phone.trim(),
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim(),
          town: town.trim(),
          county: county.trim(),
          postcode: postcode.trim(),
          country: country.trim(),
          industry: industry.trim(),
          sitesCount,
          usersCount,
          mainNeeds,
          adminFirstName: adminFirstName.trim(),
          adminLastName: adminLastName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          password,
          confirmPassword,
        }),
      });

      if (!result.ok) {
        if (result.response?.status === 202) {
          setSubmitError(t("onboarding.setupInProgress"));
          return;
        }
        setSubmitError(
          mapCompanyOnboardingInviteError(
            { error: result.error, message: result.message, code: result.code },
            result.code,
            result.response?.status ?? 0,
          ),
        );
        return;
      }

      const payload = result.data;
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
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100">
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <BertLogo variant="full" tone="onDark" size="md" className="mx-auto" />
          <h1 className="mt-6 text-2xl font-semibold text-white">{t("onboarding.workspaceReady")}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{t("onboarding.workspaceReadyBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,#0f172a,transparent_40%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <BertLogo variant="full" tone="onDark" size="md" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-blue-400/90">{t("onboarding.companyOnboardingLabel")}</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">{t("onboarding.completeSetup")}</h1>
        <p className="mt-2 text-sm text-slate-300">{t("onboarding.completeSetupBody")}</p>

        {loadError ? (
          <p className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">{loadError}</p>
        ) : null}

        {details && !loadError ? (
          <form onSubmit={handleSubmit} className="mt-8 space-y-8">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{t("onboarding.company")}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.companyName")}</span>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.website")}</span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.phone")}</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.addressLine1")}</span>
                  <input
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.addressLine2")}</span>
                  <input
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.townCity")}</span>
                  <input
                    value={town}
                    onChange={(e) => setTown(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.countyRegion")}</span>
                  <input
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.postcode")}</span>
                  <input
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.country")}</span>
                  <input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.industry")}</span>
                  <input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.numberOfSitesApprox")}</span>
                  <input
                    value={sitesCount}
                    onChange={(e) => setSitesCount(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.estimatedUsers")}</span>
                  <input
                    value={usersCount}
                    onChange={(e) => setUsersCount(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
              </div>
              <fieldset className="mt-4">
                <legend className="text-xs font-semibold text-slate-300">{t("onboarding.mainNeeds")}</legend>
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
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{t("onboarding.firstAdministrator")}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.firstName")}</span>
                  <input
                    value={adminFirstName}
                    onChange={(e) => setAdminFirstName(e.target.value)}
                    required
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.lastName")}</span>
                  <input
                    value={adminLastName}
                    onChange={(e) => setAdminLastName(e.target.value)}
                    required
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.email")}</span>
                  <input
                    type="email"
                    value={adminEmail}
                    readOnly
                    className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.password")}</span>
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
                  <span className="text-xs font-semibold text-slate-300">{t("onboarding.confirmPassword")}</span>
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
              {submitting ? t("onboarding.creatingWorkspace") : t("onboarding.createWorkspace")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

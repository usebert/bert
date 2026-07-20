import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  COMPANY_PROVISION_STAGES,
  COMPANY_TYPES,
  createGodmodeCompany,
  type ConnectedCompanyFolder,
  type CompanyProvisionStageEvent,
} from "../../services/godmodeService";
import { BERT_LIGHT_SURFACE } from "../../styles/bertText";
import { GodmodeConnectCompanyFolderPanel } from "./GodmodeConnectCompanyFolderPanel";

type Props = {
  googleConnected: boolean;
  onCreated?: (company: ConnectedCompanyFolder & { adminUsername?: string }) => void;
  onBackToCompanies?: () => void;
};

type Phase = "form" | "progress" | "success" | "error";

function deriveUsernameFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return "";
  }
  const local = normalized.split("@")[0] || "";
  const plus = local.indexOf("+");
  if (plus >= 0 && plus < local.length - 1) {
    return local.slice(plus + 1).replace(/\s+/g, "");
  }
  return local.replace(/\s+/g, "");
}

function isValidEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.includes("@") && email.length > 3 && !/\s/.test(email);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read logo file."));
    reader.readAsDataURL(file);
  });
}

export function GodmodeCreateCompanyPanel({ googleConnected, onCreated, onBackToCompanies }: Props) {
  const { t } = useTranslation();
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [operationId, setOperationId] = useState("");
  const [stageStatus, setStageStatus] = useState<Record<string, "pending" | "running" | "done" | "error">>({});
  const [error, setError] = useState("");
  const [failedStage, setFailedStage] = useState("");
  const [created, setCreated] = useState<(ConnectedCompanyFolder & { adminUsername?: string }) | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    if (usernameTouched) {
      return;
    }
    setAdminUsername(deriveUsernameFromEmail(adminEmail));
  }, [adminEmail, usernameTouched]);

  const stages = useMemo(() => COMPANY_PROVISION_STAGES, []);

  function validateForm(): string[] {
    const errors: string[] = [];
    if (!companyName.trim()) errors.push("Company name is required.");
    if (!adminName.trim()) errors.push("First admin name is required.");
    if (!isValidEmail(adminEmail)) errors.push("A valid first admin email is required.");
    if (!adminUsername.trim()) errors.push("First admin username is required.");
    if (!adminPassword || adminPassword.length < 8) errors.push("Password must be at least 8 characters.");
    if (adminPassword !== confirmPassword) errors.push("Passwords do not match.");
    if (companyType && !COMPANY_TYPES.includes(companyType as (typeof COMPANY_TYPES)[number])) {
      errors.push("Company type is not valid.");
    }
    return errors;
  }

  function applyStageEvent(event: CompanyProvisionStageEvent) {
    if (event.operationId) {
      setOperationId(event.operationId);
    }
    if (event.type === "stage" && event.stage) {
      setStageStatus((current) => ({
        ...current,
        [event.stage!]:
          event.status === "done" ? "done" : event.status === "running" ? "running" : current[event.stage!] || "pending",
      }));
    }
    if (event.type === "error") {
      setFailedStage(event.stage || event.label || "");
      setError(event.error || "Company creation failed.");
      if (event.stage) {
        setStageStatus((current) => ({ ...current, [event.stage!]: "error" }));
      }
      setPhase("error");
    }
    if (event.type === "complete" && event.company) {
      const company = {
        ...event.company,
        adminUsername: event.company.adminUsername || adminUsername.trim(),
      };
      setCreated(company);
      setPhase("success");
      setStageStatus((current) => {
        const next = { ...current };
        for (const stage of stages) {
          next[stage.id] = "done";
        }
        return next;
      });
    }
  }

  async function handleLogoChange(file: File | null) {
    if (!file) {
      setLogoDataUrl("");
      setLogoFileName("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFieldErrors(["Company logo must be an image file."]);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setLogoDataUrl(dataUrl);
    setLogoFileName(file.name);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setFailedStage("");
    setCreated(null);
    const errors = validateForm();
    setFieldErrors(errors);
    if (errors.length > 0) {
      return;
    }
    if (!googleConnected) {
      setFieldErrors(["Connect Google Workspace before creating a company."]);
      return;
    }

    const initialStatus: Record<string, "pending" | "running" | "done" | "error"> = {};
    for (const stage of stages) {
      initialStatus[stage.id] = "pending";
    }
    setStageStatus(initialStatus);
    setPhase("progress");

    try {
      const result = await createGodmodeCompany(
        {
          companyName: companyName.trim(),
          companyType: companyType || undefined,
          logoDataUrl: logoDataUrl || undefined,
          logoFileName: logoFileName || undefined,
          firstAdminName: adminName.trim(),
          firstAdminEmail: adminEmail.trim(),
          firstAdminUsername: adminUsername.trim(),
          adminPassword,
          confirmPassword,
          operationId: operationId || undefined,
        },
        applyStageEvent,
      );

      if (result.operationId) {
        setOperationId(result.operationId);
      }

      if (!result.ok || !result.company) {
        setFailedStage(result.failedStage || "");
        setError(result.error || result.errors?.[0] || "Could not create company.");
        setPhase("error");
        return;
      }

      const company = {
        ...result.company,
        adminUsername: result.company.adminUsername || adminUsername.trim(),
      };
      setCreated(company);
      setPhase("success");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create company.");
      setPhase("error");
    }
  }

  function handleRetry() {
    setPhase("form");
    setError("");
    setFailedStage("");
  }

  function handleOpenCompany() {
    if (!created) {
      return;
    }
    onCreated?.(created);
  }

  if (phase === "success" && created) {
    return (
      <section className={`${BERT_LIGHT_SURFACE} space-y-4 rounded-2xl border border-slate-200 p-5`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Ready</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{t("godmode.createNewCompany")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {created.companyName} is ready. The first administrator can sign in with username{" "}
            <span className="font-semibold text-slate-900">{created.adminUsername || adminUsername}</span>.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-semibold">{created.companyName}</p>
          <p className="mt-1 text-xs">Admin username: {created.adminUsername || adminUsername}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleOpenCompany}
            className="h-11 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
          >
            {t("godmode.openCompany")}
          </button>
          {onBackToCompanies ? (
            <button
              type="button"
              onClick={onBackToCompanies}
              className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("godmode.companies")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (phase === "progress" || phase === "error") {
    return (
      <section className={`${BERT_LIGHT_SURFACE} space-y-4 rounded-2xl border border-slate-200 p-5`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {phase === "error" ? "Needs attention" : "Provisioning"}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{t("godmode.createNewCompany")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            BERT is creating the Google Drive structure, workbook, users, document folders and required records.
          </p>
        </div>
        <ol className="space-y-2">
          {stages.map((stage) => {
            const status = stageStatus[stage.id] || "pending";
            const isFailed = phase === "error" && (failedStage === stage.id || status === "error");
            return (
              <li
                key={stage.id}
                className={[
                  "flex items-center justify-between rounded-xl border px-3 py-2 text-sm",
                  isFailed
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : status === "done"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : status === "running"
                        ? "border-orange-200 bg-orange-50 text-orange-900"
                        : "border-slate-200 bg-white text-slate-600",
                ].join(" ")}
              >
                <span>{stage.label}</span>
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {isFailed ? "Failed" : status === "done" ? "Done" : status === "running" ? "Working…" : "Waiting"}
                </span>
              </li>
            );
          })}
        </ol>
        {phase === "error" ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-700">
              {failedStage
                ? `Failed at: ${stages.find((entry) => entry.id === failedStage)?.label || failedStage}. `
                : null}
              {error}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="h-11 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
            >
              Retry from last successful stage
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`${BERT_LIGHT_SURFACE} space-y-4 rounded-2xl border border-slate-200 p-5`}>
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{t("godmode.createNewCompany")}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Create a complete BERT company workspace. BERT will create the Google Drive structure, workbook, users,
          document folders and required records automatically.
        </p>
      </div>

      {!googleConnected ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Connect Google Workspace in Platform setup before creating a company.
        </p>
      ) : null}

      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Company name
          </label>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Company logo (optional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => void handleLogoChange(event.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Company type (optional)
          </label>
          <select
            value={companyType}
            onChange={(event) => setCompanyType(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
          >
            <option value="">Select type</option>
            {COMPANY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.firstAdminName")}
          </label>
          <input
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.firstAdminEmail")}
          </label>
          <input
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            First admin username
          </label>
          <input
            value={adminUsername}
            onChange={(event) => {
              setUsernameTouched(true);
              setAdminUsername(event.target.value);
            }}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.firstAdminPassword")}
          </label>
          <div className="flex gap-2">
            <input
              type={showPassword ? "text" : "password"}
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
              required
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700"
            >
              {showPassword ? "Hide" : t("login.showPassword")}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Confirm password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            required
            autoComplete="new-password"
          />
        </div>

        {fieldErrors.length > 0 ? (
          <ul className="space-y-1 text-sm text-rose-700">
            {fieldErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="submit"
          disabled={!googleConnected}
          className="h-11 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {t("godmode.createCompany")}
        </button>
      </form>

      <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">Advanced recovery</summary>
        <p className="mt-2 text-xs leading-relaxed">
          Manual folder connection remains available for support recovery only. Prefer automated Create company for new
          workspaces.
        </p>
        {!showRecovery ? (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-slate-600 underline"
            onClick={() => setShowRecovery(true)}
          >
            Show connect company folder (recovery)
          </button>
        ) : (
          <div className="mt-3">
            <GodmodeConnectCompanyFolderPanel googleConnected={googleConnected} onConnected={onCreated} />
          </div>
        )}
      </details>
    </section>
  );
}

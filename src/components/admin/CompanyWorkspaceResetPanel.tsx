import { useMemo, useState } from "react";
import { DangerActionButton } from "../DangerActionButton";
import {
  COMPANY_RESET_CONFIRM_PHRASE,
  resetCompanyWorkspace,
  type CompanyWorkspaceResetMode,
} from "../../services/companyWorkspaceResetService";

type Props = {
  companyFolderId: string;
  masterSheetId: string;
  companyName: string;
  googleConnected: boolean;
  slatePrimaryCtaInteract: string;
  onResetComplete: (message: string) => void;
  onResetError: (message: string) => void;
  collapsible?: boolean;
};

const KEPT_ITEMS = [
  "Company Drive folder and master spreadsheet file",
  "ISO readiness folders 01–06 and folder IDs in Config",
  "Company name, company folder ID, and master sheet ID in Config",
];

const CLEARED_ITEMS = [
  "Users tab (headers only) and all Config UserAuth.<email> entries",
  "Pending app invites for this company",
  "Schedules, audit results, findings, actions, comments, evidence rows, reports, sync log",
  "Area audits and per-user access tabs",
  "Onboarding and incident tabs when present",
];

export function CompanyWorkspaceResetPanel({
  companyFolderId,
  masterSheetId,
  companyName,
  googleConnected,
  slatePrimaryCtaInteract,
  onResetComplete,
  onResetError,
  collapsible = false,
}: Props) {
  const [mode, setMode] = useState<CompanyWorkspaceResetMode>("clean_onboarding");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [showResetDetails, setShowResetDetails] = useState(false);

  const canSubmit = useMemo(
    () =>
      googleConnected &&
      Boolean(companyFolderId) &&
      Boolean(masterSheetId) &&
      confirmPhrase.trim() === COMPANY_RESET_CONFIRM_PHRASE &&
      !submitting,
    [googleConnected, companyFolderId, masterSheetId, confirmPhrase, submitting],
  );

  const handleReset = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await resetCompanyWorkspace({
        companyFolderId,
        masterSheetId,
        mode,
        confirmPhrase: confirmPhrase.trim(),
      });
      onResetComplete(
        result.message ||
          "Company workspace reset. Re-invite users from Users & Invites when you are ready.",
      );
      setConfirmPhrase("");
    } catch (error) {
      onResetError(error instanceof Error ? error.message : "Unable to reset company workspace.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetControls = (
    <>
      <p className="text-sm text-slate-600">
        Use this only when setting up or clearing a test workspace. This does not delete the Google Drive folder or
        files.
      </p>

      <button
        type="button"
        onClick={() => setShowResetDetails((current) => !current)}
        className="mt-3 text-xs font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
      >
        {showResetDetails ? "Hide reset details" : "Show reset details"}
      </button>

      {showResetDetails ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Kept</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {KEPT_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Cleared (headers preserved)</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {CLEARED_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {mode === "full_operational" ? (
                  <li className="font-semibold">Areas and AuditTemplates tabs (full operational mode)</li>
                ) : (
                  <li className="font-semibold">Areas and audit templates kept (onboarding modes)</li>
                )}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Evidence files in Google Drive are not deleted — only Evidence tab rows are cleared.
              </p>
            </div>
          </div>

          <fieldset className="mt-4 space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600">Reset mode</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              <input
                type="radio"
                name="company-reset-mode"
                checked={mode === "clean_onboarding"}
                onChange={() => setMode("clean_onboarding")}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">Clean onboarding</span> — clear operational data; keep areas and audit
                templates (default).
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              <input
                type="radio"
                name="company-reset-mode"
                checked={mode === "keep_areas_templates"}
                onChange={() => setMode("keep_areas_templates")}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">Keep areas &amp; templates</span> — same as clean onboarding (explicit
                confirmation).
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              <input
                type="radio"
                name="company-reset-mode"
                checked={mode === "full_operational"}
                onChange={() => setMode("full_operational")}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">Full operational reset</span> — also clears Areas and AuditTemplates.
              </span>
            </label>
          </fieldset>
        </>
      ) : null}

      <label className="mt-4 block text-xs font-semibold text-slate-700">
        Type {COMPANY_RESET_CONFIRM_PHRASE} to confirm
        <input
          value={confirmPhrase}
          onChange={(event) => setConfirmPhrase(event.target.value)}
          placeholder={COMPANY_RESET_CONFIRM_PHRASE}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
        />
      </label>

      <DangerActionButton
        type="button"
        disabled={!canSubmit}
        onClick={() => void handleReset()}
        className={`mt-3 rounded-xl px-4 py-2.5 text-sm ${slatePrimaryCtaInteract}`}
      >
        {submitting ? "Resetting…" : !googleConnected ? "Connect Google first" : "Reset company workspace"}
      </DangerActionButton>
    </>
  );

  if (collapsible) {
    return (
      <section className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Danger Zone</h3>
            {!dangerOpen ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Reset and destructive tools for this company workspace.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                Resets <span className="font-semibold">{companyName || "this company"}</span> to a clean onboarding
                state. Other companies are not affected.
              </p>
            )}
          </div>
          {!dangerOpen ? (
            <button
              type="button"
              onClick={() => setDangerOpen(true)}
              className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:border-rose-300 hover:bg-rose-100"
            >
              Open Danger Zone
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDangerOpen(false)}
              className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Close
            </button>
          )}
        </div>
        {dangerOpen ? <div className="mt-4 border-t border-slate-100 pt-4">{resetControls}</div> : null}
      </section>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-300 bg-rose-50/90 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-800">Danger zone</p>
      <h3 className="mt-1 text-base font-semibold text-rose-950">Reset company workspace</h3>
      <p className="mt-2 text-sm text-rose-900/90">
        Resets <span className="font-semibold">{companyName || "this company"}</span> to a clean onboarding state.
        This does not delete the company folder, master sheet, or ISO Drive folders. Other companies are not affected.
      </p>
      <div className="mt-4 text-rose-950">{resetControls}</div>
    </div>
  );
}

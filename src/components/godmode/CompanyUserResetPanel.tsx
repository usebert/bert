import { useMemo, useState } from "react";
import { DangerActionButton } from "../DangerActionButton";
import {
  RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE,
  RESET_USERS_CONFIRM_PHRASE,
  USER_RESET_ALL_WARNING,
  USER_RESET_WARNING,
  resetAllCompanyUsers,
  resetCompanyUsers,
} from "../../services/companyUserResetService";

type Props = {
  companyFolderId: string;
  masterSheetId: string;
  companyName: string;
  googleConnected: boolean;
  disabled?: boolean;
  onResetComplete: (message: string) => void;
  onResetError: (message: string) => void;
};

export function CompanyUserResetPanel({
  companyFolderId,
  masterSheetId,
  companyName,
  googleConnected,
  disabled = false,
  onResetComplete,
  onResetError,
}: Props) {
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [allConfirmPhrase, setAllConfirmPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [allSubmitting, setAllSubmitting] = useState(false);
  const [showCompanyReset, setShowCompanyReset] = useState(false);
  const [showGlobalReset, setShowGlobalReset] = useState(false);
  const [lastReport, setLastReport] = useState("");

  const canResetCompany = useMemo(
    () =>
      googleConnected &&
      Boolean(companyFolderId) &&
      Boolean(masterSheetId) &&
      confirmPhrase.trim() === RESET_USERS_CONFIRM_PHRASE &&
      !submitting &&
      !disabled,
    [googleConnected, companyFolderId, masterSheetId, confirmPhrase, submitting, disabled],
  );

  const canResetAll = useMemo(
    () =>
      googleConnected &&
      allConfirmPhrase.trim() === RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE &&
      !allSubmitting &&
      !disabled,
    [googleConnected, allConfirmPhrase, allSubmitting, disabled],
  );

  const handleResetCompany = async () => {
    if (!canResetCompany) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await resetCompanyUsers({
        companyFolderId,
        masterSheetId,
        companyName,
        confirmPhrase: confirmPhrase.trim(),
      });
      const summary = `Removed ${result.usersRemoved ?? 0} user(s), ${result.invitesRemoved ?? 0} invite(s). Backup tab: ${result.backupTabName || "Users_Backup"}.`;
      setLastReport(summary);
      onResetComplete(summary);
      setConfirmPhrase("");
      setShowCompanyReset(false);
    } catch (error) {
      onResetError(error instanceof Error ? error.message : "Unable to reset company users.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetAll = async () => {
    if (!canResetAll) {
      return;
    }
    setAllSubmitting(true);
    try {
      const result = await resetAllCompanyUsers({
        confirmPhrase: allConfirmPhrase.trim(),
      });
      const summary = `Reset ${result.companiesProcessed ?? 0} company workspace(s). Removed ${result.usersRemoved ?? 0} user(s) and ${result.invitesRemoved ?? 0} invite(s).`;
      setLastReport(summary);
      onResetComplete(summary);
      setAllConfirmPhrase("");
      setShowGlobalReset(false);
    } catch (error) {
      onResetError(error instanceof Error ? error.message : "Unable to reset all company users.");
    } finally {
      setAllSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-4">
      <div>
        <p className="text-sm font-semibold text-rose-950">Reset company users</p>
        <p className="mt-1 text-xs leading-relaxed text-rose-900">{USER_RESET_WARNING}</p>
      </div>
      <button
        type="button"
        onClick={() => setShowCompanyReset((open) => !open)}
        disabled={disabled || !googleConnected}
        className="inline-flex h-10 items-center rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-950 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {showCompanyReset ? "Hide reset company users" : "Reset company users"}
      </button>
      {showCompanyReset ? (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-white px-3 py-3">
          <p className="text-xs text-rose-900">
            Selected company: <span className="font-semibold">{companyName || companyFolderId}</span>
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-rose-900">
              Type <span className="font-mono">{RESET_USERS_CONFIRM_PHRASE}</span> to confirm
            </span>
            <input
              value={confirmPhrase}
              onChange={(event) => setConfirmPhrase(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-rose-200 px-3 text-sm text-slate-900"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <DangerActionButton
            type="button"
            disabled={!canResetCompany}
            onClick={() => void handleResetCompany()}
          >
            {submitting ? "Resetting users…" : "Reset company users"}
          </DangerActionButton>
        </div>
      ) : null}

      <div className="border-t border-rose-200 pt-4">
        <p className="text-sm font-semibold text-rose-950">Reset all company users</p>
        <p className="mt-1 text-xs leading-relaxed text-rose-900">{USER_RESET_ALL_WARNING}</p>
        <button
          type="button"
          onClick={() => setShowGlobalReset((open) => !open)}
          disabled={disabled || !googleConnected}
          className="mt-3 inline-flex h-10 items-center rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {showGlobalReset ? "Hide reset all company users" : "Reset all company users"}
        </button>
        {showGlobalReset ? (
          <div className="mt-3 space-y-3 rounded-xl border border-rose-200 bg-white px-3 py-3">
            <label className="block">
              <span className="text-xs font-semibold text-rose-900">
                Type <span className="font-mono">{RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE}</span> to confirm
              </span>
              <input
                value={allConfirmPhrase}
                onChange={(event) => setAllConfirmPhrase(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-rose-200 px-3 text-sm text-slate-900"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <DangerActionButton
              type="button"
              disabled={!canResetAll}
              onClick={() => void handleResetAll()}
            >
              {allSubmitting ? "Resetting all users…" : "Reset all company users"}
            </DangerActionButton>
          </div>
        ) : null}
      </div>

      {lastReport ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">{lastReport}</p>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import type { CompanyMembersDiagnostics } from "../services/companyUserService";

type Props = {
  reasonCode?: string;
  failedStep?: string;
  diagnostics?: CompanyMembersDiagnostics;
  detail?: string;
  tone?: "light" | "dark";
  defaultOpen?: boolean;
};

function formatDiagnostics(diagnostics: CompanyMembersDiagnostics | undefined, reasonCode?: string, detail?: string, failedStep?: string) {
  const lines = [
    reasonCode ? `reasonCode: ${reasonCode}` : "",
    failedStep || diagnostics?.failedStep ? `failedStep: ${failedStep || diagnostics?.failedStep}` : "",
    diagnostics?.companyName ? `companyName: ${diagnostics.companyName}` : "",
    diagnostics?.companyId ? `companyId: ${diagnostics.companyId}` : "",
    diagnostics?.companyFolderId ? `companyFolderId: ${diagnostics.companyFolderId}` : "",
    diagnostics?.companyFolderUrl ? `companyFolderUrl: ${diagnostics.companyFolderUrl}` : "",
    diagnostics?.masterSheetId ? `masterSheetId: ${diagnostics.masterSheetId}` : "",
    Array.isArray(diagnostics?.masterSheetIdsTried) && diagnostics.masterSheetIdsTried.length
      ? `masterSheetIdsTried: ${diagnostics.masterSheetIdsTried.join(", ")}`
      : "",
    diagnostics?.masterSheetResolutionSource
      ? `masterSheetResolutionSource: ${diagnostics.masterSheetResolutionSource}`
      : "",
    diagnostics?.signedInEmail ? `signedInEmail: ${diagnostics.signedInEmail}` : "",
    typeof diagnostics?.totalRowsRead === "number" ? `totalRowsRead: ${diagnostics.totalRowsRead}` : "",
    typeof diagnostics?.profilesReturned === "number" ? `profilesReturned: ${diagnostics.profilesReturned}` : "",
    typeof diagnostics?.activeOnlyCount === "number"
      ? `activeOnlyCount: ${diagnostics.activeOnlyCount}`
      : typeof diagnostics?.activeRowsFound === "number"
        ? `activeOnlyCount: ${diagnostics.activeRowsFound}`
        : "",
    diagnostics?.dataSource ? `dataSource: ${diagnostics.dataSource}` : "",
    diagnostics?.upstreamMessage ? `upstreamMessage: ${diagnostics.upstreamMessage}` : "",
    detail && !diagnostics?.upstreamMessage ? `detail: ${detail}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function CompanyMembersDiagnosticsPanel({
  reasonCode,
  diagnostics,
  detail,
  failedStep,
  tone = "light",
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const body = formatDiagnostics(diagnostics, reasonCode, detail, failedStep);
  if (!body.trim()) {
    return null;
  }

  const shellClass =
    tone === "dark"
      ? "border-slate-600 bg-slate-900/60 text-slate-200"
      : "border-slate-200 bg-slate-50 text-slate-800";
  const buttonClass =
    tone === "dark"
      ? "text-slate-300 hover:text-white"
      : "text-slate-600 hover:text-slate-900";

  return (
    <div className={`mt-2 rounded-xl border px-3 py-2 ${shellClass}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center justify-between text-left text-xs font-semibold ${buttonClass}`}
        aria-expanded={open}
      >
        <span>Diagnostics{reasonCode ? ` (${reasonCode})` : ""}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-90">
          {body}
        </pre>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { canCompleteAuditAsAuditor } from "../permissions";
import type { NonConformanceScreenProps } from "../types/nonConformanceScreenProps";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";
import { canArchiveRecordFromClient } from "../utils/archivePermissions";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import { EvidenceUploadChoice } from "../components/evidence/EvidenceUploadChoice";
import {
  NCR_EVIDENCE_FAILED_MESSAGE,
  NCR_EVIDENCE_PENDING_MESSAGE,
} from "../services/ncrService";

function parseNcrSequence(reference: string) {
  const match = reference.match(/^NCR-(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizeAuditorIdentity(value: string) {
  return value.trim().toLowerCase();
}

function evidencePreviewUrl(item: { previewUrl?: string; driveLink?: string; driveFileId?: string }) {
  const preview = String(item.previewUrl || "").trim();
  if (preview) return preview;
  const driveLink = String(item.driveLink || "").trim();
  if (driveLink) return driveLink;
  const driveFileId = String(item.driveFileId || "").trim();
  if (driveFileId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
  }
  return "";
}

export function NonConformanceScreen({
  currentUser,
  nonConformances,
  canViewCompletedReports,
  onSaveProgress,
  onComplete,
  onAddEvidence,
  onExportReport,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  onNcrArchived,
  onArchiveError,
  onArchiveSuccess,
}: NonConformanceScreenProps) {
  const { t } = useTranslation();
  const canArchiveNcr = canArchiveRecordFromClient(currentUser.role, "ncr");
  const auditorIdentityTokens = useMemo(() => {
    const tokens = new Set<string>();
    [currentUser.username, currentUser.name, currentUser.email].forEach((value) => {
      const normalized = normalizeAuditorIdentity(String(value || ""));
      if (normalized) {
        tokens.add(normalized);
      }
      if (normalized.includes("@")) {
        tokens.add(normalized.split("@")[0] || "");
      }
    });
    return tokens;
  }, [currentUser.email, currentUser.name, currentUser.username]);
  const visible = useMemo(() => {
    const byRef = [...nonConformances].sort((a, b) => {
      const left = parseNcrSequence(a.reference) || 0;
      const right = parseNcrSequence(b.reference) || 0;
      return left - right;
    });
    if (canCompleteAuditAsAuditor(currentUser.role)) {
      return byRef.filter((item) => {
        const auditorId = normalizeAuditorIdentity(item.auditorUserId);
        const auditorName = normalizeAuditorIdentity(item.auditorName);
        return auditorIdentityTokens.has(auditorId) || auditorIdentityTokens.has(auditorName);
      });
    }
    return byRef;
  }, [auditorIdentityTokens, nonConformances, currentUser.role]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [isoClause, setIsoClause] = useState("");
  const [investigationNotes, setInvestigationNotes] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  const selected = visible.find((item) => item.id === selectedId) || null;
  useEffect(() => {
    if (!selected && visible.length) {
      setSelectedId(visible[0].id);
      return;
    }
    if (!selected) return;
    setIsoClause(selected.investigationIsoClause || "");
    setInvestigationNotes(selected.investigationNotes || "");
    setRootCause(selected.rootCause || "");
    setCorrectiveAction(selected.correctiveAction || "");
    setExtraNotes(selected.investigationExtraNotes || "");
  }, [selectedId, selected, visible]);

  const completed = visible.filter((item) => item.status === "Completed");

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <p className={darkPanelEyebrow}>{t("ncrs.title")}</p>
        <h2 className={darkPanelTitleLg}>{t("ncrs.subtitle")}</h2>
      </section>
      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-2">
          {visible.length === 0 ? (
            <EmptyPanel
              title={t("ncrs.noNcrs")}
              text={t("ncrs.emptyRegisterBody")}
            />
          ) : (
            visible.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={`grid grid-cols-6 gap-2 rounded-xl border px-3 py-2 text-left ${selectedId === item.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
                <p className="text-xs font-semibold text-slate-900">{item.reference}</p>
                <p className="text-xs text-slate-600">{item.site}</p>
                <p className="text-xs text-slate-600">{item.auditorName}</p>
                <p className="text-xs text-slate-600">{item.raisedAt}</p>
                <p className="text-xs text-slate-600">{item.status}</p>
                <p className="text-xs text-slate-600">{item.assignedLineManager}</p>
              </button>
            ))
          )}
        </div>
      </section>
      {selected && (
        <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">{t("ncrs.investigationFormTitle", { reference: selected.reference })}</h3>
          <p className="mt-1 text-xs text-slate-500">{selected.auditQuestion}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={isoClause} onChange={(event) => setIsoClause(event.target.value)} placeholder={t("ncrs.isoClause")} className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm" />
            <textarea value={investigationNotes} onChange={(event) => setInvestigationNotes(event.target.value)} placeholder={t("ncrs.investigationNotes")} className="min-h-[6rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
            <textarea value={rootCause} onChange={(event) => setRootCause(event.target.value)} placeholder={t("ncrs.rootCause")} className="min-h-[6rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
            <textarea value={correctiveAction} onChange={(event) => setCorrectiveAction(event.target.value)} placeholder={t("ncrs.correctiveAction")} className="min-h-[6rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
          </div>
          <textarea value={extraNotes} onChange={(event) => setExtraNotes(event.target.value)} placeholder={t("ncrs.extraNotes")} className="mt-2 min-h-[5rem] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
          <div className="mt-2">
            <EvidenceUploadChoice
              triggerLabel={t("ncrs.uploadEvidence")}
              triggerClassName="min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
              onFiles={(files) => onAddEvidence(selected.id, files)}
            />
            <p className="mt-1 text-xs text-slate-500">{t("ncrs.evidenceFileCount", { count: (selected.evidence || []).length })}</p>
            {selected.evidenceUploadStatus === "pending" ||
            (selected.evidence || []).some((item) => item.uploadStatus === "pending" || !evidencePreviewUrl(item)) ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">{NCR_EVIDENCE_PENDING_MESSAGE}</p>
            ) : null}
            {selected.evidenceUploadStatus === "failed" ||
            (selected.evidence || []).some((item) => item.uploadStatus === "failed") ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">{NCR_EVIDENCE_FAILED_MESSAGE}</p>
            ) : null}
            {(selected.evidence || []).length > 0 ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(selected.evidence || []).map((item) => {
                  const url = evidencePreviewUrl(item);
                  const isImage =
                    Boolean(url) &&
                    (/\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(item.name) ||
                      String(item.mimeType || "").startsWith("image/") ||
                      url.startsWith("blob:"));
                  const pending = !url || item.uploadStatus === "pending";
                  return (
                    <div key={item.id || item.name} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      {isImage && url ? (
                        <img src={url} alt={item.name} className="h-24 w-full rounded-lg object-cover" />
                      ) : pending ? (
                        <div className="flex h-24 items-center justify-center rounded-lg bg-amber-50 text-center text-[11px] font-semibold text-amber-900">
                          {NCR_EVIDENCE_PENDING_MESSAGE}
                        </div>
                      ) : null}
                      <p className="mt-1 truncate text-xs font-medium text-slate-700">{item.name || t("ncrs.evidenceFile")}</p>
                      {url && !url.startsWith("blob:") ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-[11px] font-semibold text-slate-700 underline"
                        >
                          {t("ncrs.openEvidence")}
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {canArchiveNcr && archiveCompanyFolderId && selected && onNcrArchived ? (
              <ArchiveRecordButton
                recordType="ncr"
                recordId={selected.reference || selected.id}
                companyFolderId={archiveCompanyFolderId}
                masterSheetId={archiveMasterSheetId}
                offlineMode={archiveOffline}
                canArchive={canArchiveNcr}
                label={t("ncrs.archiveNcr")}
                onArchived={() => onNcrArchived(selected.id)}
                onError={onArchiveError}
                onSuccess={onArchiveSuccess}
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                onSaveProgress(selected.id, {
                  investigationIsoClause: isoClause,
                  investigationNotes,
                  rootCause,
                  correctiveAction,
                  investigationExtraNotes: extraNotes,
                })
              }
              className={`h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${slatePrimaryCtaInteract}`}
            >
              {t("ncrs.saveProgress")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isoClause.trim() || !investigationNotes.trim() || !rootCause.trim() || !correctiveAction.trim()) {
                  return;
                }
                onComplete(selected.id, {
                  investigationIsoClause: isoClause,
                  investigationNotes,
                  rootCause,
                  correctiveAction,
                  investigationExtraNotes: extraNotes,
                });
              }}
              className={`h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
            >
              {t("ncrs.ncrComplete")}
            </button>
          </div>
        </section>
      )}
      {canViewCompletedReports && (
        <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">{t("ncrs.completedReportsTitle")}</h3>
          <div className="mt-2 space-y-2">
            {completed.length === 0 ? (
              <EmptyPanel
                title={t("ncrs.noCompleted")}
                text={t("ncrs.completedReportsEmpty")}
              />
            ) : (
              completed.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm text-slate-700">{item.reference} - {item.site} - {item.completedByName || "-"}</p>
                  <button type="button" onClick={() => onExportReport(item)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">{t("ncrs.printExport")}</button>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

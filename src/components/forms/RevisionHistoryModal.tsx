import { useEffect, useState } from "react";
import {
  listAuditTemplateRevisions,
  restoreAuditTemplateAsRevision,
  type AuditTemplateRevisionSummary,
} from "../../services/auditBuilderService";

type RevisionHistoryModalProps = {
  open: boolean;
  templateId: string;
  templateName: string;
  formNumber?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  canRestoreAsRevision?: boolean;
  onClose: () => void;
  onViewRevision?: (revisionId: string) => void;
  onRestoredAsRevision?: (templateId: string) => void;
};

function formatWhen(value?: string) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return value;
  }
}

export function RevisionHistoryModal({
  open,
  templateId,
  templateName,
  formNumber = "",
  companyFolderId,
  masterSheetId,
  canRestoreAsRevision = false,
  onClose,
  onViewRevision,
  onRestoredAsRevision,
}: RevisionHistoryModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revisions, setRevisions] = useState<AuditTemplateRevisionSummary[]>([]);
  const [resolvedFormNumber, setResolvedFormNumber] = useState(formNumber);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const result = await listAuditTemplateRevisions(templateId, {
          companyFolderId,
          masterSheetId,
          formNumber,
        });
        if (cancelled) return;
        setRevisions(result.revisions);
        setResolvedFormNumber(result.formNumber || formNumber);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load revision history.");
        setRevisions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, templateId, formNumber, companyFolderId, masterSheetId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Revision History</h3>
          <p className="mt-1 text-sm text-slate-600">{templateName}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500" data-testid="revision-history-form-number">
            {resolvedFormNumber || "Form number pending"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <p className="text-sm text-slate-500">Loading revisions…</p> : null}
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
          {!loading && !error && revisions.length === 0 ? (
            <p className="text-sm text-slate-500">No revisions found for this form number.</p>
          ) : null}
          <ul className="space-y-3" data-testid="revision-history-list">
            {revisions.map((revision) => {
              const statusLabel = revision.status
                ? revision.status.charAt(0).toUpperCase() + revision.status.slice(1)
                : "Unknown";
              const superseded = revision.is_superseded || revision.status === "superseded" || revision.status === "archived";
              return (
                <li
                  key={revision.id}
                  data-testid="revision-history-row"
                  data-revision={revision.revision_number}
                  data-active={revision.is_active ? "true" : "false"}
                  className={[
                    "rounded-2xl border px-4 py-3",
                    revision.is_active
                      ? "border-emerald-300 bg-emerald-50/70"
                      : "border-slate-200 bg-slate-50/80",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          Rev {revision.revision_number} — {statusLabel}
                        </p>
                        {revision.is_active ? (
                          <span className="rounded-full bg-emerald-600/12 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                            Active
                          </span>
                        ) : null}
                        {superseded ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                            {revision.status === "archived" ? "Archived" : "Superseded"}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-700">{revision.template_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {revision.form_number} · {revision.revision_label || `Rev ${revision.revision_number}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Created/Revised: {formatWhen(revision.updated_at || revision.created_at)}
                        {revision.created_by ? ` · by ${revision.created_by}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Reason: {revision.revision_reason || revision.copy_reason || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {onViewRevision ? (
                        <button
                          type="button"
                          onClick={() => onViewRevision(revision.id)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                        >
                          View
                        </button>
                      ) : null}
                      {canRestoreAsRevision && superseded ? (
                        <button
                          type="button"
                          disabled={busyId === revision.id}
                          onClick={() => {
                            void (async () => {
                              setBusyId(revision.id);
                              setError("");
                              try {
                                const restored = await restoreAuditTemplateAsRevision(revision.id, {
                                  companyFolderId,
                                  masterSheetId,
                                  reason: `Restored as new revision from Rev ${revision.revision_number}`,
                                });
                                onRestoredAsRevision?.(restored.id);
                                onClose();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Unable to restore as a new revision.");
                              } finally {
                                setBusyId("");
                              }
                            })();
                          }}
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {busyId === revision.id ? "Restoring…" : "Restore as new revision"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

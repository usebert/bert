import type { DocumentRevision } from "../../types/documentControl";

type Props = {
  revision: DocumentRevision;
  canApprove: boolean;
  canManage: boolean;
  saving: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
};

export function ApprovalPanel({ revision, canApprove, canManage, saving, onSubmit, onApprove, onReject }: Props) {
  const status = revision.revisionStatus;
  const showSubmit = canManage && (status === "draft" || status === "rejected");
  const showApproveReject = canApprove && status === "awaiting_approval";

  if (!showSubmit && !showApproveReject) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        Revision {revision.revision} — {status.replace(/_/g, " ")}
      </p>
      {revision.changeSummary ? <p className="mt-1 text-sm text-slate-700">{revision.changeSummary}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {showSubmit ? (
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={onSubmit}
          >
            Submit for approval
          </button>
        ) : null}
        {showApproveReject ? (
          <>
            <button
              type="button"
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={saving}
              onClick={onApprove}
            >
              Approve & publish
            </button>
            <button
              type="button"
              className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-800 disabled:opacity-50"
              disabled={saving}
              onClick={() => {
                const reason = window.prompt("Rejection reason (optional):") || "";
                onReject(reason);
              }}
            >
              Reject
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

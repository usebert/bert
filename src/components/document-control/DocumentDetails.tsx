import type { ControlledDocument, DocumentRevision } from "../../types/documentControl";
import { ApprovalPanel } from "./ApprovalPanel";
import { NewRevisionForm, EMPTY_REVISION_FORM, type NewRevisionFormState } from "./NewRevisionForm";
import { RevisionHistory } from "./RevisionHistory";

type Props = {
  document: ControlledDocument;
  revisions: DocumentRevision[];
  currentRevision?: DocumentRevision | null;
  canManage: boolean;
  canApprove: boolean;
  canViewSuperseded: boolean;
  saving: boolean;
  showNewRevision: boolean;
  revisionForm: NewRevisionFormState;
  onRevisionFormChange: (patch: Partial<NewRevisionFormState>) => void;
  onClose: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onStartNewRevision: () => void;
  onCancelNewRevision: () => void;
  onSaveNewRevision: () => void;
  onSubmitRevision: (revisionId: string) => void;
  onApproveRevision: (revisionId: string) => void;
  onRejectRevision: (revisionId: string, reason: string) => void;
  onOpenFile: (revision: DocumentRevision) => void;
};

function formatDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function DocumentDetails({
  document,
  revisions,
  currentRevision,
  canManage,
  canApprove,
  canViewSuperseded,
  saving,
  showNewRevision,
  revisionForm,
  onRevisionFormChange,
  onClose,
  onArchive,
  onRestore,
  onStartNewRevision,
  onCancelNewRevision,
  onSaveNewRevision,
  onSubmitRevision,
  onApproveRevision,
  onRejectRevision,
  onOpenFile,
}: Props) {
  const pendingRevision =
    revisions.find((rev) => rev.revisionStatus === "awaiting_approval" || rev.revisionStatus === "draft") || null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{document.documentNumber}</p>
          <h2 className="text-lg font-semibold text-slate-900">{document.title}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {document.documentType.replace(/_/g, " ")} · {document.department} · {document.primaryStandard}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Owner</dt>
          <dd>{document.ownerName || document.ownerEmail || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Status</dt>
          <dd>{document.documentStatus.replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Current revision</dt>
          <dd>{document.currentRevision || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Clauses</dt>
          <dd>{document.clauseReferences.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Issue / effective</dt>
          <dd>
            {formatDate(document.issueDate)} / {formatDate(document.effectiveDate)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Next review</dt>
          <dd>{formatDate(document.nextReviewDate)}</dd>
        </div>
      </dl>

      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {document.documentStatus !== "archived" ? (
            <>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                onClick={onStartNewRevision}
                disabled={showNewRevision}
              >
                New revision
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                onClick={onArchive}
                disabled={saving}
              >
                Archive
              </button>
            </>
          ) : canApprove ? (
            <button
              type="button"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              onClick={onRestore}
              disabled={saving}
            >
              Restore
            </button>
          ) : null}
          {currentRevision?.fileUrl ? (
            <button
              type="button"
              className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800"
              onClick={() => currentRevision && onOpenFile(currentRevision)}
            >
              Open current file
            </button>
          ) : null}
        </div>
      ) : currentRevision?.fileUrl ? (
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800"
            onClick={() => onOpenFile(currentRevision)}
          >
            Open document
          </button>
        </div>
      ) : null}

      {pendingRevision ? (
        <div className="mt-4">
          <ApprovalPanel
            revision={pendingRevision}
            canApprove={canApprove}
            canManage={canManage}
            saving={saving}
            onSubmit={() => onSubmitRevision(pendingRevision.revisionId)}
            onApprove={() => onApproveRevision(pendingRevision.revisionId)}
            onReject={(reason) => onRejectRevision(pendingRevision.revisionId, reason)}
          />
        </div>
      ) : null}

      {showNewRevision ? (
        <div className="mt-4">
          <NewRevisionForm
            documentTitle={document.title}
            form={revisionForm}
            onChange={onRevisionFormChange}
            saving={saving}
            onCancel={onCancelNewRevision}
            onSave={onSaveNewRevision}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-slate-900">Revision history</h3>
        <div className="mt-2">
          <RevisionHistory
            revisions={revisions}
            currentRevisionId={currentRevision?.revisionId || document.currentRevisionId}
            canViewSuperseded={canViewSuperseded}
            onOpenFile={onOpenFile}
          />
        </div>
      </div>
    </div>
  );
}

export { EMPTY_REVISION_FORM };

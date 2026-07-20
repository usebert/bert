import type { ControlledCompanyDocument, DocumentRevisionRecord } from "../../types/documents";

type Props = {
  document: ControlledCompanyDocument;
  revisions?: DocumentRevisionRecord[];
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 mt-1">{value || "—"}</dd>
    </div>
  );
}

export function DocumentProperties({ document, revisions = [] }: Props) {
  const initialRevision = revisions.find((entry) => entry.isCurrent) || revisions[0];
  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Document Number" value={document.documentNumber} />
        <Field label="Title" value={document.title} />
        <Field label="Description" value={document.description} />
        <Field label="Revision" value={document.currentRevision} />
        <Field label="Status" value={document.status} />
        <Field label="Owner" value={document.ownerName} />
        <Field label="Approver" value={document.approverName} />
        <Field label="ISO Clause" value={document.isoClause} />
        <Field label="Department" value={document.department} />
        <Field label="Issue Date" value={document.issueDate} />
        <Field label="Last Review" value={document.lastReviewDate} />
        <Field label="Next Review" value={document.nextReviewDate} />
        <Field label="Review Frequency (months)" value={document.reviewFrequencyMonths} />
        <Field label="Reminder Days" value={document.reminderDays} />
        <Field label="Keywords" value={document.keywords} />
        <Field label="Folder" value={document.folderPath} />
        <Field label="Created By" value={document.createdByName} />
        <Field label="Created At" value={document.createdAt} />
        <Field label="Last Revised By" value={document.lastRevisedByName} />
        <Field label="Last Revised At" value={document.lastRevisedAt} />
        <Field label="Visibility" value={document.visibility} />
      </dl>
      {initialRevision ? (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
          <h3 className="text-sm font-medium text-slate-900 mb-2">Initial revision record</h3>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Field label="Revision" value={initialRevision.revisionNumber} />
            <Field label="Status" value={initialRevision.status} />
            <Field label="Issue Date" value={initialRevision.issueDate} />
            <Field label="Created By" value={initialRevision.createdByName} />
            <Field label="Change Summary" value={initialRevision.changeSummary} />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

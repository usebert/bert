import { useState } from "react";
import { EmptyPanel } from "../dashboard/DashboardPrimitives";
import { GoogleFormTemplatePanel } from "../admin/GoogleFormTemplatePanel";
import { ArchiveRecordButton } from "../archive/ArchiveRecordButton";
import { CopyAuditFormModal } from "./CopyAuditFormModal";
import { ReviseAuditFormModal } from "./ReviseAuditFormModal";
import { formLanguageLabel } from "../../config/templateLanguages";
import {
  copyAuditBuilderTemplate,
  createAuditTemplateNewVersion,
  getAuditBuilderTemplate,
} from "../../services/auditBuilderService";
import { canArchiveRecordFromClient } from "../../utils/archivePermissions";
import { bertTemplateToEditorDraft } from "../../utils/auditBuilderMapping";
import type { Role } from "../../permissions";
import type { AuditTemplate } from "../../types/reportsScreenProps";
import type {
  CompanyGoogleForm,
  CompanyGoogleFormsDiagnostics,
  CompanyGoogleFormsStatus,
} from "../../services/companyFormsService";

type FormsChecksTemplatesPanelProps = {
  templates: AuditTemplate[];
  syncState: string;
  googleConnected: boolean;
  companyFolderId?: string;
  masterSheetId?: string;
  role?: Role;
  canCreateTemplates: boolean;
  companyGoogleForms?: CompanyGoogleForm[];
  companyGoogleFormsStatus?: CompanyGoogleFormsStatus;
  companyGoogleFormsDiagnostics?: CompanyGoogleFormsDiagnostics | null;
  showGoogleFormsDiagnostics?: boolean;
  onToggleTemplate?: (templateId: string) => void;
  onEditTemplate?: (templateId: string) => void;
  onTemplateCopied?: (templateId: string) => void;
  onTemplateRevised?: (templateId: string) => void;
  onTemplateArchived?: (templateId: string) => void;
  onGoogleFormUpdated?: (templateId: string, record: { googleFormId?: string; googleFormEditUrl?: string; googleFormResponderUrl?: string; syncStatus?: string; currentDriveFolderName?: string }) => void;
};

function workspaceGuidance(syncState: string, googleConnected: boolean) {
  if (!googleConnected) {
    return {
      title: "Connect Google first",
      text: "Open Workspace, connect Google, link your company folder, then sync templates so forms and checks appear here.",
    };
  }
  if (syncState !== "Synced") {
    return {
      title: "Workspace not linked yet",
      text: "In Workspace, link your company folder and master workbook, then use Populate app to sync audit templates from Drive.",
    };
  }
  return {
    title: "No form or check templates yet",
    text: "Create a BERT template here, or sync Google Drive audit forms from Workspace after linking the audit forms folder.",
  };
}

function templateRevisionLabel(template: AuditTemplate) {
  if (template.revisionLabel) return template.revisionLabel;
  const revision = Number(template.revisionNumber || 1) || 1;
  const status = String(template.status || (template.active ? "active" : "inactive"));
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  if (template.formNumber) {
    return `${template.formNumber} · Rev ${revision} · ${statusLabel}`;
  }
  return `Rev ${revision} · ${statusLabel}`;
}

function CompanyGoogleFormsSection({
  forms,
  status,
  diagnostics,
  showDiagnostics,
}: {
  forms: CompanyGoogleForm[];
  status: CompanyGoogleFormsStatus;
  diagnostics?: CompanyGoogleFormsDiagnostics | null;
  showDiagnostics?: boolean;
}) {
  if (status === "idle" || status === "loading") {
    return null;
  }

  let message = "";
  if (status === "permission_denied") {
    message = "BERT cannot access the Google Forms folder.";
  } else if (status === "folder_not_found") {
    message = "Google Forms folder could not be found.";
  } else if (status === "empty") {
    message = "No Google Forms found in this company folder.";
  }

  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Google Forms</p>
          <p className="mt-1 text-xs text-slate-500">
            Live audit forms stored in this company&apos;s Google Forms folder (not master templates).
          </p>
        </div>
        {status === "found" ? (
          <span className="rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-800">
            {forms.length} form{forms.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {message ? (
        <p
          className={[
            "mt-3 text-sm",
            status === "empty" ? "text-slate-600" : "text-amber-800",
          ].join(" ")}
        >
          {message}
        </p>
      ) : null}

      {status === "found" && forms.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {forms.map((form) => (
            <li
              key={form.driveFileId || form.formId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{form.name}</p>
                {form.folderPath ? (
                  <p className="truncate text-xs text-slate-500">{form.folderPath}</p>
                ) : null}
              </div>
              {form.webViewLink ? (
                <a
                  href={form.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-900"
                >
                  Open in Drive
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {showDiagnostics && diagnostics ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700">
          <p>companyFolderId: {diagnostics.companyFolderId || "—"}</p>
          <p>googleFormsFolderId: {diagnostics.googleFormsFolderId || "—"}</p>
          <p>driveQuery: {diagnostics.driveQuery || "—"}</p>
          <p>formsFound: {diagnostics.formsFound ?? 0}</p>
          {diagnostics.permissionError ? <p>permissionError: {diagnostics.permissionError}</p> : null}
          {diagnostics.resolvedVia ? <p>resolvedVia: {diagnostics.resolvedVia}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function FormsChecksTemplatesPanel({
  templates,
  syncState,
  googleConnected,
  companyFolderId,
  masterSheetId,
  role,
  canCreateTemplates,
  companyGoogleForms = [],
  companyGoogleFormsStatus = "idle",
  companyGoogleFormsDiagnostics = null,
  showGoogleFormsDiagnostics = false,
  onToggleTemplate,
  onEditTemplate,
  onTemplateCopied,
  onTemplateRevised,
  onTemplateArchived,
  onGoogleFormUpdated,
}: FormsChecksTemplatesPanelProps) {
  const guidance = workspaceGuidance(syncState, googleConnected);
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));
  const showGoogleFormsSection =
    companyGoogleFormsStatus !== "idle" && companyGoogleFormsStatus !== "loading";
  const canManageRevisions = Boolean(canCreateTemplates && role && role !== "Auditor");
  const canArchive = Boolean(role && canArchiveRecordFromClient(role, "audit") && companyFolderId);

  const [copyTarget, setCopyTarget] = useState<AuditTemplate | null>(null);
  const [reviseTarget, setReviseTarget] = useState<AuditTemplate | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [reviseBusy, setReviseBusy] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [reviseError, setReviseError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const handleCopySubmit = async (input: {
    title: string;
    reason: string;
    confirmArchivedTitle?: boolean;
  }) => {
    if (!copyTarget) return;
    if (!input.title.trim()) {
      setCopyError("Enter a title for the copied form.");
      return;
    }
    setCopyBusy(true);
    setCopyError("");
    try {
      const record = await copyAuditBuilderTemplate(
        copyTarget.id,
        {
          title: input.title,
          reason: input.reason,
          confirmArchivedTitle: input.confirmArchivedTitle,
        },
        { companyFolderId, masterSheetId },
      );
      setCopyTarget(null);
      setActionSuccess("Copy created.");
      onTemplateCopied?.(record.id);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Unable to copy template.");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleReviseSubmit = async (input: { reason: string }) => {
    if (!reviseTarget) return;
    if (!input.reason.trim()) {
      setReviseError("Enter a reason for this revision.");
      return;
    }
    setReviseBusy(true);
    setReviseError("");
    try {
      let draft;
      try {
        const loaded = await getAuditBuilderTemplate(reviseTarget.id, { masterSheetId, companyFolderId });
        draft = {
          template_name: loaded.template_name,
          description: loaded.description,
          category: loaded.category,
          sections: loaded.sections,
          status: loaded.status || "active",
          reason: input.reason,
        };
      } catch {
        const converted = bertTemplateToEditorDraft(reviseTarget);
        draft = {
          ...converted,
          status: reviseTarget.active ? ("active" as const) : ("inactive" as const),
          reason: input.reason,
        };
      }
      const record = await createAuditTemplateNewVersion(reviseTarget.id, draft, {
        companyFolderId,
        masterSheetId,
      });
      setReviseTarget(null);
      setActionSuccess("Revision created.");
      onTemplateRevised?.(record.id);
    } catch (err) {
      setReviseError(err instanceof Error ? err.message : "Unable to create revision.");
    } finally {
      setReviseBusy(false);
    }
  };

  if (sorted.length === 0 && !showGoogleFormsSection) {
    return (
      <EmptyPanel
        title={guidance.title}
        text={
          canCreateTemplates
            ? `${guidance.text} Use Create form/check template to open the BERT template builder.`
            : guidance.text
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {showGoogleFormsSection ? (
        <CompanyGoogleFormsSection
          forms={companyGoogleForms}
          status={companyGoogleFormsStatus}
          diagnostics={companyGoogleFormsDiagnostics}
          showDiagnostics={showGoogleFormsDiagnostics}
        />
      ) : null}

      {actionSuccess ? <p className="text-sm font-medium text-emerald-700">{actionSuccess}</p> : null}

      {sorted.length === 0 ? (
        <EmptyPanel
          title={guidance.title}
          text={
            canCreateTemplates
              ? `${guidance.text} Use Create form/check template to open the BERT template builder.`
              : guidance.text
          }
        />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {templates.filter((item) => item.active).length} active template
            {templates.filter((item) => item.active).length === 1 ? "" : "s"} in this workspace. Schedules control when checks
            run. When you create a Google Form copy here, it is stored in this company&apos;s{" "}
            <span className="font-medium text-slate-800">08 - Audits / Google Forms</span> folder. BERT remains the live
            operational system.
          </p>
          {sorted.map((template) => (
            <div
              key={template.id}
              data-testid="audit-form-template-card"
              className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-700" data-testid="audit-form-revision-label">
                    {templateRevisionLabel(template)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {template.source}
                    {template.category ? ` • ${template.category}` : ""} • {formLanguageLabel(template.language || "en")}
                    {template.translationStatus && template.language !== "en"
                      ? ` • ${template.translationStatus}`
                      : ""}{" "}
                    • {template.questions.length} question
                    {template.questions.length === 1 ? "" : "s"}
                  </p>
                  {template.googleForm?.formId ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Google Form copy: {template.googleForm.syncStatus || "linked"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">BERT template only — no Google Form copy yet</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {onEditTemplate ? (
                    <button
                      type="button"
                      onClick={() => onEditTemplate(template.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      Edit
                    </button>
                  ) : null}
                  {canManageRevisions ? (
                    <button
                      type="button"
                      data-testid="audit-form-revise-button"
                      onClick={() => {
                        setReviseError("");
                        setActionSuccess("");
                        setReviseTarget(template);
                      }}
                      title="You are creating a new revision of this controlled form."
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                    >
                      Revise
                    </button>
                  ) : null}
                  {canManageRevisions ? (
                    <button
                      type="button"
                      data-testid="audit-form-copy-button"
                      onClick={() => {
                        setCopyError("");
                        setActionSuccess("");
                        setCopyTarget(template);
                      }}
                      title="You are creating a new form based on this one. It will get its own form number and start at Rev 1."
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                    >
                      Copy
                    </button>
                  ) : null}
                  {canArchive ? (
                    <ArchiveRecordButton
                      recordType="audit"
                      recordId={template.id}
                      companyFolderId={companyFolderId || ""}
                      masterSheetId={masterSheetId}
                      canArchive
                      label="Archive"
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                      onArchived={() => onTemplateArchived?.(template.id)}
                    />
                  ) : null}
                  {onToggleTemplate ? (
                    <button
                      type="button"
                      onClick={() => onToggleTemplate(template.id)}
                      className={[
                        "rounded-xl px-3 py-2 text-xs font-semibold",
                        template.active ? "bg-blue-500/12 text-blue-800" : "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {template.active ? "Active" : "Inactive"}
                    </button>
                  ) : null}
                </div>
              </div>
              <GoogleFormTemplatePanel
                templateId={template.id}
                templateName={template.name}
                category={template.category || "General"}
                companyFolderId={companyFolderId}
                placement="company"
                googleForm={template.googleForm}
                templateLanguage={template.language}
                translationStatus={template.translationStatus}
                onGoogleFormUpdated={(record) =>
                  onGoogleFormUpdated?.(template.id, {
                    googleFormId: record.googleFormId,
                    googleFormEditUrl: record.googleFormEditUrl,
                    googleFormResponderUrl: record.googleFormResponderUrl,
                    syncStatus: record.syncStatus,
                    currentDriveFolderName: record.currentDriveFolderName,
                  })
                }
              />
            </div>
          ))}
        </>
      )}

      <CopyAuditFormModal
        open={Boolean(copyTarget)}
        sourceTitle={copyTarget?.name || ""}
        mode="form"
        busy={copyBusy}
        error={copyError}
        onCancel={() => {
          if (!copyBusy) setCopyTarget(null);
        }}
        onSubmit={(input) => void handleCopySubmit(input)}
      />
      <ReviseAuditFormModal
        open={Boolean(reviseTarget)}
        sourceTitle={reviseTarget?.name || ""}
        revisionLabel={reviseTarget ? templateRevisionLabel(reviseTarget) : ""}
        busy={reviseBusy}
        error={reviseError}
        onCancel={() => {
          if (!reviseBusy) setReviseTarget(null);
        }}
        onSubmit={(input) => void handleReviseSubmit(input)}
      />
    </div>
  );
}

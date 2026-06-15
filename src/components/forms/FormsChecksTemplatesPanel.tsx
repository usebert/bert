import { EmptyPanel } from "../dashboard/DashboardPrimitives";
import { GoogleFormTemplatePanel } from "../admin/GoogleFormTemplatePanel";
import { formLanguageLabel } from "../../config/templateLanguages";
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
  canCreateTemplates: boolean;
  companyGoogleForms?: CompanyGoogleForm[];
  companyGoogleFormsStatus?: CompanyGoogleFormsStatus;
  companyGoogleFormsDiagnostics?: CompanyGoogleFormsDiagnostics | null;
  showGoogleFormsDiagnostics?: boolean;
  onToggleTemplate?: (templateId: string) => void;
  onEditTemplate?: (templateId: string) => void;
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
  canCreateTemplates,
  companyGoogleForms = [],
  companyGoogleFormsStatus = "idle",
  companyGoogleFormsDiagnostics = null,
  showGoogleFormsDiagnostics = false,
  onToggleTemplate,
  onEditTemplate,
  onGoogleFormUpdated,
}: FormsChecksTemplatesPanelProps) {
  const guidance = workspaceGuidance(syncState, googleConnected);
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));
  const showGoogleFormsSection =
    companyGoogleFormsStatus !== "idle" && companyGoogleFormsStatus !== "loading";

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
            <div key={template.id} className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
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
    </div>
  );
}

import { EmptyPanel } from "../dashboard/DashboardPrimitives";
import { GoogleFormTemplatePanel } from "../admin/GoogleFormTemplatePanel";
import { formLanguageLabel } from "../../config/templateLanguages";
import type { AuditTemplate } from "../../types/reportsScreenProps";

type FormsChecksTemplatesPanelProps = {
  templates: AuditTemplate[];
  syncState: string;
  googleConnected: boolean;
  companyFolderId?: string;
  canCreateTemplates: boolean;
  onToggleTemplate?: (templateId: string) => void;
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

export function FormsChecksTemplatesPanel({
  templates,
  syncState,
  googleConnected,
  companyFolderId,
  canCreateTemplates,
  onToggleTemplate,
  onGoogleFormUpdated,
}: FormsChecksTemplatesPanelProps) {
  const guidance = workspaceGuidance(syncState, googleConnected);
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));

  if (sorted.length === 0) {
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
            {onToggleTemplate ? (
              <button
                type="button"
                onClick={() => onToggleTemplate(template.id)}
                className={[
                  "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold",
                  template.active ? "bg-blue-500/12 text-blue-800" : "bg-slate-100 text-slate-700",
                ].join(" ")}
              >
                {template.active ? "Active" : "Inactive"}
              </button>
            ) : null}
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
    </div>
  );
}

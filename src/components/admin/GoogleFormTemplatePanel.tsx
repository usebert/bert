import { useCallback, useEffect, useState } from "react";
import {
  COMPANY_GOOGLE_FORM_STORAGE_PATH,
  googleFormTemplatesService,
  type GoogleFormTemplatePlacement,
  type GoogleFormTemplateRecord,
} from "../../services/googleFormTemplatesService";

type Props = {
  templateId: string;
  templateName: string;
  category: string;
  companyFolderId?: string;
  placement?: GoogleFormTemplatePlacement;
  googleForm?: {
    formId?: string;
    syncStatus?: string;
    editUrl?: string;
    responderUrl?: string;
    folderName?: string;
    folderPath?: string;
  };
  onGoogleFormUpdated?: (record: GoogleFormTemplateRecord) => void;
};

export function GoogleFormTemplatePanel({
  templateId,
  templateName,
  category,
  companyFolderId,
  placement = "master",
  googleForm,
  onGoogleFormUpdated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<GoogleFormTemplateRecord | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      const payload = await googleFormTemplatesService.getLinks(templateId);
      if (payload.ok && payload.template) {
        setRecord(payload.template);
        onGoogleFormUpdated?.(payload.template);
      }
    } finally {
      setLoading(false);
    }
  }, [onGoogleFormUpdated, templateId]);

  useEffect(() => {
    if (googleForm?.formId) {
      void refresh();
      return;
    }
    setRecord(null);
  }, [googleForm?.formId, refresh]);

  const editUrl = record?.googleFormEditUrl || googleForm?.editUrl || "";
  const responderUrl = record?.googleFormResponderUrl || googleForm?.responderUrl || "";
  const syncStatus = record?.syncStatus || googleForm?.syncStatus || "";
  const folderName = record?.currentDriveFolderName || googleForm?.folderName || "";
  const storedFolderPath =
    record?.currentFolderPath ||
    googleForm?.folderPath ||
    (placement === "company" ? COMPANY_GOOGLE_FORM_STORAGE_PATH : "");

  if (!googleForm?.formId && !record?.googleFormId) {
    return null;
  }

  const copyLink = async (url: string, label: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`${label} copied`);
    } catch {
      setMessage(`Copy ${label} manually from the link below`);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Google Form copy</p>
          <p className="text-sm font-semibold text-slate-900">{templateName}</p>
          {syncStatus ? <p className="text-xs text-slate-500">Sync: {syncStatus}</p> : null}
          {storedFolderPath ? (
            <p className="text-xs text-slate-500">Stored in: {storedFolderPath}</p>
          ) : folderName ? (
            <p className="text-xs text-slate-500">Folder: {folderName}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {editUrl ? (
            <a
              href={editUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Open Google Form
            </a>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyLink(editUrl, "Edit link")}
          className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Copy edit link
        </button>
        <button
          type="button"
          onClick={() => void copyLink(responderUrl, "Responder link")}
          className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Copy responder link
        </button>
        {placement === "master" ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void googleFormTemplatesService
                .moveToTemplateFolder(templateId, { category })
                .then((payload) => {
                  if (payload.ok && payload.template) {
                    setRecord(payload.template);
                    onGoogleFormUpdated?.(payload.template);
                    setMessage("Moved to template folder");
                  } else {
                    setMessage(payload.error || "Move failed");
                  }
                })
                .finally(() => setLoading(false));
            }}
            className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Move to template folder
          </button>
        ) : null}
        {placement === "master" && companyFolderId ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void googleFormTemplatesService
                .copyToCompanyFolder(templateId, companyFolderId)
                .then((payload) => {
                  if (payload.ok) {
                    setMessage("Copied to company folder");
                  } else {
                    setMessage(payload.error || "Copy failed");
                  }
                })
                .finally(() => setLoading(false));
            }}
            className="rounded-xl bg-blue-500/12 px-3 py-2 text-xs font-semibold text-blue-800"
          >
            Copy to company folder
          </button>
        ) : null}
      </div>
      {message ? <p className="mt-2 text-xs text-slate-500">{message}</p> : null}
      {record?.notes ? <p className="mt-1 text-xs text-amber-800">{record.notes}</p> : null}
    </div>
  );
}

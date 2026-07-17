import { useState } from "react";
import { useTranslation } from "react-i18next";
import { connectGodmodeCompanyFolder, type ConnectedCompanyFolder } from "../../services/godmodeService";
import { BERT_LIGHT_SURFACE } from "../../styles/bertText";

function extractFolderId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const direct = trimmed.match(/^[A-Za-z0-9_-]{20,}$/);
  if (direct) return direct[0];
  const pathMatch = trimmed.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (pathMatch?.[1]) return pathMatch[1];
  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const idParam = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return idParam?.[1] || trimmed;
}

type Props = {
  googleConnected: boolean;
  onConnected?: (company: ConnectedCompanyFolder) => void;
};

export function GodmodeConnectCompanyFolderPanel({ googleConnected, onConnected }: Props) {
  const { t } = useTranslation();
  const [folderInput, setFolderInput] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConnectedCompanyFolder | null>(null);

  const folderId = extractFolderId(folderInput);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!folderId) {
      setError("Paste a Google Drive company folder link or ID.");
      return;
    }
    if (!adminEmail.trim() || !adminPassword.trim()) {
      setError("First admin email and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await connectGodmodeCompanyFolder({
        companyFolderId: folderId,
        companyName: companyName.trim() || undefined,
        admin: {
          email: adminEmail.trim(),
          name: adminName.trim() || adminEmail.trim(),
          password: adminPassword,
        },
      });
      if (!response.ok || !response.company) {
        setError(response.error || "Could not connect company folder.");
        return;
      }
      setResult(response.company);
      onConnected?.(response.company);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not connect company folder.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`${BERT_LIGHT_SURFACE} space-y-4 rounded-2xl border border-slate-200 p-5`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Folder-first bootstrap</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">{t("godmode.connectCompanyFolder")}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Point BERT at a Google Drive company folder. BERT creates or links the workbook inside the folder, prepares
          required tabs, and can seed the first active admin in the Users tab.
        </p>
      </div>

      {!googleConnected ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Connect Google Workspace in Platform setup before connecting a company folder.
        </p>
      ) : null}

      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.companyFolderLink")}
          </label>
          <input
            value={folderInput}
            onChange={(event) => setFolderInput(event.target.value)}
            placeholder="Paste Google Drive folder link or ID"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            disabled={submitting}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.companyNameOptional")}
          </label>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Overrides Drive folder name when set"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            disabled={submitting}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t("godmode.firstAdminEmail")}
            </label>
            <input
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="admin@company.test"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t("godmode.firstAdminName")}
            </label>
            <input
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              placeholder="Company Admin"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
              disabled={submitting}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("godmode.firstAdminPassword")}
          </label>
          <input
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            placeholder="Set an initial password"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-300"
            disabled={submitting}
            required
          />
        </div>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {result ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <p className="font-semibold">{t("godmode.companyUsable")}</p>
            <p className="mt-1 break-all text-xs">
              {result.companyName || "Company"} · folder {result.companyFolderId} · workbook {result.workbookId}
            </p>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={!googleConnected || submitting}
          className="h-11 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? t("godmode.connecting") : t("godmode.connectCompanyFolder")}
        </button>
      </form>
    </section>
  );
}

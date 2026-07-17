import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  extraMessage?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
};

export function ArchiveConfirmDialog({ open, extraMessage, submitting = false, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-dialog-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <h2 id="archive-dialog-title" className="text-lg font-black text-slate-900">
          {t("archiveCentre.archiveThisItem")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("archiveCentre.archiveConfirmBody")}</p>
        {extraMessage ? <p className="mt-2 text-sm text-slate-600">{extraMessage}</p> : null}
        <label className="mt-4 block text-sm font-semibold text-slate-700">
          {t("archiveCentre.archiveReason")}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("archiveCentre.optional")}
            className="mt-2 min-h-[5rem] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onConfirm(reason.trim())}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-60"
          >
            {t("nav.archive")}
          </button>
        </div>
      </div>
    </div>
  );
}

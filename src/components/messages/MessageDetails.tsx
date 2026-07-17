import { useTranslation } from "react-i18next";
import type { OperationalMessage } from "../../types/operationalMessages";

type Props = {
  message: OperationalMessage;
  busy?: boolean;
  onRead: (message: OperationalMessage) => void;
  onArchive: (message: OperationalMessage) => void;
  onOpenLolerEquipment?: (equipmentId: string) => void;
};

function formatSentAt(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "—";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function MessageDetails({ message, busy = false, onRead, onArchive, onOpenLolerEquipment }: Props) {
  const { t } = useTranslation();

  return (
    <article
      className={`rounded-xl border p-3 ${
        message.status === "unread" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{message.subject}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("messages.from")} {message.senderName || message.senderEmail || "—"} · {formatSentAt(message.sentAt)}
            {message.status === "unread" ? ` · ${t("messages.unread")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {message.status === "unread" ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
              disabled={busy}
              onClick={() => onRead(message)}
            >
              {t("messages.markRead")}
            </button>
          ) : null}
          {message.relatedEquipmentId && onOpenLolerEquipment ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
              onClick={() => onOpenLolerEquipment(message.relatedEquipmentId || "")}
            >
              {t("messages.openLoler")}
            </button>
          ) : null}
          {message.status !== "archived" ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-500"
              disabled={busy}
              onClick={() => onArchive(message)}
            >
              {t("messages.archive")}
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.messageBody}</p>
      {message.relatedEquipmentId ? (
        <p className="mt-1 text-xs text-slate-500">
          {t("messages.linkedEquipment")} {message.relatedEquipmentId}
        </p>
      ) : null}
    </article>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { OperationalMessage } from "../../types/operationalMessages";
import {
  archiveOperationalMessage,
  fetchOperationalMessages,
  markOperationalMessageRead,
  MESSAGES_OFFLINE_WRITE_MESSAGE,
  readCachedOperationalMessages,
} from "../../services/operationalMessagesService";

type Props = {
  companyFolderId: string;
  offlineMode?: boolean;
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

export function OperationalMessagesPanel({ companyFolderId, offlineMode = false, onOpenLolerEquipment }: Props) {
  const folderId = String(companyFolderId || "").trim();
  const cached = readCachedOperationalMessages(folderId);
  const [messages, setMessages] = useState<OperationalMessage[]>(cached?.messages || []);
  const [unread, setUnread] = useState(cached?.summary?.unread || 0);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    if (!folderId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchOperationalMessages(folderId, { refresh: true });
      setMessages(payload.messages || []);
      setUnread(payload.summary?.unread || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guardWrite = () => {
    if (offlineMode || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      setError(MESSAGES_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  };

  const onRead = async (message: OperationalMessage) => {
    if (!guardWrite()) {
      return;
    }
    setBusyId(message.messageId);
    try {
      await markOperationalMessageRead(folderId, message.messageId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark message read.");
    } finally {
      setBusyId("");
    }
  };

  const onArchive = async (message: OperationalMessage) => {
    if (!guardWrite()) {
      return;
    }
    setBusyId(message.messageId);
    try {
      await archiveOperationalMessage(folderId, message.messageId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive message.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-slate-900">Messages</h2>
          <p className="text-sm text-slate-600">
            {unread > 0 ? `${unread} unread operational message${unread === 1 ? "" : "s"}` : "No unread messages"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-slate-500">Loading messages…</p> : null}
      <div className="mt-3 space-y-2">
        {messages.length === 0 && !loading ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No messages yet.
          </p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.messageId}
            className={`rounded-xl border p-3 ${
              message.status === "unread" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{message.subject}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  From {message.senderName || message.senderEmail || "—"} · {formatSentAt(message.sentAt)}
                  {message.status === "unread" ? " · Unread" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {message.status === "unread" ? (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                    disabled={busyId === message.messageId}
                    onClick={() => void onRead(message)}
                  >
                    Mark read
                  </button>
                ) : null}
                {message.relatedEquipmentId && onOpenLolerEquipment ? (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                    onClick={() => onOpenLolerEquipment(message.relatedEquipmentId || "")}
                  >
                    Open LOLER
                  </button>
                ) : null}
                {message.status !== "archived" ? (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-500"
                    disabled={busyId === message.messageId}
                    onClick={() => void onArchive(message)}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.messageBody}</p>
            {message.relatedEquipmentId ? (
              <p className="mt-1 text-xs text-slate-500">Linked LOLER equipment: {message.relatedEquipmentId}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

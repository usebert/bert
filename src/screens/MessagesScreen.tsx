import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OperationalMessage } from "../types/operationalMessages";
import {
  archiveOperationalMessage,
  fetchOperationalMessages,
  markOperationalMessageRead,
  MESSAGES_OFFLINE_WRITE_MESSAGE,
  readCachedOperationalMessages,
} from "../services/operationalMessagesService";
import { MessageList } from "../components/messages/MessageList";

type Props = {
  companyFolderId: string;
  offlineMode?: boolean;
  onOpenLolerEquipment?: (equipmentId: string) => void;
};

/**
 * Operational messages inbox coordinator.
 * Embedded from LOLER (messages tab); no dedicated nav item.
 */
export function MessagesScreen({ companyFolderId, offlineMode = false, onOpenLolerEquipment }: Props) {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t("errors.tryAgain"));
    } finally {
      setLoading(false);
    }
  }, [folderId, t]);

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
      setError(err instanceof Error ? err.message : t("errors.tryAgain"));
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
      setError(err instanceof Error ? err.message : t("errors.tryAgain"));
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-slate-900">{t("messages.title")}</h2>
          <p className="text-sm text-slate-600">
            {unread > 0
              ? t(unread === 1 ? "messages.unreadCount" : "messages.unreadCount_plural", { count: unread })
              : t("messages.noUnread")}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {t("common.refresh")}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-slate-500">{t("messages.loading")}</p> : null}
      <div className="mt-3">
        {!loading || messages.length > 0 ? (
          <MessageList
            messages={messages}
            busyId={busyId}
            onRead={(message) => void onRead(message)}
            onArchive={(message) => void onArchive(message)}
            onOpenLolerEquipment={onOpenLolerEquipment}
          />
        ) : null}
      </div>
    </section>
  );
}

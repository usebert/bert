import { useTranslation } from "react-i18next";
import type { OperationalMessage } from "../../types/operationalMessages";
import { MessageDetails } from "./MessageDetails";

type Props = {
  messages: OperationalMessage[];
  busyId?: string;
  onRead: (message: OperationalMessage) => void;
  onArchive: (message: OperationalMessage) => void;
  onOpenLolerEquipment?: (equipmentId: string) => void;
};

export function MessageList({ messages, busyId = "", onRead, onArchive, onOpenLolerEquipment }: Props) {
  const { t } = useTranslation();

  if (messages.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        {t("messages.noMessages")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((message) => (
        <MessageDetails
          key={message.messageId}
          message={message}
          busy={busyId === message.messageId}
          onRead={onRead}
          onArchive={onArchive}
          onOpenLolerEquipment={onOpenLolerEquipment}
        />
      ))}
    </div>
  );
}

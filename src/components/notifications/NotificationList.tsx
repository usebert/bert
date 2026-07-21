import { NotificationRow } from "./NotificationRow";
import type { BertNotification, NotificationGroupId } from "../../presentation/notificationPresentation";

type Group = {
  id: NotificationGroupId;
  label: string;
  items: Array<BertNotification & { isUnread: boolean }>;
};

type Props = {
  groups: Group[];
  onOpen: (item: BertNotification) => void;
  onToggleRead: (item: BertNotification) => void;
};

export function NotificationList({ groups, onOpen, onToggleRead }: Props) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h3 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ui-text-muted)]">
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.items.map((item) => (
              <NotificationRow
                key={item.key}
                item={item}
                onOpen={() => onOpen(item)}
                onToggleRead={() => onToggleRead(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

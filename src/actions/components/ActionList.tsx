import type { ActionListItem } from "../types";
import { ActionListCard } from "./ActionListCard";
import { ActionTable } from "./ActionTable";

export function ActionList({
  items,
  onSelect,
  layout = "auto",
}: {
  items: ActionListItem[];
  onSelect: (actionId: string) => void;
  layout?: "auto" | "cards" | "table";
}) {
  if (items.length === 0) return null;

  if (layout === "table") {
    return <ActionTable items={items} onSelect={onSelect} />;
  }

  if (layout === "cards") {
    return (
      <ul className="space-y-3">
        {items.map((item) => (
          <ActionListCard key={item.id} item={item} onSelect={onSelect} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <ul className="space-y-3">
          {items.map((item) => (
            <ActionListCard key={item.id} item={item} onSelect={onSelect} />
          ))}
        </ul>
      </div>
      <div className="hidden md:block">
        <ActionTable items={items} onSelect={onSelect} />
      </div>
    </>
  );
}

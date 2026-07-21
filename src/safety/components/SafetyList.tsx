import type { SafetyListItem } from "../types";
import { SafetyListCard } from "./SafetyListCard";
import { SafetyTable } from "./SafetyTable";

type Props = {
  items: SafetyListItem[];
  onSelect: (id: string) => void;
  onInvestigate?: (id: string, startInvestigation: boolean) => void;
  showInvestigate?: boolean;
  layout?: "auto" | "cards" | "table";
};

export function SafetyList({ items, onSelect, onInvestigate, showInvestigate, layout = "auto" }: Props) {
  if (items.length === 0) return null;

  if (layout === "table") {
    return <SafetyTable items={items} onSelect={onSelect} onInvestigate={onInvestigate} showInvestigate={showInvestigate} />;
  }

  if (layout === "cards") {
    return (
      <ul className="space-y-3">
        {items.map((item) => (
          <SafetyListCard
            key={item.id}
            item={item}
            onSelect={onSelect}
            onInvestigate={onInvestigate}
            showInvestigate={showInvestigate}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <ul className="space-y-3">
          {items.map((item) => (
            <SafetyListCard
              key={item.id}
              item={item}
              onSelect={onSelect}
              onInvestigate={onInvestigate}
              showInvestigate={showInvestigate}
            />
          ))}
        </ul>
      </div>
      <div className="hidden md:block overflow-x-auto">
        <SafetyTable items={items} onSelect={onSelect} onInvestigate={onInvestigate} showInvestigate={showInvestigate} />
      </div>
    </>
  );
}

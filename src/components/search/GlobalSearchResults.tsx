import { SearchResultRow } from "./SearchResultRow";
import type { SearchResultGroup } from "../../presentation/searchPresentation";

type Props = {
  groups: SearchResultGroup[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  emptyLabel?: string;
};

export function GlobalSearchResults({
  groups,
  activeIndex,
  onSelect,
  onHover,
  emptyLabel = "No matching records",
}: Props) {
  if (groups.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-[var(--ui-text-primary)]">{emptyLabel}</p>
      </div>
    );
  }

  let runningIndex = 0;

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const groupStart = runningIndex;
        const rows = group.items.map((item, itemIndex) => {
          const flatIndex = groupStart + itemIndex;
          runningIndex += 1;
          return (
            <SearchResultRow
              key={item.id}
              item={item}
              active={flatIndex === activeIndex}
              onSelect={() => onSelect(flatIndex)}
              onHover={() => onHover(flatIndex)}
            />
          );
        });
        return (
          <section key={group.id} aria-label={group.label}>
            <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ui-text-muted)]">
              {group.label}
            </h3>
            <div className="space-y-1">{rows}</div>
          </section>
        );
      })}
    </div>
  );
}

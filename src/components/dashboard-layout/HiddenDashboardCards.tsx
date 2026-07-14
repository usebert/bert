type HiddenCard = { id: string; label: string };

type Props = {
  open: boolean;
  cards: HiddenCard[];
  onRestore: (cardId: string) => void;
};

export function HiddenDashboardCards({ open, cards, onRestore }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
      <p className="text-sm font-semibold text-slate-900">Hidden cards</p>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No hidden cards.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
            >
              <span className="text-sm font-medium text-slate-800">{card.label}</span>
              <button
                type="button"
                onClick={() => onRestore(card.id)}
                className="inline-flex min-h-10 items-center rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

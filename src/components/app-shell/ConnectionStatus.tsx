import { IconAlert } from "../ui/Icon";

type Props = {
  offline: boolean;
  reconnecting?: boolean;
  compact?: boolean;
};

export function ConnectionStatus({ offline, reconnecting = false, compact = false }: Props) {
  if (!offline && !reconnecting) {
    return compact ? null : (
      <span className="sr-only" aria-live="polite">
        Online
      </span>
    );
  }

  const label = reconnecting ? "Reconnecting…" : "Offline";
  const tone = reconnecting
    ? "bg-sky-500/12 text-sky-800"
    : "bg-amber-500/15 text-amber-700";

  return (
    <span
      className={["inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", tone].join(" ")}
      role="status"
      aria-live="polite"
    >
      <IconAlert size="sm" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

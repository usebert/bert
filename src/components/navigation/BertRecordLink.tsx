import type { SearchNavigateTarget } from "../../presentation/searchPresentation";
import type { DashboardNavTarget } from "../../dashboard/unified/types";

type Props = {
  route: string;
  className?: string;
  children: React.ReactNode;
  onNavigate: (target: SearchNavigateTarget) => void;
  navigate: SearchNavigateTarget;
  showChevron?: boolean;
};

export function BertRecordLink({ route, className = "", children, onNavigate, navigate, showChevron = false }: Props) {
  return (
    <a
      href={route}
      className={[
        "inline-flex items-center gap-1 text-inherit no-underline hover:text-[var(--ui-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus-ring)]",
        className,
      ].join(" ")}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        onNavigate(navigate);
      }}
    >
      <span>{children}</span>
      {showChevron ? <span aria-hidden className="text-[var(--ui-text-muted)]">›</span> : null}
    </a>
  );
}

export function dashboardTargetToNavigate(target: DashboardNavTarget): SearchNavigateTarget | null {
  if (target.kind === "record") return target.navigate;
  if (target.kind === "audit") {
    return { screen: "audits", auditId: target.auditId, openAudit: true, scheduleId: target.scheduleId };
  }
  if (target.kind === "briefing") {
    return { screen: "briefings", briefingId: target.briefingId };
  }
  return { screen: target.screen };
}

export function dashboardTargetRoute(target: DashboardNavTarget): string | undefined {
  if ("route" in target) return target.route;
  return undefined;
}

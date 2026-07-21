import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { getContextualHelp } from "../../presentation/contextualHelp";
import { scopedDismissKey, useDismissiblePanel } from "../../hooks/useDismissiblePanel";

import { storageKeys } from "../../config/storageKeys";

const DISMISS_PREFIX = storageKeys.contextualHelpDismissed;

type Props = {
  screen: string;
  companyId?: string;
  userId?: string;
  text?: string;
  className?: string;
};

export function ContextualHelp({ screen, companyId = "", userId = "", text, className = "" }: Props) {
  const copy = text || getContextualHelp(screen);
  const storageKey = scopedDismissKey(DISMISS_PREFIX, companyId, userId, screen);
  const { dismissed, dismiss } = useDismissiblePanel(storageKey);

  if (!copy || dismissed) {
    return null;
  }

  return (
    <aside
      className={[
        "flex items-start gap-3 rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3 text-sm text-[var(--ui-text-secondary)] motion-reduce:transition-none",
        className,
      ].join(" ")}
      aria-label="Page help"
    >
      <span className="mt-0.5 shrink-0 text-[var(--ui-text-muted)]" aria-hidden>
        <HelpIcon />
      </span>
      <p className="min-w-0 flex-1 leading-relaxed">{copy}</p>
      <button
        type="button"
        onClick={dismiss}
        className="min-h-11 min-w-11 shrink-0 rounded-full text-xs font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-surface)]"
        aria-label="Dismiss help"
      >
        ×
      </button>
    </aside>
  );
}

function HelpIcon() {
  return (
    <Icon size="sm" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.7 1.2-1.7 2.2" />
      <circle cx="12" cy="16.8" r="0.8" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function WorkspaceHelpIcon({ className }: { className?: string }) {
  return (
    <span className={["inline-flex text-[var(--ui-text-muted)]", className].join(" ")} aria-hidden>
      <HelpIcon />
    </span>
  );
}

export function ContextualHelpSlot({
  screen,
  companyId,
  userId,
  children,
}: {
  screen: string;
  companyId?: string;
  userId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <ContextualHelp screen={screen} companyId={companyId} userId={userId} />
      {children}
    </div>
  );
}

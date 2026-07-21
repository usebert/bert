import { EmptyState } from "../ui/LoadingStates";

type Props = {
  variant: "empty" | "filter-empty" | "error";
  onRetry?: () => void;
};

export function NotificationEmptyState({ variant, onRetry }: Props) {
  if (variant === "error") {
    return (
      <EmptyState
        title="Notifications could not be refreshed."
        description="Try again in a moment."
        primaryAction={onRetry ? { label: "Retry", onClick: onRetry } : undefined}
      />
    );
  }

  if (variant === "filter-empty") {
    return <EmptyState title="No notifications in this category." description="Try another filter or check back later." />;
  }

  return <EmptyState title="You're all caught up." description="No active notifications need your attention right now." />;
}

import type { Role } from "../../permissions";
import type { NavItemId } from "../../types/navigation";
import { useOnboardingChecklist } from "../../hooks/useOnboardingChecklist";
import type { OnboardingInput } from "../../onboarding/onboardingChecklist";
import { OnboardingChecklistCard } from "./OnboardingChecklistCard";

type Props = {
  role: Role;
  userId: string;
  setupOnlyShell?: boolean;
  input: OnboardingInput;
  onNavigate: (screen: NavItemId) => void;
};

function canShowOnboarding(role: Role, setupOnlyShell: boolean): boolean {
  if (setupOnlyShell) return true;
  return role === "Admin" || role === "Master";
}

export function OnboardingHost({ role, userId, setupOnlyShell = false, input, onNavigate }: Props) {
  const { dismissed, dismiss, steps, progress } = useOnboardingChecklist(input, userId);

  if (!canShowOnboarding(role, setupOnlyShell) || dismissed) {
    return null;
  }

  return (
    <OnboardingChecklistCard
      steps={steps}
      completed={progress.completed}
      total={progress.total}
      percent={progress.percent}
      onNavigate={onNavigate}
      onDismiss={dismiss}
    />
  );
}

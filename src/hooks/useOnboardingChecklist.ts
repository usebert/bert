import { useMemo } from "react";
import { scopedDismissKey, useDismissiblePanel } from "../hooks/useDismissiblePanel";
import {
  buildOnboardingSnapshot,
  buildOnboardingSteps,
  onboardingProgress,
  type OnboardingInput,
  type OnboardingStep,
} from "../onboarding/onboardingChecklist";

import { storageKeys } from "../config/storageKeys";

const DISMISS_PREFIX = storageKeys.onboardingDismissed;

export function useOnboardingChecklist(input: OnboardingInput, userId: string) {
  const storageKey = scopedDismissKey(DISMISS_PREFIX, input.companyFolderId, userId, "checklist");
  const { dismissed, dismiss } = useDismissiblePanel(storageKey);

  const snapshot = useMemo(() => buildOnboardingSnapshot(input), [input]);
  const steps = useMemo(() => buildOnboardingSteps(snapshot), [snapshot]);
  const progress = useMemo(() => onboardingProgress(steps), [steps]);
  const complete = progress.percent >= 100;

  return {
    dismissed,
    dismiss,
    steps,
    progress,
    complete,
    snapshot,
  };
}

export type { OnboardingStep };

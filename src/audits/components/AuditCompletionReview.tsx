import type { CheckCompletionReviewProps } from "../../types/checkCompletion";
import { CheckCompletionReview } from "../../components/checks/CheckCompletionReview";

/** Presentation wrapper — delegates to existing review/submit validation. */
export function AuditCompletionReview(props: CheckCompletionReviewProps) {
  return <CheckCompletionReview {...props} />;
}

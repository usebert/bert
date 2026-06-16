import type { ActionItem, RiskLevel } from "../types/reportsScreenProps";
import type { AuditFindingRecord } from "../types/complianceLoop";

export type SuggestionStatus = "suggested" | "accepted" | "edited" | "ignored";

export type SuggestedDueOffset = "today" | "24h" | "48h";

export type SuggestedFixRule = {
  suggestionRuleId: string;
  label: string;
  patterns: RegExp[];
  suggestedActionTitle: string;
  suggestedActionDescription: string;
  suggestedOwnerRole: string;
  suggestedDueDate: SuggestedDueOffset;
  suggestedEvidence: string[];
  severity: RiskLevel;
  suggestionReason: string;
};

export type SuggestedFixMatch = {
  suggestionRuleId: string;
  suggestedActionTitle: string;
  suggestedActionDescription: string;
  suggestedOwnerRole: string;
  suggestedDueDate: string;
  suggestedDueOffset: SuggestedDueOffset;
  suggestedEvidence: string[];
  severity: RiskLevel;
  suggestionReason: string;
};

export const SUGGESTED_FIX_RULES: SuggestedFixRule[] = [
  {
    suggestionRuleId: "fire-exit-blocked",
    label: "Fire exit blocked",
    patterns: [
      /\bfire\s+exit\b/i,
      /\bemergency\s+exit\b/i,
      /\bblocked\s+exit\b/i,
      /\bexit\s+(route|door|way)\b/i,
      /\begress\b/i,
      /\bescape\s+route\b/i,
    ],
    suggestedActionTitle: "Clear fire exit route immediately",
    suggestedActionDescription:
      "Remove obstructions from the fire exit and verify the full escape route is usable. Confirm signage is visible and the door opens fully.",
    suggestedOwnerRole: "Site Manager",
    suggestedDueDate: "today",
    suggestedEvidence: ["Photo of cleared exit route", "Photo of exit signage visible"],
    severity: "Critical",
    suggestionReason: "Blocked or obstructed fire exits are treated as immediate life-safety risks.",
  },
  {
    suggestionRuleId: "ppe-not-worn",
    label: "PPE not worn",
    patterns: [
      /\bppe\b/i,
      /\bhard\s*hat\b/i,
      /\bhi[\s-]?vis\b/i,
      /\bhigh[\s-]?visibility\b/i,
      /\bsafety\s+glasses\b/i,
      /\bear\s+defen[cs]e\b/i,
      /\bprotective\s+(equipment|clothing|wear)\b/i,
      /\bnot\s+wearing\b/i,
    ],
    suggestedActionTitle: "Restore required PPE compliance",
    suggestedActionDescription:
      "Ensure the correct PPE is available, worn correctly, and supervisors brief the team on the requirement before work continues in the area.",
    suggestedOwnerRole: "Shift Supervisor",
    suggestedDueDate: "24h",
    suggestedEvidence: ["Photo of compliant PPE in use", "Briefing note or toolbox talk record"],
    severity: "High",
    suggestionReason: "Missing or incorrect PPE increases injury risk for the task observed.",
  },
  {
    suggestionRuleId: "spill-kit-missing",
    label: "Spill kit missing",
    patterns: [
      /\bspill\s+kit\b/i,
      /\bspill\s+response\b/i,
      /\babsorbent\b/i,
      /\bspill\s+station\b/i,
      /\bchemical\s+spill\b/i,
    ],
    suggestedActionTitle: "Restore spill response kit at point of use",
    suggestedActionDescription:
      "Replace or restock the spill kit, confirm contents against the checklist, and label the storage location so responders can find it quickly.",
    suggestedOwnerRole: "H&S Lead",
    suggestedDueDate: "24h",
    suggestedEvidence: ["Photo of stocked spill kit", "Spill kit inspection checklist"],
    severity: "High",
    suggestionReason: "Spill kits must be available where hazardous materials are handled or stored.",
  },
  {
    suggestionRuleId: "forklift-check-failed",
    label: "Forklift check failed",
    patterns: [
      /\bfork\s*lift\b/i,
      /\blift\s+truck\b/i,
      /\bflt\b/i,
      /\bpre[\s-]?use\s+check\b/i,
      /\bdaily\s+check\b/i,
      /\btruck\s+check\b/i,
    ],
    suggestedActionTitle: "Complete forklift defect follow-up",
    suggestedActionDescription:
      "Tag out the truck if unsafe, record the defect, arrange repair, and repeat the pre-use check before returning the vehicle to service.",
    suggestedOwnerRole: "Plant Manager",
    suggestedDueDate: "today",
    suggestedEvidence: ["Defect tag photo", "Repair or reinspection record"],
    severity: "Critical",
    suggestionReason: "Failed forklift checks can indicate an unsafe vehicle must not be used.",
  },
  {
    suggestionRuleId: "poor-housekeeping",
    label: "Poor housekeeping",
    patterns: [
      /\bhousekeeping\b/i,
      /\bclutter\b/i,
      /\btrip\s+hazard\b/i,
      /\buntidy\b/i,
      /\bdebris\b/i,
      /\bwalkway\b/i,
      /\bslip\b/i,
      /\b5s\b/i,
    ],
    suggestedActionTitle: "Improve housekeeping in the affected area",
    suggestedActionDescription:
      "Clear waste and obstructions, restore walkways, and agree a standard with the team so the area stays tidy after the clean-up.",
    suggestedOwnerRole: "Area Owner",
    suggestedDueDate: "48h",
    suggestedEvidence: ["Before and after photos", "Supervisor sign-off"],
    severity: "Medium",
    suggestionReason: "Poor housekeeping contributes to slips, trips, and fire-load risks.",
  },
  {
    suggestionRuleId: "guarding-damaged",
    label: "Guarding damaged",
    patterns: [
      /\bguard(ing|s)?\b/i,
      /\bmachine\s+guard\b/i,
      /\binterlock\b/i,
      /\bbarrier\b/i,
      /\bnip\s+point\b/i,
    ],
    suggestedActionTitle: "Repair or replace damaged machine guarding",
    suggestedActionDescription:
      "Isolate the equipment until guarding is restored, confirm interlocks function, and brief operators before restart.",
    suggestedOwnerRole: "Maintenance Lead",
    suggestedDueDate: "today",
    suggestedEvidence: ["Photo of repaired guard", "Isolation / permit record if used"],
    severity: "Critical",
    suggestionReason: "Damaged or missing guards expose operators to entanglement and crush hazards.",
  },
];

const GENERIC_RULE: SuggestedFixRule = {
  suggestionRuleId: "generic-corrective-action",
  label: "Generic corrective action",
  patterns: [],
  suggestedActionTitle: "Review failed check and assign corrective action",
  suggestedActionDescription:
    "Review the failed answer, agree the corrective action with the area owner, and capture evidence that the issue has been resolved.",
  suggestedOwnerRole: "Area Manager",
  suggestedDueDate: "48h",
  suggestedEvidence: ["Photo evidence of correction", "Supervisor verification note"],
  severity: "Medium",
  suggestionReason: "BERT matched this to a standard corrective-action pattern for failed checks.",
};

function normalizeMatchText(...parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function suggestedDueOffsetToIso(offset: SuggestedDueOffset, baseDate = new Date()) {
  const next = new Date(baseDate);
  if (offset === "today") {
    return next.toISOString().slice(0, 10);
  }
  if (offset === "24h") {
    next.setDate(next.getDate() + 1);
    return next.toISOString().slice(0, 10);
  }
  next.setDate(next.getDate() + 2);
  return next.toISOString().slice(0, 10);
}

export function dueHoursFromIsoDate(dueDate: string) {
  const dueMs = new Date(`${dueDate}T23:59:59`).getTime();
  return Math.round((dueMs - Date.now()) / 36e5);
}

function scoreRule(rule: SuggestedFixRule, haystack: string) {
  if (!haystack.trim()) return 0;
  return rule.patterns.reduce((score, pattern) => (pattern.test(haystack) ? score + 1 : score), 0);
}

export function matchSuggestedFix(input: {
  questionText: string;
  answer: string;
  auditName: string;
  note?: string;
}): SuggestedFixMatch {
  const haystack = normalizeMatchText(input.questionText, input.answer, input.auditName, input.note);
  let bestRule: SuggestedFixRule | null = null;
  let bestScore = 0;

  for (const rule of SUGGESTED_FIX_RULES) {
    const score = scoreRule(rule, haystack);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const rule = bestScore > 0 ? bestRule! : GENERIC_RULE;
  const suggestedDueDate = suggestedDueOffsetToIso(rule.suggestedDueDate);

  return {
    suggestionRuleId: rule.suggestionRuleId,
    suggestedActionTitle: rule.suggestedActionTitle,
    suggestedActionDescription: rule.suggestedActionDescription,
    suggestedOwnerRole: rule.suggestedOwnerRole,
    suggestedDueDate,
    suggestedDueOffset: rule.suggestedDueDate,
    suggestedEvidence: [...rule.suggestedEvidence],
    severity: rule.severity,
    suggestionReason: rule.suggestionReason,
  };
}

export function buildActionSuggestionFields(input: {
  questionText: string;
  answer: string;
  auditName: string;
  note?: string;
  similarIssueCount30d?: number;
}) {
  const match = matchSuggestedFix(input);
  return {
    suggestedActionTitle: match.suggestedActionTitle,
    suggestedActionDescription: match.suggestedActionDescription,
    suggestedOwnerRole: match.suggestedOwnerRole,
    suggestedDueDate: match.suggestedDueDate,
    suggestedEvidence: match.suggestedEvidence,
    suggestionReason: match.suggestionReason,
    suggestionRuleId: match.suggestionRuleId,
    suggestionStatus: "suggested" as SuggestionStatus,
    similarIssueCount30d: input.similarIssueCount30d ?? 0,
    severity: match.severity,
    suggestedDueHours: dueHoursFromIsoDate(match.suggestedDueDate),
  };
}

export function countSimilarIssuesInArea(input: {
  questionText: string;
  siteArea?: string;
  auditFindings: AuditFindingRecord[];
  actions: ActionItem[];
  windowDays?: number;
  now?: Date;
}) {
  const normalizedQuestion = normalizeMatchText(input.questionText);
  const normalizedArea = normalizeMatchText(input.siteArea || "");
  const windowMs = (input.windowDays ?? 30) * 24 * 60 * 60 * 1000;
  const nowMs = (input.now ?? new Date()).getTime();
  const cutoff = nowMs - windowMs;

  const matchesQuestion = (text: string) => normalizeMatchText(text) === normalizedQuestion;

  const areaMatches = (candidate?: string) => {
    if (!normalizedArea) return true;
    const normalizedCandidate = normalizeMatchText(candidate);
    if (!normalizedCandidate) return true;
    return (
      normalizedCandidate === normalizedArea ||
      normalizedCandidate.includes(normalizedArea) ||
      normalizedArea.includes(normalizedCandidate)
    );
  };

  const findingMatches = input.auditFindings.filter((finding) => {
    const createdMs = Date.parse(finding.createdAt || "");
    if (!Number.isFinite(createdMs) || createdMs < cutoff) return false;
    if (!areaMatches(finding.areaId)) return false;
    return matchesQuestion(finding.questionText);
  }).length;

  const actionMatches = input.actions.filter((action) => {
    const createdMs = Date.parse(action.createdAt || "");
    if (!Number.isFinite(createdMs) || createdMs < cutoff) return false;
    if (!areaMatches(action.siteArea)) return false;
    return matchesQuestion(action.questionText);
  }).length;

  return findingMatches + actionMatches;
}

export type ActionSuggestionPayload = Pick<
  ActionItem,
  | "suggestedActionTitle"
  | "suggestedActionDescription"
  | "suggestedOwnerRole"
  | "suggestedDueDate"
  | "suggestedEvidence"
  | "suggestionReason"
  | "suggestionRuleId"
  | "suggestionStatus"
  | "similarIssueCount30d"
>;

export function serializeActionSuggestion(action: ActionItem) {
  const payload: ActionSuggestionPayload = {
    suggestedActionTitle: action.suggestedActionTitle,
    suggestedActionDescription: action.suggestedActionDescription,
    suggestedOwnerRole: action.suggestedOwnerRole,
    suggestedDueDate: action.suggestedDueDate,
    suggestedEvidence: action.suggestedEvidence,
    suggestionReason: action.suggestionReason,
    suggestionRuleId: action.suggestionRuleId,
    suggestionStatus: action.suggestionStatus,
    similarIssueCount30d: action.similarIssueCount30d,
  };
  if (!payload.suggestionRuleId && !payload.suggestionStatus) {
    return "";
  }
  return JSON.stringify(payload);
}

export function parseActionSuggestion(raw: string): Partial<ActionSuggestionPayload> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<ActionSuggestionPayload>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function applyAcceptedSuggestion(action: ActionItem): ActionItem {
  if (!action.suggestedActionTitle) {
    return { ...action, suggestionStatus: "accepted" };
  }
  const description = action.suggestedActionDescription?.trim();
  const correctiveAction = description
    ? `${action.suggestedActionTitle}\n\n${description}`
    : action.suggestedActionTitle;
  const dueDate = action.suggestedDueDate || action.dueDate;
  return {
    ...action,
    correctiveAction,
    dueDate,
    dueHours: dueHoursFromIsoDate(dueDate),
    dueLabel: action.suggestedDueDate === suggestedDueOffsetToIso("today") ? "Due today" : action.dueLabel,
    requiresManagerReview: true,
    suggestionStatus: "accepted",
  };
}

export function applyEditedSuggestion(action: ActionItem): ActionItem {
  const accepted = applyAcceptedSuggestion(action);
  return {
    ...accepted,
    suggestionStatus: "edited",
  };
}

import { calculateClientRiskScore } from "../../services/riskAssessmentService";
import type { RiskHazardInput, RiskHazardRecord } from "../../types/riskAssessment";

export type WizardFormState = {
  title: string;
  description: string;
  assessmentType: string;
  activity: string;
  department: string;
  siteId: string;
  areaId: string;
  ownerName: string;
  assessorName: string;
  assessmentDate: string;
  reviewDate: string;
  peopleAtRisk: string[];
  peopleAtRiskOther: string;
  existingGeneralControls: string;
  emergencyArrangements: string;
  ppeSummary: string;
};

export type WizardHazardDraft = RiskHazardInput & {
  clientId: string;
  id?: string;
  initialRiskScore: number;
  residualRiskScore: number;
};

export type RiskAssessmentFieldError = {
  step: string;
  field: string;
  message: string;
};

export type RiskAssessmentValidationResult = {
  valid: boolean;
  message: string;
  fieldErrors: RiskAssessmentFieldError[];
  reviewDateWarning?: string;
};

function trim(value: unknown) {
  return String(value ?? "").trim();
}

function isValidRiskValue(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildWizardHazardDraft(input: RiskHazardInput): WizardHazardDraft {
  const initialLikelihood = Number(input.initialLikelihood) || 0;
  const initialSeverity = Number(input.initialSeverity) || 0;
  const residualLikelihood = Number(input.residualLikelihood) || 0;
  const residualSeverity = Number(input.residualSeverity) || 0;
  return {
    ...input,
    clientId: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    initialRiskScore: calculateClientRiskScore(initialLikelihood, initialSeverity),
    residualRiskScore: calculateClientRiskScore(residualLikelihood, residualSeverity),
  };
}

export function wizardDraftFromServerHazard(hazard: RiskHazardRecord): WizardHazardDraft {
  return {
    clientId: hazard.id,
    id: hazard.id,
    hazardType: hazard.hazardType,
    hazardTitle: hazard.hazardTitle,
    hazardDescription: hazard.hazardDescription,
    whoMightBeHarmed: hazard.whoMightBeHarmed,
    howMightTheyBeHarmed: hazard.howMightTheyBeHarmed,
    existingControls: hazard.existingControls,
    initialLikelihood: hazard.initialLikelihood,
    initialSeverity: hazard.initialSeverity,
    additionalControls: hazard.additionalControls,
    residualLikelihood: hazard.residualLikelihood,
    residualSeverity: hazard.residualSeverity,
    controlOwnerUserId: hazard.controlOwnerUserId,
    controlOwnerName: hazard.controlOwnerName,
    controlDueDate: hazard.controlDueDate,
    actionRequired: hazard.actionRequired,
    sortOrder: hazard.sortOrder,
    initialRiskScore: hazard.initialRiskScore,
    residualRiskScore: hazard.residualRiskScore,
  };
}

export function wizardHazardToInput(hazard: WizardHazardDraft): RiskHazardInput & { id?: string } {
  return {
    id: hazard.id,
    hazardType: hazard.hazardType,
    hazardTitle: hazard.hazardTitle,
    hazardDescription: hazard.hazardDescription,
    whoMightBeHarmed: hazard.whoMightBeHarmed,
    howMightTheyBeHarmed: hazard.howMightTheyBeHarmed,
    existingControls: hazard.existingControls,
    initialLikelihood: hazard.initialLikelihood,
    initialSeverity: hazard.initialSeverity,
    additionalControls: hazard.additionalControls,
    residualLikelihood: hazard.residualLikelihood,
    residualSeverity: hazard.residualSeverity,
    controlOwnerUserId: hazard.controlOwnerUserId,
    controlOwnerName: hazard.controlOwnerName,
    controlDueDate: hazard.controlDueDate,
    actionRequired: hazard.actionRequired,
    sortOrder: hazard.sortOrder,
  };
}

export function validateRiskAssessmentSubmission(
  form: WizardFormState,
  hazards: WizardHazardDraft[],
): RiskAssessmentValidationResult {
  const fieldErrors: RiskAssessmentFieldError[] = [];
  const push = (step: string, field: string, message: string) => fieldErrors.push({ step, field, message });

  if (!trim(form.title)) push("details", "title", "Title is required.");
  if (!trim(form.assessmentType)) push("details", "assessmentType", "Assessment type is required.");
  if (!trim(form.assessmentDate)) push("details", "assessmentDate", "Assessment date is required.");
  if (!trim(form.reviewDate)) push("details", "reviewDate", "Review date is required.");

  const assessmentDate = trim(form.assessmentDate);
  const reviewDate = trim(form.reviewDate);
  const today = todayKey();
  let reviewDateWarning = "";

  if (assessmentDate && reviewDate && reviewDate <= assessmentDate) {
    push("details", "reviewDate", "Review date must be after the assessment date.");
  }
  if (reviewDate && reviewDate < today) {
    push("details", "reviewDate", "Review date cannot be in the past.");
  }
  if (reviewDate && reviewDate === today) {
    reviewDateWarning = "The review date is today. Confirm this assessment should be reviewed immediately.";
  }

  if (hazards.length === 0) {
    push("hazards", "hazards", "At least one hazard is required before this assessment can be submitted.");
  }

  for (const hazard of hazards) {
    const label = trim(hazard.hazardTitle) || trim(hazard.hazardType) || "Hazard";
    if (!trim(hazard.hazardTitle) && !trim(hazard.hazardType)) {
      push("hazards", "hazardTitle", "Hazard title is required.");
    }
    if (!trim(hazard.whoMightBeHarmed)) {
      push("hazards", "whoMightBeHarmed", `Who might be harmed is required for "${label}".`);
    }
    if (!trim(hazard.existingControls)) {
      push("hazards", "existingControls", `Existing controls are required for "${label}".`);
    }
    if (!isValidRiskValue(hazard.initialLikelihood) || !isValidRiskValue(hazard.initialSeverity)) {
      push("controls", "initialRisk", `Initial risk scores are required for "${label}".`);
    }
    if (!isValidRiskValue(hazard.residualLikelihood) || !isValidRiskValue(hazard.residualSeverity)) {
      push("residual", "residualRisk", `Residual risk scores are required for "${label}".`);
    }
    if (hazard.actionRequired) {
      if (!trim(hazard.controlOwnerName)) {
        push("controls", "controlOwnerName", `Control owner is required for "${label}".`);
      }
      if (!trim(hazard.controlDueDate)) {
        push("controls", "controlDueDate", `Control due date is required for "${label}".`);
      }
    }
  }

  return {
    valid: fieldErrors.length === 0,
    message:
      fieldErrors.length > 0
        ? "The assessment needs more information before it can be submitted."
        : "",
    fieldErrors,
    reviewDateWarning,
  };
}

export function wizardStepIndexForField(step: string) {
  switch (step) {
    case "details":
      return 0;
    case "hazards":
      return 2;
    case "controls":
      return 3;
    case "residual":
      return 4;
    default:
      return 0;
  }
}

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
  id: string;
  initialRiskScore: number;
  residualRiskScore: number;
};

export type RiskAssessmentFieldError = {
  hazardId?: string;
  step: number;
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

export function buildClientHazardId() {
  return `rah-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function dedupeHazardsById<T extends { id?: string }>(hazards: T[]): T[] {
  const byId = new Map<string, T>();
  for (const hazard of hazards) {
    const id = trim(hazard.id);
    if (!id) continue;
    byId.set(id, hazard);
  }
  return Array.from(byId.values());
}

export function buildWizardHazardDraft(input: RiskHazardInput & { id?: string }): WizardHazardDraft {
  const id = trim(input.id) || buildClientHazardId();
  const initialLikelihood = Number(input.initialLikelihood) || 0;
  const initialSeverity = Number(input.initialSeverity) || 0;
  const residualLikelihood = Number(input.residualLikelihood) || 0;
  const residualSeverity = Number(input.residualSeverity) || 0;
  return {
    ...input,
    id,
    initialRiskScore: calculateClientRiskScore(initialLikelihood, initialSeverity),
    residualRiskScore: calculateClientRiskScore(residualLikelihood, residualSeverity),
  };
}

export function wizardDraftFromServerHazard(hazard: RiskHazardRecord): WizardHazardDraft {
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
    initialRiskScore: hazard.initialRiskScore,
    residualRiskScore: hazard.residualRiskScore,
  };
}

export function mergeHazardsFromSave(local: WizardHazardDraft[], server: RiskHazardRecord[] | undefined): WizardHazardDraft[] {
  if (!Array.isArray(server) || server.length === 0) {
    return dedupeHazardsById(local);
  }
  return dedupeHazardsById(server.map((hazard) => wizardDraftFromServerHazard(hazard)));
}

export function wizardHazardToInput(hazard: WizardHazardDraft): RiskHazardInput & { id: string } {
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

export function hazardFieldToStep(field: string) {
  switch (field) {
    case "hazardTitle":
    case "hazardType":
    case "whoMightBeHarmed":
    case "howMightTheyBeHarmed":
    case "hazards":
      return 2;
    case "existingControls":
    case "additionalControls":
    case "controlOwnerName":
    case "controlDueDate":
    case "initialRisk":
      return 3;
    case "residualRisk":
    case "residualLikelihood":
    case "residualSeverity":
      return 4;
    default:
      return 2;
  }
}

export function getHazardMissingSummary(hazard: WizardHazardDraft) {
  const missing: string[] = [];
  if (!trim(hazard.whoMightBeHarmed)) missing.push("Who might be harmed");
  if (!trim(hazard.existingControls)) missing.push("Existing controls");
  if (!isValidRiskValue(hazard.initialLikelihood) || !isValidRiskValue(hazard.initialSeverity)) missing.push("Initial risk");
  if (!isValidRiskValue(hazard.residualLikelihood) || !isValidRiskValue(hazard.residualSeverity)) missing.push("Residual risk");
  if (hazard.actionRequired) {
    if (!trim(hazard.controlOwnerName)) missing.push("Control owner");
    if (!trim(hazard.controlDueDate)) missing.push("Control due date");
  }
  return missing;
}

export function validateRiskAssessmentSubmission(
  form: WizardFormState,
  hazards: WizardHazardDraft[],
): RiskAssessmentValidationResult {
  const fieldErrors: RiskAssessmentFieldError[] = [];
  const push = (step: number, field: string, message: string, hazardId?: string) =>
    fieldErrors.push({ step, field, message, hazardId });

  if (!trim(form.title)) push(0, "title", "Title is required.");
  if (!trim(form.assessmentType)) push(0, "assessmentType", "Assessment type is required.");
  if (!trim(form.assessmentDate)) push(0, "assessmentDate", "Assessment date is required.");
  if (!trim(form.reviewDate)) push(0, "reviewDate", "Review date is required.");

  const assessmentDate = trim(form.assessmentDate);
  const reviewDate = trim(form.reviewDate);
  const today = todayKey();
  let reviewDateWarning = "";

  if (assessmentDate && reviewDate && reviewDate <= assessmentDate) {
    push(0, "reviewDate", "Review date must be after the assessment date.");
  }
  if (reviewDate && reviewDate < today) {
    push(0, "reviewDate", "Review date cannot be in the past.");
  }
  if (reviewDate && reviewDate === today) {
    reviewDateWarning = "The review date is today. Confirm this assessment should be reviewed immediately.";
  }

  const uniqueHazards = dedupeHazardsById(hazards);
  if (uniqueHazards.length === 0) {
    push(2, "hazards", "At least one hazard is required before this assessment can be submitted.");
  }

  for (const hazard of uniqueHazards) {
    const label = trim(hazard.hazardTitle) || trim(hazard.hazardType) || "Hazard";
    if (!trim(hazard.hazardTitle) && !trim(hazard.hazardType)) {
      push(2, "hazardTitle", "Hazard title is required.", hazard.id);
    }
    if (!trim(hazard.whoMightBeHarmed)) {
      push(2, "whoMightBeHarmed", `Who might be harmed is required for "${label}".`, hazard.id);
    }
    if (!trim(hazard.existingControls)) {
      push(3, "existingControls", `Existing controls are required for "${label}".`, hazard.id);
    }
    if (!isValidRiskValue(hazard.initialLikelihood) || !isValidRiskValue(hazard.initialSeverity)) {
      push(3, "initialRisk", `Initial risk scores are required for "${label}".`, hazard.id);
    }
    if (!isValidRiskValue(hazard.residualLikelihood) || !isValidRiskValue(hazard.residualSeverity)) {
      push(4, "residualRisk", `Residual risk scores are required for "${label}".`, hazard.id);
    }
    if (hazard.actionRequired) {
      if (!trim(hazard.controlOwnerName)) {
        push(3, "controlOwnerName", `Control owner is required for "${label}".`, hazard.id);
      }
      if (!trim(hazard.controlDueDate)) {
        push(3, "controlDueDate", `Control due date is required for "${label}".`, hazard.id);
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

/** @deprecated use hazardFieldToStep */
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

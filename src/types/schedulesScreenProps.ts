/**
 * Structural props types for SchedulesScreen — mirrors App.tsx domain types so the screen
 * does not import App.tsx. Keep aligned when workspace models change.
 */

export type { ScheduleAuditorOption } from "../utils/scheduleAuditors";

export type ScheduleListFilter = "Live" | "Archived" | "All schedules";

export type CompanyFolder = {
  id: string;
  name: string;
  onboardingFormName: string;
  onboardingFormId?: string;
  auditFormCount: number;
  auditFormIds?: string[];
  responseSheetName: string;
  responseSheetId?: string;
  linkedAt: string;
  onboardingVerified: boolean;
  auditFormsVerified: boolean;
  responseSheetVerified: boolean;
};

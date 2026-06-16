/**
 * Dashboard-specific configuration types — kept aligned with App.tsx so the
 * extracted DashboardScreen does not need to import from App.tsx.
 */

import type { RiskLevel } from "./reportsScreenProps";

export type DashboardPreferences = {
  trafficBoard: boolean;
  liveSummary: boolean;
  upcomingAudits: boolean;
  openActions: boolean;
  complianceSnapshot: boolean;
};

export type DashboardSectionKey = keyof DashboardPreferences;

export type RiskSummary = {
  totalRiskScore: number;
  highestRiskLevel: RiskLevel;
  criticalFindings: number;
  highFindings: number;
};

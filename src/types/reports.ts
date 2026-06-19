import type { Role } from "../permissions";

export type ReportTemplateType =
  | "Executive summary"
  | "Overdue audit pack"
  | "Corrective action pack"
  | "Evidence pack"
  | "Full report";

export type ReportSectionKey =
  | "compliance"
  | "overdueAudits"
  | "correctiveActions"
  | "overdueActions"
  | "criticalFindings"
  | "repeatFailures"
  | "evidence"
  | "auditHistory"
  | "verificationHistory"
  | "scheduleCompliance"
  | "auditCompletion"
  | "syncExceptions"
  | "templates"
  | "offlineQueue";

export type ReportItem = {
  id: string;
  title: string;
  type: "PDF report" | "Text audit pack";
  createdAt: string;
  createdBy: string;
  visibleTo: string[];
  template: ReportTemplateType;
};

export type CompanyReportUser = {
  email: string;
  name: string;
  role: Role;
  username?: string;
};

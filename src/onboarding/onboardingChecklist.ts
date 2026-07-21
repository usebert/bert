import type { NavItemId } from "../types/navigation";
import type { Audit, AuditTemplate, HistoryEntry, ManagedSchedule } from "../types/reportsScreenProps";
import type { Site, UserInvite, ScheduleItem } from "../types/adminScreenProps";
import type { AreaAuditMapping } from "../utils/areaAuditMapping";
import { activeAreas } from "../utils/companyAreas";
import { readCachedDocumentControlDocuments } from "../services/documentControlService";
import { readCachedLolerEquipment } from "../services/lolerService";

export type OnboardingStepId =
  | "company"
  | "users"
  | "sites"
  | "areas"
  | "templates"
  | "schedule"
  | "documents"
  | "briefings"
  | "equipment"
  | "firstAudit";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  optional?: boolean;
  screen: NavItemId;
  done: boolean;
};

export type OnboardingSnapshot = {
  companyReady: boolean;
  userCount: number;
  invitedCount: number;
  siteCount: number;
  areaCount: number;
  templateCount: number;
  scheduleCount: number;
  documentCount: number;
  briefingCount: number;
  equipmentCount: number;
  completedAuditCount: number;
};

export type OnboardingInput = {
  companyFolderId: string;
  companyName: string;
  invitedUsers: UserInvite[];
  memberCount: number;
  sites: Site[];
  areaAudits: AreaAuditMapping[];
  templates: AuditTemplate[];
  schedules: ScheduleItem[];
  managedSchedules: ManagedSchedule[];
  briefingCount: number;
  audits: Audit[];
  history: HistoryEntry[];
};

export function buildOnboardingSnapshot(input: OnboardingInput): OnboardingSnapshot {
  const companyReady = Boolean(input.companyFolderId.trim() && input.companyName.trim());
  const siteCount = input.sites.filter((site) => site.active).length;
  const areaCount = Math.max(activeAreas(input.sites).length, input.areaAudits.length);
  const scheduleCount =
    input.schedules.length + input.managedSchedules.filter((row) => !row.archivedAt).length;
  const cachedDocuments = input.companyFolderId
    ? readCachedDocumentControlDocuments(input.companyFolderId)?.documents?.length ?? 0
    : 0;
  const cachedEquipment = input.companyFolderId
    ? readCachedLolerEquipment(input.companyFolderId)?.equipment?.length ?? 0
    : 0;
  const completedAuditCount =
    input.history.length + input.audits.filter((audit) => Boolean(audit.lastCompletedAt?.trim())).length;

  return {
    companyReady,
    userCount: input.memberCount,
    invitedCount: input.invitedUsers.length,
    siteCount,
    areaCount,
    templateCount: input.templates.length,
    scheduleCount,
    documentCount: cachedDocuments,
    briefingCount: input.briefingCount,
    equipmentCount: cachedEquipment,
    completedAuditCount,
  };
}

export function buildOnboardingSteps(snapshot: OnboardingSnapshot): OnboardingStep[] {
  return [
    {
      id: "company",
      title: "Company created",
      description: "Your company workspace is ready.",
      screen: "dashboard",
      done: snapshot.companyReady,
    },
    {
      id: "users",
      title: "Add users",
      description: "Invite admins, managers and auditors to your workspace.",
      screen: "users",
      done: snapshot.userCount > 1 || snapshot.invitedCount > 0,
    },
    {
      id: "sites",
      title: "Add sites",
      description: "Create the sites your team works across.",
      screen: "companies",
      done: snapshot.siteCount > 0,
    },
    {
      id: "areas",
      title: "Add areas",
      description: "Define areas within sites for scoped assignments.",
      screen: "companies",
      done: snapshot.areaCount > 1,
    },
    {
      id: "templates",
      title: "Import or create audit templates",
      description: "Build checks your team can schedule and complete.",
      screen: "auditBuilder",
      done: snapshot.templateCount > 0,
    },
    {
      id: "schedule",
      title: "Create first schedule",
      description: "Assign recurring checks to the right people.",
      screen: "schedules",
      done: snapshot.scheduleCount > 0,
    },
    {
      id: "documents",
      title: "Upload controlled documents",
      description: "Add policies and procedures with revision control.",
      screen: "documentControl",
      done: snapshot.documentCount > 0,
    },
    {
      id: "briefings",
      title: "Configure briefings",
      description: "Publish updates and collect acknowledgements.",
      screen: "briefings",
      done: snapshot.briefingCount > 0,
    },
    {
      id: "equipment",
      title: "Add LOLER equipment",
      description: "Optional: register lifting equipment and inspections.",
      screen: "loler",
      optional: true,
      done: snapshot.equipmentCount > 0,
    },
    {
      id: "firstAudit",
      title: "Complete first audit",
      description: "Run a check to confirm your setup end to end.",
      screen: "audits",
      done: snapshot.completedAuditCount > 0,
    },
  ];
}

export function onboardingProgress(steps: OnboardingStep[]): { completed: number; total: number; percent: number } {
  const required = steps.filter((step) => !step.optional);
  const completed = required.filter((step) => step.done).length;
  const total = required.length;
  const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
  return { completed, total, percent };
}

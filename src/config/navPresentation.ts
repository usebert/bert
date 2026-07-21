import type { Role } from "../permissions";
import type { NavItemId } from "../types/navigation";
import { getPresentedNavForRole, getRoleNavBucket, type PresentedNavItem } from "./roleNavigation";

export type NavPresentationGroupId = "home" | "work" | "compliance" | "administration" | "platform";

export type NavPresentationGroup = {
  id: NavPresentationGroupId;
  label: string;
  itemIds: NavItemId[];
};

const DISPLAY_LABELS: Partial<Record<NavItemId, string>> = {
  dashboard: "Home",
  godmodeHome: "Home",
  auditCentre: "Audits",
  audits: "Audits",
  actions: "Actions",
  schedules: "Schedule",
  briefings: "Briefings",
  incidents: "Safety",
  nonConformance: "NCRs",
  documents: "Document Library",
  documentControl: "Documents",
  loler: "Equipment",
  reports: "Reports",
  sync: "Sync Centre",
  users: "People",
  invites: "People",
  admin: "Administration",
  companies: "Sites and Areas",
  onboarding: "Company Onboarding",
  setup: "Administration",
  setupInitial: "Tablet / Kiosk",
  results: "Results",
  calendar: "Calendar",
  archive: "Archive",
  account: "Account",
};

const GROUPS_BY_BUCKET: Record<ReturnType<typeof getRoleNavBucket>, NavPresentationGroup[]> = {
  master: [
    { id: "home", label: "Home", itemIds: ["godmodeHome", "dashboard"] },
    {
      id: "platform",
      label: "Administration",
      itemIds: ["setup", "companies", "onboarding", "users", "schedules", "reports", "sync", "account", "setupInitial"],
    },
    {
      id: "work",
      label: "Work",
      itemIds: ["auditCentre", "briefings", "results"],
    },
    {
      id: "compliance",
      label: "Compliance",
      itemIds: ["documents", "documentControl", "loler", "calendar", "archive"],
    },
  ],
  companyAdmin: [
    { id: "home", label: "Home", itemIds: ["dashboard"] },
    { id: "work", label: "Operations", itemIds: ["auditCentre", "schedules", "actions", "briefings", "results"] },
    {
      id: "compliance",
      label: "Compliance",
      itemIds: ["documents", "documentControl", "incidents", "nonConformance", "loler", "calendar"],
    },
    { id: "platform", label: "Insight", itemIds: ["reports"] },
    {
      id: "administration",
      label: "Management",
      itemIds: ["users", "admin", "sync", "archive", "account"],
    },
  ],
  manager: [
    { id: "home", label: "Home", itemIds: ["dashboard"] },
    { id: "work", label: "Operations", itemIds: ["auditCentre", "schedules", "actions", "briefings", "results"] },
    {
      id: "compliance",
      label: "Compliance",
      itemIds: ["documents", "documentControl", "incidents", "nonConformance", "loler", "calendar"],
    },
    { id: "platform", label: "Insight", itemIds: ["reports"] },
    {
      id: "administration",
      label: "Management",
      itemIds: ["invites", "sync", "archive", "account"],
    },
  ],
  auditor: [
    { id: "home", label: "Home", itemIds: ["dashboard"] },
    { id: "work", label: "Operations", itemIds: ["auditCentre", "briefings"] },
    {
      id: "compliance",
      label: "Compliance",
      itemIds: ["documents", "documentControl", "incidents", "loler", "calendar"],
    },
    {
      id: "administration",
      label: "Management",
      itemIds: ["sync", "account"],
    },
  ],
};

export function getNavDisplayLabel(item: PresentedNavItem): string {
  if (item.id === "schedules" && item.label === "Templates") {
    return "Templates";
  }
  if (item.id === "reports" && item.label.includes("Diagnostics")) {
    return "Reports / Diagnostics";
  }
  return DISPLAY_LABELS[item.id] ?? item.label;
}

export function groupPresentedNav(
  role: Role,
  items: PresentedNavItem[],
): Array<NavPresentationGroup & { items: PresentedNavItem[] }> {
  const bucket = getRoleNavBucket(role);
  const groups = GROUPS_BY_BUCKET[bucket];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assigned = new Set<NavItemId>();

  const grouped = groups
    .map((group) => {
      const groupItems = group.itemIds.flatMap((id) => {
        const item = itemById.get(id);
        if (!item || assigned.has(id)) return [];
        assigned.add(id);
        return [item];
      });
      return { ...group, items: groupItems };
    })
    .filter((group) => group.items.length > 0);

  const leftovers = items.filter((item) => !assigned.has(item.id));
  if (leftovers.length > 0) {
    grouped.push({ id: "platform", label: "More", itemIds: leftovers.map((item) => item.id), items: leftovers });
  }
  return grouped;
}

export function getFriendlyPresentedNav(role: Role): PresentedNavItem[] {
  return getPresentedNavForRole(role).map((item) => ({
    ...item,
    label: getNavDisplayLabel(item),
  }));
}

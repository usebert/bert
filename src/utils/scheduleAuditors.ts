import type { Role } from "../permissions";
import type { CompanyReportUser } from "../types/reports";

export type ScheduleAuditorOption = {
  id: string;
  name: string;
  role: Role;
  email: string;
};

type InviteLike = {
  email: string;
  status: string;
  loginReady?: boolean;
};

const SCHEDULE_AUDITOR_ROLES: Role[] = ["Admin", "Manager", "Auditor"];

export function isScheduleAuditorRole(role: Role): boolean {
  return SCHEDULE_AUDITOR_ROLES.includes(role);
}

function isActiveWorkspaceInvite(invite: InviteLike): boolean {
  return invite.status === "Active" || invite.loginReady === true;
}

function normalizeAuditorKey(value: string): string {
  return value.trim().toLowerCase();
}

export function buildAvailableScheduleAuditors(
  reportUsers: CompanyReportUser[],
  invitedUsers: InviteLike[],
): ScheduleAuditorOption[] {
  const inviteByEmail = new Map(
    invitedUsers.map((invite) => [normalizeAuditorKey(invite.email), invite]),
  );

  const options = reportUsers
    .filter((user) => isScheduleAuditorRole(user.role))
    .filter((user) => {
      const invite = inviteByEmail.get(normalizeAuditorKey(user.email));
      if (!invite) {
        return true;
      }
      return isActiveWorkspaceInvite(invite);
    })
    .map((user) => ({
      id: normalizeAuditorKey(user.email),
      name: user.name,
      role: user.role,
      email: user.email,
    }));

  return options.filter((user, index, list) => list.findIndex((item) => item.id === user.id) === index);
}

export function normalizeScheduleAuditorIds(
  savedAuditors: string[],
  options: ScheduleAuditorOption[],
): string[] {
  const normalized = new Set<string>();

  for (const saved of savedAuditors) {
    const savedKey = normalizeAuditorKey(saved);
    if (!savedKey) {
      continue;
    }

    const match = options.find(
      (option) =>
        option.id === savedKey ||
        normalizeAuditorKey(option.name) === savedKey ||
        normalizeAuditorKey(option.email) === savedKey,
    );

    normalized.add(match?.id || savedKey);
  }

  return [...normalized];
}

export function resolveScheduleAuditorLabels(
  auditorIds: string[],
  options: ScheduleAuditorOption[],
): string[] {
  return auditorIds.map((auditorId) => {
    const match = options.find((option) => option.id === normalizeAuditorKey(auditorId));
    return match?.email || auditorId;
  });
}

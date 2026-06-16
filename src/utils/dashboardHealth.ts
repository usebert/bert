export type DashboardAuditStatus = "green" | "amber" | "red";

export type DashboardScheduleHealthState = "Healthy" | "Due Soon" | "Overdue" | "Failing" | "Paused";

export type DashboardScheduleHealthInput = {
  lifecycle?: string;
  healthState?: string;
  nextDueAt?: string | null;
  missedAuditCount?: number;
};

export const amberThresholdHours = 2;

export const statusStyles: Record<
  DashboardAuditStatus,
  {
    label: string;
    dot: string;
    soft: string;
    ring: string;
    text: string;
  }
> = {
  green: {
    label: `More than ${amberThresholdHours} hours`,
    dot: "bg-blue-600",
    soft: "bg-blue-500/12",
    ring: "ring-blue-500/25",
    text: "text-blue-800",
  },
  amber: {
    label: `Less than ${amberThresholdHours} hours`,
    dot: "bg-amber-500",
    soft: "bg-amber-500/12",
    ring: "ring-amber-500/25",
    text: "text-amber-700",
  },
  red: {
    label: "Overdue",
    dot: "bg-rose-500",
    soft: "bg-rose-500/12",
    ring: "ring-rose-500/25",
    text: "text-rose-700",
  },
};

export function getAuditTrafficStatus(dueHours: number): DashboardAuditStatus {
  if (dueHours < 0) {
    return "red";
  }
  if (dueHours < amberThresholdHours) {
    return "amber";
  }
  return "green";
}

export function getDueWarning(dueHours: number) {
  if (dueHours < 0) {
    return `Overdue by ${Math.abs(dueHours)} hour${Math.abs(dueHours) === 1 ? "" : "s"}`;
  }
  if (dueHours < amberThresholdHours) {
    return `Warning: less than ${amberThresholdHours} hours remaining`;
  }
  return `${dueHours} hours remaining`;
}

export function computeScheduleHealthState(schedule: DashboardScheduleHealthInput): DashboardScheduleHealthState {
  if (schedule.lifecycle === "Archived") {
    return "Paused";
  }
  if (schedule.healthState === "Paused") {
    if (schedule.nextDueAt) {
      const resumeAt = new Date(schedule.nextDueAt).getTime();
      if (Number.isFinite(resumeAt) && resumeAt > Date.now()) {
        return "Paused";
      }
    } else {
      return "Paused";
    }
  }
  if ((schedule.missedAuditCount || 0) > 0) {
    return "Failing";
  }
  if (schedule.nextDueAt) {
    const diffHours = Math.round((new Date(schedule.nextDueAt).getTime() - Date.now()) / 36e5);
    if (diffHours < 0) return "Overdue";
    if (diffHours < amberThresholdHours) return "Due Soon";
  }
  return "Healthy";
}

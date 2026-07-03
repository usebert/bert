export type BriefingType = "Policy" | "Toolbox Talk" | "Notice" | "Training" | "Other";
export type BriefingPriority = "Normal" | "Important" | "Urgent";
export type BriefingTargetMode = "everyone" | "role" | "area" | "department" | "users";
export type BriefingRenewalFrequency = "None" | "Annual" | "6 monthly" | "Custom";

export type BriefingRecipientStatus =
  | "New"
  | "Opened"
  | "Read"
  | "Acknowledged"
  | "Signed"
  | "Replied"
  | "Overdue"
  | "Complete";

export type BriefingRecord = {
  briefingId: string;
  title: string;
  type: BriefingType;
  status: string;
  priority: BriefingPriority;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  sentAt: string;
  dueDate?: string;
  requiresRead: boolean;
  requiresAcknowledgement: boolean;
  requiresSignature: boolean;
  requiresReply: boolean;
  renewalFrequency: BriefingRenewalFrequency;
  renewalDueDate?: string;
  targetMode: BriefingTargetMode;
  targetRoles?: string;
  targetAreas?: string;
  targetDepartments?: string;
  targetUserEmails?: string;
  documentName?: string;
  documentDriveFileId?: string;
  documentDriveLink?: string;
  message: string;
  recipientCount: number;
  openedCount: number;
  readCount: number;
  acknowledgedCount: number;
  signedCount: number;
  replyCount: number;
  overdueCount: number;
};

export type BriefingRecipientRecord = {
  briefingId: string;
  recipientEmail: string;
  recipientName: string;
  role?: string;
  area?: string;
  department?: string;
  sentAt: string;
  openedAt?: string;
  readAt?: string;
  acknowledgedAt?: string;
  signedAt?: string;
  replyText?: string;
  replyAt?: string;
  status: BriefingRecipientStatus;
  overdue: boolean;
  signatureName?: string;
  lastReminderAt?: string;
  briefing?: BriefingRecord;
  needsAction?: boolean;
};

export type BriefingCreateInput = {
  title: string;
  type: BriefingType;
  priority?: BriefingPriority;
  message?: string;
  dueDate?: string;
  requiresRead?: boolean;
  requiresAcknowledgement?: boolean;
  requiresSignature?: boolean;
  requiresReply?: boolean;
  renewalFrequency?: BriefingRenewalFrequency;
  targetMode: BriefingTargetMode;
  targetRoles?: string[];
  targetAreas?: string[];
  targetDepartments?: string[];
  targetUserEmails?: string[];
  documentName?: string;
  documentDriveFileId?: string;
  documentDriveLink?: string;
};

export type DashboardToDoItem = {
  id: string;
  kind: "check" | "briefing";
  title: string;
  typeLabel: string;
  group: "overdue" | "dueToday" | "waiting" | "upcoming";
  dueLabel?: string;
  statusLabel?: string;
  actionLabel: string;
  auditId?: string;
  briefingId?: string;
  priority?: number;
};

export type BriefingTeamSummary = {
  overdueChecks?: number;
  unsignedDocuments?: number;
  unreadBriefings?: number;
  openIncidentActions?: number;
};

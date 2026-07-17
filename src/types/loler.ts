/** LOLER equipment compliance — client-side types (Phase 1). */

export type LolerEquipmentStatus = "active" | "out_of_service" | "archived";

export type LolerComplianceStatus =
  | "compliant"
  | "due_soon"
  | "overdue"
  | "out_of_service"
  | "archived";

export type LolerScheduleStatus = "upcoming" | "due_soon" | "overdue" | "completed" | "cancelled";

export type LolerEquipment = {
  id: string;
  assetId: string;
  equipmentName: string;
  equipmentType: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  siteId?: string;
  siteName?: string;
  areaId?: string;
  areaName?: string;
  ownerDepartment?: string;
  status: LolerEquipmentStatus;
  examinationIntervalMonths: number;
  lastExaminationDate?: string;
  nextExaminationDueDate: string;
  assignedPersonId?: string;
  assignedPersonName?: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
  archivedBy?: string;
  complianceStatus: LolerComplianceStatus;
};

export type LolerSchedule = {
  lolerScheduleId: string;
  equipmentId: string;
  assetId: string;
  equipmentName: string;
  siteId?: string;
  siteName?: string;
  areaId?: string;
  areaName?: string;
  dueDate: string;
  assignedPersonId?: string;
  assignedPersonName?: string;
  scheduleStatus: LolerScheduleStatus;
  completedAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type LolerEquipmentSummary = {
  totalActive: number;
  compliant: number;
  dueSoon: number;
  overdue: number;
  outOfService: number;
  archived: number;
};

export type LolerExaminationResult = "passed" | "passed_with_observations" | "failed";

export type LolerExamination = {
  examinationId: string;
  equipmentId: string;
  assetId: string;
  equipmentName: string;
  examinationDate: string;
  examinerPersonId?: string;
  examinerName?: string;
  examinerEmail?: string;
  examinationResult: LolerExaminationResult;
  observations?: string;
  defectsFound?: string;
  reportFileId?: string;
  reportFileName?: string;
  reportFileUrl?: string;
  nextExaminationDueDate?: string;
  currentScheduleId?: string;
  recordedAt: string;
  recordedBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type LolerReminderOption = "none" | "at_datetime" | "1" | "7" | "30" | "custom";

export type LolerExaminationInput = {
  equipmentId: string;
  examinationDate: string;
  examinerPersonId?: string;
  examinerName?: string;
  examinerEmail?: string;
  examinationResult: LolerExaminationResult;
  observations?: string;
  defectsFound?: string;
  nextExaminationDueDate: string;
  currentScheduleId?: string;
  markOutOfService?: boolean;
  reportFile?: {
    name?: string;
    mimeType?: string;
    dataUrl?: string;
    base64?: string;
    size?: number;
  };
  messageRecipientPersonId?: string;
  messageRecipientName?: string;
  messageRecipientEmail?: string;
  messageSubject?: string;
  messageBody?: string;
  reminderOption?: LolerReminderOption;
  reminderDate?: string;
  reminderTime?: string;
  reminderDaysBefore?: number;
  reminderAssigneeEmail?: string;
  reminderAssigneeName?: string;
};

export type LolerEquipmentInput = {
  assetId: string;
  equipmentName: string;
  equipmentType: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  siteId?: string;
  siteName?: string;
  areaId?: string;
  areaName?: string;
  ownerDepartment?: string;
  status?: LolerEquipmentStatus;
  examinationIntervalMonths: number;
  lastExaminationDate?: string;
  nextExaminationDueDate?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;
  notes?: string;
};

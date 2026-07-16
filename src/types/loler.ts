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

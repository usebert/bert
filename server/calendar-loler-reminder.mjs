/**
 * Narrow Calendar helper — create a LOLER-linked reminder with additive Related* fields.
 * Does not alter existing Calendar items or Calendar UI behaviour.
 */
import { createCalendarItem } from "./calendar-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

/**
 * Create a Calendar reminder linked to a LOLER examination / schedule.
 * `input` uses the same reminder fields already accepted by recordLolerExamination.
 */
export async function createLolerLinkedReminder(auth, deps, context, actor, input = {}, options = {}) {
  const reminderPlan = input.reminderPlan || {};
  if (!reminderPlan.enabled) {
    return { ok: true, skipped: true, item: null };
  }

  const equipment = input.equipment || {};
  const examinationId = trim(input.examinationId);
  const equipmentId = trim(input.equipmentId || equipment.id);
  const recipientEmail = normalizeEmail(
    input.reminderAssigneeEmail ||
      input.messageRecipientEmail ||
      input.examinerEmail ||
      equipment.assignedPersonId,
  );
  const recipientName =
    trim(input.reminderAssigneeName) ||
    trim(input.messageRecipientName) ||
    trim(input.examinerName) ||
    trim(equipment.assignedPersonName) ||
    "";

  return createCalendarItem(
    auth,
    deps,
    context,
    actor,
    {
      itemType: "reminder",
      title: `LOLER examination due: ${equipment.equipmentName} (${equipment.assetId})`,
      description:
        trim(input.messageBody || input.message) ||
        `Reminder for next LOLER examination of ${equipment.equipmentName} (${equipment.assetId}).`,
      startDate: reminderPlan.startDate,
      startTime: reminderPlan.startTime,
      endDate: reminderPlan.startDate,
      allDay: reminderPlan.allDay,
      assignedPersonId: recipientEmail,
      assignedPersonName: recipientName,
      assignedPersonEmail: recipientEmail,
      siteId: equipment.siteId,
      siteName: equipment.siteName,
      areaId: equipment.areaId,
      areaName: equipment.areaName,
      priority: input.examinationResult === "failed" ? "high" : "normal",
      relatedModule: "loler",
      relatedRecordId: examinationId,
      relatedEquipmentId: equipmentId,
      relatedExaminationId: examinationId,
      relatedScheduleId: trim(input.relatedScheduleId),
    },
    { todayKey: options.todayKey },
  );
}

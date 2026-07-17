import { useMemo, useState } from "react";
import type { LolerEquipment, LolerExaminationInput, LolerExaminationResult, LolerReminderOption, LolerSchedule } from "../../types/loler";
import type { ScheduleAssigneeOption } from "../../utils/scheduleAssignees";

type Props = {
  equipment: LolerEquipment;
  schedule?: LolerSchedule | null;
  assignees: ScheduleAssigneeOption[];
  userEmail: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: LolerExaminationInput) => void;
};

const RESULT_OPTIONS: Array<{ value: LolerExaminationResult; label: string }> = [
  { value: "passed", label: "Passed" },
  { value: "passed_with_observations", label: "Passed with observations" },
  { value: "failed", label: "Failed" },
];

const REMINDER_OPTIONS: Array<{ value: LolerReminderOption; label: string }> = [
  { value: "none", label: "No reminder" },
  { value: "at_datetime", label: "At a selected date and time" },
  { value: "1", label: "1 day before due date" },
  { value: "7", label: "7 days before due date" },
  { value: "30", label: "30 days before due date" },
  { value: "custom", label: "Custom days before due date" },
];

function fileToDataUrl(file: File): Promise<{ name: string; mimeType: string; dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl: String(reader.result || ""),
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function RecordExaminationForm({
  equipment,
  schedule,
  assignees,
  userEmail,
  saving,
  onCancel,
  onSave,
}: Props) {
  const defaultExaminer = useMemo(() => {
    const assigned = assignees.find(
      (person) => String(person.email || "").toLowerCase() === String(equipment.assignedPersonId || "").toLowerCase(),
    );
    const self = assignees.find((person) => String(person.email || "").toLowerCase() === userEmail.toLowerCase());
    return assigned || self || null;
  }, [assignees, equipment.assignedPersonId, userEmail]);

  const [examinationDate, setExaminationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [examinerPersonId, setExaminerPersonId] = useState(defaultExaminer?.email || userEmail || "");
  const [examinationResult, setExaminationResult] = useState<LolerExaminationResult>("passed");
  const [nextDueDate, setNextDueDate] = useState(equipment.nextExaminationDueDate || "");
  const [observations, setObservations] = useState("");
  const [defectsFound, setDefectsFound] = useState("");
  const [markOutOfService, setMarkOutOfService] = useState(false);
  const [sendMessage, setSendMessage] = useState(false);
  const [messageRecipient, setMessageRecipient] = useState(equipment.assignedPersonId || "");
  const [messageSubject, setMessageSubject] = useState(
    `LOLER examination: ${equipment.equipmentName} (${equipment.assetId})`,
  );
  const [messageBody, setMessageBody] = useState("");
  const [reminderOption, setReminderOption] = useState<LolerReminderOption>("none");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderDaysBefore, setReminderDaysBefore] = useState("14");
  const [reportFile, setReportFile] = useState<LolerExaminationInput["reportFile"]>();
  const [localError, setLocalError] = useState("");

  const examiner = assignees.find((person) => String(person.email || "").toLowerCase() === examinerPersonId.toLowerCase());
  const messageRecipientPerson = assignees.find(
    (person) => String(person.email || "").toLowerCase() === messageRecipient.toLowerCase(),
  );

  const submit = async () => {
    setLocalError("");
    if (!examinationDate || !examinerPersonId || !nextDueDate) {
      setLocalError("Examination date, examiner, and next due date are required.");
      return;
    }
    onSave({
      equipmentId: equipment.id,
      examinationDate,
      examinerPersonId,
      examinerName: examiner?.name || "",
      examinerEmail: examinerPersonId,
      examinationResult,
      observations: observations.trim() || undefined,
      defectsFound: defectsFound.trim() || undefined,
      nextExaminationDueDate: nextDueDate,
      currentScheduleId: schedule?.lolerScheduleId,
      markOutOfService: examinationResult === "failed" ? markOutOfService : false,
      reportFile,
      messageRecipientPersonId: sendMessage ? messageRecipient : undefined,
      messageRecipientName: sendMessage ? messageRecipientPerson?.name : undefined,
      messageRecipientEmail: sendMessage ? messageRecipient : undefined,
      messageSubject: sendMessage ? messageSubject : undefined,
      messageBody: sendMessage ? messageBody : undefined,
      reminderOption,
      reminderDate: reminderOption === "at_datetime" ? reminderDate : undefined,
      reminderTime: reminderOption === "at_datetime" ? reminderTime : undefined,
      reminderDaysBefore: reminderOption === "custom" ? Number(reminderDaysBefore) : undefined,
      reminderAssigneeEmail: sendMessage ? messageRecipient : examinerPersonId,
      reminderAssigneeName: sendMessage ? messageRecipientPerson?.name : examiner?.name,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-black text-slate-900">Record examination</h2>
        <p className="mt-1 text-sm text-slate-600">
          {equipment.assetId} — {equipment.equipmentName}
          {schedule?.dueDate ? ` · Schedule due ${schedule.dueDate}` : ""}
        </p>

        <div className="mt-4 grid gap-3">
          <label className="text-sm font-semibold text-slate-700">
            Examination date *
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              value={examinationDate}
              onChange={(event) => setExaminationDate(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Examiner *
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              value={examinerPersonId}
              onChange={(event) => setExaminerPersonId(event.target.value)}
            >
              <option value="">Select examiner</option>
              {assignees.map((person) => (
                <option key={person.email} value={person.email}>
                  {person.name || person.email}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Result *
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              value={examinationResult}
              onChange={(event) => setExaminationResult(event.target.value as LolerExaminationResult)}
            >
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Next examination due date *
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              value={nextDueDate}
              onChange={(event) => setNextDueDate(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Observations
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              rows={2}
              value={observations}
              onChange={(event) => setObservations(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Defects found
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              rows={2}
              value={defectsFound}
              onChange={(event) => setDefectsFound(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Report / certificate (PDF, JPG, PNG)
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="mt-1 block w-full text-sm font-normal"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  setReportFile(undefined);
                  return;
                }
                void fileToDataUrl(file)
                  .then((payload) => setReportFile(payload))
                  .catch((error) => setLocalError(error instanceof Error ? error.message : "Could not read file."));
              }}
            />
            {reportFile?.name ? <span className="mt-1 block text-xs text-slate-500">{reportFile.name}</span> : null}
          </label>

          {examinationResult === "failed" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-800">Failed examination — equipment requires attention.</p>
              <label className="mt-2 flex items-center gap-2 text-sm text-red-900">
                <input
                  type="checkbox"
                  checked={markOutOfService}
                  onChange={(event) => setMarkOutOfService(event.target.checked)}
                />
                Mark equipment out of service now
              </label>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={sendMessage} onChange={(event) => setSendMessage(event.target.checked)} />
              Send linked message
            </label>
            {sendMessage ? (
              <div className="mt-3 grid gap-2">
                <label className="text-sm text-slate-700">
                  Recipient
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                    value={messageRecipient}
                    onChange={(event) => setMessageRecipient(event.target.value)}
                  >
                    <option value="">Select recipient</option>
                    {assignees.map((person) => (
                      <option key={person.email} value={person.email}>
                        {person.name || person.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-700">
                  Subject
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                    value={messageSubject}
                    onChange={(event) => setMessageSubject(event.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Message
                  <textarea
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                    rows={3}
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="text-sm font-semibold text-slate-800">
              Timed reminder
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-normal"
                value={reminderOption}
                onChange={(event) => setReminderOption(event.target.value as LolerReminderOption)}
              >
                {REMINDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {reminderOption === "at_datetime" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={reminderDate}
                  onChange={(event) => setReminderDate(event.target.value)}
                />
                <input
                  type="time"
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={reminderTime}
                  onChange={(event) => setReminderTime(event.target.value)}
                />
              </div>
            ) : null}
            {reminderOption === "custom" ? (
              <input
                type="number"
                min={0}
                className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                value={reminderDaysBefore}
                onChange={(event) => setReminderDaysBefore(event.target.value)}
                placeholder="Days before due date"
              />
            ) : null}
          </div>
        </div>

        {localError ? <p className="mt-3 text-sm text-red-700">{localError}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save examination"}
          </button>
        </div>
      </div>
    </div>
  );
}

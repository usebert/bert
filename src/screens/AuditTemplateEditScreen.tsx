import { useEffect, useMemo, useState } from "react";
import type { FormLanguageCode } from "../config/templateLanguages";
import { getRoleTheme } from "../config/roleTheme";
import { CreateGoogleFormCopyOption } from "../components/forms/CreateGoogleFormCopyOption";
import { GoogleFormTemplatePanel } from "../components/admin/GoogleFormTemplatePanel";
import { AuditCentreBackButton } from "../components/auditCentre/AuditCentreBackButton";
import { SectionIntro } from "../components/SectionIntro";
import {
  archiveAuditBuilderTemplate,
  copyAuditBuilderTemplate,
  createAuditTemplateNewVersion,
  getAuditBuilderTemplate,
  saveAuditBuilderTemplate,
  TEMPLATE_USED_WARNING,
  updateAuditBuilderTemplate,
} from "../services/auditBuilderService";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";
import { CopyAuditFormModal } from "../components/forms/CopyAuditFormModal";
import { ReviseAuditFormModal } from "../components/forms/ReviseAuditFormModal";
import { canArchiveRecordFromClient } from "../utils/archivePermissions";
import { canManageTemplates } from "../permissions";
import type {
  AuditBuilderTemplateDraft,
  AuditBuilderTemplateRecord,
  AuditBuilderTemplateStatus,
} from "../types/auditBuilder";
import type { AuditTemplate } from "../types/reportsScreenProps";
import type { Role } from "../permissions";
import type { GoogleFormCopyOptionState } from "../utils/googleFormCopyOptionState";
import { bertTemplateToEditorDraft } from "../utils/auditBuilderMapping";
import {
  addQuestionToSection,
  addSection,
  moveQuestionDown,
  moveQuestionUp,
  moveSectionDown,
  moveSectionUp,
  removeQuestion,
  removeSection,
  updateQuestionField,
  updateQuestionOptions,
  updateSectionName,
  validateTemplateDraft,
} from "../utils/auditTemplateEditor";

type Props = {
  role: Role;
  templateId: string;
  fallbackTemplate?: AuditTemplate;
  masterSheetId?: string;
  devApiHeaders?: Record<string, string>;
  companyFolderId?: string;
  googleFormCopyOption: GoogleFormCopyOptionState;
  createGoogleFormCopy: boolean;
  onCreateGoogleFormCopyChange: (value: boolean) => void;
  googleFormCopyLanguage: FormLanguageCode;
  onGoogleFormCopyLanguageChange: (value: FormLanguageCode) => void;
  onBack: () => void;
  onTemplateUpdated: (
    template: AuditBuilderTemplateRecord,
    options?: {
      replacedTemplateId?: string;
      createGoogleFormCopy?: boolean;
      googleFormCopyLanguage?: FormLanguageCode;
    },
  ) => void;
  onTemplateArchived: (templateId: string) => void;
};

type EditorDraft = AuditBuilderTemplateDraft & {
  status: AuditBuilderTemplateStatus;
};

const CATEGORY_OPTIONS = ["Audits", "Health & Safety", "ISO 9001", "ISO 14001", "ISO 45001", "General"];

export function AuditTemplateEditScreen({
  role,
  templateId,
  fallbackTemplate,
  masterSheetId,
  devApiHeaders,
  companyFolderId,
  googleFormCopyOption,
  createGoogleFormCopy,
  onCreateGoogleFormCopyChange,
  googleFormCopyLanguage,
  onGoogleFormCopyLanguageChange,
  onBack,
  onTemplateUpdated,
  onTemplateArchived,
}: Props) {
  const theme = getRoleTheme(role);
  const requestOptions = { masterSheetId, companyFolderId, devApiHeaders };
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [recordMeta, setRecordMeta] = useState<Pick<
    AuditBuilderTemplateRecord,
    | "id"
    | "version"
    | "parent_template_id"
    | "is_used"
    | "form_number"
    | "revision_number"
    | "revision_label"
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [showUsedWarning, setShowUsedWarning] = useState(false);
  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [reviseError, setReviseError] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [reviseBusy, setReviseBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const canManageRevisions = canManageTemplates(role);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const record = await getAuditBuilderTemplate(templateId, requestOptions);
        if (cancelled) return;
        setDraft({
          template_name: record.template_name,
          description: record.description,
          category: record.category,
          sections: record.sections,
          status: record.status || "active",
        });
        setRecordMeta({
          id: record.id,
          version: record.version || record.revision_number || 1,
          parent_template_id: record.parent_template_id,
          is_used: record.is_used,
          form_number: record.form_number,
          revision_number: record.revision_number || record.version || 1,
          revision_label: record.revision_label,
        });
        setIsLocalOnly(false);
      } catch {
        if (cancelled) return;
        if (fallbackTemplate) {
          const converted = bertTemplateToEditorDraft(fallbackTemplate);
          setDraft({
            ...converted,
            status: fallbackTemplate.active ? "active" : "inactive",
          });
          setRecordMeta({
            id: fallbackTemplate.id,
            version: 1,
            parent_template_id: null,
            is_used: false,
            form_number: "",
            revision_number: 1,
            revision_label: "Rev 1 · Active",
          });
          setIsLocalOnly(true);
        } else {
          setError("Template not found.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [templateId, fallbackTemplate, masterSheetId]);

  const questionCount = useMemo(
    () => (draft?.sections || []).reduce((sum, section) => sum + section.questions.length, 0),
    [draft],
  );

  const persistDraft = async (mode: "save" | "new-version", createNewVersion = false) => {
    if (!draft || !recordMeta) return;
    const validation = validateTemplateDraft(draft);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError("");
    setSaving(true);
    setError("");
    try {
      let record: AuditBuilderTemplateRecord;
      if (isLocalOnly) {
        record = await saveAuditBuilderTemplate({ ...draft, id: recordMeta.id }, requestOptions);
        setIsLocalOnly(false);
      } else if (mode === "new-version") {
        record = await createAuditTemplateNewVersion(recordMeta.id, draft, requestOptions);
      } else {
        record = await updateAuditBuilderTemplate(recordMeta.id, draft, {
          ...requestOptions,
          createNewVersion,
        });
      }
      setRecordMeta({
        id: record.id,
        version: record.version || record.revision_number || 1,
        parent_template_id: record.parent_template_id,
        is_used: record.is_used,
        form_number: record.form_number,
        revision_number: record.revision_number || record.version || 1,
        revision_label: record.revision_label,
      });
      setShowUsedWarning(false);
      if (mode === "new-version") {
        setSuccessMessage("Revision created.");
      }
      onTemplateUpdated(record, {
        replacedTemplateId: record.id !== templateId ? templateId : undefined,
        createGoogleFormCopy:
          createGoogleFormCopy && !googleFormCopyOption.disabled && !fallbackTemplate?.googleForm?.formId,
        googleFormCopyLanguage,
      });
    } catch (err) {
      const typed = err as Error & { requiresNewVersion?: boolean };
      if (typed.requiresNewVersion) {
        setShowUsedWarning(true);
        setError(TEMPLATE_USED_WARNING);
      } else {
        setError(err instanceof Error ? err.message : "Unable to save template.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChanges = () => {
    if (recordMeta?.is_used) {
      setShowUsedWarning(true);
      return;
    }
    void persistDraft("save");
  };

  const handleConfirmUsedSave = () => {
    void persistDraft("save", true);
  };

  const handleCopySubmit = async (input: {
    title: string;
    reason: string;
    confirmArchivedTitle?: boolean;
  }) => {
    if (!recordMeta) return;
    if (!input.title.trim()) {
      setCopyError("Enter a title for the copied form.");
      return;
    }
    setCopyBusy(true);
    setCopyError("");
    try {
      if (isLocalOnly) {
        await saveAuditBuilderTemplate({ ...draft!, id: recordMeta.id }, requestOptions);
        setIsLocalOnly(false);
      }
      const record = await copyAuditBuilderTemplate(
        recordMeta.id,
        {
          title: input.title,
          reason: input.reason,
          confirmArchivedTitle: input.confirmArchivedTitle,
        },
        requestOptions,
      );
      setCopyOpen(false);
      setSuccessMessage("Copy created.");
      onTemplateUpdated(record);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Unable to copy template.");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleReviseSubmit = async (input: { reason: string }) => {
    if (!draft || !recordMeta) return;
    if (!input.reason.trim()) {
      setReviseError("Enter a reason for this revision.");
      return;
    }
    const validation = validateTemplateDraft(draft);
    if (validation) {
      setReviseError(validation);
      return;
    }
    setReviseBusy(true);
    setReviseError("");
    try {
      if (isLocalOnly) {
        await saveAuditBuilderTemplate({ ...draft, id: recordMeta.id }, requestOptions);
        setIsLocalOnly(false);
      }
      const record = await createAuditTemplateNewVersion(
        recordMeta.id,
        { ...draft, reason: input.reason },
        requestOptions,
      );
      setRecordMeta({
        id: record.id,
        version: record.version || record.revision_number || 1,
        parent_template_id: record.parent_template_id,
        is_used: record.is_used,
        form_number: record.form_number,
        revision_number: record.revision_number || record.version || 1,
        revision_label: record.revision_label,
      });
      setReviseOpen(false);
      setSuccessMessage("Revision created.");
      onTemplateUpdated(record, {
        replacedTemplateId: record.id !== templateId ? templateId : undefined,
      });
    } catch (err) {
      setReviseError(err instanceof Error ? err.message : "Unable to create revision.");
    } finally {
      setReviseBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!recordMeta) return;
    if (!window.confirm("Archive this template? It will be deactivated but kept for historic records.")) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isLocalOnly) {
        onTemplateArchived(recordMeta.id);
        onBack();
        return;
      }
      await archiveAuditBuilderTemplate(recordMeta.id, requestOptions);
      onTemplateArchived(recordMeta.id);
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive template.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">Loading template…</p>
      </section>
    );
  }

  if (!draft || !recordMeta) {
    return (
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-rose-700">{error || "Template not found."}</p>
        <button
          type="button"
          onClick={onBack}
          className={["mt-4 inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold", theme.outlineButton].join(
            " ",
          )}
        >
          Back to Audit Centre
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <AuditCentreBackButton onClick={onBack} />
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Edit Audit Template</h2>
              <SectionIntro
                text="Update sections, questions, and answer settings. Use Revise to create a controlled new revision of this form, or Copy to create a separate form with a new form number."
                className="mt-2"
                role={role}
              />
              <p className="mt-2 text-xs font-medium text-slate-700" data-testid="audit-form-revision-label">
                {recordMeta.revision_label ||
                  `${recordMeta.form_number ? `${recordMeta.form_number} · ` : ""}Rev ${recordMeta.revision_number || recordMeta.version || 1} · ${String(draft.status || "active").charAt(0).toUpperCase()}${String(draft.status || "active").slice(1)}`}
                {recordMeta.is_used ? " · Used in completed or in-progress audits" : " · Not yet used"}
              </p>
              {successMessage ? <p className="mt-2 text-sm font-medium text-emerald-700">{successMessage}</p> : null}
            </div>
          </div>
          {canManageRevisions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="audit-form-revision-actions">
              <button
                type="button"
                data-testid="audit-form-revise-button"
                onClick={() => {
                  setReviseError("");
                  setReviseOpen(true);
                }}
                disabled={saving || reviseBusy || copyBusy}
                title="You are creating a new revision of this controlled form."
                className={["inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold", theme.outlineButton].join(
                  " ",
                )}
              >
                Revise
              </button>
              <button
                type="button"
                data-testid="audit-form-copy-button"
                onClick={() => {
                  setCopyError("");
                  setCopyOpen(true);
                }}
                disabled={saving || reviseBusy || copyBusy}
                title="You are creating a new form based on this one. It will get its own form number and start at Rev 1."
                className={["inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold", theme.outlineButton].join(
                  " ",
                )}
              >
                Copy
              </button>
              {canArchiveRecordFromClient(role, "audit") && companyFolderId && recordMeta ? (
                <ArchiveRecordButton
                  recordType="audit"
                  recordId={recordMeta.id}
                  companyFolderId={companyFolderId}
                  masterSheetId={masterSheetId}
                  canArchive
                  label="Archive"
                  className="inline-flex h-11 items-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700"
                  onArchived={() => {
                    onTemplateArchived(recordMeta.id);
                    onBack();
                  }}
                  onError={(message) => setError(message)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => void handleArchive()}
                  disabled={saving}
                  className="inline-flex h-11 items-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700"
                >
                  Archive
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {showUsedWarning ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Template already used</p>
          <p className="mt-1">{TEMPLATE_USED_WARNING}</p>
          <p className="mt-2 text-xs text-amber-800">
            Existing schedules keep the version they were created with. A future &quot;Update to latest version&quot; option
            on schedule edit is planned.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirmUsedSave}
              disabled={saving}
              className={[
                "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {saving ? "Saving…" : "Save as new revision"}
            </button>
            <button
              type="button"
              onClick={() => setShowUsedWarning(false)}
              className={["inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold", theme.outlineButton].join(
                " ",
              )}
            >
              Keep editing
            </button>
          </div>
        </section>
      ) : null}

      <section className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Template name
            <input
              value={draft.template_name}
              onChange={(event) => setDraft({ ...draft, template_name: event.target.value })}
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Category
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-slate-400"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Description
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="mt-2 min-h-[5rem] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Status
          <select
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as AuditBuilderTemplateStatus })}
            className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-slate-400"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        {fallbackTemplate?.googleForm?.formId ? (
          <GoogleFormTemplatePanel
            templateId={recordMeta.id}
            templateName={draft.template_name}
            category={draft.category || "General"}
            companyFolderId={companyFolderId}
            placement={googleFormCopyOption.placement}
            googleForm={fallbackTemplate.googleForm}
            templateLanguage={fallbackTemplate.language}
            translationStatus={fallbackTemplate.translationStatus}
          />
        ) : (
          <CreateGoogleFormCopyOption
            optionState={googleFormCopyOption}
            checked={createGoogleFormCopy}
            onCheckedChange={onCreateGoogleFormCopyChange}
            googleFormCopyLanguage={googleFormCopyLanguage}
            onGoogleFormCopyLanguageChange={onGoogleFormCopyLanguageChange}
            idPrefix="audit-template-edit-google-form-copy"
          />
        )}
        <p className="text-sm text-slate-600">
          {draft.sections.length} section{draft.sections.length === 1 ? "" : "s"} · {questionCount} question
          {questionCount === 1 ? "" : "s"}
        </p>

        <div className="space-y-4">
          {draft.sections.map((section, sectionIndex) => (
            <div key={`section-${sectionIndex}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={section.name}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sections: updateSectionName(draft.sections, sectionIndex, event.target.value),
                    })
                  }
                  className="min-w-[12rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, sections: moveSectionUp(draft.sections, sectionIndex) })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, sections: moveSectionDown(draft.sections, sectionIndex) })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, sections: removeSection(draft.sections, sectionIndex) })}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                >
                  Delete section
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {section.questions.map((question, questionIndex) => (
                  <div key={`question-${sectionIndex}-${questionIndex}`} className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Question
                      <textarea
                        value={question.question_text}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            sections: updateQuestionField(
                              draft.sections,
                              sectionIndex,
                              questionIndex,
                              "question_text",
                              event.target.value,
                            ),
                          })
                        }
                        className="mt-1 min-h-[4rem] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                      />
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-semibold text-slate-600">
                        Answer type
                        <select
                          value={question.answer_type}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              sections: updateQuestionField(
                                draft.sections,
                                sectionIndex,
                                questionIndex,
                                "answer_type",
                                event.target.value,
                              ),
                            })
                          }
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                        >
                          <option value="compliance">Compliance (Pass / Fail / N/A)</option>
                          <option value="yes_no">Yes / No</option>
                          <option value="text">Free text</option>
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">
                        Answer options (one per line)
                        <textarea
                          value={question.options.join("\n")}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              sections: updateQuestionOptions(
                                draft.sections,
                                sectionIndex,
                                questionIndex,
                                event.target.value,
                              ),
                            })
                          }
                          className="mt-1 min-h-[4rem] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-700">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={question.requires_comment_on_failure}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              sections: updateQuestionField(
                                draft.sections,
                                sectionIndex,
                                questionIndex,
                                "requires_comment_on_failure",
                                event.target.checked,
                              ),
                            })
                          }
                        />
                        Comment on failure
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={question.requires_action_on_failure}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              sections: updateQuestionField(
                                draft.sections,
                                sectionIndex,
                                questionIndex,
                                "requires_action_on_failure",
                                event.target.checked,
                              ),
                            })
                          }
                        />
                        Action on failure
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={question.allows_photo_evidence}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              sections: updateQuestionField(
                                draft.sections,
                                sectionIndex,
                                questionIndex,
                                "allows_photo_evidence",
                                event.target.checked,
                              ),
                            })
                          }
                        />
                        Photo / evidence
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            sections: moveQuestionUp(draft.sections, sectionIndex, questionIndex),
                          })
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            sections: moveQuestionDown(draft.sections, sectionIndex, questionIndex),
                          })
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            sections: removeQuestion(draft.sections, sectionIndex, questionIndex),
                          })
                        }
                        className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                      >
                        Delete question
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, sections: addQuestionToSection(draft.sections, sectionIndex) })}
                className={["mt-3 inline-flex h-10 items-center rounded-xl border px-3 text-xs font-semibold", theme.outlineButton].join(
                  " ",
                )}
              >
                Add question
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDraft({ ...draft, sections: addSection(draft.sections) })}
          className={["inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold", theme.outlineButton].join(
            " ",
          )}
        >
          Add section
        </button>

        {validationError ? <p className="text-sm font-medium text-rose-700">{validationError}</p> : null}
        {error && !showUsedWarning ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}

        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={saving}
            className={[
              "inline-flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60",
              theme.primaryButton,
              theme.primaryButtonHover,
            ].join(" ")}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <CopyAuditFormModal
        open={copyOpen}
        sourceTitle={draft.template_name}
        mode="form"
        busy={copyBusy}
        error={copyError}
        onCancel={() => {
          if (!copyBusy) setCopyOpen(false);
        }}
        onSubmit={(input) => void handleCopySubmit(input)}
      />
      <ReviseAuditFormModal
        open={reviseOpen}
        sourceTitle={draft.template_name}
        revisionLabel={
          recordMeta.revision_label ||
          `${recordMeta.form_number ? `${recordMeta.form_number} · ` : ""}Rev ${recordMeta.revision_number || recordMeta.version || 1}`
        }
        busy={reviseBusy}
        error={reviseError}
        onCancel={() => {
          if (!reviseBusy) setReviseOpen(false);
        }}
        onSubmit={(input) => void handleReviseSubmit(input)}
      />
    </div>
  );
}

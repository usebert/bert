import {
  defaultTranslationStatusForLanguage,
  normalizeFormLanguage,
  type FormLanguageCode,
} from "../config/templateLanguages";
import { googleFormTemplatesService, type GoogleFormTemplatePlacement } from "../services/googleFormTemplatesService";
import type { AuditQuestion, AuditTemplate } from "../types/reportsScreenProps";

export type GoogleFormCopyToast = {
  title: string;
  message: string;
  tone: "success" | "warning";
};

export type GoogleFormCopyResult = {
  templates: AuditTemplate[];
  toast?: GoogleFormCopyToast;
};

type CreateGoogleFormCopyInput = {
  templates: AuditTemplate[];
  templateId: string;
  templateName: string;
  templateCategory: string;
  templateLanguage: FormLanguageCode;
  defaultFormLanguage: FormLanguageCode;
  templateQuestions: AuditQuestion[];
  createCopy: boolean;
  googleConnected: boolean;
  googleFormCopyLanguage: FormLanguageCode;
  placement: GoogleFormTemplatePlacement;
  selectedFolderId: string;
  selectedFolderName: string;
  workspaceName: string;
  masterSheetId: string;
  currentUserName: string;
};

export async function applyGoogleFormCopyForTemplate(
  input: CreateGoogleFormCopyInput,
): Promise<GoogleFormCopyResult> {
  const nextTemplates = input.templates;
  if (!input.createCopy || !input.googleConnected) {
    return { templates: nextTemplates };
  }

  const companyStoredPath = "08 - Audits / Google Forms";
  const copyLanguage = normalizeFormLanguage(input.googleFormCopyLanguage || input.templateLanguage);

  try {
    const result = await googleFormTemplatesService.createFromBertTemplate(
      {
        id: input.templateId,
        name: input.templateName,
        category: input.templateCategory,
        source: "Built in app",
        questions: input.templateQuestions,
        sourceCompanyId: input.selectedFolderId,
        sourceCompanyName: input.selectedFolderName || input.workspaceName,
        companyRootFolderId: input.selectedFolderId,
        masterSheetId: input.masterSheetId || "",
        createdBy: input.currentUserName || "BERT",
        placement: input.placement,
        language: input.templateLanguage,
        defaultLanguage: input.defaultFormLanguage,
        translationStatus: defaultTranslationStatusForLanguage(copyLanguage),
      },
      { placement: input.placement, googleFormLanguage: copyLanguage },
    );

    if (result.ok && result.googleForm) {
      const storedPath =
        result.storedFolderPath ||
        result.googleForm.currentFolderPath ||
        (input.placement === "company"
          ? companyStoredPath
          : result.googleForm.currentDriveFolderName || "Drive");
      const googleFormMeta = {
        formId: result.googleForm.googleFormId,
        driveFileId: result.googleForm.googleFormDriveFileId,
        editUrl: result.googleForm.googleFormEditUrl,
        responderUrl: result.googleForm.googleFormResponderUrl,
        folderId: result.googleForm.currentDriveFolderId,
        folderName: result.googleForm.currentDriveFolderName,
        folderPath: storedPath,
        syncStatus: result.googleForm.syncStatus,
        notes: result.googleForm.notes,
      };
      const templatesWithGoogle = nextTemplates.map((template) =>
        template.id === input.templateId ? { ...template, googleForm: googleFormMeta } : template,
      );
      const storedLine =
        input.placement === "company" ? ` Stored in: ${companyStoredPath}.` : ` Stored in: ${storedPath}.`;
      const moveWarning =
        result.folderPlacementFailed || result.googleForm.syncStatus === "Created - move failed"
          ? " Google Form copy was created but could not be moved into the company audit folder."
          : "";
      return {
        templates: templatesWithGoogle,
        toast: {
          title: "Template added",
          message: `${input.templateName} is ready in BERT with a Google Form copy.${storedLine}${moveWarning}`,
          tone:
            result.folderPlacementFailed || result.googleForm.syncStatus === "Created - move failed"
              ? "warning"
              : "success",
        },
      };
    }

    if (result.permissionRequired) {
      return {
        templates: nextTemplates,
        toast: {
          title: "BERT template created",
          message: "Google Forms permission is not connected yet.",
          tone: "warning",
        },
      };
    }

    if (result.userMessage) {
      return {
        templates: nextTemplates,
        toast: {
          title: "BERT template created",
          message: result.userMessage,
          tone: "warning",
        },
      };
    }

    return {
      templates: nextTemplates,
      toast: {
        title: "BERT template created",
        message:
          input.placement === "company"
            ? "Google Form copy could not be stored in the company audit folder."
            : "Google Form copy could not be created.",
        tone: "warning",
      },
    };
  } catch {
    return {
      templates: nextTemplates,
      toast: {
        title: "BERT template created",
        message:
          input.placement === "company"
            ? "Google Form copy could not be stored in the company audit folder."
            : "Google Form copy could not be created.",
        tone: "warning",
      },
    };
  }
}

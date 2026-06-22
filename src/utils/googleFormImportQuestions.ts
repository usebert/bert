import type { AuditQuestion } from "../types/reportsScreenProps";

export const GOOGLE_FORM_IMPORT_STATUS = "Google Form Import";

export function buildGoogleFormImportQuestions(templateName: string, webViewLink?: string): AuditQuestion[] {
  const link = String(webViewLink || "").trim();
  const text = link ? `Complete linked Google Form (${link})` : "Complete linked Google Form";
  const safeName = String(templateName || "google-form").trim() || "google-form";

  return [
    {
      id: `${safeName}-google-form`,
      text,
      riskLevel: "Medium",
      riskCategory: "Quality",
      autoActionRequired: false,
      requiresPhotoEvidence: false,
      requiresManagerReview: false,
    },
  ];
}

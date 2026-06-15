import { validateCompanyDriveIds } from "../utils/googleDriveId";

const STORAGE_KEY = "bert_company_login_hint_v1";

export type CompanyLoginHint = {
  email: string;
  masterSheetId: string;
  companyFolderId?: string;
  companyName?: string;
  savedAt: number;
};

export function readCompanyLoginHint(): CompanyLoginHint | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CompanyLoginHint;
    const validated = validateCompanyDriveIds({
      companyFolderId: parsed.companyFolderId,
      masterSheetId: parsed.masterSheetId,
    });
    if (!parsed?.email || !validated) {
      return null;
    }
    return {
      email: String(parsed.email).trim().toLowerCase(),
      masterSheetId: validated.masterSheetId,
      companyFolderId: validated.companyFolderId,
      companyName: parsed.companyName ? String(parsed.companyName).trim() : undefined,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function saveCompanyLoginHint(hint: Omit<CompanyLoginHint, "savedAt">): void {
  const validated = validateCompanyDriveIds({
    companyFolderId: hint.companyFolderId,
    masterSheetId: hint.masterSheetId,
  });
  const email = String(hint.email).trim().toLowerCase();
  if (!email || !validated) {
    return;
  }
  const payload: CompanyLoginHint = {
    email,
    masterSheetId: validated.masterSheetId,
    companyFolderId: validated.companyFolderId,
    companyName: hint.companyName ? String(hint.companyName).trim() : undefined,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCompanyLoginHintForEmail(email: string): void {
  const hint = readCompanyLoginHint();
  if (!hint) {
    return;
  }
  if (hint.email === String(email).trim().toLowerCase()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

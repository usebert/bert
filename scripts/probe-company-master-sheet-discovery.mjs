#!/usr/bin/env node
/**
 * Operator probe — list master sheet discovery results for a company Drive folder.
 * Usage: node scripts/probe-company-master-sheet-discovery.mjs <companyFolderId> [companyName]
 */
import { discoverCompanyMasterSheetInFolder } from "../server/company-folder-structure.mjs";

const companyFolderId = String(process.argv[2] || "").trim();
const companyName = String(process.argv[3] || "").trim();

if (!companyFolderId) {
  console.error("Usage: node scripts/probe-company-master-sheet-discovery.mjs <companyFolderId> [companyName]");
  process.exit(1);
}

const { google } = await import("googleapis");
const tokenPath = process.env.BERT_GOOGLE_TOKEN_PATH || ".data/google-oauth.json";
let auth = null;
try {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(tokenPath, "utf8"));
  const session = JSON.parse(raw);
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth.setCredentials(session.tokens || session);
  auth = oauth;
} catch (error) {
  console.error("Could not load Google OAuth session from", tokenPath, error instanceof Error ? error.message : error);
  process.exit(1);
}

const drive = google.drive({ version: "v3", auth });
const discovered = await discoverCompanyMasterSheetInFolder(drive, { companyRootFolderId: companyFolderId, companyName });
console.log(JSON.stringify({ companyFolderId, companyName: companyName || undefined, discovered }, null, 2));

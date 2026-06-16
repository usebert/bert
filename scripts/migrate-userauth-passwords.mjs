#!/usr/bin/env node
/**
 * One-shot: hash plaintext `UserAuth.*` values in a company master sheet Config tab.
 * Uses the same Google OAuth session as the API (`./.sessions/google-session.json`).
 *
 * Usage (from repo root, after `npm run google:connect` or equivalent):
 *   node scripts/migrate-userauth-passwords.mjs <masterSpreadsheetId>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";
import { migrateAllPlainUserAuthKeys } from "../server/userauth-password.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const sheetId = String(process.argv[2] || "").trim();
if (!sheetId) {
  console.error("Usage: node scripts/migrate-userauth-passwords.mjs <masterSpreadsheetId>");
  process.exit(1);
}

const sessionsDirRaw = String(process.env.BERT_SESSIONS_DIR || "").trim();
const sessionsDir = sessionsDirRaw
  ? path.isAbsolute(sessionsDirRaw)
    ? path.normalize(sessionsDirRaw)
    : path.resolve(root, sessionsDirRaw)
  : path.join(root, ".sessions");
const sessionCandidates = [
  path.join(sessionsDir, "google-oauth-token.json"),
  path.join(sessionsDir, "google-session.json"),
  path.join(root, ".sessions", "google-session.json"),
];
const sessionPath = sessionCandidates.find((candidate) => fs.existsSync(candidate));
if (!sessionPath) {
  console.error(
    "Missing Google OAuth token file — connect Google on this machine first (see npm run google:connect).",
  );
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(session.tokens);

const CONFIG_HEADERS = ["Key", "Value", "Updated At"];
const CONFIG_KEYS = [
  "schemaVersion",
  "companyId",
  "companyName",
  "createdAt",
  "lastValidatedAt",
  "lastRepairedAt",
  "appVersion",
];

function rowsToRecords(values) {
  if (!values?.length) {
    return [];
  }
  const headers = values[0].map((c) => String(c || "").trim());
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

async function getConfig(a, spreadsheetId) {
  const sheets = google.sheets({ version: "v4", auth: a });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Config!A1:ZZ500",
  });
  const rows = rowsToRecords(response.data.values || []);
  return rows.reduce((acc, row) => {
    const key = String(row.Key || row.key || "").trim();
    if (!key) {
      return acc;
    }
    acc[key] = String(row.Value || row.value || "").trim();
    return acc;
  }, {});
}

async function updateConfig(a, spreadsheetId, patch) {
  const sheets = google.sheets({ version: "v4", auth: a });
  const merged = { ...(await getConfig(a, spreadsheetId)), ...patch };
  const orderedKeys = Array.from(new Set([...CONFIG_KEYS, ...Object.keys(merged)]));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Config!A:C",
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Config!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [CONFIG_HEADERS, ...orderedKeys.map((key) => [key, merged[key] || "", new Date().toISOString()])],
    },
  });
}

const result = await migrateAllPlainUserAuthKeys(auth, sheetId, getConfig, updateConfig);
console.log(JSON.stringify({ ok: true, sheetId, migrated: result.migrated }, null, 0));

#!/usr/bin/env node
/**
 * Risk Register schema and route wiring checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RISK_REGISTER_REQUIRED_TABS,
  RISK_REGISTER_TAB_COLUMNS,
  mapRiskRegisterRecord,
} from "../shared/risk-register.mjs";
import { calculateRiskScore, getRiskBand } from "../shared/risk-assessments.mjs";
import {
  buildProductionVerificationRiskRegister,
  isOperationalRiskRegisterItem,
  isVerificationRiskRegisterItem,
} from "../shared/production-verification-risk-register.mjs";

const routesSource = fs.readFileSync(new URL("../server/risk-register-routes.mjs", import.meta.url), "utf8");
const coreSource = fs.readFileSync(new URL("./lib/production-risk-register-workflow-core.mjs", import.meta.url), "utf8");

assert.equal(RISK_REGISTER_REQUIRED_TABS.length, 3, "schema: three required workbook tabs");
assert.ok(RISK_REGISTER_TAB_COLUMNS.includes("RiskId"), "schema: RiskId column");
assert.ok(RISK_REGISTER_TAB_COLUMNS.includes("RiskReference"), "schema: RiskReference column");
assert.ok(RISK_REGISTER_TAB_COLUMNS.includes("InitialRiskScore"), "schema: InitialRiskScore column");
assert.ok(routesSource.includes("/risk-register/verification"), "routes: verification endpoints registered before parameterized paths");
assert.ok(routesSource.includes("/risks/:riskId"), "routes: detail endpoint");
assert.ok(coreSource.includes("BERT Production Risk Register Workflow"), "workflow: report title");

const sample = buildProductionVerificationRiskRegister({ runId: 42, companyFolderId: "folder", ownerName: "owner@example.com" });
const mapped = mapRiskRegisterRecord({
  RiskId: sample.riskId,
  CompanyFolderId: sample.companyFolderId,
  RiskReference: sample.riskReference,
  Title: sample.title,
  Description: sample.description,
  Category: sample.category,
  Department: sample.department,
  SiteId: sample.siteId,
  OwnerName: sample.ownerName,
  Cause: sample.cause,
  Consequence: sample.consequence,
  InitialLikelihood: String(sample.initialLikelihood),
  InitialImpact: String(sample.initialImpact),
  InitialRiskScore: String(sample.initialRiskScore),
  InitialRiskBand: sample.initialRiskBand,
  ResidualLikelihood: String(sample.residualLikelihood),
  ResidualImpact: String(sample.residualImpact),
  ResidualRiskScore: String(sample.residualRiskScore),
  ResidualRiskBand: sample.residualRiskBand,
  Status: sample.status,
  ReviewDate: sample.reviewDate,
  Notes: sample.notes,
});
assert.equal(isVerificationRiskRegisterItem(mapped), true, "verification marker recognition");
assert.equal(isOperationalRiskRegisterItem(mapped), false, "active verification excluded operationally");
const score = calculateRiskScore(3, 3);
assert.equal(score, 9, "scoring: 3x3");
assert.equal(getRiskBand(score).label, "Moderate", "scoring: band");

console.log("Risk Register verification checks passed.");

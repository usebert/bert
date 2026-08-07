#!/usr/bin/env node
/**
 * Regression tests for company-users route scope enforcement (GET/PATCH/DELETE/verification).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertCompanyUsersRouteScope } from "../server/company-users-route-scope.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const FOLDER_A = "a".repeat(33);
const FOLDER_B = "b".repeat(33);
const SHEET_A = "s".repeat(44);
const SHEET_B = "t".repeat(44);

function companyActor(overrides = {}) {
  return {
    kind: "company",
    role: "Admin",
    email: "admin@example.com",
    companyFolderId: FOLDER_A,
    companyId: FOLDER_A,
    masterSheetId: SHEET_A,
    ...overrides,
  };
}

test("valid route folder + session match allows list scope", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: FOLDER_A,
    queryMasterSheetId: SHEET_A,
    actor: companyActor(),
  });
  assert.equal(scope.ok, true);
  assert.equal(scope.companyFolderId, FOLDER_A);
  assert.equal(scope.masterSheetId, SHEET_A);
  assert.equal(scope.trustSessionContext, true);
});

test("production repro: invalid-company-folder-id + valid masterSheetId is rejected", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: "invalid-company-folder-id",
    queryMasterSheetId: SHEET_A,
    actor: companyActor(),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
  assert.equal(scope.body.code, "SESSION_COMPANY_MISMATCH");
  assert.equal(scope.body.users, undefined);
});

test("valid folder B + sheet A for company A actor is rejected", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: FOLDER_B,
    queryMasterSheetId: SHEET_A,
    actor: companyActor(),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
  assert.equal(scope.body.users, undefined);
});

test("valid folder + foreign masterSheetId is rejected", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: FOLDER_A,
    queryMasterSheetId: SHEET_B,
    actor: companyActor(),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
  assert.equal(scope.body.blocker, "forbidden");
  assert.equal(scope.body.users, undefined);
});

test("query companyFolderId mismatch with route is rejected", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: FOLDER_A,
    queryCompanyFolderId: FOLDER_B,
    queryMasterSheetId: SHEET_A,
    actor: companyActor(),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
});

test("PATCH route scope rejects cross-company folder for company actor", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "PATCH /api/companies/:companyFolderId/users/:email",
    routeCompanyFolderId: FOLDER_B,
    queryMasterSheetId: SHEET_A,
    actor: companyActor({ role: "Admin" }),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
});

test("DELETE route scope rejects invalid master sheet for company actor", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "DELETE /api/companies/:companyFolderId/users/:email",
    routeCompanyFolderId: FOLDER_A,
    queryMasterSheetId: SHEET_B,
    actor: companyActor({ role: "Admin" }),
  });
  assert.equal(scope.ok, false);
  assert.equal(scope.httpStatus, 403);
});

test("godmode actor may target a different company folder", () => {
  const scope = assertCompanyUsersRouteScope({
    route: "GET /api/companies/:companyId/users",
    routeCompanyFolderId: FOLDER_B,
    queryMasterSheetId: SHEET_B,
    actor: {
      kind: "godmode",
      role: "Godmode",
      companyFolderId: FOLDER_A,
      masterSheetId: SHEET_A,
    },
  });
  assert.equal(scope.ok, true);
  assert.equal(scope.companyFolderId, FOLDER_B);
});

test("GET users route uses canonical scope guard and not actor folder fallback", () => {
  const coreRoutes = fs.readFileSync(path.join(root, "server/core-workflow-routes.mjs"), "utf8");
  const getUsersBlock = coreRoutes.slice(
    coreRoutes.indexOf('app.get("/api/companies/:companyId/users"'),
    coreRoutes.indexOf("app.get(", coreRoutes.indexOf('app.get("/api/companies/:companyId/users"') + 1),
  );
  assert.match(getUsersBlock, /assertCompanyUsersRouteScope\(/);
  assert.doesNotMatch(
    getUsersBlock,
    /req\.query\.companyFolderId \|\| actor\?\.companyFolderId \|\| actor\?\.companyId \|\| companyId/,
  );
});

test("PATCH DELETE and verification routes use canonical scope guard", () => {
  const serverSrc = fs.readFileSync(path.join(root, "server/server.mjs"), "utf8");
  assert.match(serverSrc, /assertCompanyUsersRouteScope\(/);
  assert.match(serverSrc, /verification-create[\s\S]*assertCompanyUsersRouteScope/);
  assert.match(serverSrc, /verification-cleanup[\s\S]*assertCompanyUsersRouteScope/);
});

test("scope module emits company-scope-server diagnostic", () => {
  const scopeSrc = fs.readFileSync(path.join(root, "server/company-users-route-scope.mjs"), "utf8");
  assert.match(scopeSrc, /\[user-permissions:company-scope-server\]/);
});

#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessmentAlreadyApproved,
  isTransientHttpStatus,
  isTransientNetworkError,
  isTransientWorkflowFailure,
  requestWithTransientRetries,
  reviewAlreadyRecorded,
} from "./lib/production-risk-assessment-transient-retry.mjs";

test("502/503/504 are transient HTTP statuses", () => {
  assert.equal(isTransientHttpStatus(502), true);
  assert.equal(isTransientHttpStatus(503), true);
  assert.equal(isTransientHttpStatus(504), true);
  assert.equal(isTransientHttpStatus(400), false);
  assert.equal(isTransientHttpStatus(500), false);
});

test("network and timeout errors are transient", () => {
  const timeout = new Error("Request timed out after 1000ms");
  timeout.code = "STAGE_TIMEOUT";
  assert.equal(isTransientNetworkError(timeout), true);
  const reset = new Error("fetch failed: ECONNRESET");
  assert.equal(isTransientNetworkError(reset), true);
  assert.equal(isTransientNetworkError(new Error("validation failed")), false);
});

test("requestWithTransientRetries retries 502 then succeeds", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    if (calls === 1) {
      return { status: 502, json: null };
    }
    return { status: 200, json: { ok: true } };
  };
  const result = await requestWithTransientRetries(request, "POST", "/review", {}, { maxRetries: 2, baseBackoffMs: 1 });
  assert.equal(calls, 2);
  assert.equal(result.response.status, 200);
  assert.equal(result.retried, true);
});

test("requestWithTransientRetries does not retry 400", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return { status: 400, json: { ok: false } };
  };
  const result = await requestWithTransientRetries(request, "POST", "/review", {}, { maxRetries: 2, baseBackoffMs: 1 });
  assert.equal(calls, 1);
  assert.equal(result.response.status, 400);
});

test("requestWithTransientRetries enforces maximum retry count", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return { status: 502, json: null };
  };
  const result = await requestWithTransientRetries(request, "POST", "/review", {}, { maxRetries: 2, baseBackoffMs: 1 });
  assert.equal(calls, 3);
  assert.equal(result.response.status, 502);
});

test("assessmentAlreadyApproved detects Active with approval metadata", () => {
  assert.equal(
    assessmentAlreadyApproved({
      status: 200,
      json: { ok: true, item: { status: "Active", approvedAt: "2026-01-01", approvedBy: "a@b.co" } },
    }),
    true,
  );
  assert.equal(
    assessmentAlreadyApproved({
      status: 200,
      json: { ok: true, item: { status: "Submitted" } },
    }),
    false,
  );
});

test("reviewAlreadyRecorded detects stable review id", () => {
  assert.equal(
    reviewAlreadyRecorded(
      {
        status: 200,
        json: { ok: true, reviews: [{ id: "bert-smoke-ra-review-1", outcome: "no_change" }] },
      },
      "bert-smoke-ra-review-1",
    ),
    true,
  );
  assert.equal(
    reviewAlreadyRecorded({ status: 200, json: { ok: true, reviews: [] } }, "bert-smoke-ra-review-1"),
    false,
  );
});

test("isTransientWorkflowFailure combines HTTP and network failures", () => {
  assert.equal(isTransientWorkflowFailure({ status: 502 }), true);
  assert.equal(isTransientWorkflowFailure(null, new Error("socket hang up")), true);
  assert.equal(isTransientWorkflowFailure({ status: 403 }), false);
});

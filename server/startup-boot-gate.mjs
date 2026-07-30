/**
 * Boot gate orchestration — critical checks before listen, deferred checks after.
 */
import { CHECK_STATUS, OVERALL_STATUS, deriveOverallStatus } from "./startup-health-manager.mjs";

export async function executeBootSequence(steps = {}) {
  const listenCalls = [];
  let backgroundStartCount = 0;
  const log = typeof steps.log === "function" ? steps.log : () => {};
  const exit = typeof steps.exit === "function" ? steps.exit : () => {};

  const critical = await steps.runCriticalBootChecks();
  if (typeof steps.onCriticalReport === "function") {
    steps.onCriticalReport(critical);
  }

  if (critical?.bootBlocked) {
    log("critical boot blocked");
    exit(1);
    return {
      listened: false,
      listenCalls,
      backgroundStartCount,
      critical,
      deferred: null,
      readiness: {
        phase: "failed",
        acceptingTraffic: false,
        status: OVERALL_STATUS.FAILED,
      },
    };
  }

  await new Promise((resolve, reject) => {
    try {
      steps.listen(() => {
        listenCalls.push(Date.now());
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

  if (typeof steps.startBackgroundServices === "function") {
    steps.startBackgroundServices();
    backgroundStartCount += 1;
  }

  const deferred = await steps.runDeferredReadinessChecks();
  const mergedChecks = [...(critical?.checks || []), ...(deferred?.checks || [])];
  const finalStatus = deriveOverallStatus(
    mergedChecks.map((check) => ({
      status: check.status,
      critical: !["Workbook", "Background Jobs"].includes(check.name),
    })),
  );
  const readiness = {
    phase: "ready",
    acceptingTraffic: finalStatus !== OVERALL_STATUS.FAILED,
    status: finalStatus,
    criticalStatus: critical?.status,
    deferredStatus: deferred?.status,
  };

  if (typeof steps.onFinalReport === "function") {
    steps.onFinalReport({ critical, deferred, readiness });
  }

  return {
    listened: true,
    listenCalls,
    backgroundStartCount,
    critical,
    deferred,
    readiness,
  };
}

export function buildPublicHealthPayload(basePayload = {}, readiness = {}) {
  const accepting = readiness.acceptingTraffic === true;
  const payload = {
    ...basePayload,
    ok: accepting && readiness.status !== OVERALL_STATUS.FAILED,
    ready: accepting,
    startupStatus: readiness.status || OVERALL_STATUS.FAILED,
    bootPhase: readiness.phase || "booting",
  };
  if (!accepting) {
    payload.ok = false;
  }
  return payload;
}

export function publicHealthStatusCode(payload = {}) {
  return payload.ok === true && payload.ready === true ? 200 : 503;
}

export function hasCriticalFailure(checks = []) {
  return checks.some((check) => check.status === CHECK_STATUS.FAIL && check.critical !== false);
}

/**
 * Gate live workbook writes from verifier scripts.
 * Live Users tab (and related) writes require BERT_ALLOW_LIVE_VERIFY_WRITES=1.
 */

export function liveVerifyWritesAllowed() {
  return String(process.env.BERT_ALLOW_LIVE_VERIFY_WRITES || "").trim() === "1";
}

export function logLiveVerifyWritesSkipped(scriptName) {
  console.error(
    [
      `[${scriptName}] Live journey skipped — live workbook writes require BERT_ALLOW_LIVE_VERIFY_WRITES=1.`,
      "Static guards still run. Set the env var only when targeting a disposable test workbook.",
    ].join("\n"),
  );
}

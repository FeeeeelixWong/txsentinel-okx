const { POLICY_VERSION, SUPPORTED_CHAINS, validateTransaction } = require("./policy");

const PREFLIGHT_STATUS = Object.freeze({
  READY: "READY",
  REVIEW: "REVIEW",
  BLOCKED: "BLOCKED"
});
const SUPPORTED_OPERATIONS = new Set(["transfer", "approval", "swap", "contract_call"]);

const SAMPLE_INPUT = Object.freeze({
  chain: "xlayer",
  operation: "transfer",
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  amountUsd: 25,
  policy: {
    maxSpendUsd: 100,
    denyUnlimitedApprovals: true,
    requireSimulation: true
  },
  simulation: {
    status: "succeeded",
    estimatedFeeUsd: 0.01
  }
});

function nextStep(status) {
  if (status === "READY") {
    return {
      action: "REQUEST_PAID_CHECK",
      label: "Request the formal policy decision and deterministic receipt",
      endpoint: "/api/check-paid"
    };
  }

  if (status === "REVIEW") {
    return {
      action: "REVIEW_OR_REQUEST_PAID_REPORT",
      label: "Ask for human review or purchase the detailed policy report",
      endpoint: "/api/check-paid"
    };
  }

  return {
    action: "STOP_OR_REQUEST_PAID_REPORT",
    label: "Stop the proposed action or purchase the detailed policy report",
    endpoint: "/api/check-paid"
  };
}

function screenReadiness(input) {
  const chain = String(input.chain || "xlayer").toLowerCase();
  const operation = String(input.operation || "transfer").toLowerCase();
  const policy = input.policy || {};
  const simulation = input.simulation || null;

  if (!SUPPORTED_CHAINS[chain] || !SUPPORTED_OPERATIONS.has(operation)) return "BLOCKED";
  if (simulation?.status === "reverted") return "BLOCKED";
  if (operation === "approval" && policy.denyUnlimitedApprovals !== false && input.approvalAmount === "unlimited") {
    return "BLOCKED";
  }

  if (!input.to) return "REVIEW";
  if (Number.isFinite(input.amountUsd) && Number.isFinite(policy.maxSpendUsd) && input.amountUsd > policy.maxSpendUsd) {
    return "REVIEW";
  }
  if (policy.requireSimulation === true && (!simulation || simulation.status === "not_run")) return "REVIEW";

  return "READY";
}

function preflightTransaction(input) {
  const validation = validateTransaction(input);
  if (!validation.success) return validation;

  const chain = String(validation.data.chain || "xlayer").toLowerCase();
  const operation = String(validation.data.operation || "transfer").toLowerCase();
  const status = screenReadiness(validation.data);

  return {
    success: true,
    data: validation.data,
    preflight: {
      status,
      chain,
      operation,
      billing: "free",
      binding: false,
      formalDecision: false,
      receiptIssued: false,
      next: nextStep(status),
      limitations: [
        "READY does not imply ALLOW; the formal engine evaluates additional rules",
        "No formal ALLOW, HOLD, or DENY decision",
        "No detailed rule evidence or risk score",
        "No action digest or deterministic receipt hash",
        "Not an authorization to sign or execute the proposed action"
      ]
    }
  };
}

function createPreflightHandler({ legacy = false } = {}) {
  return function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-TxSentinel-Mode", "preflight");
    if (legacy) {
      res.setHeader("Deprecation", "true");
      res.setHeader("Link", "</api/preflight>; rel=\"successor-version\"");
    }

    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method === "GET") {
      return res.status(200).json({
        service: "TxSentinel Free Preflight",
        status: "ready",
        mode: "preflight",
        endpoint: "/api/preflight",
        legacyAlias: legacy ? "/api/check" : null,
        paidEndpoint: "/api/check-paid",
        policyVersion: POLICY_VERSION,
        supportedChains: Object.keys(SUPPORTED_CHAINS),
        operations: ["transfer", "approval", "swap", "contract_call"],
        preflightStatuses: ["READY", "REVIEW", "BLOCKED"],
        sampleInput: SAMPLE_INPUT
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const suppliedInput = req.body && Object.keys(req.body).length > 0;
    const candidate = suppliedInput ? req.body : SAMPLE_INPUT;
    const result = preflightTransaction(candidate);

    if (!result.success) {
      return res.status(422).json({
        ok: false,
        mode: "preflight",
        error: "INVALID_POLICY_REQUEST",
        issues: result.issues
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "preflight",
      inputMode: suppliedInput ? "request" : "review-sample",
      checkedAt: new Date().toISOString(),
      preflight: result.preflight
    });
  };
}

module.exports = {
  PREFLIGHT_STATUS,
  SAMPLE_INPUT,
  createPreflightHandler,
  preflightTransaction,
  screenReadiness
};

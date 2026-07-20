const { POLICY_VERSION, SUPPORTED_CHAINS, evaluateTransaction, validateTransaction } = require("../lib/policy");

const SAMPLE_INPUT = {
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
};

function sendEvaluation(req, res) {
  const suppliedInput = req.body && Object.keys(req.body).length > 0;
  const candidate = suppliedInput ? req.body : SAMPLE_INPUT;
  const validation = validateTransaction(candidate);

  if (!validation.success) {
    return res.status(422).json({
      ok: false,
      error: "INVALID_POLICY_REQUEST",
      issues: validation.issues
    });
  }

  return res.status(200).json({
    ok: true,
    inputMode: suppliedInput ? "request" : "review-sample",
    evaluatedAt: new Date().toISOString(),
    result: evaluateTransaction(validation.data)
  });
}

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      service: "TxSentinel Transaction Policy Check",
      status: "ready",
      policyVersion: POLICY_VERSION,
      method: "POST",
      endpoint: "/api/check",
      paidEndpoint: "/api/check-paid",
      supportedChains: Object.keys(SUPPORTED_CHAINS),
      operations: ["transfer", "approval", "swap", "contract_call"],
      decisions: ["ALLOW", "HOLD", "DENY"],
      sampleInput: SAMPLE_INPUT
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  return sendEvaluation(req, res);
};

module.exports.sendEvaluation = sendEvaluation;

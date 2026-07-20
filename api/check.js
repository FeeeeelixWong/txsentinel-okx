const { evaluateTransaction } = require("../lib/policy");

const SAMPLE_INPUT = {
  chain: "xlayer",
  operation: "transfer",
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  amountUsd: 25,
  policy: {
    maxSpendUsd: 100,
    denyUnlimitedApprovals: true
  }
};

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      service: "TxSentinel Transaction Policy Check",
      status: "ready",
      method: "POST",
      endpoint: "/api/check",
      supportedChains: ["xlayer", "ethereum", "base", "solana"],
      decisions: ["ALLOW", "HOLD", "DENY"],
      sampleInput: SAMPLE_INPUT
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const suppliedInput = req.body && Object.keys(req.body).length > 0;
  const result = evaluateTransaction(suppliedInput ? req.body : SAMPLE_INPUT);

  return res.status(200).json({
    ok: true,
    inputMode: suppliedInput ? "request" : "review-sample",
    result
  });
};


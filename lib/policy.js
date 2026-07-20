const crypto = require("node:crypto");
const { z } = require("zod");

const POLICY_VERSION = "txsentinel-1.0.0";
const SUPPORTED_CHAINS = Object.freeze({
  xlayer: { caip2: "eip155:196", family: "evm" },
  ethereum: { caip2: "eip155:1", family: "evm" },
  base: { caip2: "eip155:8453", family: "evm" },
  solana: { caip2: "solana:mainnet", family: "solana" }
});
const SUPPORTED_OPERATIONS = new Set(["transfer", "approval", "swap", "contract_call"]);
const DECISION_RANK = { ALLOW: 0, HOLD: 1, DENY: 2 };
const SEVERITY_SCORE = { info: 0, low: 10, medium: 30, high: 60, critical: 100 };

const finiteNumber = z.number().finite();
const transactionSchema = z
  .object({
    chain: z.string().trim().min(1).max(32).optional(),
    operation: z.string().trim().min(1).max(32).optional(),
    from: z.string().trim().max(128).optional(),
    to: z.string().trim().max(128).optional(),
    amountUsd: finiteNumber.nonnegative().optional(),
    approvalAmount: z.union([finiteNumber.nonnegative(), z.literal("unlimited")]).optional(),
    policy: z
      .object({
        maxSpendUsd: finiteNumber.nonnegative().optional(),
        allowlistedRecipients: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
        blockedRecipients: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
        denyUnlimitedApprovals: z.boolean().optional(),
        requireSimulation: z.boolean().optional(),
        requireVerifiedContract: z.boolean().optional(),
        maxSlippageBps: finiteNumber.nonnegative().max(10000).optional(),
        maxFeeUsd: finiteNumber.nonnegative().optional()
      })
      .strict()
      .optional(),
    simulation: z
      .object({
        status: z.enum(["succeeded", "reverted", "not_run"]),
        reason: z.string().trim().max(280).optional(),
        estimatedFeeUsd: finiteNumber.nonnegative().optional(),
        slippageBps: finiteNumber.nonnegative().max(10000).optional(),
        contractVerified: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict();

function normalizeIdentity(value, chain) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return SUPPORTED_CHAINS[chain]?.family === "evm" ? normalized.toLowerCase() : normalized;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return `0x${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function highestDecision(current, candidate) {
  return DECISION_RANK[candidate] > DECISION_RANK[current] ? candidate : current;
}

function validateTransaction(input) {
  const parsed = transactionSchema.safeParse(input);

  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message
    }))
  };
}

function evaluateTransaction(input = {}) {
  const chain = String(input.chain || "xlayer").toLowerCase();
  const operation = String(input.operation || "transfer").toLowerCase();
  const amountUsd = Number(input.amountUsd ?? 0);
  const from = normalizeIdentity(input.from, chain);
  const recipient = normalizeIdentity(input.to, chain);
  const suppliedPolicy = input.policy && typeof input.policy === "object" ? input.policy : {};
  const simulation = input.simulation && typeof input.simulation === "object" ? input.simulation : null;
  const maxSpendUsd = Number(suppliedPolicy.maxSpendUsd ?? 1000);
  const maxSlippageBps = Number(suppliedPolicy.maxSlippageBps ?? 100);
  const maxFeeUsd = Number(suppliedPolicy.maxFeeUsd ?? 25);
  const allowlist = Array.isArray(suppliedPolicy.allowlistedRecipients)
    ? suppliedPolicy.allowlistedRecipients.map((value) => normalizeIdentity(value, chain)).filter(Boolean).sort()
    : [];
  const blockedRecipients = Array.isArray(suppliedPolicy.blockedRecipients)
    ? suppliedPolicy.blockedRecipients.map((value) => normalizeIdentity(value, chain)).filter(Boolean).sort()
    : [];
  const reasons = [];
  let decision = "ALLOW";

  function flag(candidate, code, severity, detail, evidence = {}) {
    decision = highestDecision(decision, candidate);
    reasons.push({ code, severity, detail, evidence });
  }

  if (!SUPPORTED_CHAINS[chain]) {
    flag("DENY", "UNSUPPORTED_CHAIN", "critical", `${chain} is not supported`, { chain });
  }

  if (!SUPPORTED_OPERATIONS.has(operation)) {
    flag("DENY", "UNSUPPORTED_OPERATION", "critical", `${operation} is not supported`, { operation });
  }

  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    flag("DENY", "INVALID_AMOUNT", "critical", "amountUsd must be a non-negative finite number", { amountUsd: input.amountUsd });
  }

  if (simulation?.status === "reverted") {
    flag("DENY", "SIMULATION_REVERTED", "critical", simulation.reason || "Transaction simulation reverted", {
      simulationStatus: simulation.status
    });
  }

  if (operation === "approval" && suppliedPolicy.denyUnlimitedApprovals !== false && input.approvalAmount === "unlimited") {
    flag("DENY", "UNLIMITED_APPROVAL", "critical", "Unlimited token approval violates policy", {
      approvalAmount: "unlimited"
    });
  }

  if (recipient && blockedRecipients.includes(recipient)) {
    flag("DENY", "RECIPIENT_BLOCKED", "critical", "Recipient is explicitly blocked by policy", { recipient });
  }

  if (Number.isFinite(amountUsd) && Number.isFinite(maxSpendUsd) && amountUsd > maxSpendUsd) {
    flag("HOLD", "SPEND_LIMIT_EXCEEDED", "high", `${amountUsd} USD exceeds the ${maxSpendUsd} USD policy limit`, {
      observedUsd: amountUsd,
      limitUsd: maxSpendUsd
    });
  }

  if (allowlist.length > 0 && recipient && !allowlist.includes(recipient)) {
    flag("HOLD", "RECIPIENT_NOT_ALLOWLISTED", "high", "Recipient requires manual approval", { recipient });
  }

  if (!recipient) {
    flag("HOLD", "RECIPIENT_MISSING", "medium", "No recipient was supplied");
  }

  if (suppliedPolicy.requireSimulation === true && (!simulation || simulation.status === "not_run")) {
    flag("HOLD", "SIMULATION_REQUIRED", "high", "Policy requires successful transaction simulation", {
      simulationStatus: simulation?.status || "missing"
    });
  }

  if (
    suppliedPolicy.requireVerifiedContract === true &&
    ["approval", "swap", "contract_call"].includes(operation) &&
    simulation?.contractVerified !== true
  ) {
    flag("HOLD", "CONTRACT_NOT_VERIFIED", "high", "Contract verification evidence is required", {
      contractVerified: simulation?.contractVerified ?? null
    });
  }

  if (Number.isFinite(simulation?.slippageBps) && Number.isFinite(maxSlippageBps) && simulation.slippageBps > maxSlippageBps) {
    flag("HOLD", "SLIPPAGE_LIMIT_EXCEEDED", "high", `${simulation.slippageBps} bps exceeds the ${maxSlippageBps} bps limit`, {
      observedBps: simulation.slippageBps,
      limitBps: maxSlippageBps
    });
  }

  if (Number.isFinite(simulation?.estimatedFeeUsd) && Number.isFinite(maxFeeUsd) && simulation.estimatedFeeUsd > maxFeeUsd) {
    flag("HOLD", "FEE_LIMIT_EXCEEDED", "medium", `${simulation.estimatedFeeUsd} USD estimated fee exceeds the ${maxFeeUsd} USD limit`, {
      observedUsd: simulation.estimatedFeeUsd,
      limitUsd: maxFeeUsd
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      code: "POLICY_CHECKS_PASSED",
      severity: "info",
      detail: "The proposed action satisfies every supplied policy constraint",
      evidence: { checks: 8 }
    });
  }

  const policySnapshot = {
    maxSpendUsd: Number.isFinite(maxSpendUsd) ? maxSpendUsd : null,
    allowlistedRecipients: allowlist,
    blockedRecipients,
    denyUnlimitedApprovals: suppliedPolicy.denyUnlimitedApprovals !== false,
    requireSimulation: suppliedPolicy.requireSimulation === true,
    requireVerifiedContract: suppliedPolicy.requireVerifiedContract === true,
    maxSlippageBps: Number.isFinite(maxSlippageBps) ? maxSlippageBps : null,
    maxFeeUsd: Number.isFinite(maxFeeUsd) ? maxFeeUsd : null
  };
  const action = {
    chain,
    caip2: SUPPORTED_CHAINS[chain]?.caip2 || null,
    operation,
    from,
    to: recipient,
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
    approvalAmount: input.approvalAmount ?? null
  };
  const evidence = {
    simulationStatus: simulation?.status || "not_supplied",
    estimatedFeeUsd: Number.isFinite(simulation?.estimatedFeeUsd) ? simulation.estimatedFeeUsd : null,
    slippageBps: Number.isFinite(simulation?.slippageBps) ? simulation.slippageBps : null,
    contractVerified: simulation?.contractVerified ?? null
  };
  const riskScore = Math.min(
    100,
    reasons.reduce((score, reason) => score + SEVERITY_SCORE[reason.severity], 0)
  );
  const actionDigest = sha256({ action, policy: policySnapshot, evidence });
  const receipt = {
    policyVersion: POLICY_VERSION,
    actionDigest,
    action,
    policy: policySnapshot,
    evidence,
    decision,
    riskScore,
    reasons
  };

  return {
    service: "TxSentinel Transaction Policy Check",
    ...receipt,
    receiptHash: sha256(receipt),
    deterministic: true
  };
}

module.exports = {
  POLICY_VERSION,
  SUPPORTED_CHAINS,
  evaluateTransaction,
  stableStringify,
  validateTransaction
};
